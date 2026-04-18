---
description: Business logic các module sản xuất — Điều xe, Ngăn lưu, Thành phẩm. Đọc khi làm việc với các module này.
---

# Business Logic: Sản xuất

## Module Điều xe (`dispatch_entries`)

### Cấu trúc dữ liệu
```typescript
// Bảng dispatch_entries lưu toàn bộ 1 ngày
{
  id: UUID, factory_id: UUID,
  ngay: string,       // "DD/MM/YYYY" hoặc "YYYY-MM-DD"
  chung_nhan: string, // "PEFC CS" | "PEFC FM" | "ISO" | "Không"
  rows: DxRow[]       // JSONB — mỗi phần tử = 1 chuyến xe
}

// DxRow — 1 chuyến xe
{
  uid: string, _date: string,
  so_xe: string,      // "5B", "7A", "2A"... (danh sách xe cố định)
  chuyen: number,     // 1 hoặc 2
  tai_xe: string,     // Tên tài xế (danh sách cố định)
  diem_gn: string[], // Điểm giao nhận: mã lô vườn ["Q7","P11"]
  phien: string[],   // ["Phiên A","Phiên B","Phiên C","Phiên D"]
  lo_thu_hoach: string,
  xu_ly: string,      // "Xé" | "Cán"
  lo_trinh: string[], // Lộ trình qua các điểm
  so_km: number,
  kl_dct: string,     // KL tươi (kg)
  drc_dc: string,     // DRC% tươi
  kl_dck: string,     // KL khô — AUTO-CALC
  kl_dkt: string,     // KL dập tươi
  drc_dk: string,     // DRC% dập
  kl_dkk: string,     // KL dập khô — AUTO-CALC
  kl_dt: string,      // KL dập tổng
  drc_d: string,      // DRC dập, mặc định "65"
  kl_dk: string,      // KL dập khô tổng
  ngan_ref: string[]
}
```

### Auto-calc bắt buộc
```typescript
kl_dck = (parseFloat(kl_dct) * parseFloat(drc_dc) / 100).toFixed(1)
kl_dkk = (parseFloat(kl_dkt) * parseFloat(drc_dk) / 100).toFixed(1)
// Trigger khi: kl_dct, drc_dc, kl_dkt, hoặc drc_dk thay đổi
```

### UI flow
1. **List view** → bảng theo ngày, click hàng → detail
2. **Detail view** → bảng đầy đủ tất cả cột + tổng KL dưới cùng
3. **Add view** → form header (ngày + chứng nhận) + dynamic rows

---

## Module Ngăn lưu (`ngans`)

### Cấu trúc dữ liệu
```typescript
{
  id: UUID, factory_id: UUID,
  ma_ngan: string,    // "N11-NT-ĐC-X-29/12/25-31/12/25"
  ten_ngan: string,   // "N11"
  loai_nl: string,    // "Mủ đông chén"|"Mủ nước"|"Mủ tạp"|"Mủ skim"
  nguon_goc: string,  // "NT"|"M"|"GCA"
  xu_ly: string,      // "Xé"|"Cán"|"Hỗn hợp"
  chung_nhan: string, // "PEFC CS"|"PEFC FM"|"ISO"|"Không"
  ngay_bd: date, ngay_kt: date,
  trang_thai: string, // "Đang sản xuất"|"Chờ sản xuất"|"Hoàn thành"|"Đóng"
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
  ma_lo: string,       // AUTO: "${num}${suffix}/${year}" → "144cs/26"
  num: number,         // Số thứ tự
  suffix: string,      // "cs"|"m"|"gca"
  year: string,        // "26" (2 chữ số cuối)
  ngay_sx: date, ca: string,  // "A"|"B"|"C"|"D"
  ngan_id: UUID,       // FK → ngans
  loai_csr: string,    // "CSR10"|"CSR20"|"CSRL"|"CSR3L"|"CSR5"|"CSRCV50"|"CSRCV60"
  loai_banh: number,   // kg/bành, thường = 35
  boc: string, tham: string,  // "Củ"|"Mới"
  pallet: string[],    // ["Sắt đế gỗ","Sắt mỏng"]
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
| Code | Tên | Nguồn gốc | Chứng nhận |
|---|---|---|---|
| `cs` | Nội tuyển PEFC | NT | PEFC CS |
| `m` | Mua ngoài | M | — |
| `gca` | Gia công | GCA | — |
