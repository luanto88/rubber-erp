---
description: Schema Supabase - tham chiếu khi viết query, migration hoặc làm việc với dữ liệu
---

# Database Schema

## Danh sách bảng liên quan

| Bảng | Mô tả | Primary Key |
|---|---|---|
| `factories` | Nhà máy | `id` UUID |
| `profiles` | Hồ sơ ứng dụng | `id` UUID |
| `departments` | Phòng ban chuẩn (hệ thống, không theo factory_id) | `id` UUID |
| `dispatch_entries` | Bảng điều xe / phân xe | `id` UUID |
| `dispatch_delivery_points` | Danh mục điểm giao nhận theo nhà máy | `id` UUID |
| `dispatch_drivers` | Danh mục tài xế điều xe | `id` UUID |
| `dispatch_vehicles` | Danh mục xe điều xe | `id` UUID |
| `dispatch_vehicle_driver_assignments` | Lịch sử gán tài xế chính theo xe | `id` UUID |
| `ngans` | Ngăn lưu mủ cao su | `id` UUID |
| `lots` | Lô thành phẩm | `id` UUID |
| `qc_results` | Kết quả kiểm nghiệm | `id` UUID |
| `export_orders` | Đơn xuất hàng | `id` UUID |
| `customers` | Khách hàng | `id` UUID |
| `forest_plots` | Lô vườn cao su cho EUDR (polygon GeoJSON) | `id` UUID |
| `maintenance_assets` | Danh mục thiết bị / xe bảo trì | `id` UUID |
| `maintenance_staff` | Nhân sự bảo trì | `id` UUID |
| `maintenance_external_materials` | Vật tư mua ngoài (master list gợi ý) | `id` UUID |
| `inventory_*` | Cụm bảng module kho vật tư / hóa chất | UUID / theo từng bảng |
| `sk_history` | Lịch sử thao tác Sang kiện / Thay bọc | `id` UUID |
| `sign_pins` | PIN chữ ký số (bcrypt hash) theo user | `user_id` UUID |
| `iso_documents` | Tài liệu ISO (quy trình, hướng dẫn, biểu mẫu) | `id` UUID |
| `van_ban_documents` | Văn bản nội bộ (công văn, thông báo, quyết định) | `id` UUID |
| `doc_approval_log` | Audit trail mọi thao tác ký duyệt | `id` UUID |
| `notifications` | Thông báo in-app (ISO & Văn bản) | `id` UUID |

## Quan hệ chính

```text
departments (hệ thống, không có factory_id)
  └── profiles.department_id → departments.id (optional FK)

factories
  ├── profiles (factory_id)
  ├── dispatch_entries (factory_id)
  ├── dispatch_delivery_points (factory_id)
  ├── dispatch_drivers (factory_id)
  ├── dispatch_vehicles (factory_id)
  ├── dispatch_vehicle_driver_assignments (factory_id)
  │     ├── vehicle_id → dispatch_vehicles.id
  │     └── driver_id → dispatch_drivers.id
  ├── ngans (factory_id)
  ├── lots (factory_id)
  ├── qc_results (factory_id)
  ├── export_orders (factory_id)
  ├── customers (factory_id)
  ├── forest_plots (factory_id)
  ├── maintenance_assets (factory_id)
  ├── maintenance_staff (factory_id)
  ├── maintenance_external_materials (factory_id)
  ├── sk_history (factory_id)
  ├── iso_documents (factory_id)
  │     ├── soan_thao_user_id → auth.users
  │     ├── xem_xet_user_id → auth.users
  │     └── phe_duyet_user_id → auth.users
  ├── van_ban_documents (factory_id)
  │     └── soan_thao_user_id / phe_duyet_user_id → auth.users
  ├── doc_approval_log (factory_id)
  │     └── user_id → auth.users
  └── notifications (factory_id)
        └── user_id → auth.users

sign_pins (không có factory_id — theo auth.users)
  └── user_id PK → auth.users
```

## Cập nhật schema điều xe 2026-06-01

- Migration đã chạy: `supabase/migrations/20260601_dispatch_entry_rows.sql`.
- `dispatch_entries` có thêm `day_chuyen TEXT` và tiếp tục giữ `rows JSONB` để tương thích legacy.
- Bảng mới `dispatch_entry_rows` lưu vật lý từng chuyến điều xe:
  - khóa chính `id`
  - `factory_id`, `dispatch_entry_id`
  - `uid_legacy`, `ngay DATE`, `day_chuyen`
  - snapshot xe/tài xế/chuyến: `so_xe`, `chuyen`, `tai_xe`
  - nghiệp vụ tuyến: `diem_gn[]`, `phien[]`, `lo_thu_hoach[]`, `lo_trinh[]`, `doi[]`, `so_km`
  - sản lượng: `kl_ct/drc_c/kl_ck`, `kl_dct/drc_dc/kl_dck`, `kl_dkt/drc_dk/kl_dkk`, `kl_dt/drc_d/kl_dk`, `kl_mn/drc_mn/kl_mnk`
  - `ngan_ref[]`, `ghi_chu`, `locked`, `sort_order`
  - unique `(dispatch_entry_id, uid_legacy)`
