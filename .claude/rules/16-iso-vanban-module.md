## description: Module ISO & Văn bản nội bộ — workflow ký duyệt, chữ ký số PIN, PDF generation

# Module ISO & Văn bản Nội bộ

## Phạm vi

Thay thế hoàn toàn AppSheet + Google Apps Script cho việc quản lý:

- **ISO** (`/dashboard/iso/`): quy trình, hướng dẫn, biểu mẫu, TCCS — vòng đời từ soạn thảo đến ban hành và hủy hiệu lực
- **Văn bản nội bộ** (`/dashboard/documents/`): công văn, thông báo, quyết định — vòng ký phòng ban và phê duyệt BGĐ

Không có migration dữ liệu cũ — chỉ quản lý tài liệu tạo mới từ ERP.  
Mọi dữ liệu phải có `factory_id`, filter theo nhà máy đang đăng nhập.

---

## Migrations

| File                                                                       | Nội dung                                                                                                                                                       |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260522_iso_vanban_module.sql`                                           | Tạo 5 bảng + triggers + RLS + 14 permissions                                                                                                                   |
| `20260523_iso_phan_loai_tl.sql`                                            | Thêm `phan_loai_tl` vào `iso_documents`; seed `settings.master_data`, `settings.maintenance_config`, `iso.signature` vào `permissions` + `role_permissions`    |
| `20260524_iso_signature_placement.sql` (**đã chạy thủ công — 2026-05-25**) | Thêm 3 cột JSONB lưu placement chữ ký từng bước                                                                                                                |
| `20260526_iso_standards_review.sql`                                        | Thêm danh mục tiêu chuẩn, bảng nối `iso_document_standards`, danh mục `iso_document_types`, các cột soát xét/đổi mã/file đính kèm và permission `iso.soat_xet` |

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
file_phieu_yeu_cau_thay_doi_url TEXT, -- file đính kèm soát xét
file_de_nghi_soat_xet_url TEXT,       -- file đính kèm soát xét

doi_ma_tai_lieu BOOLEAN DEFAULT false,
ma_tai_lieu_cu TEXT,          -- mã tài liệu/hồ sơ cũ được chọn để soát xét
ma_tai_lieu_moi TEXT,         -- khi Soát xét đổi mã
ly_do_soat_xet TEXT,
noi_dung_soat_xet TEXT,
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

| Loại                           | Phân loại        | Điều kiện Con            |
| ------------------------------ | ---------------- | ------------------------ |
| CS, OB, ST, QC, TC, QT, MT, QĐ | Luôn Cha         | —                        |
| **PL** (Phụ lục)               | Cha **hoặc** Con | `phan_loai_tl === "con"` |
| **HD** (Hướng dẫn)             | Cha **hoặc** Con | `phan_loai_tl === "con"` |
| **F** (Biểu mẫu)               | Luôn Con         | Luôn true                |

Kiểm tra logic Con trong code:

```typescript
const isCon = phan_loai_tl === "con" || loai_tai_lieu === "F";
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
LOAI_CHA_OPTIONS = ["CS", "OB", "ST", "QC", "TC", "QT", "HD", "MT", "QĐ", "PL"];

// Loại TL có thể là Con
LOAI_CON_OPTIONS = ["PL", "HD", "F"];

// Mapping loai_tai_lieu → phòng ban được phép dùng loại đó
// CS/OB/ST/QC: chỉ PHK; TC/QT/HD/MT/PL/QĐ/F: PHK và tất cả phòng ban khác
LOAI_PHONG_BAN_MAP: Record<string, string[]>;
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
iso.soat_xet / iso.xem_xet / iso.phe_duyet / iso.print
iso.signature               -- tab Chữ ký cá nhân trong Cài đặt (mọi user active)
documents.view / documents.create / documents.edit / documents.delete
documents.ky_phong_ban / documents.phe_duyet / documents.print
settings.master_data        -- tab Danh mục trong Cài đặt
settings.maintenance_config -- tab Bảo trì trong Cài đặt
```

Guard bắt buộc ở cả UI và logic thao tác.

`iso.soat_xet` là permission chính cho bước soát xét/xem xét ISO. Hệ thống có thể fallback `iso.xem_xet` để tương thích dữ liệu cũ, nhưng phân quyền mới phải cấp `iso.soat_xet`.

**Phân quyền mặc định:**

- `admin`: toàn bộ
- `manager`: `iso.view/create/edit`, `iso.soat_xet`, `iso.signature`, `settings.master_data`, `settings.maintenance_config`
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

| Action                           | Ai thực hiện                | Từ → Đến                                                         | Trường cập nhật                                | Thông báo đến                                                              |
| -------------------------------- | --------------------------- | ---------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------- |
| `gui_xem_xet`                    | Soạn thảo                   | `draft → cho_xem_xet`                                            | `ky_soan_thao_at=now()`                        | `xem_xet_user_id`                                                          |
| `gui_phe_duyet` từ draft (Cấp 2) | Soạn thảo                   | `draft → cho_phe_duyet`                                          | `ky_soan_thao_at=now()`                        | `phe_duyet_user_id`                                                        |
| `gui_phe_duyet` từ `cho_xem_xet` | Xem xét                     | `cho_xem_xet → cho_phe_duyet`                                    | `ky_xem_xet_at=now()`                          | `phe_duyet_user_id`                                                        |
| `phe_duyet`                      | Phê duyệt                   | `cho_phe_duyet → co_hieu_luc`                                    | `ky_phe_duyet_at=now()`, `ngay_hieu_luc=now()` | `soan_thao_user_id`, `xem_xet_user_id`                                     |
| `tra_ve`                         | Xem xét / Phê duyệt (Cấp 2) | `cho_xem_xet / cho_phe_duyet → tra_ve`                           | `ghi_chu=lyDo`                                 | `soan_thao_user_id`                                                        |
| `khong_xem_xet`                  | Xem xét                     | `cho_xem_xet → tra_ve`                                           | `ghi_chu=lyDo`                                 | `soan_thao_user_id`                                                        |
| `tu_choi_phe_duyet`              | Phê duyệt                   | Cấp 1: `cho_phe_duyet → bi_tu_choi_phe_duyet`; Cấp 2: `→ tra_ve` | `ghi_chu=lyDo`                                 | Cấp 1: `xem_xet_user_id` + `soan_thao_user_id`; Cấp 2: `soan_thao_user_id` |
| `gui_lai_phe_duyet`              | Xem xét                     | `bi_tu_choi_phe_duyet → cho_phe_duyet`                           | `ky_xem_xet_at=now()`                          | `phe_duyet_user_id`                                                        |
| `tra_ve_nhap`                    | Xem xét                     | `bi_tu_choi_phe_duyet → draft`                                   | `ghi_chu=lyDo` (tùy chọn)                      | `soan_thao_user_id`                                                        |

Mọi action đều INSERT vào `doc_approval_log`.

### Quy trình Soát xét

Khi tạo tài liệu với `chon_quy_trinh = "Soát xét"`:

- Người dùng chỉ được chọn tài liệu/hồ sơ cũ có `trang_thai = 'co_hieu_luc'` và cùng `factory_id`.
- Bộ lọc theo tầng: `Tiêu chuẩn` (multi-select) → `Phòng ban` → `Loại tài liệu/Loại hồ sơ` → `Mã tài liệu/Mã hồ sơ`.
- Khi chọn mã cũ, form lưu `ma_tai_lieu_cu`, hiển thị tên cũ read-only, gợi ý tên mới bằng tên cũ và cho phép sửa.
- Bắt buộc nhập `ly_do_soat_xet`, `noi_dung_soat_xet`; nếu `doi_ma_tai_lieu = true` thì bắt buộc nhập `ma_tai_lieu_moi`.
- Sau khi `phe_duyet`, nếu đổi mã thì cập nhật tài liệu mới sang `ma_tai_lieu_moi`; nếu không đổi mã thì giữ mã hiện tại.
- Sau phê duyệt, chỉ invalidate **1 tài liệu/hồ sơ cũ có hiệu lực gần nhất** theo `ma_tai_lieu_cu`, cùng `factory_id`, `trang_thai = 'co_hieu_luc'`, `id <> docId`, ưu tiên `ngay_hieu_luc DESC NULLS LAST`, rồi `updated_at DESC`.
- Tài liệu/hồ sơ cũ bị invalidate được cập nhật `trang_thai = 'het_hieu_luc'`, `ngay_het_hieu_luc = now()`, sau đó gọi `POST /api/sign/restamp-pdf { docIds, factoryId }`.
- Restamp PDF cũ phải thể hiện `Hết hiệu lực` màu đỏ ở footer và có dấu hiệu ở header; non-PDF được bỏ qua an toàn.

Chi tiết layout form 4 trường hợp nằm trong `.claude/rules/17-iso-soat-xet.md` và phải là nguồn tham chiếu chính khi sửa UI soát xét.

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

  Trong handlePinConfirm:
    const fileExt = doc?.file_goc_url?.split("?")[0].split(".").pop()?.toLowerCase()

    Nếu doc có file_goc_url VÀ fileExt === "pdf" VÀ action không phải noSignActions:
      → Mở SignaturePlacementModal (pdfjs canvas + react-draggable)
      → User kéo/resize vị trí chữ ký và tên (2 box độc lập)
      → Click "Xác nhận vị trí" → doTransition(action, token, placement)

    Nếu file_goc_url tồn tại nhưng KHÔNG phải PDF (DOCX, XLSX, v.v.):
      → Bỏ qua placement modal
      → Gọi doTransition(action, token, null) trực tiếp

    Nếu không có file hoặc action thuộc noSignActions
      ["tra_ve","khong_xem_xet","tu_choi_phe_duyet","tra_ve_nhap"]:
      → doTransition(action, token, null)

doTransition:
  1. Cập nhật trang_thai (Supabase)
  2. INSERT doc_approval_log
  3. Nếu có token + file_goc_url:
     POST /api/sign/generate-pdf { token, docId, docType, signaturePlacement, skipTagLabels }

     Server (generate-pdf):
       — Phát hiện non-PDF (ext ≠ "pdf") → trả về { ok: true, skipped: true, reason: "non-pdf" }
       — File PDF: verify JWT → lưu placement → quét tag header/footer → điền tag tìm thấy
          → nhúng chữ ký body lũy kế (tất cả bước đã ký) + tên người ký nếu bật → upload PDF

     UI xử lý response:
       Nếu response.skipped === true:
         → toast "File không phải PDF — chữ ký số không được nhúng, đã lưu workflow"
         → KHÔNG cập nhật file_signed_pdf_url
       Nếu response.ok (PDF):
         → Cập nhật file_signed_pdf_url
         → Nếu response.metaMismatched.length > 0: hiển thị warning banner
         → Nếu diagnostics.sigImgLoadFailed.length > 0: toast cảnh báo chưa có ảnh chữ ký

  4. Nếu soát xét invalidate tài liệu cũ:
     POST /api/sign/restamp-pdf { docIds, factoryId }
  5. POST /api/iso/notify { docId, factoryId, action, recipientUserIds }
```

