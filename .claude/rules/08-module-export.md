---
description: Module xuat hang, assignments, EUDR
---

# Module Xuat hang

## Schema chinh (`export_orders`)

```ts
{
  id: UUID,
  factory_id: UUID,
  ma_don: string,
  ngay: date,
  so_thong_bao: string,
  so_hoa_don: string,
  so_hop_dong: string,
  customer_id: UUID,
  chung_loai: string,
  loai_pallet: string,
  loai_banh: number,
  loai_boc: string,
  vehicles: Vehicle[],
  assignments: Assignment[],
  tong_banh: number,
  yeu_cau_chi_tieu: object[],
  files: object[],
}
```

## Rule `loai_pallet_xuat`

`du_lieu_nha_may.xlsx` la source cao nhat cho `loai_pallet_xuat`.

Rule chinh thuc:

- `loai_pallet_xuat` chi loc theo `nha may`
- Gia tri mac dinh ban dau lay tu Excel
- Gia tri mo rong runtime duoc luu vao database theo dung nha may
- UI co nut `+` ben phai o chon de them moi
- Gia tri them moi phai duoc dung lai cho lan sau cua cung nha may

### NMPHK

- `Roi`
- `Pallet sat de go`

### NMCP

- `Roi`
- `PE de go`
- `PE de nhua`
- `Pallet go`
- `MB4`
- `MB5`

## Rule `loai_boc`

- `loai_boc` phai filter theo `nha may + day_chuyen + chung_loai`
- Khong dung danh sach chung hard-code cho tat ca nha may

## Ma don

```ts
ma_don = `XH-${ma_kh}-${so_thong_bao}-${ddmmyy(ngay)}`
```

- Read-only
- Chi auto tao khi du thong tin
- Edit mode giu nguyen ma da luu

## Chon lo va remaining

- Hien thi lo co `trang_thai IN ("Hoan thanh", "Xuat hang")`
- Chi dua lo vao panel neu con `remaining > 0`
- `remaining` = tong so kien cua lo - tong da gan trong cac don khac

## Quan he voi Thanh pham

- Xuat het remaining -> lo chuyen `Xuat hang`
- Con remaining -> giu `Hoan thanh`
- Xoa don hang -> phai tinh lai remaining cua tung lo
- Neu lo co hang kha dung tro lai sau khi xoa don -> quay ve `Hoan thanh`

## Khach hang

- Co thao tac tao nhanh trong module `Xuat hang`
- Dong thoi phai co trang quan tri day du trong `Cai dat`

## EUDR

EUDR da duoc trien khai, khong con la y tuong tuong lai.

- Module: `/dashboard/eudr`
- Truy xuat tu `export_orders -> lots -> ngans -> dispatch_entries -> GeoJSON`
- Ho tro QR code, zip file, file dinh kem
