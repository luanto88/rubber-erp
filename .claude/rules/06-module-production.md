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
  ca: string,
  ngan_id: UUID,
  loai_csr: string,
  loai_banh: number,
  boc: string,
  tham: string,
  pallet: string[],
  kien_a: number,
  kien_b: number,
  kien_c: number,
  kien_d: number,
  tong_banh: number,
  tong_kg: number,
  trang_thai: string,
}
```

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

### Trang thai lo

- `Hoan thanh`
- `Do dang`
- `Xuat hang`

### Xac dinh trang thai

```ts
if (loai_banh === 20) {
  lo_tron = 240
} else {
  lo_tron = 144
}
trang_thai = tong_banh >= lo_tron ? "Hoan thanh" : "Do dang"
```

### Auto-calc

- `tong_banh = kien_a + kien_b + kien_c + kien_d`
- `tong_kg = tong_banh * loai_banh`
- `ma_lo = ${num}${suffix}/${year}`

### Kien toi da theo loai banh

```ts
const maxKienValue = loai_banh === 20 ? 60 : 36
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

## 5. Quan he Ngan va Thanh pham

- `eligibleNgans`: chi lay `Cho san xuat`
- Chon ngan -> cap nhat `Dang san xuat`
- Xoa het lo cua ngan -> ngan quay ve `Cho san xuat`

## 6. Quan he Thanh pham va Xuat hang

- Lo `Hoan thanh` duoc hien thi tai module `Xuat hang`
- Xuat het remaining -> lo chuyen `Xuat hang`
- Xoa don hang -> tinh lai remaining
- Neu con hang kha dung tro lai -> lo quay ve `Hoan thanh`