**Chữ ký là bắt buộc — không có nút "Bỏ qua chữ ký"**. Placement modal luôn phải được xác nhận trước khi gọi `doTransition` (trừ non-PDF và noSignActions).

### JWT Secret

```
process.env.SIGN_JWT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
```

### API Routes

| Route                             | Method | Mô tả                                                                                                                                         |
| --------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/sign/set-pin`               | POST   | `{userId, pin}` → bcrypt.hash → upsert `sign_pins`                                                                                            |
| `/api/sign/verify`                | POST   | `{userId, pin, docId, docType}` → verify bcrypt → JWT 5 phút                                                                                  |
| `/api/sign/generate-pdf`          | POST   | `{token, docId, docType, signaturePlacement?, skipTagLabels?}` → verify JWT → fill tag header/footer tìm thấy → embed chữ ký/tên → upload PDF |
| `/api/sign/restamp-pdf`           | POST   | `{docIds, factoryId}` → load PDF cũ → stamp footer "Hết hiệu lực" → re-upload                                                                 |
| `/api/iso/notify`                 | POST   | `{docId, factoryId, action, recipientUserIds, lyDo?}` → in-app + Telegram + Email                                                             |
| `/api/iso/profiles-by-permission` | GET    | `?factoryId=...&permCode=...` → danh sách user có quyền (service role, bypass RLS)                                                            |

### Ảnh chữ ký

- Storage bucket: `iso-documents` (public)
- Path: `signatures/{factory_id}/{user_id}/chu_ky.png`
- Upload: upsert=true, overwrite nếu đã tồn tại
- Quản lý tại: `Cài đặt → ISO & Văn bản → Chữ ký cá nhân`

### signaturePlacement object

```typescript
type SignPlacement = {
  page: number; // số trang (1-based)
  x: number; // tọa độ từ trái (pt, pdf-lib bottom-left origin)
  y: number; // tọa độ từ đáy (pt)
  width: number;
  height: number;
  showSignerName?: boolean;
  nameX?: number;
  nameY?: number;
  nameWidth?: number;
  nameHeight?: number;
};
```

Canvas coords → PDF coords: `y_pdf = pdfPageHeight - (y_canvas / scale) - (h_canvas / scale)`

---

## Supabase Storage — bucket `iso-documents`

Bucket **public**, tạo thủ công trong Supabase Dashboard.

| Mục đích        | Path                                           |
| --------------- | ---------------------------------------------- |
| File gốc upload | `{factory_id}/iso/{timestamp}_{filename}`      |
| Ảnh chữ ký      | `signatures/{factory_id}/{user_id}/chu_ky.png` |
| PDF đã ký       | `{factory_id}/iso/signed/{docId}_signed.pdf`   |

File gốc không bao giờ bị modify — chỉ đọc để preview.

---

## PDF Generation — Logic chung

`generate-pdf/route.ts` phân nhánh theo `isCon`:

```typescript
function isConDoc(
  loaiTaiLieu: string | null,
  phanLoaiTl: string | null,
): boolean {
  if (loaiTaiLieu === "F") return true;
  if ((loaiTaiLieu === "PL" || loaiTaiLieu === "HD") && phanLoaiTl === "con")
    return true;
  return false;
}
```

| Loại                               | Tạo trang riêng | Header tag            | Footer tag                   | Chữ ký body |
| ---------------------------------- | --------------- | --------------------- | ---------------------------- | ----------- |
| **Cha** (QT, HD Cha, PL Cha, v.v.) | ❌ Không        | Điền nếu tìm thấy tag | Thay nếu tìm thấy footer mẫu | ✅ Có       |
| **Con** (F, HD Con, PL Con)        | ❌ Không        | Điền nếu tìm thấy tag | Thay nếu tìm thấy footer mẫu | ✅ Có       |

- Không tạo “phiếu ký duyệt” riêng cho cả tài liệu cha lẫn tài liệu con.
- PDF đầu ra phải giữ nguyên số trang của `file_goc_url`.
- Mọi thay đổi đều được vẽ trực tiếp lên các trang của tài liệu gốc.

---

## Drag-and-drop Signature Placement

Đã triển khai trong `documents/[id]/page.tsx`:

```typescript
// State placement modal
const [placementModal, setPlacementModal] = useState<{
  show: boolean;
  token: string;
  action: PinModalAction;
  lyDo?: string;
  sigX: number;
  sigY: number;
  sigW: number;
  sigH: number;
  nameX: number;
  nameY: number;
  nameW: number;
  nameH: number;
  showSignerName: boolean;
  currentPage: number;
  totalPages: number;
  canvasScale: number;
  pdfPageHeight: number;
  sigImgUrl: string | null;
  previewSignatures: PreviewSignature[]; // chữ ký/tên các bước trước đó
} | null>(null);

