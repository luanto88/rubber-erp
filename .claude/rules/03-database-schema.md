---
description: Schema Supabase — tham chiếu khi viết query, migration, hoặc làm việc với dữ liệu
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
| `dispatch_entries` | Bảng phân xe điều mủ | `id` UUID |
| `export_orders` | Đơn xuất hàng | `id` UUID |
| `customers` | Khách hàng | `id` UUID |
| `suffixes` | Hậu tố mã lô | `code` TEXT |
| `permissions` | Danh sách permission hệ thống | `code` TEXT |
| `role_permissions` | Permission mặc định theo role | `(role, permission_code)` |
| `user_permissions` | Permission gán thực tế cho user | `(user_id, permission_code)` |
| `kv_store` | Key-value store (legacy) | `id` UUID |
| `inventory_*` | Cum bang module quan ly kho vat tu / hoa chat | UUID / theo tung bang |

## Bang mo rong nen co / se can them

De ho tro `Cai dat`, cau hinh nha may, duyet tai khoan va phan quyen, he thong nen co cac bang mo rong sau:

| Bảng | Mục đích |
|---|---|
| `factory_product_configs` | Matrix cau hinh theo nha may: `loai_banh`, `loai_boc`, `loai_tham`, `loai_pallet_sx`, `loai_pallet_xuat` |
| `vehicles` | Danh muc xe, kem thong tin tai xe hien hanh |
| `maintenance_assets` | Danh muc thiet bi cho module bao tri tuong lai |
| `maintenance_areas` | Khu vuc / vi tri thiet bi cho module bao tri tuong lai |
| `inventory_warehouses`, `inventory_items`, `inventory_documents`, ... | Module kho vat tu / hoa chat; tat ca bang deu phai co `factory_id` |

## Quan hệ

```
factories
  ├── profiles (factory_id)
  ├── ngans (factory_id)
  ├── lots (factory_id)
  │     └── ngan_id → ngans.id
  ├── qc_results (factory_id)
  │     └── lot_id → lots.id
  ├── dispatch_entries (factory_id)
  ├── export_orders (factory_id)
  │     └── customer_id → customers.id
  ├── customers (factory_id)
  └── factory_product_configs (factory_id)
```

## Schema chi tiết

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

Ghi chu van hanh:

- `ngay_sx`: ngay mo lo ban dau
- `ngay_ht`: ngay tron lo / ngay hoan tat lo
- `ma_lo` la dinh danh nghiep vu duy nhat theo `factory_id`; khong duoc phep ton tai 2 ban ghi `lots` cung `ma_lo`

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

Ghi chu van hanh:

- `lot_id` la khoa lien ket uu tien
- `ma_lo` duoc giu de in an, truy vet va backfill du lieu cu
- `ngay_sx` trong `qc_results` phai la ngay thanh pham hoan tat cua lo:
  - uu tien `lots.ngay_ht`
  - fallback `lots.ngay_sx`

### `dispatch_entries`
```sql
id UUID PK, factory_id UUID,
ngay TEXT, chung_nhan TEXT, rows JSONB,
created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
```

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

Ghi chu van hanh:

- `auth_email` la email noi bo de anh xa `username` vao `auth.users`
- Dinh dang hien tai: `username@auth.rubber-erp.example.com`
- Email `.local` chi giu de tuong thich nguoc, khong dung de tao moi

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
