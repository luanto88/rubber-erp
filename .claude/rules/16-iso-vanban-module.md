---
description: Module ISO & Văn bản nội bộ — workflow ký duyệt, chữ ký số PIN, PDF generation
---

# Module ISO & Văn bản Nội bộ

## Phạm vi

Thay thế hoàn toàn AppSheet + Google Apps Script cho việc quản lý:

- **ISO** (`/dashboard/iso/`): quy trình, hướng dẫn, biểu mẫu, TCCS — vòng đời từ soạn thảo đến ban hành và hủy hiệu lực
- **Văn bản nội bộ** (`/dashboard/documents/`): công văn, thông báo, quyết định — vòng ký phòng ban và phê duyệt BGĐ

Không có migration dữ liệu cũ — chỉ quản lý tài liệu tạo mới từ ERP.  
Mọi dữ liệu phải có `factory_id`, filter theo nhà máy đang đăng nhập.

---

## Migration

File: `supabase/migrations/20260522_iso_vanban_module.sql`

Tạo 5 bảng + triggers + RLS + 14 permissions:

- `sign_pins` — bcrypt hash PIN của từng user
- `iso_documents` — tài liệu ISO
- `van_ban_documents` — văn bản nội bộ
- `doc_approval_log` — audit trail mọi thao tác ký duyệt
- `notifications` — thông báo in-app

---

## Bảng `iso_documents`

```sql
id UUID PK, factory_id UUID,
ma_tai_lieu TEXT,       -- QLCL-QT-01
ten_tai_lieu TEXT NOT NULL,
loai_tai_lieu TEXT,     -- QT|HD|BM|TCCS|QC|KH|BC|Khác
phong_ban TEXT,
cap_tl TEXT,            -- "Cấp 1" | "Cấp 2"
chon_quy_trinh TEXT,    -- "Soạn thảo" | "Soát xét"
loai_vb TEXT,           -- "Thường" | "Mật"
lan_ban_hanh INTEGER DEFAULT 1,

trang_thai TEXT DEFAULT 'draft',
-- draft | cho_xem_xet | cho_phe_duyet | co_hieu_luc | het_hieu_luc | tra_ve

soan_thao TEXT,         -- snapshot tên người soạn thảo
xem_xet TEXT,           -- snapshot tên người xem xét
phe_duyet TEXT,         -- snapshot tên người phê duyệt

soan_thao_user_id UUID → auth.users,
xem_xet_user_id UUID → auth.users,
phe_duyet_user_id UUID → auth.users,

-- Timestamps từng bước ký
ky_soan_thao_at TIMESTAMPTZ,  -- khi Gửi xem xét / Gửi phê duyệt (Cấp 2)
ky_xem_xet_at TIMESTAMPTZ,   -- khi người xem xét Gửi phê duyệt
ky_phe_duyet_at TIMESTAMPTZ, -- khi phê duyệt

file_goc_url TEXT,            -- Supabase Storage: file gốc do user upload
file_signed_pdf_url TEXT,     -- PDF cuối với chữ ký nhúng

ma_tai_lieu_moi TEXT,         -- khi Soát xét đổi mã
ngay_hieu_luc TIMESTAMPTZ,
ngay_het_hieu_luc TIMESTAMPTZ,
ghi_chu TEXT,                 -- lý do trả về (khi tra_ve)
qr_url TEXT,

created_by UUID → auth.users,
created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
```

---

## Bảng `van_ban_documents`

