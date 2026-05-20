---
description: Schema Supabase - tham chiếu khi viết query, migration hoặc làm việc với dữ liệu
---

# Database Schema

## Danh sách bảng liên quan

| Bảng | Mô tả | Primary Key |
|---|---|---|
| `factories` | Nhà máy | `id` UUID |
| `profiles` | Hồ sơ ứng dụng | `id` UUID |
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
| `inventory_*` | Cụm bảng module kho vật tư / hóa chất | UUID / theo từng bảng |

## Quan hệ chính

```text
factories
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
  └── customers (factory_id)
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

## Tham chiếu rule trung tâm

Quy định chi tiết về:

- dữ liệu thêm nhanh trong `Cài đặt`
- phạm vi seed
- logic master data xe / tài xế / tài xế chính

xem tại:

- `.claude/rules/04-settings-master-data.md`
