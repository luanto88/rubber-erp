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

## Rule quan trong

- `pkn`: dem theo nam va theo nha may
- `lo_kn`: dem tich luy theo nha may, khong reset
- Cac lo cung 1 phieu dung chung `batch_id`

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
