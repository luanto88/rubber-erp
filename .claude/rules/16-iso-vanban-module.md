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

## Migrations

| File | Nội dung |
|------|---------|
| `20260522_iso_vanban_module.sql` | Tạo 5 bảng + triggers + RLS + 14 permissions |
| `20260523_iso_phan_loai_tl.sql` | Thêm `phan_loai_tl` vào `iso_documents`; seed `settings.master_data`, `settings.maintenance_config`, `iso.signature` vào `permissions` + `role_permissions` |
| `20260524_iso_signature_placement.sql` (**đã chạy thủ công — 2026-05-25**) | Thêm 3 cột JSONB lưu placement chữ ký từng bước |

```sql
-- 20260524_iso_signature_placement.sql
ALTER TABLE iso_documents
  ADD COLUMN IF NOT EXISTS soan_thao_placement JSONB,
  ADD COLUMN IF NOT EXISTS xem_xet_placement   JSONB,
  ADD COLUMN IF NOT EXISTS phe_duyet_placement  JSONB;
```

---

## Bảng `iso_documents`

```sql
id UUID PK, factory_id UUID,
ma_tai_lieu TEXT,       -- format Cha: PB-LOAISOSO (VD: NMCB-QT01)
                        -- format Con: MACHA-LOAISOSO (VD: NMCB-QT01-PL01)
ten_tai_lieu TEXT NOT NULL,
loai_tai_lieu TEXT,     -- CS|OB|ST|QC|TC|QT|HD|MT|QĐ|PL|F
phong_ban TEXT,
cap_tl TEXT,            -- "Cấp 1" | "Cấp 2"
chon_quy_trinh TEXT,    -- "Soạn thảo" | "Soát xét"
loai_vb TEXT,           -- "Thường" | "Mật"
lan_ban_hanh INTEGER DEFAULT 1,
phan_loai_tl TEXT DEFAULT 'cha',  -- "cha" | "con" — F luôn là con; PL và HD có thể cha hoặc con

trang_thai TEXT DEFAULT 'draft',
-- draft | cho_xem_xet | cho_phe_duyet | co_hieu_luc | het_hieu_luc | tra_ve | bi_tu_choi_phe_duyet

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

-- Placement chữ ký từng bước (JSONB) — thêm bằng migration 20260524
soan_thao_placement JSONB,    -- {page, x, y, width, height} của bước soạn thảo
xem_xet_placement JSONB,      -- placement bước xem xét
phe_duyet_placement JSONB,    -- placement bước phê duyệt

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

## Quy tắc mã tài liệu

### Loại Cha/Con

| Loại | Phân loại | Điều kiện Con |
|------|-----------|--------------|
| CS, OB, ST, QC, TC, QT, MT, QĐ | Luôn Cha | — |
| **PL** (Phụ lục) | Cha **hoặc** Con | `phan_loai_tl === "con"` |
| **HD** (Hướng dẫn) | Cha **hoặc** Con | `phan_loai_tl === "con"` |
| **F** (Biểu mẫu) | Luôn Con | Luôn true |

Kiểm tra logic Con trong code:
```typescript
const isCon = phan_loai_tl === "con" || loai_tai_lieu === "F"
```

> F luôn là con bất kể `phan_loai_tl`. PL và HD là con khi `phan_loai_tl === "con"`. Mọi loại khác luôn là cha.

### Format mã

- **Cha**: `{PB}-{LOAI}{SO}` — không có dấu `-` trước số  
  Ví dụ: `NMCB-QT01`, `PHK-HD03`
- **Con**: `{MA_CHA}-{LOAI}{SO}`  
  Ví dụ: `NMCB-QT01-PL01`, `NMCB-QT01-HD02`

### Helpers trong `iso-types.ts`

```typescript
// Tạo mã Cha
buildMaTaiLieu(pb: string, loai: string, so: string): string
// VD: buildMaTaiLieu("NMCB", "QT", "1") → "NMCB-QT01"

// Tạo mã Con
buildMaTaiLieuCon(maCha: string, loai: string, so: string): string
// VD: buildMaTaiLieuCon("NMCB-QT01", "PL", "1") → "NMCB-QT01-PL01"

// Parse mã Con để lấy maCha và soHieu
parseMaTaiLieuCon(ma: string, loai: string): { maCha: string; soHieu: string }
// VD: parseMaTaiLieuCon("NMCB-QT01-PL01", "PL") → { maCha: "NMCB-QT01", soHieu: "1" }

// Parse mã cha để lấy phòng ban, loại TL, số hiệu
parseParentCode(code: string): { pb: string; loai: string; so: string } | null
// VD: parseParentCode("NMCB-QT01") → { pb: "NMCB", loai: "QT", so: "1" }
// VD: parseParentCode("PHK-QĐ02") → { pb: "PHK", loai: "QĐ", so: "2" }
// Dùng khi load tài liệu Con để hydrate các field cha trong form
```

### Constants trong `iso-types.ts`

```typescript
// Loại TL có thể là Cha (không bao gồm F — F luôn là Con)
LOAI_CHA_OPTIONS = ["CS","OB","ST","QC","TC","QT","HD","MT","QĐ","PL"]

// Loại TL có thể là Con
LOAI_CON_OPTIONS = ["PL","HD","F"]

// Mapping loai_tai_lieu → phòng ban được phép dùng loại đó
// CS/OB/ST/QC: chỉ PHK; TC/QT/HD/MT/PL/QĐ/F: PHK và tất cả phòng ban khác
LOAI_PHONG_BAN_MAP: Record<string, string[]>
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
action TEXT,          -- 'gui_xem_xet'|'gui_phe_duyet'|'phe_duyet'|'tra_ve'|'khong_xem_xet'|'ky_phong_ban'|'tu_choi'
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

