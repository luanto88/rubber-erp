---
description: Module Xuất hàng — đọc khi làm việc với export_orders, vehicles, assignments
---

# Module Xuất hàng (`export_orders`)

## Cấu trúc dữ liệu

```typescript
// Đơn xuất hàng
{
  id: UUID, factory_id: UUID,
  ma_don: string,        // "XH_KUMHO_14_240226"
  ngay: date,
  so_thong_bao: string,
  so_hoa_don: string,
  so_hop_dong: string,
  customer_id: UUID,     // FK → customers
  chung_loai: string,    // "CSR10"...
  loai_pallet: string,   // "Xuất rời"|"Pallet gỗ"|"Pallet sắt"
  vehicles: Vehicle[],   // JSONB
  assignments: Assignment[], // JSONB
  tong_banh: number      // AUTO: sum tất cả assignments
}

// Xe
type Vehicle = {
  id: string,            // random uid
  loai_xe: string,       // "Container 20ft"|"Container 40ft"|"Xe tải mui bạt"|"Khác"
  bien_truoc: string,    // Biển số đầu kéo
  bien_sau: string,      // Biển số rơ-moóc (sơmi rơmoóc)
  ghi_chu: string
}

// Gán lô vào xe
type Assignment = {
  lot_id: string,        // UUID của lot
  ma_lo: string,
  vehicleIdx: number,    // Index trong mảng vehicles (0-based)
  kien_a: number, kien_b: number, kien_c: number, kien_d: number
}
```

## Business rules

- **"Biển trước"** = biển số đầu kéo (không phải mặt trước xe)
- **"Biển sau"** = biển số rơ-moóc
- Panel chọn lô chỉ hiện: `loai_csr === form.chung_loai` VÀ `trang_thai === "Hoàn thành"`
- `tong_banh` AUTO = `sum(kien_a + kien_b + kien_c + kien_d)` trên tất cả assignments
- Một lô có thể gán vào nhiều xe khác nhau (split shipment)

## UI Pattern — Layout 2 cột khi tạo đơn

```
┌─────────────────────────┬──────────────────┐
│ CỘT TRÁI (col-span-2)   │ CỘT PHẢI         │
│ ┌─────────────────────┐ │ ┌──────────────┐ │
│ │ Form thông tin đơn  │ │ │ Panel chọn   │ │
│ └─────────────────────┘ │ │ lô hàng      │ │
│ ┌─────────────────────┐ │ │              │ │
│ │ Danh sách xe        │ │ │ Filter theo  │ │
│ └─────────────────────┘ │ │ loai_csr     │ │
│ ┌─────────────────────┐ │ │              │ │
│ │ Lô đã gán (preview) │ │ │ Sticky top   │ │
│ └─────────────────────┘ │ └──────────────┘ │
└─────────────────────────┴──────────────────┘
```

### Panel chọn lô
- Mỗi lô có nút riêng cho từng xe: `[Xe 1] [Xe 2] [Xe 3]`
- Nút **xanh** = lô đã được gán vào xe đó
- Click lần nữa = bỏ gán (toggle)
- Sau khi gán → hiện ở khu vực "Lô đã gán" bên trái
- Ở khu vực "Lô đã gán": chỉnh được số kiện A/B/C/D

## List view

- Bảng danh sách đơn
- Click hàng → expand inline: thông tin xe + danh sách lô
