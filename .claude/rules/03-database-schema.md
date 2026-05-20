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
  └── maintenance_external_materials (factory_id)
```

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

## Migrations đã chạy

| File | Nội dung |
|---|---|
| `20260520_departments_and_ext_materials.sql` | Tạo bảng `departments` + seed; thêm `profiles.department_id`; mở rộng `maintenance_external_materials` |
| `20260520_forest_plots.sql` | Tạo bảng `forest_plots` |

## Tham chiếu rule trung tâm

Quy định chi tiết về:

- dữ liệu thêm nhanh trong `Cài đặt`
- phạm vi seed
- logic master data xe / tài xế / tài xế chính

xem tại:

- `.claude/rules/04-settings-master-data.md`