```sql
id UUID PK, factory_id UUID,
ma_van_ban TEXT,        -- auto-gen: VB-DDMMYY/NNN
ten_van_ban TEXT NOT NULL,
phong_ban TEXT,
cap_tl TEXT,            -- "Cấp 1" | "Cấp 2"
loai_vb TEXT,           -- "Thường" | "Mật"

ky_phong_ban TEXT[],    -- danh sách phòng ban ký theo thứ tự (Cấp 1)
count_pb INTEGER DEFAULT 0,       -- bước hiện tại trong vòng ký (0-based)
pb_ky_hien_tai TEXT,    -- phòng ban đang chờ ký
ky_phong_ban_at JSONB DEFAULT '{}', -- {phong_ban: ISO_timestamp}

soan_thao TEXT,         -- snapshot tên người soạn thảo
soan_thao_user_id UUID,
phe_duyet TEXT,         -- snapshot tên người phê duyệt
phe_duyet_user_id UUID,

file_goc_url TEXT,
file_signed_pdf_url TEXT,
trang_thai TEXT DEFAULT 'draft',
-- draft | cho_pb{N}_ky | cho_phe_duyet | da_phe_duyet | tra_ve
noi_dung_kky TEXT,      -- lý do không ký / trả về

ngay_ban_hanh TIMESTAMPTZ,
ky_phe_duyet_at TIMESTAMPTZ,
qr_url TEXT,

created_by UUID → auth.users,
created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
```

---

## Bảng `sign_pins`

```sql
user_id UUID PK → auth.users,
pin_hash TEXT NOT NULL,   -- bcrypt hash, cost=12
updated_at TIMESTAMPTZ
```

RLS: user chỉ đọc được bản ghi của chính mình (`user_id = auth.uid()`).  
Service role được gọi từ API routes để upsert.

---

## Bảng `doc_approval_log` (audit trail)

```sql
id UUID PK,
doc_id UUID,          -- iso_documents.id hoặc van_ban_documents.id
doc_type TEXT,        -- 'iso' | 'van_ban'
factory_id UUID,
user_id UUID → auth.users,
action TEXT,          -- 'gui_xem_xet'|'gui_phe_duyet'|'phe_duyet'|'tra_ve'|'ky_phong_ban'|'tu_choi'
phong_ban TEXT,
buoc_ky INTEGER,
ly_do TEXT,
ip_address TEXT,
user_agent TEXT,
created_at TIMESTAMPTZ
```

---

## Bảng `notifications`

```sql
id UUID PK,
factory_id UUID,
user_id UUID → auth.users,   -- người nhận
type TEXT,                   -- 'cho_ky' | 'phan_phoi' | 'het_hieu_luc'
doc_id UUID,
doc_type TEXT,               -- 'iso' | 'van_ban'
title TEXT,
body TEXT,
is_read BOOLEAN DEFAULT false,
link TEXT,                   -- URL trang chi tiết
created_at TIMESTAMPTZ
```

RLS:
- SELECT: `user_id = auth.uid()`
- INSERT: `WITH CHECK (true)` — service role từ API
- UPDATE: `user_id = auth.uid()` — chỉ self-mark as read

---

## Permissions (14 quyền)

```
iso.view / iso.create / iso.edit / iso.delete
iso.xem_xet / iso.phe_duyet / iso.print
documents.view / documents.create / documents.edit / documents.delete
documents.ky_phong_ban / documents.phe_duyet / documents.print
```

Guard bắt buộc ở cả UI và logic thao tác.

---

## Workflow ISO

### Trạng thái

```
draft → cho_xem_xet → cho_phe_duyet → co_hieu_luc → het_hieu_luc
                    ↗ (Cấp 2 bỏ qua cho_xem_xet)
```

- **Cấp 1** (3 bước): `draft → cho_xem_xet → cho_phe_duyet → co_hieu_luc`
- **Cấp 2** (2 bước): `draft → cho_phe_duyet → co_hieu_luc`
- `tra_ve`: soạn thảo viên nhận lại, tài liệu quay về draft sau khi sửa

### Quy trình Soát xét

Khi tạo tài liệu với `chon_quy_trinh = "Soát xét"`:
- Sau khi `phe_duyet`, auto-UPDATE tất cả tài liệu cùng `ma_tai_lieu` + `trang_thai = 'co_hieu_luc'` → `het_hieu_luc`
- Trừ tài liệu hiện tại (id ≠ current)
- Logic thực hiện trong client sau khi Supabase cập nhật thành công

### Actions và timestamp mapping

