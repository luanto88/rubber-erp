---
description: Module Cai dat, master data, duyet tai khoan va phan quyen
---

# Module Cai dat & Permissions

## Vai tro cua module Cai dat

`Cai dat` la noi quan tri tap trung cho tat ca:

- Master data dung chung
- Cau hinh he thong theo nha may
- Nguoi dung
- Phan quyen

Bat ky danh muc dung chung nao phat sinh sau nay cung phai duoc dua ve `Cai dat`, du van co the giu thao tac them nhanh o module nghiep vu.

## To chuc giao dien

`Cai dat` duoc to chuc theo nhieu tab de admin thao tac ro rang.

Khung tab mac dinh:

- `Cong ty`
- `Nguoi dung`
- `Phan quyen`
- `Cau hinh nha may`
- `Danh muc`

Nguyen tac xep:

- Cau hinh matrix theo nha may -> `Cau hinh nha may`
- Master data / danh muc dung chung -> `Danh muc`
- Neu mot domain lon len du nhieu bang con, co the tach thanh tab rieng sau

Vi du:

- `Bao tri` o giai doan dau dua vao `Danh muc`
- Sau nay neu mo rong du lon, co the tach tab rieng `Bao tri`

## Danh muc quan tri tap trung

Toi thieu gom:

- Xe
- Hau to
- Khach hang
- Cau hinh nha may / matrix san pham
- Nguoi dung
- Phan quyen

## Quy tac thao tac nhanh

Mot so module nghiep vu duoc phep co nut them nhanh:

- Them khach hang
- Them hau to
- Them `loai_pallet_sx`
- Them `loai_pallet_xuat`

Nhung du lieu tao ra phai:

- luu vao database
- gan dung nha may lien quan neu la cau hinh theo nha may
- xuat hien lai trong `Cai dat`

## Xe va tai xe

- Tai xe nam trong danh muc xe, khong tach bang rieng o muc rule hien tai
- `Cai dat` phai co trang quan tri day du de mua them xe, doi tai xe, cap nhat thong tin xe

## Hau to

- Co the them nhanh trong `Thanh pham`
- Dong thoi phai co trang quan tri day du trong `Cai dat`

## Khach hang

- Co the them nhanh trong `Xuat hang`
- Dong thoi phai co trang quan tri day du trong `Cai dat`

## Cau hinh nha may

`Cai dat` phai cho phep chinh sua toan bo matrix cau hinh:

- `loai_banh`
- `loai_boc`
- `loai_tham`
- `loai_pallet_sx`
- `loai_pallet_xuat`

## Dang ky va duyet tai khoan

### Dang ky

- User tu dang ky bang `Supabase Auth`
- App tao them ho so trong bang `profiles`
- Trang thai ban dau -> `pending`

### Duyet

Admin hoac nguoi co quyen `users.approve` duyet trong `Cai dat`.

Khi duyet tai khoan, can gan:

- `factory_id`
- `role`
- bo permission chi tiet

Khi duyet:

- bat buoc chon `role + permissions`
- cap nhat `status = active`
- luu `approved_by`, `approved_at`

### Khoa tai khoan

- Admin co the khoa tai khoan `active`
- Khi khoa:
  - `status = disabled`
  - luu `disabled_by`
  - luu `disabled_at`
- Tai khoan `disabled` khong duoc vao ung dung

## Phan quyen

Mo hinh quyen:

`module + action chuan`, them mot so action dac biet

### Action chuan

- `view`
- `create`
- `edit`
- `delete`

### Action dac biet

- `import`
- `export_file`
- `print`
- `approve`
- `manage_config`
- `quick_add`
- `mark_completed`
- `delete_order`

### Vi du

- `dispatch.view`
- `dispatch.import`
- `product.mark_completed`
- `export.delete_order`
- `settings.manage_config`
- `users.approve`
- `users.edit_permission`

## Rule ve UI va logic

- User khong co quyen thi khong hien hoac disable nut lien quan
- Nhung phai co guard o logic thao tac, khong chi an UI
- Moi action nhay cam nhu xoa, import, duyet, sua config phai check quyen that

## Trang thai thuc te cua UI hien tai

Hien tai trong `Cai dat`:

- Tab `Cong ty`: da co
- Tab `Nguoi dung`: da co, gom `Cho duyet`, `Dang hoat dong`, khoa tai khoan
- Tab `Phan quyen`: da co khung hien thi permission theo module
- Tab `Cau hinh nha may`: da co khung cho buoc CRUD tiep theo
- Tab `Danh muc`: hien dang chua `Hau to`

## Goi y role tong quat

- `admin`: toan quyen
- `manager`: nghiep vu rong, khong mac dinh quan tri user/config neu khong duoc cap them
- `user`: quyen theo cap phat
- `customer`: xem khu vuc duoc mo, chu yeu la truy xuat
