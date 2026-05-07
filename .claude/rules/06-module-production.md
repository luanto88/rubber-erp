---
description: Business logic cac module san xuat - Dieu xe, Kho nguyen lieu, Thanh pham
---

# Business Logic: San xuat

## 1. Rule chung

- Moi query phai filter theo `factory_id`
- Moi form CRUD phai co field `day_chuyen` dat o dau form
- Cac dropdown phu thuoc phai reset khi doi `day_chuyen`
- Cac option san pham phai lay tu matrix cau hinh nha may, khong hard-code rai rac

## 2. Module Dieu xe (`dispatch_entries`)

### Schema chinh

```ts
{
  id: UUID,
  factory_id: UUID,
  ngay: string,
  chung_nhan: string,
  rows: DxRow[],
  created_at: string,
  ma_dx?: string,
}
```

### Rule quan trong

- `ma_dx` format: `DX-ddmmyy/N`
- `chung_nhan`: chi duoc la `PEFC CS`, `PEFC FM`, `Khong`
- KL kho phai auto-calc tu KL tuoi va DRC
- `chuyen` duoc auto-assign theo xe trong ngay
- `lo_trinh` chi hien thi diem cung doi voi `diem_gn`

## 3. Module Kho nguyen lieu (`ngans`)

### Trang thai hop le

- `Dang nhan`
- `Dong`
- `Cho san xuat`
- `Dang san xuat`
- `Da san xuat`

Chi tiet state machine xem them trong `storage.md`.

### Rule quan trong

- Khong co trang thai `Hoan thanh` cho ngan
- Ngan du 21 ngay moi chuyen sang `Cho san xuat`
- Chi ngan `Cho san xuat` moi duoc chon trong `Thanh pham`
- Chon ngan trong `Thanh pham` -> cap nhat ngay sang `Dang san xuat`
- Bam `Luu va danh dau da san xuat` -> cap nhat ngan sang `Da san xuat`

### Loai nguyen lieu

Phai filter theo nha may va day chuyen:

- `Mu tap`: su dung cac loai nguyen lieu hop le cua nha may
- `Mu nuoc`: chi duoc `Mu nuoc`

## 4. Module Thanh pham (`lots`)

### Schema chinh

```ts
{
  id: UUID,
  factory_id: UUID,
  day_chuyen: string,
  ma_lo: string,
  num: number,
  suffix: string,
  year: string,
  ngay_sx: date,
  ngay_ht: date | null,
  loai_csr: string,
  loai_banh: number,
  boc: string,
  tham: string,
  pallet: string[],
  tong_banh: number,
  tong_kg: number,
  trang_thai: string,
}
```

### Schema chi tiet giao dich lo (`lot_transactions`)

```ts
{
  id: UUID,
  lot_id: UUID,
  ngan_id: UUID,
  ca: string,         // A | B | C
  ngay_nhap: date,    // ngay thuc te cua ca nhap
  kien_a: number,
  kien_b: number,
  kien_c: number,
  kien_d: number,
  so_banh: number,    // san luong delta cua dong giao dich
  so_kg: number,      // san luong kg delta cua dong giao dich
}
```

- `lots` la bang master tong hop theo `ma_lo`
- `lot_transactions` la lich su chi tiet theo tung ca / tung ngay / tung ngan
- Mot `ma_lo` co the co nhieu dong `lot_transactions`
- Trong cung `factory_id`, chi duoc 1 dong `lots` cho moi `ma_lo`

### Source of truth cho option

`du_lieu_nha_may.xlsx` la source cao nhat cho:

- `loai_banh`
- `loai_boc`
- `loai_tham`
- `loai_pallet_sx`

Quy tac loc:

- `loai_banh`, `loai_boc`, `loai_tham`: theo `nha may + day_chuyen + chung loai SP`
- `loai_pallet_sx`: theo cau hinh nha may, co the mo rong runtime va luu DB

### Quy tac lo tron