| Action | Trường cập nhật |
|--------|----------------|
| `gui_xem_xet` (Cấp 1) | `trang_thai='cho_xem_xet'`, `ky_soan_thao_at=now()` |
| `gui_phe_duyet` từ draft (Cấp 2) | `trang_thai='cho_phe_duyet'`, `ky_soan_thao_at=now()` |
| `gui_phe_duyet` từ cho_xem_xet | `trang_thai='cho_phe_duyet'`, `ky_xem_xet_at=now()` |
| `phe_duyet` | `trang_thai='co_hieu_luc'`, `ky_phe_duyet_at=now()`, `ngay_hieu_luc=now()` |
| `tra_ve` | `trang_thai='tra_ve'`, `ghi_chu=lyDoTraVe` |

Mọi action đều INSERT vào `doc_approval_log`.

---

## Workflow Văn bản

### Trạng thái

```
Cấp 1: draft → cho_pb1_ky → cho_pb2_ky → ... → cho_phe_duyet → da_phe_duyet
Cấp 2: draft → cho_phe_duyet → da_phe_duyet
Từ chối/Trả về: bất kỳ bước nào → tra_ve
```

- `ky_phong_ban[]`: danh sách phòng ban ký theo thứ tự (Cấp 1)
- `count_pb`: bước hiện tại (0-based index vào `ky_phong_ban`)
- `pb_ky_hien_tai`: phòng ban đang chờ ký (= `ky_phong_ban[count_pb]`)
- Sau khi phòng ban N ký xong: `count_pb++`, `pb_ky_hien_tai = ky_phong_ban[count_pb]`
- Nếu hết danh sách: chuyển `cho_phe_duyet`
- `ky_phong_ban_at` (JSONB): lưu timestamp ký của từng phòng ban `{ "QLCL": "2026-05-22T..." }`

---

## Chữ ký số — PIN + Ảnh

### Cơ chế bảo mật

```
User bấm nút ký duyệt
  → Modal: nhập PIN (4–6 số, ẩn)
  → POST /api/sign/verify { userId, pin, docId, docType }
      Server: bcrypt.compare(pin, sign_pins.pin_hash)
      Nếu đúng: SignJWT { userId, docId, docType } exp=5m, alg=HS256
      ← token (5 phút)
  → POST /api/sign/generate-pdf { token, signaturePlacement, pdfStoragePath }
      Server: jwtVerify(token) → lấy ảnh chữ ký từ Storage → pdf-lib embed → upload
      ← signed PDF URL
  → Cập nhật trạng thái tài liệu
  → INSERT doc_approval_log
```

### JWT Secret

```
process.env.SIGN_JWT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
```

Biến `SIGN_JWT_SECRET` là optional — nếu không có, fallback về `SUPABASE_SERVICE_ROLE_KEY`.

### API Routes

| Route | Method | Mô tả |
|-------|--------|--------|
| `/api/sign/set-pin` | POST | Nhận `{userId, pin}` → `bcrypt.hash(pin, 12)` → upsert `sign_pins` |
| `/api/sign/verify` | POST | Nhận `{userId, pin, docId, docType}` → verify bcrypt → trả JWT 5 phút |
| `/api/sign/generate-pdf` | POST | Nhận `{token, signaturePlacement, pdfStoragePath}` → verify JWT → nhúng chữ ký → upload PDF |

### Ảnh chữ ký

- Storage bucket: `iso-documents` (public)
- Path: `signatures/{factory_id}/{user_id}/chu_ky.png`
- Upload: upsert=true, overwrite nếu đã tồn tại
- Quản lý tại: `Cài đặt → ISO & Văn bản → Chữ ký cá nhân`

### signaturePlacement object

```typescript
type SignaturePlacement = {
  page: number    // số trang (1-based)
  x: number       // tọa độ từ trái (pt)
  y: number       // tọa độ từ đáy (pt) — pdf-lib dùng bottom-left origin
  width: number   // chiều rộng (pt)
  height: number  // chiều cao (pt)
}
```

---

## Supabase Storage — bucket `iso-documents`

Bucket **public**, tạo thủ công trong Supabase Dashboard.

| Mục đích | Path |
|----------|------|
| File gốc upload | `{factory_id}/iso/{timestamp}_{filename}` |
| Ảnh chữ ký | `signatures/{factory_id}/{user_id}/chu_ky.png` |
| PDF đã ký (working) | `{factory_id}/iso/signed/{docId}_signed.pdf` |