## Permissions

```
iso.view / iso.create / iso.edit / iso.delete
iso.xem_xet / iso.phe_duyet / iso.print
iso.signature               -- tab Chữ ký cá nhân trong Cài đặt (mọi user active)
documents.view / documents.create / documents.edit / documents.delete
documents.ky_phong_ban / documents.phe_duyet / documents.print
settings.master_data        -- tab Danh mục trong Cài đặt
settings.maintenance_config -- tab Bảo trì trong Cài đặt
```

Guard bắt buộc ở cả UI và logic thao tác.

**Phân quyền mặc định:**
- `admin`: toàn bộ
- `manager`: `iso.view/create/edit`, `iso.signature`, `settings.master_data`, `settings.maintenance_config`
- `user`: `iso.view`, `iso.signature`

---

## Workflow ISO

### Trạng thái

```
Cấp 1 (3 bước):
  draft → cho_xem_xet → cho_phe_duyet → co_hieu_luc → het_hieu_luc
              ↓                ↓
         tra_ve          bi_tu_choi_phe_duyet
      (khong_xem_xet)         ↙          ↘
    → soạn thảo sửa   cho_phe_duyet      draft
                    (gui_lai_phe_duyet) (tra_ve_nhap)
                      [xem xét ký lại]

Cấp 2 (2 bước):
  draft → cho_phe_duyet → co_hieu_luc → het_hieu_luc
                ↓
             tra_ve (tu_choi_phe_duyet → soạn thảo sửa)
```

- **Cấp 1** (3 bước): `draft → cho_xem_xet → cho_phe_duyet → co_hieu_luc`
- **Cấp 2** (2 bước): `draft → cho_phe_duyet → co_hieu_luc`
- `tra_ve`: soạn thảo viên nhận lại, tài liệu quay về draft sau khi sửa
- `bi_tu_choi_phe_duyet` (**chỉ Cấp 1**): phê duyệt từ chối; người xem xét quyết định gửi lại hay trả về nháp

### Actions và timestamp mapping

| Action | Ai thực hiện | Từ → Đến | Trường cập nhật | Thông báo đến |
|--------|-------------|----------|----------------|--------------|
| `gui_xem_xet` | Soạn thảo | `draft → cho_xem_xet` | `ky_soan_thao_at=now()` | `xem_xet_user_id` |
| `gui_phe_duyet` từ draft (Cấp 2) | Soạn thảo | `draft → cho_phe_duyet` | `ky_soan_thao_at=now()` | `phe_duyet_user_id` |
| `gui_phe_duyet` từ `cho_xem_xet` | Xem xét | `cho_xem_xet → cho_phe_duyet` | `ky_xem_xet_at=now()` | `phe_duyet_user_id` |
| `phe_duyet` | Phê duyệt | `cho_phe_duyet → co_hieu_luc` | `ky_phe_duyet_at=now()`, `ngay_hieu_luc=now()` | `soan_thao_user_id`, `xem_xet_user_id` |
| `tra_ve` | Xem xét / Phê duyệt (Cấp 2) | `cho_xem_xet / cho_phe_duyet → tra_ve` | `ghi_chu=lyDo` | `soan_thao_user_id` |
| `khong_xem_xet` | Xem xét | `cho_xem_xet → tra_ve` | `ghi_chu=lyDo` | `soan_thao_user_id` |
| `tu_choi_phe_duyet` | Phê duyệt | Cấp 1: `cho_phe_duyet → bi_tu_choi_phe_duyet`; Cấp 2: `→ tra_ve` | `ghi_chu=lyDo` | Cấp 1: `xem_xet_user_id` + `soan_thao_user_id`; Cấp 2: `soan_thao_user_id` |
| `gui_lai_phe_duyet` | Xem xét | `bi_tu_choi_phe_duyet → cho_phe_duyet` | `ky_xem_xet_at=now()` | `phe_duyet_user_id` |
| `tra_ve_nhap` | Xem xét | `bi_tu_choi_phe_duyet → draft` | `ghi_chu=lyDo` (tùy chọn) | `soan_thao_user_id` |

Mọi action đều INSERT vào `doc_approval_log`.

### Quy trình Soát xét

Khi tạo tài liệu với `chon_quy_trinh = "Soát xét"`:
- Sau khi `phe_duyet`, auto-UPDATE tất cả tài liệu cùng `ma_tai_lieu` (mã cũ) + `trang_thai = 'co_hieu_luc'` → `het_hieu_luc` + `ngay_het_hieu_luc = now()`
- Trừ tài liệu hiện tại
- Nếu `ma_tai_lieu_moi` có giá trị: cập nhật `ma_tai_lieu = ma_tai_lieu_moi` sau phê duyệt
- Restamp PDF các tài liệu cũ bị invalidate: gọi `POST /api/sign/restamp-pdf { docIds, factoryId }`

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

### Cơ chế bảo mật (flow đầy đủ với drag-and-drop)