- Banh `35` va `33.33`: 4 kien, moi kien 36 banh -> lo tron `144`
- Banh `20`: 4 kien, moi kien 60 banh -> lo tron `240`

### Quy tac ngon ngu hien thi trong Thanh pham

- Ten field ky thuat va schema DB giu nguyen dang `banh` / `loai_banh` / `tong_banh`
- UI nghiep vu cua module `Thanh pham` phai hien thi theo cach goi `bành`

### Trang thai lo

- `Hoan thanh`
- `Do dang`
- `Xuat hang`

### Quy tac ngay cua lo

- `ngay_sx`: ngay mo lo ban dau
- `ngay_ht`: ngay tron lo / ngay hoan tat lo
- Neu lo duoc nhap qua nhieu ca hoac nhieu ngay:
  - `ngay_sx` khong doi
  - `ngay_ht` chi duoc set khi lo chuyen sang `Hoan thanh` hoac `Xuat hang`
- Cac module downstream can uu tien `ngay_ht` khi can ngay thanh pham hoan tat

### Xac dinh trang thai

```ts
if (loai_banh === 20) {
  lo_tron = 240;
} else {
  lo_tron = 144;
}
trang_thai = tong_banh >= lo_tron ? "Hoan thanh" : "Do dang";
```

### Auto-calc

- `tong_banh = kien_a + kien_b + kien_c + kien_d`
- `tong_kg = tong_banh * loai_banh`
- `ma_lo = ${num}${suffix}/${year}`

### Quy tac day so lo

- Day so lo phai lien tuc trong tung nhom `loai thanh pham + loai banh`
- Day so lo trong nam khong phu thuoc `suffix`, `boc`, `tham`, `pallet` hay cac thuoc tinh khac
- Nguoi dung tu chu dong reset ve `01` khi sang nam moi, nen `year` la diem cat day so
- Tai thoi diem giao thoa cuoi nam, `so lo max` giu `/nam cu` va `so lo 01` dung `/nam moi`, khong phu thuoc tuyet doi vao `ngay_sx` la `31/12` hay `01/01`
- Khi nguoi dung nhap so lo nhay coc trong cung nhom tren, UI phai canh bao cac so lo con trong
- Goi y `so lo gan nhat` va logic xac dinh lo tiep theo phai tinh theo cung nhom `loai thanh pham + loai banh`

### Kien toi da theo loai banh

```ts
const maxKienValue = loai_banh === 20 ? 60 : 36;
```

### Rule `tham`

- Field ky thuat: `tham`
- Cau hinh nguon: `loai_tham`
- UI hien thi: `Tham`
- Du lieu cu phai duoc normalize ve 2 gia tri chuan: `Cu`, `Moi`

### Rule lo ke thua

Khi lo cuoi ca truoc dang do:

- Kien da du tu ca truoc -> read-only, khong tinh vao san luong ca nay
- Kien chua du -> nhap tiep, chi tinh phan delta them vao
- Neu lo vua dat tron trong lan nhap tiep:
  - update chinh ban ghi `Do dang` hien co
  - khong tao ban ghi `lots` moi cung `ma_lo`
  - set `ngay_ht = ngay_sx` cua lan nhap hoan tat
  - luu them 1 dong vao `lot_transactions` cho ca dang nhap

### Quy tac duy nhat `ma_lo`

- Trong cung `factory_id`, `ma_lo` la dinh danh nghiep vu duy nhat
- Khong duoc ton tai dong thoi 2 ban ghi `lots` cung `ma_lo` voi cac trang thai khac nhau
- Neu lo `Do dang` da ton tai, thao tac sau phai tiep tuc cap nhat ban ghi do, khong duoc tao lo moi

### Rule xoa dong san xuat

