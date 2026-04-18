---
description: Schema Supabase — tham chiếu khi viết query, migration, hoặc làm việc với dữ liệu
---

# Database Schema

## Danh sách bảng

| Bảng | Mô tả | Primary Key |
|---|---|---|
| `factories` | Nhà máy | `id` UUID |
| `users` | Tài khoản người dùng | `id` UUID |
| `ngans` | Ngăn lưu mủ cao su | `id` UUID |
| `lots` | Lô thành phẩm | `id` UUID |
| `qc_results` | Kết quả kiểm nghiệm | `id` UUID |
| `dispatch_entries` | Bảng phân xe điều mủ | `id` UUID |
| `export_orders` | Đơn xuất hàng | `id` UUID |
| `customers` | Khách hàng | `id` UUID |
| `suffixes` | Hậu tố mã lô | `code` TEXT |
| `kv_store` | Key-value store (legacy) | `id` UUID |

## Quan hệ

```
factories
  ├── ngans (factory_id)
  ├── lots (factory_id)
  │     └── ngan_id → ngans.id
  ├── qc_results (factory_id)
  │     └── lot_id → lots.id
  ├── dispatch_entries (factory_id)
  ├── export_orders (factory_id)
  │     └── customer_id → customers.id
  └── customers (factory_id)
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