// pdfjs worker — version-matched từ jsdelivr CDN
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
```

### PreviewSignature — preview chữ ký và tên của các bước trước

```typescript
type PreviewSignature = SignPlacement & {
  signerUserId: string;
  url: string; // URL ảnh chữ ký
  signerName?: string; // Tên người ký (snapshot từ doc.soan_thao / xem_xet / phe_duyet)
};
```

`buildPreviewSignatures()` tạo danh sách chữ ký của tất cả người ký KHÁC user hiện tại đã có `ky_*_at` (đã ký):

```typescript
const buildPreviewSignatures = () => {
  const nameByUserId: Record<string, string> = {};
  if (doc.soan_thao_user_id)
    nameByUserId[doc.soan_thao_user_id] = doc.soan_thao ?? "";
  if (doc.xem_xet_user_id)
    nameByUserId[doc.xem_xet_user_id] = doc.xem_xet ?? "";
  if (doc.phe_duyet_user_id)
    nameByUserId[doc.phe_duyet_user_id] = doc.phe_duyet ?? "";

  return candidates
    .filter(
      (e) =>
        e.signerUserId &&
        e.placement &&
        e.signedAt &&
        e.signerUserId !== user.id,
    )
    .map((e) => ({
      ...e.placement,
      signerUserId: e.signerUserId,
      url: supabase.storage
        .from("iso-documents")
        .getPublicUrl(`signatures/${factoryId}/${e.signerUserId}/chu_ky.png`)
        .data.publicUrl,
      // Bao gồm đủ name fields từ placement
      showSignerName: e.placement.showSignerName as unknown as
        | boolean
        | undefined,
      nameX: Number(e.placement.nameX ?? 0),
      nameY: Number(e.placement.nameY ?? 0),
      nameWidth: Number(e.placement.nameWidth ?? 80),
      nameHeight: Number(e.placement.nameHeight ?? 20),
      signerName: nameByUserId[e.signerUserId] ?? "",
    }));
};
```

**Lưu ý TypeScript**: `entry.placement.showSignerName` từ Supabase JSONB có runtime type `number`, nhưng TypeScript typed `boolean | undefined`. Cast qua `unknown`: `(entry.placement.showSignerName as unknown as boolean | undefined)`.

**UI render preview canvas**: Mỗi `PreviewSignature` render 2 lớp độc lập trên canvas:

1. `<img>` ảnh chữ ký tại vị trí đã đặt (opacity 0.45)
2. `<div>` text tên người ký tại vị trí box tên (nếu `showSignerName !== false && signerName`)

Tên hiển thị dạng italic, font Times New Roman, viền dashed mờ để phân biệt với chữ ký đang đặt của bước hiện tại.

- Ảnh chữ ký và tên người ký là hai lớp preview độc lập.
- Người dùng kéo/resize ảnh chữ ký riêng, kéo/resize box tên riêng.
- Nếu template đã có sẵn tên, người dùng có thể tắt box tên bằng toggle `(X)` — tên là tùy chọn.
- Chữ ký là **bắt buộc** — không có nút bỏ qua chữ ký.

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

| Package                        | Mục đích                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| `pdf-lib`                      | Nhúng ảnh chữ ký/tên vào PDF, điền tag header/footer, lưu PDF kết quả                   |
| `pdfjs-dist` (v5.x)            | Render PDF thành canvas để preview (client) + scan text metadata (server, Node.js mode) |
| `bcryptjs` + `@types/bcryptjs` | Hash/verify PIN                                                                         |
| `react-draggable`              | Drag chữ ký trên canvas                                                                 |
| `re-resizable`                 | Resize ảnh chữ ký                                                                       |
| `jose`                         | Mint/verify JWT (HS256)                                                                 |
| `nodemailer`                   | Gửi email thông báo                                                                     |

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
const isNew = docId === "new-doc";
// canXemXet phải được định nghĩa TRƯỚC isEditable
const canXemXet =
  (hasPermission(user, "iso.soat_xet") || hasPermission(user, "iso.xem_xet")) &&
  !!userId &&
  userId === doc?.xem_xet_user_id;
const canApprove =
  hasPermission(user, "iso.phe_duyet") &&
  !!userId &&
  userId === doc?.phe_duyet_user_id;
// bi_tu_choi_phe_duyet cho phép người xem xét sửa để gửi lại
const isEditable =
  isNew ||
  trangThai === "draft" ||
  trangThai === "tra_ve" ||
  (trangThai === "bi_tu_choi_phe_duyet" && canXemXet);
```

**Thứ tự khai báo bắt buộc**: `canXemXet` / `canApprove` phải đứng trước `isEditable` trong code — nếu đảo ngược, `canXemXet` sẽ là `undefined` khi được dùng trong biểu thức `isEditable`.

Link "Tạo tài liệu" trong `documents/page.tsx` trỏ thẳng vào `/dashboard/iso/documents/new-doc`.  
`new/page.tsx` tồn tại cho backward compat nhưng chỉ là redirect fallback.

### canXemXet / canApprove

```typescript
const canXemXet =
  (hasPermission(user, "iso.soat_xet") || hasPermission(user, "iso.xem_xet")) &&
  !!userId &&
  userId === doc?.xem_xet_user_id;
const canApprove =
  hasPermission(user, "iso.phe_duyet") &&
  !!userId &&
  userId === doc?.phe_duyet_user_id;
```

Người xem xét / phê duyệt phải là đúng user được chỉ định.

### Buttons theo trạng thái

| Trạng thái             | canXemXet thấy                                                        | canApprove thấy                                                 |
| ---------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------- |
| `cho_xem_xet`          | "Xem xét" (gui_phe_duyet) + "Không xem xét" (khong_xem_xet)           | —                                                               |
| `cho_phe_duyet`        | —                                                                     | "Phê duyệt" (phe_duyet) + "Không phê duyệt" (tu_choi_phe_duyet) |
| `bi_tu_choi_phe_duyet` | "Gửi phê duyệt lại" (gui_lai_phe_duyet) + "Trả về Nháp" (tra_ve_nhap) | —                                                               |

Phê duyệt KHÔNG có nút "Trả về" (tra_ve) ở bước `cho_xem_xet` — phê duyệt không được can thiệp vào bước xem xét.

### Lọc nhân sự theo quyền

Dropdown "Người xem xét" và "Người phê duyệt" chỉ hiện user có permission tương ứng.

**Tại sao cần API route server-side**: Frontend Supabase client (anon key) bị RLS chặn — chỉ đọc được bản ghi `user_permissions` của chính mình. Cần `SUPABASE_SERVICE_ROLE_KEY` (server-side only) để bypass RLS và đọc quyền của tất cả user.

**Cách hoạt động (`GET /api/iso/profiles-by-permission`)**:

```typescript
// Client gọi API route (không truy vấn DB trực tiếp)
const loadProfilesByPermission = async (
  fid: string,
  permCode: string,
): Promise<ProfileOption[]> => {
  const res = await fetch(
    `/api/iso/profiles-by-permission?factoryId=${fid}&permCode=${encodeURIComponent(permCode)}`,
  );
  if (!res.ok) return [];
  const json = await res.json();
  return (json.profiles || []) as ProfileOption[];
};

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
    const next = { ...f, ...patch };
    const isConNext = next.phan_loai_tl === "con";
    if (isConNext) {
      // Bước 1: build mã cha từ PB + loai_tai_lieu_cha + so_hieu_cha
      const maCha = buildMaTaiLieu(
        next.phong_ban,
        next.loai_tai_lieu_cha,
        next.so_hieu_cha,
      );
      next.ma_tai_lieu_cha = maCha;
      // Bước 2: build mã con từ maCha + loai_tai_lieu (của con) + so_hieu
      next.ma_tai_lieu = buildMaTaiLieuCon(
        maCha,
        next.loai_tai_lieu,
        next.so_hieu,
      );
    } else {
      next.ma_tai_lieu_cha = "";
      next.ma_tai_lieu = buildMaTaiLieu(
        next.phong_ban,
        next.loai_tai_lieu,
        next.so_hieu,
      );
    }
    return next;
  });
};
```

> Người dùng KHÔNG nhập tay `ma_tai_lieu_cha`. Mã cha được tự sinh từ `phong_ban + loai_tai_lieu_cha + so_hieu_cha`. Đây là cải tiến so với thiết kế ban đầu (trước đây form có field nhập tay mã cha — đã xóa).