```
User bấm nút ký duyệt
  → PIN Modal (4–6 số)
  → POST /api/sign/verify { userId, pin, docId, docType }
      Server: bcrypt.compare(pin, sign_pins.pin_hash)
      Nếu đúng: SignJWT { userId, docId, docType } exp=5m
      ← token

  Nếu doc có file_goc_url VÀ action không phải tra_ve/khong_xem_xet:
    → Mở SignaturePlacementModal (pdfjs canvas + react-draggable)
    → User kéo/resize vị trí chữ ký
    → Click "Xác nhận vị trí"
      → doTransition(action, token, placement)

  Nếu không có file hoặc action trong noSignActions ["tra_ve","khong_xem_xet","tu_choi_phe_duyet","tra_ve_nhap"]:
    → doTransition(action, token, null)  -- bỏ qua placement

doTransition:
  1. Cập nhật trang_thai (Supabase)
  2. INSERT doc_approval_log
  3. Nếu có token + file_goc_url:
     POST /api/sign/generate-pdf { token, docId, docType, signaturePlacement, skipTagLabels }
     → Server: verify JWT → đọc `file_goc_url` → quét tag header/footer → điền tag tìm thấy → nhúng chữ ký body + tên người ký nếu bật → upload PDF
     → Cập nhật file_signed_pdf_url
     → Nếu response.metaMismatched.length > 0: hiển thị warning banner (headerMismatchWarnings)
     → Nếu diagnostics.sigImgLoadFailed.length > 0: toast cảnh báo người ký chưa upload ảnh chữ ký
  4. Nếu soát xét invalidate tài liệu cũ:
     POST /api/sign/restamp-pdf { docIds, factoryId }
  5. POST /api/iso/notify { docId, factoryId, action, recipientUserIds }
```

### JWT Secret

```
process.env.SIGN_JWT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
```

### API Routes

| Route | Method | Mô tả |
|-------|--------|--------|
| `/api/sign/set-pin` | POST | `{userId, pin}` → bcrypt.hash → upsert `sign_pins` |
| `/api/sign/verify` | POST | `{userId, pin, docId, docType}` → verify bcrypt → JWT 5 phút |
| `/api/sign/generate-pdf` | POST | `{token, docId, docType, signaturePlacement?, skipTagLabels?}` → verify JWT → fill tag header/footer tìm thấy → embed chữ ký/tên → upload PDF |
| `/api/sign/restamp-pdf` | POST | `{docIds, factoryId}` → load PDF cũ → stamp footer "Hết hiệu lực" → re-upload |
| `/api/iso/notify` | POST | `{docId, factoryId, action, recipientUserIds, lyDo?}` → in-app + Telegram + Email |
| `/api/iso/profiles-by-permission` | GET | `?factoryId=...&permCode=...` → danh sách user có quyền (service role, bypass RLS) |

### Ảnh chữ ký

- Storage bucket: `iso-documents` (public)
- Path: `signatures/{factory_id}/{user_id}/chu_ky.png`
- Upload: upsert=true, overwrite nếu đã tồn tại
- Quản lý tại: `Cài đặt → ISO & Văn bản → Chữ ký cá nhân`

### signaturePlacement object

```typescript
type SignPlacement = {
  page: number    // số trang (1-based)
  x: number       // tọa độ từ trái (pt, pdf-lib bottom-left origin)
  y: number       // tọa độ từ đáy (pt)
  width: number
  height: number
  showSignerName?: boolean
  nameX?: number
  nameY?: number
  nameWidth?: number
  nameHeight?: number
}
```

Canvas coords → PDF coords: `y_pdf = pdfPageHeight - (y_canvas / scale) - (h_canvas / scale)`

---

## Supabase Storage — bucket `iso-documents`

Bucket **public**, tạo thủ công trong Supabase Dashboard.

| Mục đích | Path |
|----------|------|
| File gốc upload | `{factory_id}/iso/{timestamp}_{filename}` |
| Ảnh chữ ký | `signatures/{factory_id}/{user_id}/chu_ky.png` |
| PDF đã ký | `{factory_id}/iso/signed/{docId}_signed.pdf` |

File gốc không bao giờ bị modify — chỉ đọc để preview.

---

## PDF Generation — Logic chung

`generate-pdf/route.ts` phân nhánh theo `isCon`:

```typescript
function isConDoc(loaiTaiLieu: string | null, phanLoaiTl: string | null): boolean {
  if (loaiTaiLieu === "F") return true
  if ((loaiTaiLieu === "PL" || loaiTaiLieu === "HD") && phanLoaiTl === "con") return true
  return false
}
```

| Loại | Tạo trang riêng | Header tag | Footer tag | Chữ ký body |
|------|------------------|------------|------------|-------------|
| **Cha** (QT, HD Cha, PL Cha, v.v.) | ❌ Không | Điền nếu tìm thấy tag | Thay nếu tìm thấy footer mẫu | ✅ Có |
| **Con** (F, HD Con, PL Con) | ❌ Không | Điền nếu tìm thấy tag | Thay nếu tìm thấy footer mẫu | ✅ Có |

- Không tạo “phiếu ký duyệt” riêng cho cả tài liệu cha lẫn tài liệu con.
- PDF đầu ra phải giữ nguyên số trang của `file_goc_url`.
- Mọi thay đổi đều được vẽ trực tiếp lên các trang của tài liệu gốc.

---

## Drag-and-drop Signature Placement

Đã triển khai trong `documents/[id]/page.tsx`:

```typescript
// State
const [placementModal, setPlacementModal] = useState<{
  show: boolean; token: string; action: PinModalAction; lyDo?: string
  sigX: number; sigY: number; sigW: number; sigH: number
  nameX: number; nameY: number; nameW: number; nameH: number
  showSignerName: boolean
  currentPage: number; totalPages: number
  canvasScale: number; pdfPageHeight: number
  sigImgUrl: string | null
} | null>(null)

// pdfjs worker — version-matched từ jsdelivr CDN
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`
```

- Ảnh chữ ký và tên người ký là hai lớp preview độc lập.
- Người dùng kéo/resize ảnh chữ ký riêng, kéo/resize box tên riêng.
- Nếu template đã có sẵn tên, người dùng có thể tắt box tên bằng toggle `(X)`.

**Lưu ý pdfjs**: Package đang dùng `pdfjs-dist@^5.x`. Worker URL phải lấy `pdfjsLib.version` động — KHÔNG hardcode URL với version 3.x.

**Lưu ý react-draggable + React 19**: React 19 đã xóa `ReactDOM.findDOMNode`. `react-draggable` v4 dùng API này nếu không truyền `nodeRef` → crash `_reactDom.default.findDOMNode is not a function`. Bắt buộc:

```typescript
// Khai báo ref ngoài component body
const draggableNodeRef = useRef<HTMLDivElement>(null)

// Trong JSX modal đặt chữ ký:
<Draggable
  nodeRef={draggableNodeRef as RefObject<HTMLElement>}
  position={{ x: placementModal.sigX, y: placementModal.sigY }}
  onStop={(_, d) => setPlacementModal((p) => p ? { ...p, sigX: d.x, sigY: d.y } : null)}
  bounds="parent"
>
  <div ref={draggableNodeRef} style={{ position: "absolute", top: 0, left: 0, zIndex: 10, cursor: "move" }}>
    ...
  </div>
</Draggable>
```

---

## Packages

| Package | Mục đích |
|---------|----------|
| `pdf-lib` | Nhúng ảnh chữ ký/tên vào PDF, điền tag header/footer, lưu PDF kết quả |
| `pdfjs-dist` (v5.x) | Render PDF thành canvas để preview (client) + scan text metadata (server, Node.js mode) |
| `bcryptjs` + `@types/bcryptjs` | Hash/verify PIN |
| `react-draggable` | Drag chữ ký trên canvas |
| `re-resizable` | Resize ảnh chữ ký |
| `jose` | Mint/verify JWT (HS256) |
| `nodemailer` | Gửi email thông báo |

---

## Cấu trúc thư mục

```text
src/app/dashboard/iso/
  page.tsx                      -- Overview KPI: tổng, co_hieu_luc, chờ duyệt
  documents/
    page.tsx                    -- Danh sách + bộ lọc; link "Tạo" → /new-doc
    new/page.tsx                -- Redirect → new-doc (loading spinner, không null)
    [id]/page.tsx               -- Form tạo/xem/ký duyệt (docId="new-doc" = tạo mới)
  my-tasks/page.tsx             -- Tài liệu cần tôi xem xét / ký
  _components/
    iso-shell.tsx               -- Tab navigation
    iso-types.ts                -- Types, constants, buildMaTaiLieu, buildMaTaiLieuCon,
                                --   buildMaTaiLieuCon, parseMaTaiLieuCon, parseParentCode,
                                --   LOAI_CHA_OPTIONS, LOAI_CON_OPTIONS, LOAI_PHONG_BAN_MAP,
                                --   PHONG_BAN_OPTIONS, LOAI_TAI_LIEU_LABEL, helpers

src/app/dashboard/documents/    -- (chưa triển khai — Giai đoạn 3)

src/app/api/sign/
  set-pin/route.ts
  verify/route.ts
  generate-pdf/route.ts         -- signaturePlacement embed + quét tag header/footer + nhúng tên người ký
  restamp-pdf/route.ts          -- Re-stamp "Hết hiệu lực" lên PDF cũ

src/app/api/iso/
  notify/route.ts               -- in-app + Telegram + Email khi đổi trạng thái
```

---

## Quy tắc kỹ thuật

### isNew / isEditable

```typescript
const isNew = docId === "new-doc"
// canXemXet phải được định nghĩa TRƯỚC isEditable
const canXemXet = hasPermission(user, "iso.xem_xet") && !!userId && userId === doc?.xem_xet_user_id
const canApprove = hasPermission(user, "iso.phe_duyet") && !!userId && userId === doc?.phe_duyet_user_id
// bi_tu_choi_phe_duyet cho phép người xem xét sửa để gửi lại
const isEditable = isNew || trangThai === "draft" || trangThai === "tra_ve"
  || (trangThai === "bi_tu_choi_phe_duyet" && canXemXet)