File gốc không bao giờ bị modify — chỉ đọc để preview/download.  
Hệ thống chỉ tạo PDF mới (trang phiếu ký duyệt + chữ ký nhúng) bằng `pdf-lib`.

---

## PDF Generation — Phiếu ký duyệt

Thay vì chèn thẳng vào file gốc, hệ thống tạo riêng **trang Phiếu ký duyệt** chứa chữ ký:

```
┌─────────────────────────────────────────────┐
│  [Tên công ty]         [Mã TL: QT-01]       │
│  PHIẾU XÁC NHẬN KÝ DUYỆT   [Lần BH: 01]   │
├──────────────┬───────────────┬──────────────┤
│  Soạn thảo  │   Xem xét    │  Phê duyệt   │
│  [img chữký]│  [img chữký] │  [img chữký] │
│  Nguyễn A   │  Trần B      │  Lê C        │
│  dd/mm/yyyy │  dd/mm/yyyy  │  dd/mm/yyyy  │
└─────────────┴──────────────┴──────────────┘
│  [QR code → link ERP]                       │
└─────────────────────────────────────────────┘
```

- Mỗi bước ký: re-generate trang phiếu (thêm chữ ký mới) + ghép lại với `pdf-lib`
- `file_signed_pdf_url`: được cập nhật sau mỗi bước ký

---

## Drag-and-drop Signature Placement (đang pending)

Khi bấm "Ký duyệt", UI mở màn chọn vị trí:

1. `pdfjs-dist` render trang PDF thành canvas
2. `react-draggable` + `re-resizable` overlay ảnh chữ ký lên canvas
3. User kéo/resize chữ ký vào đúng vị trí
4. Tọa độ `{page, x, y, width, height}` được lưu vào state
5. User nhập PIN → `POST /api/sign/verify` → nhận token
6. `POST /api/sign/generate-pdf` với tọa độ đã chọn
7. Nhận URL PDF mới, cập nhật `file_signed_pdf_url`

---

## Packages

| Package | Mục đích |
|---------|----------|
| `pdf-lib` | Nhúng ảnh chữ ký vào PDF + ghép trang |
| `pdfjs-dist` | Render PDF thành canvas để preview |
| `@react-pdf/renderer` | Tạo trang Phiếu ký duyệt |
| `bcryptjs` + `@types/bcryptjs` | Hash/verify PIN |
| `react-draggable` | Drag chữ ký trên canvas |
| `re-resizable` | Resize ảnh chữ ký |
| `jose` | Mint/verify JWT (HS256) |

---

## Cấu trúc thư mục

```text
src/app/dashboard/iso/
  page.tsx                      -- Overview KPI: tổng, co_hieu_luc, chờ duyệt
  documents/
    page.tsx                    -- Danh sách + bộ lọc
    new/page.tsx                -- Redirect → new-doc
    [id]/page.tsx               -- Form tạo/xem/ký duyệt (docId="new-doc" = tạo mới)
  my-tasks/page.tsx             -- Tài liệu cần tôi xem xét / ký
  _components/
    iso-shell.tsx               -- Tab navigation (Tổng quan / Tài liệu ISO / Việc của tôi)
    iso-types.ts                -- Types, TRANG_THAI_LABEL, TRANG_THAI_COLOR, helpers

src/app/dashboard/documents/    -- (chưa triển khai — Giai đoạn 3)
  page.tsx
  ...

src/app/api/sign/
  set-pin/route.ts              -- POST: upsert bcrypt hash vào sign_pins
  verify/route.ts               -- POST: verify PIN → JWT 5 phút
  generate-pdf/route.ts         -- POST: verify JWT → embed chữ ký → upload PDF
```

---

## Quy tắc kỹ thuật

### isNew / isEditable

```typescript
const isNew = docId === "new-doc"
const isEditable = isNew || trangThai === "draft" || trangThai === "tra_ve"
```

URL `/dashboard/iso/documents/new` redirect sang `/dashboard/iso/documents/new-doc`  
(tránh Next.js route conflict với `/new` static segment).

### canXemXet / canApprove