### IsoDocumentForm — các field liên quan đến Con

```typescript
type IsoDocumentForm = {
  ma_tai_lieu: string; // auto-generated (readonly)
  so_hieu: string; // số hiệu của TL này (Cha: serial của TL; Con: serial con)

  // Chỉ dùng khi phan_loai_tl === "con":
  loai_tai_lieu_cha: string; // loại TL của tài liệu cha (e.g. "QT")
  so_hieu_cha: string; // số hiệu cha (e.g. "2")
  ma_tai_lieu_cha: string; // mã cha auto-derived, KHÔNG nhập tay (e.g. "NMCB-QT02")

  phan_loai_tl: string; // "cha" | "con"
  // ...
};
```

Khi load tài liệu Con từ DB (`loadDoc`), phải gọi `parseParentCode(maTaiLieuCha)` để hydrate `loai_tai_lieu_cha` và `so_hieu_cha`:

```typescript
const isCon = d.phan_loai_tl === "con" || d.loai_tai_lieu === "F";
if (isCon) {
  const parsed = parseMaTaiLieuCon(d.ma_tai_lieu, d.loai_tai_lieu);
  const maTaiLieuCha = parsed.maCha;
  const parentParsed = parseParentCode(maTaiLieuCha);
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
// 1. oldDocumentCode = doc.ma_tai_lieu_cu || doc.ma_tai_lieu
// 2. Nếu doi_ma_tai_lieu && ma_tai_lieu_moi → cập nhật tài liệu mới sang mã mới
// 3. Tìm đúng 1 tài liệu/hồ sơ cũ còn hiệu lực gần nhất theo mã cũ:
const { data: toInvalidate } = await supabase
  .from("iso_documents")
  .select("id")
  .eq("factory_id", factoryId)
  .eq("ma_tai_lieu", oldDocumentCode)
  .eq("trang_thai", "co_hieu_luc")
  .neq("id", docId)
  .order("ngay_hieu_luc", { ascending: false, nullsFirst: false })
  .order("updated_at", { ascending: false })
  .limit(1);

// 4. Update bản ghi tìm được sang het_hieu_luc + restamp-pdf
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
const [headerMismatchWarnings, setHeaderMismatchWarnings] = useState<
  Array<{ found: string; expected: string }>
>([]);
// Labels user đã xác nhận là không phải lỗi — truyền vào generate-pdf lần tiếp theo
const [confirmedSkipTags, setConfirmedSkipTags] = useState<string[]>([]);
```

#### Luồng hoạt động

1. Sau `generate-pdf` thành công, nếu `pdfJson.metaMismatched?.length > 0` → `setHeaderMismatchWarnings(pdfJson.metaMismatched)`
2. Banner amber hiển thị danh sách tag tìm thấy và gợi ý đúng
3. Nút **"Bỏ qua, không điền tag này"**: thêm `expected` vào `confirmedSkipTags`, xóa warnings
4. Nút **"Đóng"**: chỉ xóa warnings (không thêm vào skipTags — sẽ warn lại lần sau)
5. `confirmedSkipTags` được truyền vào mỗi lần gọi generate-pdf:

```typescript
body: JSON.stringify({
  token,
  docId,
  docType: "iso",
  signaturePlacement: placement,
  skipTagLabels: confirmedSkipTags, // tích lũy từ các lần bỏ qua trước
});
```

#### Diagnostics toast

Nếu `pdfJson.diagnostics?.sigImgLoadFailed?.length > 0` → toast cảnh báo:

```typescript
const failedSigs = pdfJson.diagnostics?.sigImgLoadFailed as
  | string[]
  | undefined;
if (failedSigs && failedSigs.length > 0) {
  showToast(
    false,
    `${failedSigs.length} người ký chưa có ảnh chữ ký. Vào Cài đặt → Chữ ký cá nhân để upload.`,
  );
}
```

### doc_approval_log insert

```typescript
const lyDoActions = [
  "tra_ve",
  "khong_xem_xet",
  "tu_choi_phe_duyet",
  "tra_ve_nhap",
];
await supabase.from("doc_approval_log").insert({
  doc_id: docId,
  doc_type: "iso",
  factory_id: factoryId,
  user_id: userId,
  action,
  ly_do: lyDoActions.includes(action) ? lyDoTraVe : null,
});
```

### Signature persistence (generate-pdf/route.ts)

Mỗi lần generate PDF, server thực hiện theo thứ tự:

1. **Detect non-PDF**: nếu `file_goc_url` có extension khác `pdf`:
   - Nếu `action === "phe_duyet"` VÀ `signFileKind === "main"`: **convert sang PDF qua CloudConvert** (`convertOfficeUrlToPdfDocumentWithRetry`) rồi tiếp tục flow bình thường — không trả về `skipped`
   - Tất cả trường hợp khác: trả về `{ ok: true, skipped: true, reason: "non-pdf" }` ngay lập tức (sau khi đã lưu placement nếu có)
2. **Xác định signer hiện tại** theo `userId` so với `soan_thao_user_id / xem_xet_user_id / phe_duyet_user_id`
3. **Lưu placement** của bước hiện tại vào DB (`soan_thao_placement / xem_xet_placement / phe_duyet_placement`)
4. **Reload tất cả 3 placements** từ DB
5. **Bắt đầu từ `file_goc_url`** (KHÔNG dùng `file_signed_pdf_url` — tránh double-stamp)
6. **Scan text layer** bằng `pdfjs-dist` → điền tag header/footer hợp lệ; bỏ qua tag mismatch (trả về `metaMismatched`)
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
  - `Lần ban hành:` (quy trình Soạn thảo)
  - `Lần sửa đổi:` hoặc `Lần soát xét:` (chỉ hợp lệ khi `chon_quy_trinh === "Soát xét"`)
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

#### Tag tương tự phải cảnh báo và bỏ qua fill

- Các tag có thể nhầm lẫn:
  - `Mã hồ sơ`, `Mã hiệu`, `Số hiệu` → nhầm với `Mã tài liệu`
  - `Ngày ban hành`, `Ngày áp dụng` → nhầm với `Ngày hiệu lực`
  - `Trạng thái` → nhầm với `Tình trạng`
  - `Phiên bản` → nhầm với `Lần ban hành / Lần sửa đổi`
  - `Lần sửa đổi`, `Lần soát xét` → nhầm với `Lần ban hành` **khi `chon_quy_trinh !== "Soát xét"`**
- Nếu phát hiện tag tương tự:
  - **KHÔNG tự điền** — tag bị skip hoàn toàn (không điền giá trị thực vào vị trí đó)
  - trả về trong `metaMismatched[]` để UI hiển thị warning banner
  - người dùng có thể bấm "Bỏ qua, không điền tag này" để thêm vào `confirmedSkipTags` — lần sau sẽ không cảnh báo nữa