```

**Thứ tự khai báo bắt buộc**: `canXemXet` / `canApprove` phải đứng trước `isEditable` trong code — nếu đảo ngược, `canXemXet` sẽ là `undefined` khi được dùng trong biểu thức `isEditable`.

Link "Tạo tài liệu" trong `documents/page.tsx` trỏ thẳng vào `/dashboard/iso/documents/new-doc`.  
`new/page.tsx` tồn tại cho backward compat nhưng chỉ là redirect fallback.

### canXemXet / canApprove

```typescript
const canXemXet = hasPermission(user, "iso.xem_xet") && !!userId && userId === doc?.xem_xet_user_id
const canApprove = hasPermission(user, "iso.phe_duyet") && !!userId && userId === doc?.phe_duyet_user_id
```

Người xem xét / phê duyệt phải là đúng user được chỉ định.

### Buttons theo trạng thái

| Trạng thái | canXemXet thấy | canApprove thấy |
|------------|---------------|----------------|
| `cho_xem_xet` | "Xem xét" (gui_phe_duyet) + "Không xem xét" (khong_xem_xet) | — |
| `cho_phe_duyet` | — | "Phê duyệt" (phe_duyet) + "Không phê duyệt" (tu_choi_phe_duyet) |
| `bi_tu_choi_phe_duyet` | "Gửi phê duyệt lại" (gui_lai_phe_duyet) + "Trả về Nháp" (tra_ve_nhap) | — |

Phê duyệt KHÔNG có nút "Trả về" (tra_ve) ở bước `cho_xem_xet` — phê duyệt không được can thiệp vào bước xem xét.

### Lọc nhân sự theo quyền

Dropdown "Người xem xét" và "Người phê duyệt" chỉ hiện user có permission tương ứng.

**Tại sao cần API route server-side**: Frontend Supabase client (anon key) bị RLS chặn — chỉ đọc được bản ghi `user_permissions` của chính mình. Cần `SUPABASE_SERVICE_ROLE_KEY` (server-side only) để bypass RLS và đọc quyền của tất cả user.

**Cách hoạt động (`GET /api/iso/profiles-by-permission`)**:

```typescript
// Client gọi API route (không truy vấn DB trực tiếp)
const loadProfilesByPermission = async (fid: string, permCode: string): Promise<ProfileOption[]> => {
  const res = await fetch(`/api/iso/profiles-by-permission?factoryId=${fid}&permCode=${encodeURIComponent(permCode)}`)
  if (!res.ok) return []
  const json = await res.json()
  return (json.profiles || []) as ProfileOption[]
}

// Server dùng supabaseAdmin (service role) — 2 query riêng biệt rồi merge:
// 1. user_permissions WHERE permission_code = permCode AND granted = true → directIds
// 2. role_permissions WHERE permission_code = permCode → roles (+ thêm "admin")
// 3. profiles WHERE factory_id = fid AND status = "active" AND id IN directIds
// 4. profiles WHERE factory_id = fid AND status = "active" AND role IN roles
// → dedup + sort Vietnamese
```

**Ràng buộc không trùng nhau (bắt buộc)**:
- Người soạn thảo = current user, auto-set khi tạo mới, read-only
- Dropdown "Người xem xét" (`profilesXemXet`) lọc bỏ `soan_thao_user_id`
- Dropdown "Người phê duyệt" (`profilesPheDuyet`) lọc bỏ cả `soan_thao_user_id` lẫn `xem_xet_user_id`
- Khi thay đổi người xem xét: nếu người phê duyệt đang chọn trùng thì tự động xóa `phe_duyet_user_id`

### rebuildMa — sinh mã tự động trong form

```typescript
// Trong IIFE của form section, rebuildMa được gọi khi thay đổi:
// - Loại tài liệu (loai_tai_lieu)
// - Phòng ban (phong_ban)
// - Số hiệu (so_hieu)
// - Phân loại Cha/Con (phan_loai_tl)
// - Loại TL cha (loai_tai_lieu_cha) — Con mode
// - Số hiệu cha (so_hieu_cha) — Con mode

const rebuildMa = (patch: Partial<IsoDocumentForm>) => {
  setForm((f) => {
    const next = { ...f, ...patch }
    const isConNext = next.phan_loai_tl === "con"
    if (isConNext) {
      // Bước 1: build mã cha từ PB + loai_tai_lieu_cha + so_hieu_cha
      const maCha = buildMaTaiLieu(next.phong_ban, next.loai_tai_lieu_cha, next.so_hieu_cha)
      next.ma_tai_lieu_cha = maCha
      // Bước 2: build mã con từ maCha + loai_tai_lieu (của con) + so_hieu
      next.ma_tai_lieu = buildMaTaiLieuCon(maCha, next.loai_tai_lieu, next.so_hieu)
    } else {
      next.ma_tai_lieu_cha = ""
      next.ma_tai_lieu = buildMaTaiLieu(next.phong_ban, next.loai_tai_lieu, next.so_hieu)
    }
    return next
  })
}
```

> Người dùng KHÔNG nhập tay `ma_tai_lieu_cha`. Mã cha được tự sinh từ `phong_ban + loai_tai_lieu_cha + so_hieu_cha`. Đây là cải tiến so với thiết kế ban đầu (trước đây form có field nhập tay mã cha — đã xóa).

### IsoDocumentForm — các field liên quan đến Con

```typescript
type IsoDocumentForm = {
  ma_tai_lieu: string          // auto-generated (readonly)
  so_hieu: string              // số hiệu của TL này (Cha: serial của TL; Con: serial con)

  // Chỉ dùng khi phan_loai_tl === "con":
  loai_tai_lieu_cha: string    // loại TL của tài liệu cha (e.g. "QT")
  so_hieu_cha: string          // số hiệu cha (e.g. "2")
  ma_tai_lieu_cha: string      // mã cha auto-derived, KHÔNG nhập tay (e.g. "NMCB-QT02")

  phan_loai_tl: string         // "cha" | "con"
  // ...
}
```

Khi load tài liệu Con từ DB (`loadDoc`), phải gọi `parseParentCode(maTaiLieuCha)` để hydrate `loai_tai_lieu_cha` và `so_hieu_cha`:

```typescript
const isCon = d.phan_loai_tl === "con" || d.loai_tai_lieu === "F"
if (isCon) {
  const parsed = parseMaTaiLieuCon(d.ma_tai_lieu, d.loai_tai_lieu)
  const maTaiLieuCha = parsed.maCha
  const parentParsed = parseParentCode(maTaiLieuCha)
  // → form.loai_tai_lieu_cha = parentParsed?.loai ?? "QT"
  // → form.so_hieu_cha = parentParsed?.so ?? ""
  // → form.ma_tai_lieu_cha = maTaiLieuCha
}
```

### Validation "Gửi xem xét"

Nút "Gửi xem xét" / "Gửi phê duyệt" (bước của soạn thảo viên) phải đọc từ `form` (live state), không đọc từ `doc` (DB snapshot):

```typescript
// Cấp 1: cần cả xem_xet_user_id VÀ phe_duyet_user_id được chỉ định
// Cấp 2: chỉ cần phe_duyet_user_id
disabled={
  form.cap_tl === "Cấp 2"
    ? !form.phe_duyet_user_id
    : (!form.xem_xet_user_id || !form.phe_duyet_user_id)
}
```

> **Không dùng `doc?.*`** — `doc` là snapshot DB, không cập nhật cho đến khi lưu. Nếu dùng `doc`, nút vẫn bị disabled dù người dùng đã chọn xong trong dropdown. Phải dùng `form.*_user_id` để nút kích hoạt ngay khi chọn.
>
> Không dùng `!form.xem_xet` (name string) — truthy nếu tên đã điền, nhưng không đảm bảo user đã được chọn đúng. Phải dùng `_user_id` UUID.

### Soát xét auto-invalidation + đổi mã

```typescript
// Sau phe_duyet, nếu chon_quy_trinh === "Soát xét":
// 1. Nếu ma_tai_lieu_moi có giá trị → cập nhật ma_tai_lieu = ma_tai_lieu_moi
// 2. Invalidate tài liệu cũ cùng mã (mã CŨ, trước khi đổi):
await supabase
  .from("iso_documents")
  .update({ trang_thai: "het_hieu_luc", ngay_het_hieu_luc: now })
  .eq("factory_id", factoryId)
  .eq("ma_tai_lieu", doc.ma_tai_lieu)   // mã cũ
  .eq("trang_thai", "co_hieu_luc")
  .neq("id", docId)
  .select("id")
