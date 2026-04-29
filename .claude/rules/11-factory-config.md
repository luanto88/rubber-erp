---
description: Source of truth va cau hinh nha may cho matrix san pham
---

# Factory Config Matrix

## Source of truth

File:

- `cung_cap_dl/du_lieu_nha_may.xlsx`

la source of truth cao nhat cho:

- `loai_banh`
- `loai_boc`
- `loai_tham`
- `loai_pallet_sx`
- `loai_pallet_xuat`

## Cach dien giai

- Excel = du lieu chuan ban dau de seed va doi chieu spec
- Database = nguon chay thuc te
- Gia tri mo rong runtime cua tung nha may duoc luu vao database

Khong ghi nguoc gia tri runtime vao file Excel.

## Quy tac loc

### Theo nha may

- `loai_pallet_xuat`

### Theo nha may + day chuyen + chung loai SP

- `loai_banh`
- `loai_boc`
- `loai_tham`

### Theo matrix cau hinh nha may

- `loai_pallet_sx`

## Rule `loai_tham`

- Ten cot cau hinh: `loai_tham`
- Y nghia: loai tham ngan cach cac banh mu
- UI hien thi: `Tham`
- La dropdown
- Du lieu su dung 2 gia tri chuan: `Cu`, `Moi`
- Khi doc du lieu cu phai normalize cac gia tri lech ve `Cu` hoac `Moi`

## Cau hinh mac dinh theo Excel

### NMPHK

- `Mu tap / 10`
  - `loai_banh`: `35`
  - `loai_boc`: `Boc tron 0,04`, `Boc nhan 0,04 VRG CSR10`
  - `loai_pallet_sx`: `Pallet sat de go`, `Pallet sat mong`, `Pallet MB5`, `Pallet go`
  - `loai_pallet_xuat`: `Roi`, `Pallet sat de go`
- `Mu tap / 20`
  - `loai_banh`: `35`
  - `loai_boc`: `Boc tron 0,04`, `Boc nhan 0,04 VRG CSR20`
  - `loai_pallet_sx`: nhu tren
  - `loai_pallet_xuat`: nhu tren
- `Mu nuoc / L`
  - `loai_banh`: `35`, `33.33`
- `Mu nuoc / 3L`
  - `loai_banh`: `35`, `33.33`
- `Mu nuoc / CV50`
  - `loai_banh`: `35`, `20`
- `Mu nuoc / CV60`
  - `loai_banh`: `35`, `20`

### NMCP

- `Mu tap / 10`
  - `loai_banh`: `35`
  - `loai_boc`: `Boc tron 0,04`, `Boc nhan 0,04 VRG SVR10`
  - `loai_pallet_sx`: `Pallet sat de go`, `Pallet sat de nhua`, `Pallet sat mong`, `Pallet MB5`, `Pallet go`
  - `loai_pallet_xuat`: `Roi`, `PE de go`, `PE de nhua`, `Pallet go`, `MB4`, `MB5`
- `Mu tap / 20`
  - `loai_banh`: `35`
  - `loai_boc`: `Boc tron 0,04`, `Boc nhan 0,04 VRG SVR20`
  - `loai_pallet_sx`: nhu tren
  - `loai_pallet_xuat`: nhu tren
- `Mu nuoc / L`
  - `loai_banh`: `35`, `33.33`
- `Mu nuoc / 3L`
  - `loai_banh`: `35`, `33.33`
- `Mu nuoc / CV50`
  - `loai_banh`: `35`, `20`
- `Mu nuoc / CV60`
  - `loai_banh`: `35`, `20`

## Cau hinh runtime trong database

Nen co bang cau hinh nha may de van hanh thuc te, co the thiet ke theo logic cua Excel va cho phep chinh sua toan bo.

Bang nay phai ho tro:

- chinh `loai_banh`
- chinh `loai_boc`
- chinh `loai_tham`
- chinh `loai_pallet_sx`
- chinh `loai_pallet_xuat`
- luu gia tri mo rong theo tung nha may

## Nut them nhanh

Trong module nghiep vu, `loai_pallet_sx` va `loai_pallet_xuat` co the co nut `+`.

Rule:

- Gia tri moi chi ap dung cho nha may dang dang nhap
- Luu vao database
- Tu dong bo sung vao cau hinh nha may de dung cho cac lan sau