- `Lần sửa đổi` / `Lần soát xét` **KHÔNG bị flagged** khi `chon_quy_trinh === "Soát xét"` — đây là tag hợp lệ cho quy trình soát xét.

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
Không đặt ra ngoài ô chứa
```

- Cảnh báo này hiển thị cùng lúc với preview chữ ký/tên.

#### Cách nhận diện tag trong `fillMetadataPlaceholders`

Hàm nhận thêm param `chonQuyTrinh: string | null` để quyết định pattern mismatch theo ngữ cảnh.

```typescript
async function fillMetadataPlaceholders(
  pdfDoc,
  pdfBytes,
  doc,
  font,
  qrBuffer,
  maTl,
  lsStr,
  dateStr,
  statusText,
  skipLabels: string[] = [],
  chonQuyTrinh: string | null = null, // "Soát xét" | "Soạn thảo" | null
): Promise<MetaFillResult>;
```

**`getMismatchPatterns(chonQuyTrinh)`** — context-aware:

```typescript
function getMismatchPatterns(chonQuyTrinh: string | null) {
  const base = [
    { pattern: /^ma\s*ho\s*so\b/i, expected: "Mã tài liệu" },
    { pattern: /^ma\s*hieu\b/i, expected: "Mã tài liệu" },
    { pattern: /^so\s*hieu(\s*tai\s*lieu)?\b/i, expected: "Mã tài liệu" },
    { pattern: /^ngay\s*ban\s*hanh\b/i, expected: "Ngày hiệu lực" },
    { pattern: /^ngay\s*ap\s*dung\b/i, expected: "Ngày hiệu lực" },
    { pattern: /^phien\s*ban\b/i, expected: "Lần ban hành / Lần sửa đổi" },
    { pattern: /^trang\s*thai\b/i, expected: "Tình trạng" },
  ];
  // Khi KHÔNG phải Soát xét: "Lần sửa đổi" / "Lần soát xét" là tag sai
  if (chonQuyTrinh !== "Soát xét") {
    base.push({ pattern: /^lan\s*sua\s*doi\b/i, expected: "Lần ban hành" });
    base.push({ pattern: /^lan\s*soat\s*xet\b/i, expected: "Lần ban hành" });
  }
  return base;
}
```

**Logic trong vòng lặp fill**: Nếu item match một mismatch pattern → đánh dấu `isMismatched = true` → **KHÔNG fill** (continue sang item tiếp theo) → thêm vào `mismatched[]` để trả về UI.

```typescript
let isMismatched = false;
for (const { pattern, expected } of mismatchPatterns) {
  if (skipLabels.includes(expected)) continue;
  if (pattern.test(normalizedItem)) {
    mismatched.push({ found: item.str, expected });
    isMismatched = true;
  }
}
if (isMismatched) continue; // bỏ qua fill — yêu cầu người dùng sửa template
```

**Quy tắc chung**:

- Dùng `pdfjs-dist` để đọc text layer của tất cả trang.
- Chuỗi tìm kiếm phải được chuẩn hóa tiếng Việt về dạng **không dấu**, chữ thường, bỏ khoảng trắng thừa trước khi match.
- Header/footer chỉ được xử lý trong vùng header/footer của trang; body không được thay tag.
- Với header: giá trị hiện có chỉ được đọc từ phần text nằm **bên phải label**; nếu đã có dữ liệu thật thì bỏ qua.
- Với footer: chỉ thay khi match đúng mẫu footer chuẩn hóa; bỏ qua nếu đã là giá trị thật.
- `metaFilled`, `metaNotFound`, `metaMismatched` tiếp tục được trả về cho UI.

---

## Trạng thái label & màu (iso-types.ts)

```typescript
export const TRANG_THAI_LABEL: Record<IsoTrangThai, string> = {
  draft: "Nháp",
  cho_xem_xet: "Chờ xem xét",
  cho_phe_duyet: "Chờ phê duyệt",
  co_hieu_luc: "Có hiệu lực",
  het_hieu_luc: "Hết hiệu lực",
  tra_ve: "Trả về",
  bi_tu_choi_phe_duyet: "Phê duyệt từ chối",
};

export const TRANG_THAI_COLOR: Record<IsoTrangThai, string> = {
  draft: "bg-slate-100 text-slate-600",
  cho_xem_xet: "bg-amber-100 text-amber-700",
  cho_phe_duyet: "bg-orange-100 text-orange-700",
  co_hieu_luc: "bg-emerald-100 text-emerald-700",
  het_hieu_luc: "bg-red-100 text-red-600",
  tra_ve: "bg-rose-100 text-rose-700",
  bi_tu_choi_phe_duyet: "bg-red-100 text-red-700",
};
```

---

## Thông báo ISO (`/api/iso/notify`)

Gửi 3 kênh: in-app (`notifications` table) + Telegram + Email.

```typescript
// POST { docId, factoryId, action, recipientUserIds: string[], lyDo? }
```

| Action                     | Gửi đến                                                                    | Tiêu đề                         |
| -------------------------- | -------------------------------------------------------------------------- | ------------------------------- |
| `gui_xem_xet`              | `xem_xet_user_id`                                                          | "Tài liệu cần xem xét"          |
| `gui_phe_duyet`            | `phe_duyet_user_id`                                                        | "Tài liệu cần phê duyệt"        |
| `phe_duyet`                | `soan_thao_user_id`, `xem_xet_user_id`                                     | "Tài liệu đã được phê duyệt"    |
| `tra_ve` / `khong_xem_xet` | `soan_thao_user_id`                                                        | "Tài liệu bị trả về"            |
| `tu_choi_phe_duyet`        | Cấp 1: `xem_xet_user_id` + `soan_thao_user_id`; Cấp 2: `soan_thao_user_id` | "Tài liệu bị từ chối phê duyệt" |
| `gui_lai_phe_duyet`        | `phe_duyet_user_id`                                                        | "Tài liệu gửi phê duyệt lại"    |
| `tra_ve_nhap`              | `soan_thao_user_id`                                                        | "Tài liệu trả về Nháp"          |

Pattern giống `src/app/api/maintenance/notify/route.ts`. Màu violet (`#7c3aed`) thay vì orange.

**Telegram ISO dùng nhóm riêng** — env vars khác với module bảo trì:

| Module  | Bot Token                | Chat ID                |
| ------- | ------------------------ | ---------------------- |
| ISO     | `ISO_TELEGRAM_BOT_TOKEN` | `ISO_TELEGRAM_CHAT_ID` |
| Bảo trì | `TELEGRAM_BOT_TOKEN`     | `TELEGRAM_CHAT_ID`     |

Hai nhóm hoàn toàn độc lập — thông báo ISO không gửi vào nhóm bảo trì và ngược lại.

---

## Trạng thái triển khai (2026-05-26)

| Hạng mục                                                                                                                | Trạng thái                       |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| SQL migration (5 bảng + triggers + RLS)                                                                                 | ✅ Hoàn thành                    |
| Migration `phan_loai_tl` + permissions                                                                                  | ✅ Đã chạy                       |
| Migration `soan_thao/xem_xet/phe_duyet_placement` (3 cột JSONB)                                                         | ✅ Đã chạy thủ công (2026-05-25) |
| npm packages                                                                                                            | ✅ Hoàn thành                    |
| API `/api/sign/set-pin`                                                                                                 | ✅ Hoàn thành                    |
| API `/api/sign/verify`                                                                                                  | ✅ Hoàn thành                    |
| API `/api/sign/generate-pdf` — signature persistence + metadata auto-fill + NotoSans + skipTagLabels + diagnostics      | ✅ Hoàn thành                    |
| API `/api/sign/generate-pdf` — mismatch detection + skip fill cho tag mismatch (revision aliases hợp lệ không cảnh báo) | ✅ Hoàn thành (2026-05-26)       |
| API `/api/sign/generate-pdf` — non-PDF: `phe_duyet` main → CloudConvert polling; các bước khác → skipped: true           | ✅ Cập nhật (2026-05-29)         |
| API `/api/sign/restamp-pdf`                                                                                             | ✅ Hoàn thành                    |
| API `/api/iso/notify` — 3 action mới                                                                                    | ✅ Hoàn thành                    |
| Settings tab ISO & Văn bản + Chữ ký cá nhân                                                                             | ✅ Hoàn thành                    |
| Settings tab visibility theo permission                                                                                 | ✅ Hoàn thành                    |
| Module ISO: shell, KPI, danh sách, form detail                                                                          | ✅ Hoàn thành                    |
| Module ISO: workflow `bi_tu_choi_phe_duyet` + 3 actions mới                                                             | ✅ Hoàn thành                    |
| Module ISO: drag-and-drop signature placement                                                                           | ✅ Hoàn thành                    |
| Module ISO: preview lũy kế tên người ký các bước trước (`PreviewSignature.signerName`)                                  | ✅ Hoàn thành (2026-05-26)       |
| Module ISO: bypass placement modal cho non-PDF + toast thông báo                                                        | ✅ Hoàn thành (2026-05-26)       |
| Module ISO: bỏ nút "Bỏ qua chữ ký" (chữ ký bắt buộc)                                                                    | ✅ Hoàn thành (2026-05-26)       |
| Module ISO: đổi nhãn cảnh báo → "Không đặt ra ngoài ô chứa"                                                             | ✅ Hoàn thành (2026-05-26)       |
| Module ISO: lọc nhân sự theo quyền                                                                                      | ✅ Hoàn thành                    |
| Module ISO: mã tài liệu Cha/Con format                                                                                  | ✅ Hoàn thành                    |
| Module ISO: `phan_loai_tl` cho PL/HD                                                                                    | ✅ Hoàn thành                    |
| Module ISO: my-tasks page                                                                                               | ✅ Hoàn thành                    |
| Module ISO: mismatch warning UI + confirmedSkipTags + diagnostics toast                                                 | ✅ Hoàn thành                    |
| Module ISO: NotoSans + Times New Roman cho fill tag và tên người ký                                                     | ✅ Hoàn thành                    |
| Module ISO: preview chữ ký/tên độc lập + fill trực tiếp trên file PDF gốc                                               | ✅ Hoàn thành                    |
| Module ISO: tiêu chuẩn áp dụng nhiều-nhiều (`iso_standards`, `iso_document_standards`)                                  | ✅ Hoàn thành (2026-05-26)       |
| Module ISO: permission `iso.soat_xet` + fallback `iso.xem_xet`                                                          | ✅ Hoàn thành (2026-05-26)       |
| Module ISO: form soạn thảo/soát xét theo 4 trường hợp TH1-TH4                                                           | ✅ Hoàn thành (2026-05-26)       |
| Module ISO: soát xét lọc tài liệu/hồ sơ `Có hiệu lực` theo Tiêu chuẩn → Phòng ban → Loại → Mã                           | ✅ Hoàn thành (2026-05-26)       |
| Module ISO: soát xét lưu `ma_tai_lieu_cu`, lý do/nội dung soát xét, đổi mã mới, file đính kèm                           | ✅ Hoàn thành (2026-05-26)       |
| Module Văn bản (Giai đoạn 3)                                                                                            | ⏳ Pending                       |
| In-app notification bell (Realtime)                                                                                     | ⏳ Pending                       |
| Trang in (bypass sidebar)                                                                                               | ⏳ Pending                       |
| Supabase Storage bucket `iso-documents`                                                                                 | ⏳ Cần tạo thủ công              |