// 3. Gọi restamp-pdf với invalidatedIds
```

### Font dùng trong generate-pdf

- `loadViFont()` đọc `public/fonts/NotoSans-Regular.ttf` để vẽ text tiếng Việt trong PDF.
- `loadSignerNameFont()` đọc `public/fonts/TimesNewRoman.ttf` để vẽ tên người ký.
- Nếu không load được font tiếng Việt hợp lệ thì route phải trả lỗi `500`, không được fallback sang `Helvetica` cho text có dấu.
- Tên người ký dùng `Times New Roman`, cỡ chuẩn `13`, nhưng có thể co nhỏ nhẹ nếu tên dài hơn bề rộng ô tên.

### Mismatch warning UI ([id]/page.tsx)

#### State

```typescript
// Warnings từ generate-pdf khi phát hiện tag tương tự nhưng sai tên
const [headerMismatchWarnings, setHeaderMismatchWarnings] = useState<Array<{ found: string; expected: string }>>([])
// Labels user đã xác nhận là không phải lỗi — truyền vào generate-pdf lần tiếp theo
const [confirmedSkipTags, setConfirmedSkipTags] = useState<string[]>([])
```

#### Luồng hoạt động

1. Sau `generate-pdf` thành công, nếu `pdfJson.metaMismatched?.length > 0` → `setHeaderMismatchWarnings(pdfJson.metaMismatched)`
2. Banner amber hiển thị danh sách tag tìm thấy và gợi ý đúng
3. Nút **"Bỏ qua, không điền tag này"**: thêm `expected` vào `confirmedSkipTags`, xóa warnings
4. Nút **"Đóng"**: chỉ xóa warnings (không thêm vào skipTags — sẽ warn lại lần sau)
5. `confirmedSkipTags` được truyền vào mỗi lần gọi generate-pdf:

```typescript
body: JSON.stringify({
  token, docId, docType: "iso",
  signaturePlacement: placement,
  skipTagLabels: confirmedSkipTags,  // tích lũy từ các lần bỏ qua trước
})
```

#### Diagnostics toast

Nếu `pdfJson.diagnostics?.sigImgLoadFailed?.length > 0` → toast cảnh báo:

```typescript
const failedSigs = pdfJson.diagnostics?.sigImgLoadFailed as string[] | undefined
if (failedSigs && failedSigs.length > 0) {
  showToast(false, `${failedSigs.length} người ký chưa có ảnh chữ ký. Vào Cài đặt → Chữ ký cá nhân để upload.`)
}
```

### doc_approval_log insert

```typescript
const lyDoActions = ["tra_ve", "khong_xem_xet", "tu_choi_phe_duyet", "tra_ve_nhap"]
await supabase.from("doc_approval_log").insert({
  doc_id: docId, doc_type: "iso", factory_id: factoryId,
  user_id: userId, action,
  ly_do: lyDoActions.includes(action) ? lyDoTraVe : null,
})
```

### Signature persistence (generate-pdf/route.ts)

Mỗi lần generate PDF, server thực hiện theo thứ tự:

1. **Xác định signer hiện tại** theo `userId` so với `soan_thao_user_id / xem_xet_user_id / phe_duyet_user_id`
2. **Lưu placement** của bước hiện tại vào DB (`soan_thao_placement / xem_xet_placement / phe_duyet_placement`)
3. **Reload tất cả 3 placements** từ DB
4. **Bắt đầu từ `file_goc_url`** (KHÔNG dùng `file_signed_pdf_url` — tránh double-stamp)
5. **Bắt đầu từ `file_goc_url`** và scan text layer bằng `pdfjs-dist`
6. **Chỉ điền tag nếu tag thực sự tồn tại** ở header/footer; không thấy thì bỏ qua
7. **Re-apply tất cả placements đã lưu** (ảnh chữ ký body): mỗi bước ký đã qua đều được nhúng lại
8. **Vẽ tên người ký** nếu `showSignerName !== false`, dùng box tên độc lập nếu user đã đặt
9. **Upload PDF kết quả** → cập nhật `file_signed_pdf_url`

**Kết quả:**
- Soạn thảo ký → PDF body có 1 chữ ký soạn thảo
- Xem xét ký → PDF body có 2 chữ ký (soạn thảo + xem xét)
- Phê duyệt ký → PDF body có 3 chữ ký (soạn thảo + xem xét + phê duyệt)

### Quy tắc cố định header/footer + tên người ký (cập nhật 2026-05-25)

#### Phạm vi quét tag

- Chỉ quét phần `header` và `footer` của tài liệu.
- Không thay thế bất kỳ tag nào trong `body`.
- Phần `body` chỉ được:
  - nhúng ảnh chữ ký,
  - nhúng tên người ký theo bước ký nếu người dùng bật hiển thị tên.

#### Quy tắc tag header

- Các tag hệ thống hợp lệ trong header:
  - `Mã tài liệu:`
  - `Ngày hiệu lực:`
  - `Tình trạng:`
  - `Lần ban hành:` hoặc `Lần sửa đổi:` hoặc `Lần soát xét:`
  - `QR:` hoặc `QR`
- Quy tắc điền:
  - Nếu tag đã có dấu `:`: code chèn sau dấu `:`, thêm ` ` rồi mới thêm giá trị thực.
  - Nếu phát hiện đúng nhãn nhưng không có dấu `:`: code phải điền thêm `:`, rồi thêm dấu cách và giá trị thực.
  - Nếu người dùng đã điền giá trị thật sau tag: code bỏ qua, không ghi đè.
  - Nếu tài liệu không có tag nào ngoài `QR:` hoặc `QR`, code chỉ điền QR và bỏ qua các tag header khác.
  - Font giá trị hệ thống trong header: `Times New Roman`, size `13`.

#### Quy tắc tag footer

- Footer mẫu hệ thống có cấu trúc:
  - `Mã tài liệu (Lần ban hành-Ngày hiệu lực) Tình trạng`
- Quy tắc điền:
  - Footer được thay thế hoàn toàn bằng giá trị thực.
  - Ví dụ: `NMCB-QT01 (01-25/05/2026) Có hiệu lực`
  - Nếu người dùng đã điền footer thật rồi: code bỏ qua, không ghi đè.
  - Nếu không tìm thấy footer mẫu/tag footer thì bỏ qua, không tự vẽ footer mới ở vị trí đoán.
  - Font footer hệ thống: `Times New Roman`, size `13`.

#### Tag tương tự phải cảnh báo bắt buộc

- Các tag có thể nhầm lẫn:
  - `Mã hồ sơ`, `Mã hiệu` → nhầm với `Mã tài liệu`
  - `Trạng thái` → nhầm với `Tình trạng`
  - `Lần sửa đổi`, `Lần soát xét` → nhầm trong nhóm `Lần ban hành / Lần sửa đổi`
- Nếu phát hiện tag tương tự:
  - không tự điền,
  - hiển thị cảnh báo,
  - bắt buộc người dùng sửa template rồi upload lại.

#### Hướng dẫn bắt buộc trong UI upload template

- Khu vực hướng dẫn phải có dòng:

```text
Nhãn hệ thống tự nhận diện trong phần header tài liệu:
```

- Bên dưới liệt kê đúng các nhãn hệ thống hợp lệ để người dùng đặt trong template.

#### Tên người ký trong bước đặt chữ ký

- Trong modal placement, mỗi bước ký phải hiển thị:
  - ảnh chữ ký,
  - tên người ký ở một box độc lập với chữ ký để người dùng kéo riêng.
- Tên hiển thị mặc định là `ON`.
- Phải có nút/toggle gốc dạng `(X)` để người dùng tắt hiển thị tên nếu template đã có sẵn tên.
- Tên người ký khi nhúng PDF:
  - căn giữa trong ô tên,
  - font `Times New Roman`, size `13`,
  - nếu tên dài thì được phép co nhỏ vừa ô nhưng phải ưu tiên giữ cân giữa.

#### Cảnh báo placement

- Trong modal đặt chữ ký phải hiển thị cảnh báo cố định:

```text
Không đặt ảnh chữ ký hoặc tên tràn ra ngoài ô chứa
```

- Cảnh báo này hiển thị cùng lúc với preview chữ ký/tên.

#### Cách nhận diện tag trong `fillMetadataPlaceholders`

- Dùng `pdfjs-dist` để đọc text layer của tất cả trang.
- Chuỗi tìm kiếm phải được chuẩn hóa tiếng Việt về dạng **không dấu**, chữ thường, bỏ khoảng trắng thừa trước khi match.
- Header/footer chỉ được xử lý trong vùng header/footer của trang; body không được thay tag.
- Với header:
  - match theo nhãn chuẩn hóa như `ma tai lieu`, `ngay hieu luc`, `tinh trang`, `lan ban hanh / sua doi / soat xet`, `qr`
  - giá trị hiện có chỉ được đọc từ phần text nằm **bên phải label**
  - nếu phần bên phải đã có dữ liệu thật thì bỏ qua
- Với footer:
  - chỉ thay khi dòng footer match đúng mẫu footer chuẩn hóa
  - nếu footer đã là giá trị thật hoặc không match mẫu thì bỏ qua
- `metaFilled`, `metaNotFound`, `metaMismatched` tiếp tục được trả về cho UI.

---

## Trạng thái label & màu (iso-types.ts)

```typescript
export const TRANG_THAI_LABEL: Record<IsoTrangThai, string> = {
  draft:                  "Nháp",
  cho_xem_xet:            "Chờ xem xét",
  cho_phe_duyet:          "Chờ phê duyệt",
  co_hieu_luc:            "Có hiệu lực",
  het_hieu_luc:           "Hết hiệu lực",
  tra_ve:                 "Trả về",
  bi_tu_choi_phe_duyet:   "Phê duyệt từ chối",
}