- Xoa trong session thanh pham la xoa theo tung dong `lot_transactions`
- Khong xoa ca `lots` khi van con it nhat 1 giao dich
- Khong duoc map theo `lot.id` khi nguoi dung dang chon 1 dong session; phai map theo `lot_transactions.id`
- Co the xoa bat ky dong `lot_transactions` nao duoc chon trong session, khong con rule chan "chi xoa transaction moi nhat"
- Khi xoa xong phai tinh lai `lots`:
  - `tong_banh`, `tong_kg`
  - `trang_thai` (`Do dang` / `Hoan thanh`)
  - `ngan_id`, `ca`, `ngay_ht` theo giao dich moi nhat con lai
- Neu lo khong con giao dich nao -> cho phep xoa master `lots`

## 5. Quan he Ngan va Thanh pham

- `eligibleNgans`: chi lay `Cho san xuat`
- Chon ngan -> cap nhat `Dang san xuat`
- Xoa het lo cua ngan -> ngan quay ve `Cho san xuat`
- Sua lo va doi ngan:
  - Chan neu ngan dich vuot `110%`
  - Sau khi luu, tinh lai ca ngan cu va ngan moi
  - `< 100%` -> `Dang san xuat`
  - `100% - 110%` -> giu nguyen trang thai hien tai
  - Ngan khong con lo -> `Cho san xuat`

### Rule tinh trang thai ngan sau khi xoa/sua

- Luon tinh tong kg theo `lot_transactions` cua tung `ngan_id` (khong dua vao 1 truong snapshot don le)
- Neu ngan khong con san luong -> `Cho san xuat`
- Neu ty le lap day `< 100%` -> `Dang san xuat`
- Neu ty le `100% - 110%`:
  - Neu ngan dang la `Da san xuat` -> giu nguyen `Da san xuat`
  - Neu ngan dang la trang thai khac -> giu theo workflow hien tai

## 5.1. Chi tiet ngan luu tren UI

- Modal chi tiet ngan phai hien `Thong tin ngan` truoc
- Phan thanh pham phai gom nhom theo `loai thanh pham + loai banh + loai boc`
- Mac dinh chi hien header tong hop cua tung nhom, khong do danh sach lo dai ngay tu dau
- Click header nhom -> mo danh sach `ngay san xuat`
- Click tung ngay -> mo danh sach `lo thanh pham` chi tiet
- Moi tang hien thi phai co thong tin tong hop `kg` va so luong de nguoi dung doc nhanh

## 6. Quan he Thanh pham va Xuat hang

- Lo `Hoan thanh` duoc hien thi tai module `Xuat hang`
- Xuat het remaining -> lo chuyen `Xuat hang`
- Xoa don hang -> tinh lai remaining
- Neu con hang kha dung tro lai -> lo quay ve `Hoan thanh`

### Dong bo canh bao Do dang

- Danh sach canh bao do dang toan cuc va canh bao trong form nhap thanh pham phai dung cung 1 nguon du lieu va cung 1 rule loc
- Khong de truong hop ngoai form bao `Do dang` nhung trong form khong con lo do dang (hoac nguoc lai)
- Hien tai, canh bao lo do dang trong `/dashboard/product` duoc hien thi theo **toan bo lo do dang cung day chuyen**, khong loc theo `year` cua thanh pham
- Neu can hien thi theo nam trong tuong lai, phai doi dong bo o ca canh bao toan cuc va canh bao trong form tao moi, khong sua le 1 ben

### Goi y tu dong trong form nhap

- Goi y `so lo gan nhat` dua theo lo `Do dang` gan nhat trong cung series (`loai_csr + loai_banh + year`)
- Goi y `ngan_id` uu tien theo giao dich gan nhat cung `day_chuyen` de tranh nham day chuyen

### Quy tac ngon ngu hien thi

- Mac dinh noi dung UI, thong bao, canh bao va tai lieu noi bo phai viet bang tieng Viet co dau, dung chinh ta
- Chi duoc bo dau hoac doi ngon ngu khi nguoi dung yeu cau ro rang
- Khi sua chuoi UI o `Thanh pham`, uu tien sua truc tiep tung cum hien thi; khong dung script convert encoding hang loat