---

## Cập nhật nóng (2026-05-26, phiên fix mới)

### 1) Sửa lỗi chồng 2 dòng tên ở placement modal

- Nguyên nhân: modal ký dùng nền `file_signed_pdf_url` (đã có chữ ký/tên lũy kế), nhưng frontend vẫn render thêm lớp `previewSignatures` nên bị đè 2 lần.
- Fix:
  - Thêm `sourcePdfUrl` vào state `placementModal`.
  - Khi mở modal ký:
    - dùng `sourcePdfUrl = doc.file_signed_pdf_url || doc.file_goc_url`.
    - nếu đang dùng `file_signed_pdf_url` thì **không render** `previewSignatures`.
- Kết quả: không còn 2 dòng tên ở bước Xem xét/Phê duyệt.

### 2) Chuẩn hóa logic mismatch cho tag revision

- Trước đây có cảnh báo sai với `Lần sửa đổi` trong một số trường hợp.
- Hiện tại coi các nhãn sau là **alias hợp lệ** của cùng nhóm revision:
  - `Lần ban hành`
  - `Lần sửa đổi`
  - `Lần soát xét`
  - `Lần ban hành / Lần sửa đổi`
- `getMismatchPatterns()` không còn đẩy `Lần sửa đổi`/`Lần soát xét` vào nhóm mismatch.
- Kết quả: không còn warning giả kiểu “đã nhập sai thay vì Lần ban hành / Lần sửa đổi”.

### 3) Quy tắc vận hành để debug nhanh

- `bodySignaturesEmbedded` phản ánh đúng số signer có placement tại thời điểm gọi API.
- Nếu `allPlacementsRaw` cho thấy `xem_xet/phe_duyet` đang `hasPlacement=false` thì đó là lý do kỹ thuật khiến PDF chỉ embed được 1 chữ ký ở lần gọi đó.

---

## Cập nhật nóng (2026-05-27, ký DOCX/XLSX theo tag)

### 1) API ký Office

- Thêm route `POST /api/sign/generate-office`.
- Route nhận `{ token, docId, docType, fileKind }`, xác thực JWT giống luồng PDF.
- `fileKind` hỗ trợ:
  - `main`: file tài liệu/hồ sơ chính.
  - `change_request`: phiếu yêu cầu thay đổi.
  - `review_request`: đề nghị soát xét.
- DOCX được xử lý bằng `jszip`; XLSX được xử lý bằng `exceljs`.
- Route quét toàn bộ file, thay tất cả tag trùng khớp chính xác, chèn QR và ảnh chữ ký tại vị trí tag.

### 2) Migration lưu file Office đã ký

- Thêm migration `supabase/migrations/20260527_iso_office_signing.sql`.
- Các cột mới:
  - `file_signed_office_url`
  - `file_signed_office_type`
  - `file_phieu_yeu_cau_thay_doi_signed_url`
  - `file_de_nghi_soat_xet_signed_url`
- Cần chạy migration này trên Supabase trước khi ký DOCX/XLSX thật.

### 3) Quy tắc ký DOCX/XLSX

- Không chuyển DOCX/XLSX thành PDF để ký thay file gốc.
- File chính là template có hiệu lực, dùng lại nhiều lần; khi dùng mẫu phải tạo bản sao đã điền tag/ký.
- Phiếu yêu cầu thay đổi và đề nghị soát xét chỉ dùng để hợp thức hóa hồ sơ soát xét, không dùng làm mẫu báo cáo lặp lại.
- Office template không có nút "Bỏ qua tag".
- Nếu thiếu tag bắt buộc của bước ký hoặc phát hiện tag gần giống/sai, hệ thống báo lỗi để sửa template và không chuyển trạng thái workflow.

### 4) UI

- Khu vực upload file đã có hướng dẫn tag cho DOCX/XLSX.
- Cảnh báo upload DOCX/XLSX đã đổi thành: file sẽ được ký theo tag, người dùng phải đặt đúng tag chữ ký, tên người ký và QR.
- Sidebar hiển thị link tải file DOCX/XLSX đã ký khi có `file_signed_office_url`.

---

## Cập nhật nóng (2026-05-28, footer, QR và hồ sơ con)

### 1) Quy tắc mã hồ sơ con

- Khi soạn thảo hồ sơ con từ một tài liệu cha, mã hồ sơ con phải tự sinh theo mã cha.
- Ví dụ tài liệu cha `NMCB-QT01`, chọn loại hồ sơ con là `F`/Biểu mẫu:
  - Khi chưa nhập số hiệu hồ sơ con: hiển thị tiền tố `NMCB-QT01-F`.
  - Khi nhập số hiệu `01`: mã đầy đủ là `NMCB-QT01-F01`.
- `F` luôn là hồ sơ con. `PL` và `HD` là hồ sơ con khi `phan_loai_tl = "con"`.
- Người dùng không nhập tay mã tài liệu/hồ sơ; form chỉ cho nhập các thành phần như phòng ban, loại, số hiệu cha và số hiệu con.

### 2) Quy tắc điền header/footer PDF

- Header và footer chỉ được điền phần còn thiếu. Nếu người dùng đã điền sẵn một tag bằng giá trị thật thì code phải bỏ qua tag đó, không ghi đè và không nối thêm giá trị mới.
- Ví dụ header đã có `Ngày hiệu lực: 03/04/2026` thì không được điền thêm ngày hiện tại thành `Ngày hiệu lực: 03/04/2026 28/05/2026`.
- Footer mẫu chuẩn:

```text
Mã tài liệu (Lần ban hành-Ngày hiệu lực) Tình trạng
```

- Nếu footer đã điền sẵn một phần, ví dụ:

```text
Mã tài liệu (Lần ban hành-03/04/2026) Tình trạng
```

