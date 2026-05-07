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

// Cấu trúc Vehicle (lưu trong mảng JSONB `vehicles`)
type Vehicle = {
  id: string,
  loai_xe: string,
  bien_truoc: string,
  bien_sau: string,
  ghi_chu: string,
  image_url_1?: string, // Ảnh xe/Biển số (Lưu trên bucket order-files)
  image_url_2?: string, // Ảnh hàng hóa/Niêm phong
  image_url_3?: string, // Ảnh chứng từ/Phiếu cân
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
ma_don = `XH-${ma_kh}-${so_thong_bao}-${ddmmyy(ngay)}`;
```

- Read-only
- Chi auto tao khi du thong tin
- Edit mode giu nguyen ma da luu

## Chon lo va remaining

- Hien thi lo co `trang_thai IN ("Hoan thanh", "Xuat hang")`
- Chi dua lo vao panel neu con `remaining > 0`
- `remaining` = tong so kien cua lo - tong da gan trong cac don khac
- Neu bo loc lot picker khong ra lo, kiem tra truoc tien:
  - chuoi `trang_thai` cua query co dung tieng Viet chuan
  - chuoi `loai_boc`, `loai_pallet`, `chi tieu` co bi mojibake hay sai chinh ta khong
  - text tim kiem `ma_lo` co dang duoc normalize dung khong

## Quan he voi Thanh pham

- Xuat het remaining -> lo chuyen `Xuat hang`
- Con remaining -> giu `Hoan thanh`
- Xoa don hang -> phai tinh lai remaining cua tung lo
- Neu lo co hang kha dung tro lai sau khi xoa don -> quay ve `Hoan thanh`

### Rule KN lai tu flow Xuat hang

- Neu nguoi dung keo 1 lo `rot hang` trong form `Xuat hang`, he thong duoc phep mo flow `Kiem nghiem lai`
- Draft form `Xuat hang` chi duoc luu tam bang `sessionStorage` de giu UI state; day khong phai source of truth nghiep vu
- Sau khi luu KN lai:
  - neu flow duoc mo tu `Xuat hang` thi quay lai form `Xuat hang` va khoi phuc draft
  - neu ket qua KN lai `dat hang` thi lo do tu dong nam lai tren dung xe ma nguoi dung vua dinh keo vao
  - neu ket qua van `rot hang` thi van quay lai form `Xuat hang`, giu draft nhung khong gan lo len xe
- Neu nguoi dung mo `Kiem nghiem lai` truc tiep trong module `Kiem nghiem` (khong di tu `Xuat hang`) thi save xong khong duoc tu dong quay ve form `Xuat hang`

### Rule dong bo khi xoa don xuat

- Khi xoa 1 `export_order`, khong update trang thai lo theo kieu cung nhac
- Bat buoc tinh lai theo cac don xuat con lai:
  - `remaining <= 0` -> `Xuat hang`
  - `remaining > 0` -> `Hoan thanh`
- Ket qua tinh lai phai phan anh ngay o module `Thanh pham` (dong bo 2 chieu)

## Khach hang

- Co thao tac tao nhanh trong module `Xuat hang`
- Dong thoi phai co trang quan tri day du trong `Cai dat`

## EUDR

EUDR da duoc trien khai, khong con la y tuong tuong lai.

- Module: `/dashboard/eudr`
- Truy xuat tu `export_orders -> lots -> ngans -> dispatch_entries -> GeoJSON`
- Ho tro QR code, zip file, file dinh kem

## Ngon ngu giao dien

- Session `Xuat hang` phai hien thi tieng Viet co dau, dung chinh ta
- Session `Xuat hang` hien tai phai dong bo cach goi so luong theo thuat ngu nghiep vu la `banh`
- Cac nhan quan trong can giu dung dang chuan: `Xuat hang`, `Tao don xuat`, `Tong banh`, `Khach hang`, `Lo hang`, `Yeu cau chi tieu`