export const TRANG_THAI_COLOR: Record<IsoTrangThai, string> = {
  draft:                  "bg-slate-100 text-slate-600",
  cho_xem_xet:            "bg-amber-100 text-amber-700",
  cho_phe_duyet:          "bg-orange-100 text-orange-700",
  co_hieu_luc:            "bg-emerald-100 text-emerald-700",
  het_hieu_luc:           "bg-red-100 text-red-600",
  tra_ve:                 "bg-rose-100 text-rose-700",
  bi_tu_choi_phe_duyet:   "bg-red-100 text-red-700",
}
```

---

## Thông báo ISO (`/api/iso/notify`)

Gửi 3 kênh: in-app (`notifications` table) + Telegram + Email.

```typescript
// POST { docId, factoryId, action, recipientUserIds: string[], lyDo? }
```

| Action | Gửi đến | Tiêu đề |
|--------|---------|---------|
| `gui_xem_xet` | `xem_xet_user_id` | "Tài liệu cần xem xét" |
| `gui_phe_duyet` | `phe_duyet_user_id` | "Tài liệu cần phê duyệt" |
| `phe_duyet` | `soan_thao_user_id`, `xem_xet_user_id` | "Tài liệu đã được phê duyệt" |
| `tra_ve` / `khong_xem_xet` | `soan_thao_user_id` | "Tài liệu bị trả về" |
| `tu_choi_phe_duyet` | Cấp 1: `xem_xet_user_id` + `soan_thao_user_id`; Cấp 2: `soan_thao_user_id` | "Tài liệu bị từ chối phê duyệt" |
| `gui_lai_phe_duyet` | `phe_duyet_user_id` | "Tài liệu gửi phê duyệt lại" |
| `tra_ve_nhap` | `soan_thao_user_id` | "Tài liệu trả về Nháp" |

Pattern giống `src/app/api/maintenance/notify/route.ts`. Màu violet (`#7c3aed`) thay vì orange.

