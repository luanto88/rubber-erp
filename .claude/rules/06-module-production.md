---
description: Business logic các module sản xuất — Điều xe, Ngăn lưu, Thành phẩm. Đọc khi làm việc với các module này.
---

# Business Logic: Sản xuất

## Module Điều xe (`dispatch_entries`)

### Cấu trúc dữ liệu

```typescript
// Bảng dispatch_entries
{
  id: UUID, factory_id: UUID,
  ngay: string,       // "YYYY-MM-DD"
  chung_nhan: string, // "PEFC CS" | "PEFC FM" | "Không"
  rows: DxRow[],      // JSONB
  created_at: string, // dùng tính ma_dx
  ma_dx?: string      // computed "DX-ddmmyy/N", không lưu DB
}

// DxRow — 1 chuyến xe
{
  uid: string, _date: string,
  so_xe: string,        // "5B", "7A", "2A"...
  chuyen: number,       // AUTO-ASSIGN khi chọn xe, read-only
  tai_xe: string,       // dropdown từ VEHICLES
  diem_gn: string[],   // mã lô vườn ["Q7","P11"]
  phien: string[],     // ["Phiên A","Phiên B","Phiên C","Phiên D"]
  lo_thu_hoach: string[], // AUTO-FILL từ phien + diem_gn
  xu_ly: string,        // "Xé" | "Không xé"
  lo_trinh: string[],  // chỉ điểm cùng doi với diem_gn
  so_km: number,
  kl_ct: string,       // Chen tuoi (kg)
  drc_c: string,       // DRC% chen
  kl_ck: string,       // Chen kho — AUTO-CALC
  kl_dct: string,       // Dong chen tuoi (kg)
  drc_dc: string,       // DRC% dong chen
  kl_dck: string,       // Dong chen kho — AUTO-CALC
  kl_dkt: string,       // Dong khoi tuoi (kg)
  drc_dk: string,       // DRC% dong khoi
  kl_dkk: string,       // Dong khoi kho — AUTO-CALC
  kl_dt: string,        // Mu day tuoi (kg)
  drc_d: string,        // DRC% mu day (default "65")
  kl_dk: string,        // Mu day kho — AUTO-CALC
  ngan_ref: string[],
  locked?: boolean,
  _warn?: string        // canh bao xe trung chuyen (ephemeral)
}
```

### Auto-calc bắt buộc

```typescript
kl_ck = autoCalcKLK(kl_ct, drc_c); // chen kho
kl_dck = autoCalcKLK(kl_dct, drc_dc); // dong chen kho
kl_dkk = autoCalcKLK(kl_dkt, drc_dk); // dong khoi kho
kl_dk = autoCalcKLK(kl_dt, drc_d); // mu day kho
// Trigger khi field tuong ung thay doi
```

### Logic chuyến auto-assign

```typescript
// Trong updateRow khi field === "so_xe":
const sameXe = prev.filter((r2, i2) => i2 !== idx && r2.so_xe === val);
next.chuyen = sameXe.length + 1; // 0 -> 1, 1 -> 2, >=2 -> warn
next._warn =
  sameXe.length >= 2 ? `Xe ${val} da co ${sameXe.length} chuyen!` : undefined;
```

### Logic lo_trinh filter theo doi

```typescript
// DIEM_GN co truong doi: number (lay tu lo_chi_tiet.csv)
// Khi diem_gn thay doi, tinh allowedDoi, loc lo_trinh options
const allowedDoi = getAllowedDoi(row.diem_gn);
const opts = DIEM_GN.filter((d) => allowedDoi.includes(d.doi)).map(
  (d) => d.ma_lo,
);
```

### Doi phan bo cua DIEM_GN

- Doi 1: E1, G3, G5
- Doi 2: B5, D9  (D9 chuyen tu Doi 3 sang)
- Doi 3: G8, G9, J7
- Doi 4: L2, N7
- Doi 5: C16, C17, D11
- Doi 6: H11, K10, L12
- Doi 7: H13, L14  (H13 chuyen tu Doi 6 sang)
- Doi 8: F16, I16
- Doi 9: U2, P3
- Doi 10: Q7, P11
- Doi 11: T7, U11
- Doi 12: S15, S12, P14

### UI flow

1. **List view** → col "Ma DX" dau tien (DX-ddmmyy/N), click hang → detail
2. **Detail view** → bang day du, header hien ma_dx
3. **Add view** → pre-fill rows tu ngay gan nhat (xoa KL), ngay default = maxDate+1
4. **Nha may diem den** → disabled, lay tu factories table
5. **Chung nhan** → "PEFC CS" | "PEFC FM" | "Khong" (khong co "ISO")
6. **Toolbar** → Tai bang (CSV template hoặc xlsx template , admin only) | Nhap CSV (admin only) | Nhap KL | GeoJSON download | + Them xe
7. **KL modal** → 3 nhom: Chen / Dong chen / Dong khoi / Mu day

---

## Module Ngăn lưu (`ngans`)