thì hệ thống phải giữ ngày `03/04/2026`, chỉ thay các phần còn lại để ra dạng:

```text
NMCB-QT01 (01-03/04/2026) Chờ phê duyệt
```

- Tình trạng trong footer phải thay đổi theo từng bước workflow: Nháp, Chờ xem xét, Chờ phê duyệt, Có hiệu lực, Hết hiệu lực, Trả về, Phê duyệt từ chối.
- Cảnh báo tag không khớp ở footer chỉ nên phát sinh khi footer có nhãn sai thật sự như `Mã hồ sơ`, `Mã hiệu`, `Phiên bản`, `Ngày ban hành`, `Ngày áp dụng`, `Trạng thái` trong ngữ cảnh footer. Không cảnh báo sai với footer mẫu có ngày hiệu lực đã điền sẵn.

### 3) Quy tắc QR cho hồ sơ con

- Với PDF hồ sơ con, nếu template không có tag `QR`/`QR:` và không có vị trí QR thủ công từ bước ký, hệ thống tự chèn QR ở góc trên bên trái trang đầu.
- Nếu template có tag `QR`/`QR:` hoặc người dùng đã đặt vị trí QR thủ công trong modal ký, hệ thống ưu tiên vị trí đó và không chèn thêm QR mặc định.
- Với DOCX/XLSX hồ sơ con, engine ưu tiên tag `{{QR}}`; nếu thiếu tag này thì tự chèn QR mặc định góc trên trái nội dung trang/sheet đầu.

### 4) UI file tài liệu và thông báo

- Trong khối `File tài liệu`, phần upload/thay file phải nằm phía trên các hướng dẫn tag.
- Khi đã có `PDF có chữ ký`, khối này phải hiển thị nổi bật phía trên phần upload, nút Xem dùng biểu tượng con mắt và nút Tải dùng biểu tượng mũi tên tải xuống, kích thước lớn hơn nút thường.
- Sidebar ISO phải hiển thị số lượng việc cần xử lý của người đang đăng nhập bằng badge màu đỏ.
- Khi đang soạn thảo tài liệu cha, khối `Hồ sơ con của tài liệu này` cho phép chọn loại hồ sơ con (`F`, `PL`, `HD`) và upload nhiều file cùng lúc.
- Khối hồ sơ con dùng nút `Thêm hồ sơ`; mỗi dòng có `Mã hồ sơ`, `Tên hồ sơ`, `Loại hồ sơ`, `Số hiệu`, `Lần ban hành`, `Ghi chú`, `File hồ sơ`.
- Mỗi dòng hồ sơ con upload đúng một file riêng. Khi lưu tài liệu cha, mỗi dòng tạo một bản ghi hồ sơ con riêng và gắn `parent_doc_id` về tài liệu cha.

### 5) Token ký

- Token ký phải đủ thời gian cho thao tác đặt vị trí/ký thực tế. Nếu token hết hạn, UI/API phải báo rõ: `Token không hợp lệ hoặc đã hết hạn. Vui lòng ký lại.`

## Cập nhật mới nhất (2026-05-28) - logic hồ sơ con, PDF, DOCX/XLSX và danh sách hồ sơ

Mục này thay thế các quy tắc cũ nếu có mâu thuẫn.

### Hồ sơ con là một phần của bộ tài liệu

- Tài liệu cha và các hồ sơ con có `parent_doc_id` trỏ về cha được xử lý như một bộ tài liệu khi gửi xem xét, gửi phê duyệt và phê duyệt.
- Trên `Việc của tôi` và badge sidebar ISO, một tài liệu cha kèm nhiều hồ sơ con chỉ được tính là một đầu việc. Không hiển thị 21 dòng riêng nếu có một tài liệu cha và 20 hồ sơ con.
- Dòng việc phải phân biệt rõ:
  - `Bộ tài liệu + N hồ sơ` nếu có hồ sơ con.
  - `Tài liệu riêng` nếu không có hồ sơ con.
- Trong trang chi tiết tài liệu cha, phải có thông tin cho người xem xét/phê duyệt biết họ đang xử lý một bộ tài liệu và hệ thống sẽ mở lần lượt file chính rồi từng hồ sơ con cần ký/xem.

### UI danh sách hồ sơ con

- Danh sách hồ sơ con đã lưu nằm ở panel bên phải, trong khối `File tài liệu`, ngay dưới phần `PDF có chữ ký`.
- Mỗi dòng hồ sơ con có nút xem, tải và `Thay file` khi được phép sửa.
- Nút xem phải ưu tiên file đã xử lý mới nhất:
  1. `file_signed_pdf_url`
  2. `file_signed_office_url`
  3. `file_goc_url`
- Khi thay file hồ sơ con đã lưu, phải reset các URL bản đã xử lý cũ (`file_signed_pdf_url`, `file_signed_office_url`, `file_signed_office_type`) để các bước sau dùng file mới.

### Flow ký/xem xét theo từng bước

- Mỗi bước phải tạo được artifact mới cho từng hồ sơ con để người ở bước sau mở bằng nút mắt và thấy nội dung đã thay đổi.
- Khi gửi xem xét:
  - File chính xử lý trước.
  - Sau đó xử lý lần lượt từng hồ sơ con.
  - Trạng thái hiển thị trong file là `Chờ xem xét`.
- Khi gửi phê duyệt hoặc gửi phê duyệt lại: trạng thái hiển thị trong file là `Chờ phê duyệt`.
- Khi phê duyệt: trạng thái hiển thị trong file là `Có hiệu lực`.
- Khi trả về/từ chối: trạng thái hiển thị trong file tương ứng là `Trả về` hoặc `Phê duyệt từ chối`.
- API `/api/sign/generate-pdf` và `/api/sign/generate-office` nhận thêm `action` để tính trạng thái mục tiêu, không chỉ dựa vào trạng thái hiện tại trong DB.

### PDF hồ sơ con

- PDF hồ sơ con mở modal để người dùng đặt QR/chữ ký/vị trí cần thiết.
- Footer phải được đóng trên tất cả các trang, không chỉ trang đầu.
- Footer chuẩn:

```text
MÃ_TÀI_LIỆU (LẦN_BAN_HÀNH-NGÀY_HIỆU_LỰC) TÌNH_TRẠNG
```

- Ví dụ:

```text
NMCB-QT01-F01 (03-28/05/2026) Chờ xem xét
```

- Nếu footer cũ đã có, hệ thống có thể phủ vùng footer và ghi lại footer mới để đảm bảo trạng thái theo bước luôn đúng.

### DOCX/XLSX hồ sơ con

- Hồ sơ con DOCX/XLSX dùng bộ tag cố định:
  - `{{QR}}`
  - `{{MA_TAI_LIEU}}`
  - `{{LAN_BAN_HANH}}`
  - `{{NGAY_HIEU_LUC}}`
  - `{{TINH_TRANG}}`
- Tag đúng và có trong file thì điền.
- Tag đúng nhưng không có trong file thì bỏ qua, không chặn workflow.
- Người dùng tự điền nội dung thường thay vì tag thì bỏ qua, không ghi đè.
- Tag gần giống hoặc sai trong dạng `{{...}}` thì cảnh báo và chặn, yêu cầu sửa template hoặc dùng nút `Thay file`.
- Không có nút bỏ qua tag sai cho Office. Office template có tag sai phải được sửa.
- DOCX phải trích text hiển thị từ các node text như `w:t`/`a:t` để kiểm tra tag gần giống, không được quét regex trực tiếp trên XML thô vì dễ bắt nhầm đoạn XML.
- DOCX phải quét toàn bộ `word/**/*.xml`, gồm body, table, header, footer, textbox/drawing text nếu nằm trong XML của Word.
- Tag `{{QR}}` trong DOCX có thể đứng độc lập hoặc nằm chung run/dòng với tiêu đề. Khi tag nằm chung run, engine phải tách run thành `text trước QR` + ảnh QR + `text sau QR`, không được chỉ xóa tag.
- QR trong DOCX của hồ sơ con có kích thước khoảng `12mm x 12mm` (`432000 x 432000` EMU), cả khi chèn theo tag và khi chèn mặc định.

