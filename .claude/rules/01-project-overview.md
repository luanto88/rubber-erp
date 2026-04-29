---
description: Tong quan du an Rubber ERP - doc file nay dau tien khi bat dau task
---

# Rubber ERP - Project Overview

## Muc tieu

He thong ERP quan ly san xuat cao su theo nha may, day chuyen, lo thanh pham, kiem nghiem, xuat hang, va truy xuat EUDR.

## Stack

- Framework: Next.js App Router
- Language: TypeScript
- Styling: Tailwind CSS
- Backend: Supabase
- Icons: lucide-react
- UI: tu viet, khong dung component library ngoai

## Multi-tenant

He thong co nhieu nha may, moi du lieu nghiep vu deu thuoc 1 `factory_id`.
Moi query va moi danh sach hien thi deu phai filter theo nha may dang dang nhap.

## Day chuyen va matrix san pham

Truc nghiep vu bat buoc:

`Nha may -> Day chuyen -> Chung loai SP -> Loai banh / Loai boc / Loai tham / Pallet`

Nguon cao nhat cho matrix nay la:

- `cung_cap_dl/du_lieu_nha_may.xlsx`

Excel la source of truth ban dau cho:

- `loai_banh`
- `loai_boc`
- `loai_tham`
- `loai_pallet_sx`
- `loai_pallet_xuat`

Quy tac loc:

- `loai_pallet_xuat`: theo nha may
- `loai_banh`, `loai_boc`, `loai_tham`: theo `nha may + day_chuyen + chung loai SP`
- `loai_pallet_sx`: theo matrix cau hinh nha may

## Quy tac lo tron

- Banh `35` va `33.33`: 4 kien x 36 banh = 144 banh
- Banh `20`: 4 kien x 60 banh = 240 banh

## Quy tac van hanh cau hinh

- Excel dung de seed va doi chieu spec
- Database la nguon chay thuc te
- Gia tri mo rong runtime theo nha may phai luu vao database
- Khong hard-code option rai rac trong tung page

## Module Cai dat

`Cai dat` la noi quan tri tap trung cho:

- Xe
- Hau to
- Khach hang
- Cau hinh nha may
- Nguoi dung
- Phan quyen
- Cac danh muc mo rong duoc them nhanh trong module nghiep vu

Giao dien `Cai dat` duoc to chuc theo nhieu tab:

- `Cong ty`
- `Nguoi dung`
- `Phan quyen`
- `Cau hinh nha may`
- `Danh muc`

Nguyen tac:

- Matrix cau hinh theo nha may -> `Cau hinh nha may`
- Master data dung chung -> `Danh muc`
- Domain moi nhu `Bao tri` ban dau dua vao `Danh muc`, khi du lon co the tach thanh tab rieng

Module nghiep vu co the giu nut them nhanh, nhung du lieu tao ra phai dong bo ve `Cai dat`.

## Dang ky va phan quyen

- User moi dang ky -> `pending`
- Admin duyet trong `Cai dat`
- Phan quyen theo `module + action chuan`, them mot so action dac biet

## Modules chinh

- `dispatch`: Dieu xe
- `storage`: Kho nguyen lieu / Ngan luu / Ho chua
- `product`: Thanh pham
- `quality`: Kiem nghiem
- `export`: Xuat hang
- `eudr`: Truy xuat chuoi cung ung
- `settings`: Quan tri danh muc, cau hinh, user, phan quyen