- Tính năng mới nên query `dispatch_entry_rows`; chỉ dùng `dispatch_entries.rows` khi cần fallback/legacy.
- Mọi query vẫn phải filter theo `factory_id`.

## Schema auth / profile

### `departments`

```sql
id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
code        TEXT UNIQUE NOT NULL,
name        TEXT NOT NULL,
is_active   BOOLEAN DEFAULT true,
sort_order  INTEGER DEFAULT 0,
created_at  TIMESTAMPTZ DEFAULT now()
```

Seed 9 phòng ban: PHK, KTNN, QLCL, KHXD, TCKT, TCHC, TTBV, NMCB, CS.
Không có `factory_id` — dùng chung toàn app.
RLS: authenticated users có thể đọc; admin có thể quản lý.

### `profiles`

```sql
id              UUID PK (= auth.users.id),
username        TEXT,
auth_email      TEXT,
full_name       TEXT,
factory_id      UUID REFERENCES factories,
role            TEXT,
department      TEXT,         -- text backward-compat (tên phòng ban)
department_id   UUID REFERENCES departments,  -- FK mới (2026-05)
status          TEXT,         -- pending | active | disabled
approved_by     UUID,
approved_at     TIMESTAMPTZ,
disabled_by     UUID,
disabled_at     TIMESTAMPTZ
```

## Schema dispatch

### `dispatch_entries`

```sql
id UUID PK, factory_id UUID,
ngay TEXT, chung_nhan TEXT, rows JSONB,
created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
```

Ghi chú:

- `rows[].so_xe` và `rows[].tai_xe` là snapshot nghiệp vụ đã lưu trên chứng từ
- `rows[].diem_gn` lưu các mã điểm giao nhận được chọn cho từng chuyến

### `dispatch_delivery_points`

```sql
id UUID PK, factory_id UUID,
ma_lo TEXT, doi INTEGER, lat DOUBLE PRECISION, lng DOUBLE PRECISION,
phien_a TEXT[], phien_b TEXT[], phien_c TEXT[], phien_d TEXT[],
sort_order INTEGER, is_active BOOLEAN,
created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
```

### `dispatch_drivers`

```sql
id UUID PK, factory_id UUID,
code TEXT, name TEXT, phone TEXT,
is_active BOOLEAN,
created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
```

### `dispatch_vehicles`

```sql
id UUID PK, factory_id UUID,
code TEXT, name TEXT, vehicle_type TEXT, plate_number TEXT,
sort_order INTEGER, is_active BOOLEAN,
created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
```

### `dispatch_vehicle_driver_assignments`

```sql
id UUID PK, factory_id UUID,
vehicle_id UUID → dispatch_vehicles,
driver_id UUID → dispatch_drivers,
effective_from DATE, effective_to DATE,
is_current BOOLEAN, note TEXT,
created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
```

Ghi chú:

- lưu lịch sử gán tài xế chính theo xe
- một xe có thể có nhiều dòng lịch sử theo thời gian
- tại một thời điểm chỉ nên có 1 dòng hiện hành với `is_current = true`

## Schema Thành phẩm

### `sk_history`

```sql
id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
factory_id   UUID,
ngay         DATE,
loai         TEXT,            -- "Sang kiện" | "Thay bọc"
chung_loai   TEXT,            -- chủng loại SP liên quan
from_boc     TEXT,            -- Thay bọc: bọc cũ; null với Sang kiện
to_boc       TEXT,            -- Thay bọc: bọc mới; null với Sang kiện
from_pallet  TEXT,            -- Sang kiện: pallet cũ (từ filter); null với Thay bọc
to_pallet    TEXT,            -- Sang kiện: pallet mới (join ", "); null với Thay bọc
lots         JSONB,           -- [{ id, ma_lo, converted: { a, b, c, d } }]
created_at   TIMESTAMPTZ DEFAULT now()
```

Ghi chú:

- Mỗi phiên Sang kiện / Thay bọc tạo 1 bản ghi duy nhất, bất kể xử lý bao nhiêu lô
- `lots` JSONB lưu snapshot số bành đã chuyển của từng lô tại thời điểm thao tác
- Không có FK trỏ vào `lots.id` — đây là lịch sử audit, không dùng để tính toán nghiệp vụ

## Schema bảo trì

### `maintenance_external_materials`

```sql
id           UUID PK,
factory_id   UUID,
ten_vat_tu   TEXT NOT NULL,
dvt          TEXT,
code         TEXT,            -- mã vật tư (unique per factory khi không null)
specification TEXT,           -- quy cách / đặc tính
category_id  UUID REFERENCES inventory_item_categories,
is_active    BOOLEAN DEFAULT true,
created_at   TIMESTAMPTZ
```