---

## Cập nhật mới nhất (2026-05-28, phiên chốt) - logic hồ sơ con độc lập và Office

Mục này thay thế mọi quy tắc cũ trong file này nếu có mâu thuẫn.

### Phân biệt bộ tài liệu và hồ sơ con độc lập

- Hồ sơ con luôn là một bản ghi riêng trong `iso_documents`, liên kết với tài liệu cha bằng `parent_doc_id`.
- Khi người dùng soạn thảo tài liệu cha kèm các hồ sơ con mới trong cùng form, tài liệu cha và các hồ sơ con đó là một bộ tài liệu khi gửi xem xét, gửi phê duyệt và phê duyệt. `Việc của tôi` và badge sidebar gom cả bộ thành một đầu việc.
- Khi người dùng soạn thảo một hồ sơ mới cho quy trình/tài liệu cha đã có hiệu lực, hồ sơ đó vẫn có `parent_doc_id` nhưng là đầu việc độc lập cho tới khi được phê duyệt. Sau khi lưu phải mở trang chi tiết hồ sơ vừa tạo, không điều hướng về trang tài liệu cha.
- Trang chi tiết tài liệu cha đang `co_hieu_luc` chỉ hiển thị các hồ sơ con cũng đang `co_hieu_luc`. Không hiển thị hồ sơ con mới ở trạng thái nháp, chờ xem xét hoặc chờ phê duyệt trong panel file của tài liệu cha đã có hiệu lực.
- Danh sách tài liệu và `Việc của tôi` phải phân biệt rõ:
  - Bộ thật: hiển thị `Bộ tài liệu + N hồ sơ`, nút xử lý bộ.
  - Hồ sơ con độc lập: hiển thị `Cần xem xét N hồ sơ của quy trình {MA_CHA}` hoặc `Cần phê duyệt N hồ sơ của quy trình {MA_CHA}`, nút `Xử lý hồ sơ`.
  - Tài liệu riêng: hiển thị `Tài liệu riêng`.

### Mã tài liệu/hồ sơ là duy nhất

- `ma_tai_lieu` phải duy nhất trong cùng `factory_id` cho cả tài liệu cha và hồ sơ con.
- Không được cho soạn thảo hồ sơ có mã trùng với bất kỳ bản ghi `iso_documents` nào cùng nhà máy, kể cả khi mã đó thuộc quy trình khác.
- Khi form có nhiều dòng hồ sơ con đang nháp, phải chặn trùng mã ngay trong các dòng nháp trước khi lưu.
- Khi sửa tài liệu/hồ sơ hiện hữu, kiểm tra trùng mã phải loại trừ chính bản ghi đang sửa.
- Thông báo lỗi phải nói rõ mã nào bị trùng để người dùng đổi loại/số hiệu hồ sơ hoặc chọn quy trình khác.

### Form soạn thảo hồ sơ

- Với phân loại `Hồ sơ (Con)`, header không hiển thị trường thừa `Mã hồ sơ: Tự sinh *`; mã hồ sơ tự sinh nằm trong từng dòng hồ sơ bên dưới.
- Form soạn thảo hồ sơ dùng bố cục một cột, không để panel bên phải trống.
- Nút chọn file của từng dòng hồ sơ phải gắn trực tiếp với input file của dòng đó và upload đúng file cho đúng dòng.
- Mỗi dòng hồ sơ upload đúng một file riêng. Khi thay file của hồ sơ đã lưu phải xóa các artifact cũ: `file_signed_pdf_url`, `file_signed_office_url`, `file_signed_office_type`.

### Hiển thị file và artifact

- Nút mắt của tài liệu/hồ sơ luôn mở file mới nhất theo thứ tự ưu tiên: `file_signed_pdf_url`, rồi `file_signed_office_url`, rồi `file_goc_url`.
- Trong panel `File tài liệu`, chỉ hiển thị một dòng Office đã xử lý ở vị trí trên cùng khi có `file_signed_office_url`. Không hiển thị trùng hai dòng kiểu `DOCX/XLSX đã cập nhật tag` và `DOCX/XLSX có file chữ ký`.
- Danh sách hồ sơ con đã lưu nằm trong panel phải, dưới phần file chính/PDF có chữ ký.
- Mỗi bước xem xét/phê duyệt phải tạo artifact mới cho từng hồ sơ con để người ở bước sau mở nút mắt thấy đúng nội dung đã cập nhật.

### Trạng thái theo action

- `gui_xem_xet` hiển thị `Chờ xem xét`, riêng hồ sơ cấp 2 khi gửi thẳng phê duyệt phải hiển thị `Chờ phê duyệt`.
- `gui_phe_duyet` và `gui_lai_phe_duyet` hiển thị `Chờ phê duyệt`.
- `phe_duyet` hiển thị `Có hiệu lực`.
- Trả về/từ chối hiển thị đúng trạng thái tương ứng trong file và UI.

### DOCX/XLSX hồ sơ con

- Hồ sơ con DOCX/XLSX dùng cùng bộ tag chữ chuẩn của tài liệu ISO, cộng thêm `{{QR}}`. Không còn giới hạn ở bộ cố định chỉ gồm `{{QR}}`, `{{MA_TAI_LIEU}}`, `{{LAN_BAN_HANH}}`, `{{NGAY_HIEU_LUC}}`, `{{TINH_TRANG}}`.
- Tag đúng có trong file thì điền. Tag đúng nhưng không có trong file thì bỏ qua, không chặn workflow.
- Tag sai hoặc gần giống dạng `{{...}}` phải chặn và yêu cầu người dùng thay/sửa file template. Không có nút bỏ qua tag sai cho Office.
- DOCX phải quét text hiển thị trong body, bảng, header, footer và drawing/textbox nếu nằm trong XML Word.
- `{{QR}}` trong DOCX phải thay được khi đứng độc lập, chung run hoặc chung dòng với tiêu đề.
- QR hồ sơ con trong DOCX/XLSX dùng kích thước khoảng `12mm x 12mm`.

### PDF hồ sơ con

- PDF hồ sơ con phải đóng footer trạng thái trên tất cả trang.
- Footer phải phản ánh trạng thái theo action hiện tại, không giữ trạng thái cũ trong file gốc.

---

## Cập nhật nóng (2026-05-29) — CloudConvert + UI hồ sơ con

### 1) CloudConvert cho convert DOCX/XLSX → PDF tại bước Phê duyệt

Thay thế `LibreOffice` bằng **CloudConvert API** trong `generate-pdf/route.ts`.

**Flow hiện tại (`convertOfficeUrlToPdfDocumentWithRetry`)**:
1. POST `https://api.cloudconvert.com/v2/jobs` — tạo job `import/url → convert → export/url`
2. Polling `https://api.cloudconvert.com/v2/jobs/{jobId}` mỗi 2s, timeout 90s — **KHÔNG dùng** `sync.api.cloudconvert.com` (gây 403)
3. Nếu `status === "finished"`: lấy URL PDF → download → trả về `PDFDocument`
4. Nếu `status === "error"`: throw ngay lập tức
5. Retry tự động 1 lần sau 3s nếu gặp lỗi 429 (rate limit)

**Điều kiện kích hoạt convert**:
- File non-PDF (`ext === "docx"` hoặc `"xlsx"`)
- **Và** `action === "phe_duyet"` **và** `signFileKind === "main"`
- Các bước khác (gửi xem xét, gửi phê duyệt) với non-PDF vẫn trả về `{ skipped: true, reason: "non-pdf" }`

**Env var bắt buộc**:
```
CLOUDCONVERT_API_KEY=...   # đã có trong .env.local và Vercel
```

### 2) Xóa duplicate "Hồ sơ con" khỏi right panel

- Section "Hồ sơ con của tài liệu này" trong right panel của form cha đã bị disable (`false &&`).
- Khu quản lý hồ sơ con chỉ còn ở **left form** (col-span-2), bên dưới form thông tin tài liệu.
- Right panel (`[id]/page.tsx`) không còn render `childDraftRows` cho tài liệu cha.
