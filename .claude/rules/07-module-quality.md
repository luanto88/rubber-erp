---
description: Module kiem nghiem va grading logic
---

# Module Kiem nghiem

## Schema chinh (`qc_results`)

```ts
{
  id: UUID,
  factory_id: UUID,
  lot_id: UUID | null,
  ma_lo: string,
  pkn: number,
  lo_kn: number,
  batch_id: UUID,
  ngay_kn: date,
  ngay_sx: date,
  chung_loai: string,
  loai_csr: string,
  loai_kn: string,
  tieu_chuan: string,
  so_mau: number,
  samples: object,
  grade: object,
  dat_hang: string,
  trang_thai: string,
  parent_id: UUID | null,
  lan: number,
}
```

## Quy tac ngay cua phieu KN

- `ngay_kn`: ngay lap / ngay kiem nghiem
- `qc_results.ngay_sx`: ngay thanh pham hoan tat cua lo duoc kiem
- Nguon ngay uu tien:
  - `lots.ngay_ht` neu da co
  - fallback `lots.ngay_sx` neu lo chua co `ngay_ht`
- Dieu nay thay the logic cu chi dua vao ngay mo lo
- Vi du:
  - lo mo ngay `10/04/2026`
  - tron lo ngay `11/04/2026`
  - KN ngay `12/04/2026`
  -> `qc_results.ngay_sx = 11/04/2026`

## Rule quan trong

- `pkn`: dem theo nam va theo nha may
- `lo_kn`: dem tich luy theo nha may, khong reset
- Cac lo cung 1 phieu dung chung `batch_id`
- Khi tao phieu KN thuong, danh sach lo phai loc theo ngay thanh pham hoan tat, tuc `ngay_ht` neu co

## Canonical lot va doi chieu lo

- `lot_id` la lien ket chinh giua `qc_results` va `lots`
- Neu du lieu cu bi lech `lot_id`, he thong duoc phep doi chieu bo sung theo `ma_lo`
- Khi ton tai nhieu ban ghi `lots` cung `ma_lo`, he thong phai chon `canonical lot` theo uu tien:
  - `Xuat hang`
  - `Hoan thanh`
  - `Do dang`
  - ban ghi co `ngay_ht` moi hon
  - ban ghi co `tong_banh` lon hon
- Sau khi doi chieu thanh cong, `qc_results` phai duoc cap nhat lai ve `lot_id`, `ma_lo`, `ngay_sx` cua `canonical lot`

## Quy tac `dat_hang`

Day la rule chinh thuc:

- Dat: `CSR10`, `CSR20`, `CSRL`, ...
- Rot hang: them hau to `RH`

Vi du:

- `CSR10` -> dat
- `CSR10RH` -> rot hang

Khong dung gia tri `Khong dat` cho `dat_hang`.

`trang_thai` van la:

- `dat`
- `khong_dat`

## Visible fields

- `10`, `20`, `CV50`, `CV60`: co `mooney`
- `L`, `3L`: co `mau_sac`
- `Po` luon hien thi

## Grading engine

- Tap chat, tro: `mean + 3SD <= limit`
- Bay hoi, nito: `max <= limit`, neu TCCS thi them check `DR`
- Po:
  - Neu CV50/CV60 khong co gioi han Po -> auto dat
  - Con lai check `min` va `DR` neu can
- PRI: check `min`, `mean`, `DR`
- Mooney: nam trong khoang cho phep

## PDF va list view

- `HANG DK`: luon la `loai_csr`
- `DAT HANG`: dung `dat_hang`, co the la `CSR10RH`

## Quy tac import KN

- Import Excel chi duoc insert `qc_results` khi match duoc sang `lots`
- Khong duoc tao `qc_results` mo coi voi `lot_id = null` cho du lieu moi
- Truoc khi insert, he thong phai chay preflight tren toan bo file import:
  - doi chieu tung `LO_NM` voi `canonical lot`
  - doi chieu `NGAY_SX` trong file voi ngay hieu luc cua lo:
    - uu tien `lots.ngay_ht`
    - fallback `lots.ngay_sx`
  - kiem tra lo da ton tai trong `qc_results` chua
- Neu 1 dong trong file da co KN hoac sai ngay so voi lo thanh pham:
  - khong duoc insert dong do
  - phai dua vao danh sach canh bao
  - he thong chu dong giu lai va import chi cac lo chua KN, dung ngay
- Neu trong cung 1 file co 2 dong trung cung 1 lo:
  - chi duoc giu dong dau tien
  - cac dong trung sau phai bi bo qua va canh bao
- Neu khong match duoc lo thanh pham:
  - dong import do phai bao loi
  - khong duoc insert tam bang `ma_lo` roi xu ly sau

## Quan he xoa phieu va trang thai lo

Khi xoa phieu kiem nghiem:

- He thong phai lay truoc danh sach `lot_id` lien quan tu `qc_results`
- Sau khi xoa phieu, cac lo thanh pham lien quan phai duoc cap nhat lai `trang_thai = Hoan thanh`
- Rule nay ap dung cho ca:
  - xoa 1 phieu
  - xoa hang loat nhieu phieu

## Rule quay lai Xuat hang sau KN lai

- `Kiem nghiem lai (Rot hang)` co 2 context:
  - mo truc tiep trong module `Kiem nghiem`
  - mo tu form `Xuat hang` khi nguoi dung co gang gan 1 lo rot hang len xe
- Chi context mo tu `Xuat hang` moi duoc phep:
  - nhan draft form `Xuat hang` tu `sessionStorage`
  - save xong quay lai `Xuat hang`
  - neu ket qua KN lai dat thi auto-gan lo ve dung xe dang cho
- Neu nguoi dung dang o module `Kiem nghiem` va tao / sua `KN lai (Rot hang)` truc tiep, save xong o lai luong `Kiem nghiem`, khong redirect sang `Xuat hang`