Index: `UNIQUE (factory_id, code) WHERE code IS NOT NULL`

## Schema EUDR

### `forest_plots`

```sql
id UUID PK, factory_id UUID,
ten TEXT,           -- Mã ngắn lô vườn (J1T, B5...) — key match với dispatch_delivery_points.phien_X[]
ma_lo_full TEXT,    -- Mã đầy đủ (5.14PH.04.10.118)
nong_truong TEXT, doi INTEGER,
giong TEXT, dien_tich_ha NUMERIC(10,4),
nam_trong INTEGER, nam_cao_up INTEGER,
geometry JSONB,     -- GeoJSON Polygon { "type": "Polygon", "coordinates": [...] }
is_active BOOLEAN,
created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
UNIQUE(factory_id, ten)
```

Ghi chú:

- Nguồn ban đầu: `/public/geojson/Lo cao su - 2026_Full.geojson` (seed qua `scripts/seed-forest-plots.mjs`)
- EUDR query DB trước (`forest_plots`), fallback file GeoJSON tĩnh nếu bảng rỗng
- `dispatch_delivery_points.phien_X[]` lưu mảng giá trị `ten` — không thay đổi
- Không có FK từ bảng nào khác trỏ vào `forest_plots`

## Schema ISO & Văn bản

Chi tiết đầy đủ các bảng ISO & Văn bản xem tại:

- `.claude/rules/16-iso-vanban-module.md`

Tóm tắt schema:

- `sign_pins`: `user_id UUID PK`, `pin_hash TEXT`, `updated_at TIMESTAMPTZ`
- `iso_documents`: `id UUID PK`, `factory_id`, `ma_tai_lieu`, `ten_tai_lieu`, `loai_tai_lieu` (CS|OB|ST|QC|TC|QT|HD|MT|QĐ|PL|F), `phan_loai_tl TEXT DEFAULT 'cha'` (cha|con — F luôn là con; PL và HD có thể cha hoặc con), `cap_tl`, `chon_quy_trinh`, `trang_thai DEFAULT 'draft'` (thêm `bi_tu_choi_phe_duyet`), `soan_thao/xem_xet/phe_duyet` (text snapshot + `_user_id` UUID), `ky_*_at` (timestamps), `soan_thao_placement/xem_xet_placement/phe_duyet_placement` (JSONB — migration 20260524), `file_goc_url`, `file_signed_pdf_url`, `ma_tai_lieu_moi TEXT`, `ngay_hieu_luc`, `ghi_chu`
- `van_ban_documents`: `id UUID PK`, `factory_id`, `ma_van_ban`, `ten_van_ban`, `cap_tl`, `ky_phong_ban TEXT[]`, `count_pb INTEGER`, `pb_ky_hien_tai TEXT`, `ky_phong_ban_at JSONB`, `trang_thai DEFAULT 'draft'`, `file_goc_url`, `file_signed_pdf_url`
- `doc_approval_log`: `id UUID PK`, `doc_id UUID`, `doc_type TEXT`, `factory_id`, `user_id`, `action TEXT`, `phong_ban TEXT`, `buoc_ky INTEGER`, `ly_do TEXT`, `ip_address TEXT`, `created_at`
- `notifications`: `id UUID PK`, `factory_id`, `user_id`, `type TEXT`, `doc_id UUID`, `doc_type TEXT`, `title TEXT`, `body TEXT`, `is_read BOOLEAN DEFAULT false`, `link TEXT`, `created_at`

## Migrations đã chạy

| File | Nội dung |
|---|---|
| `20260520_departments_and_ext_materials.sql` | Tạo bảng `departments` + seed; thêm `profiles.department_id`; mở rộng `maintenance_external_materials` |
| `20260520_forest_plots.sql` | Tạo bảng `forest_plots` |
| `20260522_sk_history.sql` | Tạo bảng `sk_history` (lịch sử Sang kiện / Thay bọc) |
| `20260522_iso_vanban_module.sql` | Tạo bảng `sign_pins`, `iso_documents`, `van_ban_documents`, `doc_approval_log`, `notifications`; triggers `updated_at`; RLS; 14 permissions ISO & Văn bản |
| `20260523_iso_phan_loai_tl.sql` | Thêm `iso_documents.phan_loai_tl TEXT DEFAULT 'cha'`; seed permissions `iso.signature`, `settings.master_data`, `settings.maintenance_config` cho role_permissions |
| `20260524_iso_signature_placement.sql` (**chạy thủ công**) | Thêm `iso_documents.soan_thao_placement`, `xem_xet_placement`, `phe_duyet_placement` (JSONB) — lưu placement chữ ký từng bước |

## Tham chiếu rule trung tâm

Quy định chi tiết về:

- dữ liệu thêm nhanh trong `Cài đặt`
- phạm vi seed
- logic master data xe / tài xế / tài xế chính

xem tại:

- `.claude/rules/04-settings-master-data.md`
