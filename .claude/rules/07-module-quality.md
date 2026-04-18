---
description: Module Kiểm nghiệm + Bảng tiêu chuẩn TCCS/TCVN — đọc khi làm việc với quality module hoặc grading logic
---

# Module Kiểm nghiệm & Tiêu chuẩn Chất lượng

## Cấu trúc dữ liệu (`qc_results`)

```typescript
{
  id: UUID, factory_id: UUID, lot_id: UUID,
  ma_lo: string, pkn: number,
  ngay_kn: date,       // Ngày kiểm nghiệm
  ngay_sx: date,       // Ngày sản xuất — mặc định = ngay_kn - 1 ngày
  chung_loai: string,  // "10","20","L","3L","CV50","CV60","5"
  loai_csr: string,    // "CSR10","CSR20","CSRL"...
  loai_kn: string,     // "thuong" (6 mẫu) | "ngat" (14 mẫu)
  tieu_chuan: string,  // "TCCS" | "TCVN" | "KH_KUMHO"...
  so_mau: number,      // 6 hoặc 14
  samples: {
    tap_chat: number[], tro: number[], bay_hoi: number[],
    nito: number[], po: number[], pri: number[],
    mooney: number[], mau_sac: string[]
  },
  grade: { [key]: { dat: boolean, tb: number, detail: string } },
  dat_hang: string,    // "CSR10" nếu đạt, "Không đạt" nếu trượt
  trang_thai: string,  // "dat" | "khong_dat"
}
```

---

## Bảng tiêu chuẩn TCCS 112:2022

> **Đặc trưng TCCS:** Kiểm DR (độ lệch max-min) cho Bay hơi, Nitơ, Po, PRI. Tạp chất dùng X̄+3SD.

| Loại | Tạp chất | Tro | Bay hơi | BH_DR | Nitơ | Ni_DR | Po≥ | Po_DR | PRI≥ | PRI_TB | PRI_DR | Mooney | Màu | Màu_DR |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| CSR-L    | 0.02 | 0.4 | 0.7 | 0.1 | 0.5 | 0.06 | 35 | 8  | 60 | 70 | 10 | —     | ≤4 | 1 |
| CSR-3L   | 0.03 | 0.4 | 0.7 | 0.1 | 0.5 | 0.06 | 35 | 8  | 60 | 70 | 10 | 73-93 | ≤6 | 1 |
| CSR-5    | 0.04 | 0.5 | 0.7 | 0.1 | 0.5 | 0.06 | 30 | —  | 60 | 70 | 10 | —     | —  | — |
| CSR-CV50 | 0.02 | 0.4 | 0.7 | 0.1 | 0.5 | 0.06 | —  | —  | 60 | 70 | 10 | 45-55 | —  | — |
| CSR-CV60 | 0.02 | 0.4 | 0.7 | 0.1 | 0.5 | 0.06 | —  | —  | 60 | 70 | 10 | 55-65 | —  | — |
| CSR-10   | 0.07 | 0.6 | 0.7 | 0.1 | 0.5 | 0.06 | 30 | 8  | 50 | 60 | 10 | 73-93 | —  | — |
| CSR-20   | 0.15 | 0.7 | 0.7 | 0.1 | 0.5 | 0.06 | 30 | 8  | 40 | 50 | 10 | —     | —  | — |

---

## Bảng tiêu chuẩn TCVN 3769:2016

> **Đặc trưng TCVN:** Không kiểm DR. Bay hơi và Nitơ nới lỏng hơn TCCS.

| Loại | Tạp chất | Tro | Bay hơi | Nitơ | Po≥ | PRI≥ | PRI_TB | Mooney | Màu |
|---|---|---|---|---|---|---|---|---|---|
| CSR-L    | 0.02 | 0.4 | 0.8 | 0.6 | 35 | 60 | 70 | —     | ≤4 |
| CSR-3L   | 0.03 | 0.5 | 0.8 | 0.6 | 35 | 60 | 70 | 73-93 | ≤6 |
| CSR-5    | 0.05 | 0.6 | 0.8 | 0.6 | 30 | 60 | 70 | —     | —  |
| CSR-CV50 | 0.02 | 0.4 | 0.8 | 0.6 | —  | 60 | 70 | 45-55 | —  |
| CSR-CV60 | 0.02 | 0.4 | 0.8 | 0.6 | —  | 60 | 70 | 55-65 | —  |
| CSR-10   | 0.08 | 0.6 | 0.8 | 0.6 | 30 | 50 | 60 | 73-93 | —  |
| CSR-20   | 0.16 | 0.8 | 0.8 | 0.6 | 30 | 40 | 50 | —     | —  |

---

## So sánh TCCS vs TCVN

| Chỉ tiêu | TCCS | TCVN |
|---|---|---|
| Bay hơi giới hạn | 0.7 | 0.8 (nới lỏng) |
| Bay hơi DR | ≤ 0.1 | Không kiểm |
| Nitơ giới hạn | 0.5 | 0.6 (nới lỏng) |
| Nitơ DR | ≤ 0.06 | Không kiểm |
| Po DR | ≤ 8 | Không kiểm |
| PRI DR | ≤ 10 | Không kiểm |
| CSR-10 tạp chất | 0.07 | 0.08 |
| CSR-20 tạp chất | 0.15 | 0.16 |

---

## Tiêu chuẩn khách hàng (TCKH)

- Base từ TCCS, chỉnh từng chỉ tiêu theo yêu cầu khách hàng
- Lưu trong bảng `qc_custom_std` với `key = "KH_" + tenKhachHang`
- Ví dụ: `KH_KUMHO` cho KUMHO TIRES
- Dropdown tiêu chuẩn hiện: `TCCS | TCVN | KH_KUMHO | ...`

---

## Grading Engine

```typescript
// Flag quan trọng
// hasRange = true  → kiểm DR (TCCS và TCKH)
// hasRange = false → không kiểm DR (TCVN)
const hasRange = tieu_chuan === "TCCS" || tieu_chuan.startsWith("KH_")

// 1. Tạp chất & Tro: X̄ + 3SD ≤ giới hạn
const mean = avg(vals)
const sd   = stdDev(vals)
dat = (mean + 3 * sd) <= limit

// 2. Bay hơi & Nitơ
dat = max(vals) <= limit
   && (hasRange ? (max - min) <= dr_limit : true)

// 3. Po
dat = min(vals) >= po_min
   && (hasRange && po_dr ? (max - min) <= po_dr : true)

// 4. PRI
dat = mean >= pri_tb
   && min(vals) >= pri_min
   && (hasRange ? (max - min) <= pri_dr : true)

// 5. Mooney (nằm trong khoảng)
dat = min(vals) >= ml_min && max(vals) <= ml_max

// Kết quả tổng
trang_thai = Object.values(grade).every(g => g.dat) ? "dat" : "khong_dat"
dat_hang   = trang_thai === "dat" ? loai_csr : "Không đạt"
```

---

## UI Pattern

- **List:** Bảng, click hàng → expand inline xem chi tiết từng mẫu
- **Expanded row:** Grid 7 ô (1 chỉ tiêu/ô) × N mẫu + kết quả đạt/không đạt
- **Form nhập:** Bảng grid 7 chỉ tiêu × N cột (6 hoặc 14 mẫu)
- **Loại kiểm:** Thường = 6 mẫu, Kiểm ngặt = 14 mẫu (chọn ở form → tự thay đổi số cột)