```typescript
const canXemXet = hasPermission(user, "iso.xem_xet") && userId === doc.xem_xet_user_id
const canApprove = hasPermission(user, "iso.phe_duyet") && userId === doc.phe_duyet_user_id
```

Người xem xét / phê duyệt phải là đúng user được chỉ định, không phải bất kỳ ai có quyền.

### Soát xét auto-invalidation

```typescript
// Sau khi phe_duyet thành công, nếu chon_quy_trinh === "Soát xét"
if (doc.chon_quy_trinh === "Soát xét" && doc.ma_tai_lieu) {
  await supabase
    .from("iso_documents")
    .update({ trang_thai: "het_hieu_luc", ngay_het_hieu_luc: new Date().toISOString() })
    .eq("factory_id", factoryId)
    .eq("ma_tai_lieu", doc.ma_tai_lieu)
    .eq("trang_thai", "co_hieu_luc")
    .neq("id", doc.id)
}
```

### doc_approval_log insert

Sau mỗi action (gui_xem_xet, gui_phe_duyet, phe_duyet, tra_ve), insert:

```typescript
await supabase.from("doc_approval_log").insert({
  doc_id: docId,
  doc_type: "iso",
  factory_id: factoryId,
  user_id: userId,
  action,
  ly_do: action === "tra_ve" ? lyDoTraVe : null,
})
```

---

## Trạng thái label & màu (iso-types.ts)

```typescript
export const TRANG_THAI_LABEL: Record<IsoTrangThai, string> = {
  draft:         "Nháp",
  cho_xem_xet:  "Chờ xem xét",
  cho_phe_duyet:"Chờ phê duyệt",
  co_hieu_luc:  "Có hiệu lực",
  het_hieu_luc: "Hết hiệu lực",
  tra_ve:        "Trả về",
}

export const TRANG_THAI_COLOR: Record<IsoTrangThai, string> = {
  draft:         "bg-slate-100 text-slate-600",
  cho_xem_xet:  "bg-amber-100 text-amber-700",
  cho_phe_duyet:"bg-blue-100 text-blue-700",
  co_hieu_luc:  "bg-emerald-100 text-emerald-700",
  het_hieu_luc: "bg-red-100 text-red-600",
  tra_ve:        "bg-orange-100 text-orange-700",
}
```

---

## Thông báo (chưa triển khai)

### Email

- Route: `POST /api/iso/notify`, `POST /api/documents/notify`
- Pattern giống `src/app/api/maintenance/notify/route.ts`
- Gửi khi thay đổi trạng thái: chờ xem xét, chờ phê duyệt, đã duyệt, trả về

### Chuông thông báo in-app (Giai đoạn 4)

- Supabase Realtime subscribe channel `notifications:user_id=eq.{userId}`
- Badge count tự cập nhật khi có INSERT vào `notifications`
- Click → dropdown 20 items gần nhất, click item → navigate + mark as read

---

## Trạng thái triển khai (2026-05-22)

| Hạng mục | Trạng thái |
|----------|-----------|
| SQL migration (5 bảng + triggers + RLS) | ✅ Hoàn thành |
| npm packages (pdf-lib, jose, bcryptjs...) | ✅ Hoàn thành |
| API `/api/sign/set-pin` | ✅ Hoàn thành |
| API `/api/sign/verify` | ✅ Hoàn thành |
| API `/api/sign/generate-pdf` | ✅ Hoàn thành |
| Settings tab ISO & Văn bản + Chữ ký cá nhân | ✅ Hoàn thành |
| Module ISO: shell, KPI, danh sách, form detail | ✅ Hoàn thành |
| Module ISO: workflow ký duyệt (nút + PIN modal) | ✅ Hoàn thành |
| Module ISO: my-tasks page | ✅ Hoàn thành |
| Drag-and-drop signature placement UI | ⏳ Pending |
| Module Văn bản (Giai đoạn 3) | ⏳ Pending |
| API notify (Email + Telegram) cho ISO & Văn bản | ⏳ Pending |
| In-app notification bell (Realtime) | ⏳ Pending |
| Trang in (bypass sidebar) | ⏳ Pending |
| Supabase Storage bucket `iso-documents` (tạo tay) | ⏳ Cần tạo thủ công |
