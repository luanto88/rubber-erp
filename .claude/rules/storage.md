# Module Ngan Luu va Thanh Pham

## 1. Trang thai ngan hop le

Chi co 5 trang thai hop le:

- `Dang nhan (Can cap nhat)`
- `Cho san xuat`
- `Dang san xuat`
- `Da san xuat`
- `Dong`

Khong co trang thai `Hoan thanh` cho ngan.

## 2. Rule tao ngan

- Vi tri ngan goi y theo danh sach `N1 -> N24`
- Phai an cac ngan dang duoc su dung o cac trang thai:
  - `Dang nhan (Can cap nhat)`
  - `Cho san xuat`
  - `Dang san xuat`
  - `Dong`
- Cho phep nhap tay ten ngan, toi da 10 ky tu
- `ma_ngan` la field tu sinh, khong cho sua tay
- `KL tuoi` va `KL kho` la field read-only, tu tinh tu danh sach xe da chon

## 3. Tinh khoi luong theo loai nguyen lieu

Khi tao / sua ngan, chi duoc cong dung cot KL cua dung loai nguyen lieu da chon:

- `Mu chen` -> `kl_ct`, `kl_ck`
- `Mu dong chen` -> `kl_dct`, `kl_dck`
- `Mu dong khoi` -> `kl_dkt`, `kl_dkk`
- `Mu day` -> `kl_dt`, `kl_dk`
- `Mu nuoc` -> `kl_mn`, `kl_mnk`

Helper tham chieu trong code: `getKLFromTrip(...)` tai `src/app/dashboard/storage/page.tsx`.

## 4. Auto-transition ngan

- Chi co `ngay_bd`, chua co `ngay_kt` -> `Dang nhan (Can cap nhat)`
- Co ca `ngay_bd` va `ngay_kt` -> `Cho san xuat` sau khi du dieu kien dong me theo UI hien tai
- Ngan du 21 ngay moi duoc xem la san sang dua vao san xuat
- Module thanh pham chi duoc chon cac ngan hop le theo rule nghiep vu hien hanh

## 5. Quan he ngan va thanh pham

### Khi tao lo thanh pham

- Chon ngan trong module thanh pham -> ngan chuyen sang `Dang san xuat`
- Bam `Luu va danh dau da san xuat` -> ngan chuyen sang `Da san xuat`

### Khi xoa lo thanh pham

- Neu xoa het lo cua ngan -> ngan quay ve `Cho san xuat`

### Khi sua lo thanh pham va doi sang ngan khac

Truoc khi luu:

- Neu ty le lap day du kien cua ngan dich > `110%` -> chan thao tac

Sau khi luu:

- Tinh lai ca `ngan cu` va `ngan moi`
- Neu ngan khong con lo nao -> `Cho san xuat`
- Neu ty le lap day `< 100%` -> `Dang san xuat`
- Neu ty le nam trong `100% - 110%` -> giu nguyen trang thai hien tai

## 6. Rule ty le lap day

- Ty le lap day = `tong tong_kg cac lo trong ngan / tong_kho ngan * 100`
- Muc `100% - 110%` la vung hop le de tiep tuc giu trang thai hien tai
- Vuot `110%` thi khong cho chuyen lo sang ngan do trong form sua

## 7. Chi tiet ngan luu tren UI

Khi bam `Xem chi tiet` trong module ngan luu:

- Luon hien thi `Thong tin ngan` truoc
- Phan thanh pham khong hien danh sach dai ngay tu dau
- Phai gom nhom thanh pham theo:
  - `loai thanh pham + loai banh + loai boc`
- Moi nhom chi hien 1 header tong hop:
  - ten nhom
  - tong `kg`
  - tong so `lo`
  - tong so `ngay san xuat`
- Khi click vao header nhom -> mo danh sach `ngay san xuat`
- Moi ngay san xuat chi hien 1 dong tong hop:
  - ngay
  - ten nhom
  - tong `kg`
  - tong so `lo`
- Khi click vao tung ngay -> moi hien danh sach `lo thanh pham` chi tiet

Muc tieu UI:

- Khong de modal thanh mot danh sach dai va cung
- Uu tien tong quan truoc, chi tiet sau
- Nguoi dung di tu `ngan -> nhom thanh pham -> ngay san xuat -> lo chi tiet`

## 8. Code references

- UI ngan luu: `src/app/dashboard/storage/page.tsx`
- UI thanh pham: `src/app/dashboard/product/page.tsx`
- Rule sync trang thai ngan khi sua lo: `handleEditSave`
- Rule chi tiet ngan theo nhom / ngay / lo: `openView`, `groupedViewLots`