**Telegram ISO dùng nhóm riêng** — env vars khác với module bảo trì:

| Module | Bot Token | Chat ID |
|--------|-----------|---------|
| ISO | `ISO_TELEGRAM_BOT_TOKEN` | `ISO_TELEGRAM_CHAT_ID` |
| Bảo trì | `TELEGRAM_BOT_TOKEN` | `TELEGRAM_CHAT_ID` |

Hai nhóm hoàn toàn độc lập — thông báo ISO không gửi vào nhóm bảo trì và ngược lại.

---

## Trạng thái triển khai (2026-05-25)

| Hạng mục | Trạng thái |
|----------|-----------|
| SQL migration (5 bảng + triggers + RLS) | ✅ Hoàn thành |
| Migration `phan_loai_tl` + permissions | ✅ Đã chạy |
| Migration `soan_thao/xem_xet/phe_duyet_placement` (3 cột JSONB) | ✅ Đã chạy thủ công (2026-05-25) |
| npm packages | ✅ Hoàn thành |
| API `/api/sign/set-pin` | ✅ Hoàn thành |
| API `/api/sign/verify` | ✅ Hoàn thành |
| API `/api/sign/generate-pdf` — signature persistence + metadata auto-fill + NotoSans + skipTagLabels + diagnostics | ✅ Hoàn thành |
| API `/api/sign/restamp-pdf` | ✅ Hoàn thành |
| API `/api/iso/notify` — 3 action mới | ✅ Hoàn thành |
| Settings tab ISO & Văn bản + Chữ ký cá nhân | ✅ Hoàn thành |
| Settings tab visibility theo permission | ✅ Hoàn thành |
| Module ISO: shell, KPI, danh sách, form detail | ✅ Hoàn thành |
| Module ISO: workflow `bi_tu_choi_phe_duyet` + 3 actions mới | ✅ Hoàn thành |
| Module ISO: drag-and-drop signature placement | ✅ Hoàn thành |
| Module ISO: lọc nhân sự theo quyền | ✅ Hoàn thành |
| Module ISO: mã tài liệu Cha/Con format | ✅ Hoàn thành |
| Module ISO: `phan_loai_tl` cho PL/HD | ✅ Hoàn thành |
| Module ISO: my-tasks page | ✅ Hoàn thành |
| Module ISO: mismatch warning UI + confirmedSkipTags + diagnostics toast | ✅ Hoàn thành |
| Module ISO: NotoSans + Times New Roman cho fill tag và tên người ký | ✅ Hoàn thành |
| Module ISO: preview chữ ký/tên độc lập + fill trực tiếp trên file PDF gốc | ✅ Hoàn thành |
| Module Văn bản (Giai đoạn 3) | ⏳ Pending |
| In-app notification bell (Realtime) | ⏳ Pending |
| Trang in (bypass sidebar) | ⏳ Pending |
| Supabase Storage bucket `iso-documents` | ⏳ Cần tạo thủ công |