### Cấu trúc dữ liệu

```typescript
{
  id: UUID, factory_id: UUID,
  ma_ngan: string,    // "N11-NT-ĐC-X-29/12/25-31/12/25"
  ten_ngan: string,   // "N11"
  loai_nl: string,    // "Mủ chén"|"Mủ đông chén"|"Mủ đông khối"|"Mủ dây"|"Mủ dơ"|"Mủ tạp"|"Mủ nước"
  nguon_goc: string,  // "NT"|"M"|"GCA"
  xu_ly: string,      // "Xé"|"Không xé"|"Hỗn hợp"  (không dùng "Cán")
  chung_nhan: string, // "PEFC CS"|"PEFC FM"|"Không"
  ngay_bd: date, ngay_kt: date,
  trang_thai: string, // "Đang sản xuất"|"Chờ sản xuất"|"Hoàn thành"|"Đã sản xuất"|"Đóng"
  // "Hoàn thành" = ủ xong sẵn sàng SX (storage module set)
  // "Đã sản xuất" = đã SX hết KL (product module set khi đánh dấu xong)
  tong_tuoi: number,  // KL tươi tổng (kg)
  tong_kho: number,   // KL khô quy đổi (kg)
  trips: string[],    // uid các chuyến xe đã vào ngăn
  lo_nguon_goc: string
}
```

### Business rules

- **Thời gian ủ tối thiểu: 21 ngày** tính từ `ngay_bd`
- **Progress bar:** `Math.min(daysSinceBD / 21 * 100, 100)%`
  - Màu xanh `bg-emerald-500` khi ≥ 21 ngày
  - Màu vàng `bg-amber-400` khi < 21 ngày
- **Mã ngăn pattern:** `[Vị trí]-[Nguồn gốc]-[Loại NL viết tắt]-[XL]-[dd/mm/yy]-[dd/mm/yy]`
- Một ngăn có thể cung cấp mủ cho nhiều lô thành phẩm

### UI: Card grid (không phải bảng)

- Layout 3 cột responsive
- Card header màu theo trạng thái
- Mỗi card hiện: tên, loại NL, nguồn gốc, chứng nhận, KL, progress bar ủ

---

## Module Thành phẩm (`lots`)

### Cấu trúc dữ liệu

```typescript
{
  id: UUID, factory_id: UUID,
  day_chuyen: string,  // "Mủ tạp" | "Mủ nước" — quyết định loại SP/bành/bọc hợp lệ
  ma_lo: string,       // AUTO: "${num}${suffix}/${year}" → "144cs/26"
  num: number,         // Số thứ tự
  suffix: string,      // "cs"|"m"|"gca"
  year: string,        // "26" (2 chữ số cuối)
  ngay_sx: date, ca: string,  // "A"|"B"|"C"|"D"
  ngan_id: UUID,       // FK → ngans — loai_nl của ngăn phải khớp với loại NL đầu vào của day_chuyen
  loai_csr: string,    // NMPHK: "CSR10"|"CSR20"|"CSRL"|"CSR3L"|"CSRCV50"|"CSRCV60" / NMCP: "SVR*"
  loai_banh: number,   // Mủ tạp=35; L/3L=35|33,33; CV50/60=35|20
  boc: string, tham: string,  // "Củ"|"Mới"
  pallet: string[],    // NMPHK: sắt đế gỗ/sắt mỏng/MB5/gỗ; NMCP: +sắt đế nhựa
  chi_thi: string,
  kien_a: number, kien_b: number, kien_c: number, kien_d: number,
  tong_banh: number,   // AUTO: sum(kien_a..d)
  tong_kg: number,     // AUTO: tong_banh × loai_banh
  trang_thai: string,  // "Hoàn thành"|"Dở dang"|"Xuất hàng"
  dd_snapshot: JSONB,  // Snapshot khi dở dang
  is_manual_edit: boolean, edit_key: string
}
```

### Business rules bắt buộc

- **Lô tròn:** 4 kiện × 36 bành = **144 bành** → `trang_thai = "Hoàn thành"`
- **Lô dở dang:** bất kỳ kiện nào < 36 → `trang_thai = "Dở dang"`
- **Auto-calc:**
  - `tong_banh = kien_a + kien_b + kien_c + kien_d`
  - `tong_kg = tong_banh × loai_banh`
  - `ma_lo = "${num}${suffix}/${year}"`
- **Highlight kiện:** xanh `text-emerald-600` = 36, vàng `text-amber-600` = 1–35, xám = 0
- **dd_snapshot:** lưu {kien_a, kien_b, kien_c, kien_d} tại thời điểm lô bị đánh dấu dở dang

### Hậu tố lô

| Code  | Tên            | Nguồn gốc | Chứng nhận |
| ----- | -------------- | --------- | ---------- |
| `cs`  | Nội tuyển PEFC | NT        | PEFC CS    |
| `m`   | Mua ngoài      | M         | —          |
| `gca` | Gia công       | GCA       | —          |
