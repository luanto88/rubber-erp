---
description: Schema Supabase - tham chiếu khi viết query, migration hoặc làm việc với dữ liệu
---

# Database Schema

## Danh sách bảng

| Bảng | Mô tả | Primary Key |
|---|---|---|
| `factories` | Nhà máy | `id` UUID |
| `users` | Tài khoản người dùng cũ, chỉ dùng cho migration | `id` UUID |
| `profiles` | Hồ sơ ứng dụng gắn với `auth.users` | `id` UUID |
| `ngans` | Ngăn lưu mủ cao su | `id` UUID |
| `lots` | Lô thành phẩm | `id` UUID |
| `qc_results` | Kết quả kiểm nghiệm | `id` UUID |
| `dispatch_entries` | Bảng điều xe / phân xe | `id` UUID |
| `dispatch_delivery_points` | Danh mục điểm giao nhận theo nhà máy | `id` UUID |
| `dispatch_drivers` | Danh mục tài xế điều xe | `id` UUID |
| `dispatch_vehicles` | Danh mục xe điều xe | `id` UUID |
| `dispatch_vehicle_driver_assignments` | Lịch sử gán tài xế chính theo xe | `id` UUID |
| `export_orders` | Đơn xuất hàng | `id` UUID |
| `customers` | Khách hàng | `id` UUID |
| `suffixes` | Hậu tố mã lô | `code` TEXT |
| `permissions` | Danh sách permission hệ thống | `code` TEXT |
| `role_permissions` | Permission mặc định theo role | `(role, permission_code)` |
| `user_permissions` | Permission gán thực tế cho user | `(user_id, permission_code)` |
| `kv_store` | Key-value store (legacy) | `id` UUID |
| `inventory_*` | Cụm bảng module quản lý kho vật tư / hóa chất | UUID / theo từng bảng |

## Bảng mở rộng nên có / đã có

| Bảng | Mục đích |
|---|---|
| `factory_product_configs` | Matrix cấu hình theo nhà máy: `loai_banh`, `loai_boc`, `loai_tham`, `loai_pallet_sx`, `loai_pallet_xuat` |
| `dispatch_drivers` | Danh mục tài xế riêng cho module điều xe |
| `dispatch_vehicles` | Danh mục xe riêng cho module điều xe |
| `dispatch_vehicle_driver_assignments` | Lịch sử tài xế chính theo xe, có hiệu lực theo thời gian |
| `maintenance_assets` | Danh mục thiết bị cho module bảo trì |
| `maintenance_areas` | Khu vực / vị trí thiết bị cho module bảo trì |
| `inventory_warehouses`, `inventory_items`, `inventory_documents`, ... | Module kho vật tư / hóa chất; tất cả bảng đều phải có `factory_id` |

## Quan hệ

```text
factories
  ├── profiles (factory_id)
  ├── ngans (factory_id)
  ├── lots (factory_id)
  │     └── ngan_id → ngans.id
  ├── qc_results (factory_id)
  │     └── lot_id → lots.id
  ├── dispatch_entries (factory_id)
  ├── dispatch_delivery_points (factory_id)
  ├── dispatch_drivers (factory_id)
  ├── dispatch_vehicles (factory_id)
  ├── dispatch_vehicle_driver_assignments (factory_id)
  │     ├── vehicle_id → dispatch_vehicles.id
  │     └── driver_id → dispatch_drivers.id
  ├── export_orders (factory_id)
  │     └── customer_id → customers.id
  ├── customers (factory_id)
  └── factory_product_configs (factory_id)
```

## Schema chi tiết

### `dispatch_entries`

```sql
id UUID PK, factory_id UUID,
ngay TEXT, chung_nhan TEXT, rows JSONB,
created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
```

Ghi chú vận hành:

- `rows` lưu danh sách chuyến điều xe trong ngày
- `rows[].so_xe` và `rows[].tai_xe` là snapshot nghiệp vụ đã lưu trên chứng từ
- `rows[].diem_gn` chỉ lưu các mã điểm giao nhận đã chọn của từng chuyến
- Mọi metadata của điểm giao nhận như `đội`, tọa độ, phiên A/B/C/D, thứ tự hiển thị phải lấy từ `dispatch_delivery_points`

### `dispatch_delivery_points`

```sql
id UUID PK, factory_id UUID,
ma_lo TEXT, doi INTEGER, lat DOUBLE PRECISION, lng DOUBLE PRECISION,
phien_a TEXT[], phien_b TEXT[], phien_c TEXT[], phien_d TEXT[],
sort_order INTEGER, is_active BOOLEAN,
created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
```

Ghi chú vận hành:

- Đây là bảng master data cho module `Điều xe` và `EUDR`
- Dữ liệu phải tách theo `factory_id`
- `ma_lo` là mã điểm giao nhận duy nhất trong phạm vi từng nhà máy
- `is_active = false` nghĩa là tạm ngưng sử dụng trên UI nhưng vẫn giữ dữ liệu lịch sử

### `dispatch_drivers`

```sql
id UUID PK, factory_id UUID,
code TEXT, name TEXT, phone TEXT,
is_active BOOLEAN,
created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
```

Ghi chú vận hành:

- Là master data tài xế riêng cho module điều xe
- `name` là tên hiển thị nghiệp vụ
- `code` và `phone` là thông tin mở rộng, có thể để trống trong seed ban đầu
- Unique theo `(factory_id, name)`

### `dispatch_vehicles`

```sql
id UUID PK, factory_id UUID,
code TEXT, name TEXT, vehicle_type TEXT, plate_number TEXT,
sort_order INTEGER, is_active BOOLEAN,
created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
```

Ghi chú vận hành:

- Là master data xe riêng cho module điều xe
- `code` là mã xe nghiệp vụ như `1B`, `4A`, `X01`
- `name` là tên xe hiển thị
- `vehicle_type` là nhóm xe như `Cozon nội bộ`, `Isuzu vận chuyển`, `Xúc sản xuất`
- Unique theo `(factory_id, code)`

### `dispatch_vehicle_driver_assignments`

```sql
id UUID PK, factory_id UUID,
vehicle_id UUID → dispatch_vehicles,
driver_id UUID → dispatch_drivers,
effective_from DATE, effective_to DATE,
is_current BOOLEAN, note TEXT,
created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
```

Ghi chú vận hành:

- Lưu lịch sử gán tài xế chính theo xe
- Một xe có thể có nhiều dòng lịch sử theo thời gian
- Tại một thời điểm chỉ nên có 1 dòng hiện hành cho mỗi xe với `is_current = true`
- Khi đổi tài xế chính phải:
  - đóng dòng hiện hành bằng `effective_to`
  - set `is_current = false`
  - insert dòng mới với `effective_from` mới
- Màn `Điều xe` chỉ dùng bảng này để gợi ý tài xế chính, không được ghi đè từ thao tác override trên chứng từ

### Seed hiện tại cho xe và tài xế

- Seed master data xe/tài xế hiện tại chỉ áp dụng cho nhà máy `Phước Hòa Kampong Thom`
- Điều kiện seed: `factories.code = 'phuochoa_kt'`
- Nếu cần mở rộng cho nhà máy khác thì phải seed riêng, không dùng chung mặc định

### `ngans`

```sql
id UUID PK, factory_id UUID, ma_ngan TEXT, ten_ngan TEXT,
loai_nl TEXT, nguon_goc TEXT, xu_ly TEXT, chung_nhan TEXT,
ngay_bd DATE, ngay_kt DATE, trang_thai TEXT,
tong_tuoi NUMERIC, tong_kho NUMERIC,
trips JSONB, lo_nguon_goc TEXT,
created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
```

### `lots`

```sql
id UUID PK, factory_id UUID, ma_lo TEXT, num INTEGER,
suffix TEXT, year TEXT, ngay_sx DATE, ngay_ht DATE, ca TEXT,
ngan_id UUID→ngans, loai_csr TEXT, loai_banh NUMERIC,
boc TEXT, tham TEXT, pallet ARRAY, chi_thi TEXT,
kien_a INTEGER, kien_b INTEGER, kien_c INTEGER, kien_d INTEGER,
tong_banh INTEGER, tong_kg NUMERIC, trang_thai TEXT, ghi_chu TEXT,
dd_snapshot JSONB, is_manual_edit BOOLEAN, edit_key TEXT,
created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
```

Ghi chú vận hành:

- `ngay_sx`: ngày mở lô ban đầu
- `ngay_ht`: ngày tròn lô / ngày hoàn tất lô
- `ma_lo` là định danh nghiệp vụ duy nhất theo `factory_id`; không được phép tồn tại 2 bản ghi `lots` cùng `ma_lo`

### `qc_results`

```sql
id UUID PK, factory_id UUID, lot_id UUID→lots,
ma_lo TEXT, pkn INTEGER, ma_kl TEXT,
ngay_kn DATE, ngay_sx DATE,
chung_loai TEXT, loai_csr TEXT, loai_kn TEXT, tieu_chuan TEXT,
so_mau INTEGER, samples JSONB, grade JSONB,
dat_hang TEXT, trang_thai TEXT, parent_id UUID, lan INTEGER,
created_at TIMESTAMPTZ
```

Ghi chú vận hành:

- `lot_id` là khóa liên kết ưu tiên
- `ma_lo` được giữ để in ấn, truy vết và backfill dữ liệu cũ
- `ngay_sx` trong `qc_results` phải là ngày thành phẩm hoàn tất của lô:
  - ưu tiên `lots.ngay_ht`
  - fallback `lots.ngay_sx`

### `export_orders`

```sql
id UUID PK, factory_id UUID,
ma_don TEXT, ngay DATE, so_thong_bao TEXT, so_hoa_don TEXT,
so_hop_dong TEXT, customer_id UUID→customers,
chung_loai TEXT, loai_pallet TEXT,
vehicles JSONB, assignments JSONB, tong_banh INTEGER,
created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
```

### `customers`

```sql
id UUID PK, factory_id UUID,
ma_kh TEXT UNIQUE, ten_kh_en TEXT, email TEXT, dia_chi TEXT,
created_at TIMESTAMPTZ
```

### `profiles`

```sql
id UUID PK -> auth.users(id),
username TEXT UNIQUE, auth_email TEXT UNIQUE,
full_name TEXT, factory_id UUID -> factories,
department TEXT, role TEXT, status TEXT,
approved_by UUID, approved_at TIMESTAMPTZ,
disabled_by UUID, disabled_at TIMESTAMPTZ,
created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
```

Ghi chú vận hành:

- `auth_email` là email nội bộ để ánh xạ `username` vào `auth.users`
- Định dạng hiện tại: `username@auth.rubber-erp.example.com`
- Email `.local` chỉ giữ để tương thích ngược, không dùng để tạo mới

### `permissions`

```sql
code TEXT PK, module_name TEXT, action_name TEXT, created_at TIMESTAMPTZ
```

### `role_permissions`

```sql
role TEXT, permission_code TEXT -> permissions(code), created_at TIMESTAMPTZ
PRIMARY KEY (role, permission_code)
```

### `user_permissions`

```sql
user_id UUID -> profiles(id),
permission_code TEXT -> permissions(code),
granted BOOLEAN, granted_by UUID, granted_at TIMESTAMPTZ
PRIMARY KEY (user_id, permission_code)
```
