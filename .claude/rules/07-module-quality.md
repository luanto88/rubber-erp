---
description: Module Kiểm nghiệm + Bảng tiêu chuẩn TCCS/TCVN — đọc khi làm việc với quality module hoặc grading logic
---

# Module Kiểm nghiệm & Tiêu chuẩn Chất lượng

## Cấu trúc dữ liệu (`qc_results`)

```typescript
{
  id: UUID, factory_id: UUID, lot_id: UUID | null,
  ma_lo: string,
  pkn: number,        // Số phiếu KN trong năm (1, 2, 3...) — 1 phiếu/ngày/nhà máy
  lo_kn: number,      // Lô PKN — số lô tích lũy toàn thời gian per factory (1, 2, 3...)
  batch_id: UUID,     // Nhóm lô cùng phiếu — tất cả lô cùng ngày chia sẻ 1 batch_id
  ngay_kn: date,      // Ngày kiểm nghiệm
  ngay_sx: date,      // Ngày sản xuất — mặc định = ngay_kn - 1 ngày
  chung_loai: string, // "10","20","L","3L","CV50","CV60","5"
  loai_csr: string,   // "CSR10","CSR20","CSRL","CSR3L","CSRCV50","CSRCV60"
  loai_kn: string,    // "thuong" (6 mẫu) | "ngat" (14 mẫu) | "tuy_chon" | "kl_6thang" | "kl_rot_hang"
  tieu_chuan: string, // "TCCS 112:2022" | "TCVN 3769:2016" | UUID của custom std
  so_mau: number,     // 6 hoặc 14
  samples: {
    tap_chat: (number|string)[], tro: (number|string)[], bay_hoi: (number|string)[],
    nito: (number|string)[], po: (number|string)[], pri: (number|string)[],
    mooney: (number|string)[], mau_sac: (number|string)[]
  },
  grade: { [key]: { dat: boolean, tb: number, detail: string } },
  dat_hang: string,   // "CSR10" nếu đạt, "CSR10RH" nếu rớt hạng (RH = Rớt Hạng)
  trang_thai: string, // "dat" | "khong_dat"
  parent_id: UUID | null, // Kiểm lại: trỏ về record gốc
  lan: number,        // Lần kiểm (1 = lần đầu, 2 = kiểm lại...)
  notes: NoteEntry[], // Lịch sử chỉnh sửa mẫu
}
```

### Mã phiếu KN — format và logic

```typescript
// Format: PKN-{fCode}-{ddmmyy}/{pkn}
// Ví dụ: PKN-PHK-010126/1
formatPKN(pkn: number, ngay_kn: string, fCode: string): string

// Factory codes: phuochoa_kt → "PHK", cuaparis → "CP"

// pkn: đếm per năm per nhà máy — group by ngày KN
// Ngày 01/01/26: pkn=1 | Ngày 02/01/26: pkn=2 | ... (reset mỗi năm)

// lo_kn: đếm tích lũy per nhà máy, không reset
// Phiếu 1 (5 lô): lo_kn=1,2,3,4,5 | Phiếu 2 (5 lô): lo_kn=6,7,8,9,10
```

**Ví dụ:**
| Ngày KN | Lô nhà máy | Lô PKN (lo_kn) | Mã phiếu |
|---|---|---|---|
| 01/01/26 | 01cs/26..05cs/26 | 01, 02, 03, 04, 05 | PKN-PHK-010126/1 |
| 02/01/26 | 06cs/26..10cs/26 | 06, 07, 08, 09, 10 | PKN-PHK-020126/2 |

### getNextPKN / getNextLoKN

```typescript
// pkn: max(pkn) trong năm + 1
const getNextPKN = async (fid, year) => {
  const { data } = await supabase.from("qc_results").select("pkn")
    .eq("factory_id", fid).gte("ngay_kn", `${year}-01-01`).lte("ngay_kn", `${year}-12-31`)
    .order("pkn", { ascending: false }).limit(1)
  return (data?.[0]?.pkn ?? 0) + 1
}

// lo_kn: count(*) per factory + 1 (tích lũy, không reset)
const getNextLoKN = async (fid) => {
  const { count } = await supabase.from("qc_results")
    .select("id", { count: "exact", head: true }).eq("factory_id", fid)
  return (count ?? 0) + 1
}
```

### handleSaveBatch — batch insert logic

```typescript
// Một lần tạo phiếu: tất cả lô chia sẻ cùng pkn + batch_id
const batchPKN = await getNextPKN(factoryId, year)  // 1 lần
let nextLoKN   = await getNextLoKN(factoryId)        // bắt đầu từ đây
const batchId  = crypto.randomUUID()                  // 1 UUID cho toàn phiếu

for (const lot of selectedLots) {
  insert({ batch_id: batchId, pkn: batchPKN, lo_kn: nextLoKN++, ... })
}
```

---

## Chỉ tiêu hiển thị theo chủng loại (LOAI_PROFILE)

Po **luôn hiển thị** cho mọi chủng loại. CV50/CV60 có Po nhưng không có giới hạn → tự động Đạt.

| Chủng loại | Chỉ tiêu bắt buộc | Chỉ tiêu thứ 7 |
|---|---|---|
| 10, 20 | TC, Tro, Bay hơi, Nitơ, Po, PRI | Mooney |
| L, 3L  | TC, Tro, Bay hơi, Nitơ, Po, PRI | Màu sắc |
| CV50, CV60 | TC, Tro, Bay hơi, Nitơ, Po, PRI | Mooney |
| Khác (5...) | TC, Tro, Bay hơi, Nitơ, Po, PRI | (không có) |

```typescript
const LOAI_PROFILE: Record<string, { mooney: boolean; mau: boolean }> = {
  "10": {mooney:true,mau:false}, "20": {mooney:true,mau:false},
  "L":  {mooney:false,mau:true}, "3L": {mooney:false,mau:true},
  "CV50":{mooney:true,mau:false},"CV60":{mooney:true,mau:false},
}
function getVisibleFields(chungLoai: string): string[] {
  const base = ["tap_chat","tro","bay_hoi","nito","po","pri"]
  const p = LOAI_PROFILE[chungLoai] || { mooney:false, mau:false }
  if (p.mooney) base.push("mooney")
  if (p.mau)    base.push("mau_sac")
  return base
}
// Gọi với chung_loai (e.g. "10"), KHÔNG phải loai_csr (e.g. "CSR10")
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

| Chỉ tiêu | TCCS 112:2022 | TCVN 3769:2016 |
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
- Lưu trong bảng `qc_custom_std`: `{ id UUID, factory_id, ten_kh TEXT, limits JSONB }`
- Dropdown tiêu chuẩn hiện: `TCCS 112:2022 | TCVN 3769:2016 | [tên khách hàng]...`

---

## Grading Engine (`calcGrade`)

```typescript
// SVR types → map sang CSR limits: limitKey = loaiCsr.replace(/^SVR/, "CSR")
// TCCS/TCKH: kiểm DR; TCVN: không kiểm DR
const lim = getLimits(loaiCsr, tieuChuan, customLimits)
const visible = getVisibleFields(chungLoai)  // chung_loai = "10", "L", "CV60"...

// 1. Tạp chất & Tro: X̄ + 3SD ≤ giới hạn
dat = (mean + 3 * sd) <= limit

// 2. Bay hơi & Nitơ: Max ≤ limit && DR ≤ dr_limit (nếu TCCS)
dat = max <= limit && (bay_hoi_dr === null || dr <= bay_hoi_dr)

// 3. Po:
//   - po_min === null (CV50/CV60): luôn Đạt, không ảnh hưởng tổng kết
//   - po_min !== null: min >= po_min && dr <= po_dr (nếu TCCS)
if (lim.po_min === null) grade.po = { dat: true, ... }  // CV types

// 4. PRI: min >= pri_min && mean >= pri_tb && dr <= pri_dr (nếu TCCS)

// 5. Mooney (nằm trong khoảng): min >= ml_min && max <= ml_max

// Kết quả tổng
trang_thai = all grade.dat ? "dat" : "khong_dat"
dat_hang   = allDat ? loaiCsr : loaiCsr + "RH"
// "CSR10" nếu đạt, "CSR10RH" nếu rớt hạng (KHÔNG dùng "Không đạt")
```

---

## PDF Phiếu KN (`buildBatchPage`)

```
BẢNG KẾT QUẢ KIỂM NGHIỆM CAO SU CSR
Mã phiếu: PKN-PHK-010126/1  |  NGÀY SX: dd/mm/yyyy  |  NHÀ MÁY: Phước Hòa KT

┌──────┬──────┬───────┬───────────┬─────────┬───────────┬─────────┬───────┬───────┬───────┬──────────┬──────┐
│LÔ PKN│LÔ NM │HẠNG DK│ TẠP CHẤT  │   TRO   │  BAY HƠI  │  NITƠ   │  Po   │  PRI  │  MÀU  │ML(1'+4') │ĐẠT   │
│      │      │       │X̄ |3SD|X̄+3│X̄|3SD|X̄+│X̄|Xmax| DR│X̄|Xmax|DR│X̄|Xm|DR│X̄|Xm|DR│X̄|Xmax|DR│X̄|Xm|Xmax│HẠNG  │
├──────┼──────┼───────┼───────────┼─────────┼───────────┼─────────┼───────┼───────┼───────┼──────────┼──────┤
│  01  │01cs  │ CSR10 │ ... | ... │...      │...        │...      │...    │...    │  —    │...       │CSR10 │
└──────┴──────┴───────┴───────────┴─────────┴───────────┴─────────┴───────┴───────┴───────┴──────────┴──────┘
TỔNG SỐ LÔ KN: 5
              Kampong Thom, ngày DD tháng MM năm YYYY
LẬP BIỂU                          TRƯỞNG PHÒNG QLCL
```

**Cột PDF:**
- **LÔ PKN** = `r.lo_kn` (số tích lũy: 01, 02...)
- **LÔ NM** = `stripYear(r.ma_lo)` → "01cs/26" → "01cs"
- **HẠNG DK** = `r.loai_csr` (luôn là CSR10, không bao giờ là CSR10RH)
- **ĐẠT HẠNG** = `r.dat_hang` ("CSR10" đạt / "CSR10RH" rớt hạng)

**Sub-columns thống kê:**
- Tạp chất & Tro: X̄ | 3SD | X̄+3SD
- Bay hơi & Nitơ & Màu: X̄ | Xmax | DR (Xmax-Xmin)
- Po & PRI: X̄ | Xmin | DR (Xmax-Xmin)
- ML(Mooney): X̄ | Xmin | Xmax

**In PDF:** `window.open()` → `buildPrintHTML(dateResults, ...)` → nhóm theo `batch_id` → in từng phiếu

---

## UI Pattern

- **List view:** Group by `ngay_kn` (date) → header ngày có badge `PKN-PHK-010126/1`
- **Cột bảng:** "Lô PKN" = `r.lo_kn` | "Lô KN" = `r.ma_lo` | Loại | Tiêu chuẩn | Tạp chất | Tro | PRI | Kết quả
- **Expand hàng:** Grid chi tiết từng mẫu (N mẫu × 7 chỉ tiêu) + grade per chỉ tiêu
- **Form nhập:** Bảng grid 7 chỉ tiêu × N cột (6 hoặc 14 mẫu), chỉ show chỉ tiêu visible
- **Loại kiểm:** thuong=6 mẫu | ngat=14 mẫu | tuy_chon | kl_6thang | kl_rot_hang

## Import Excel/CSV (Admin only)

Template format (Mau_KN_10_thuong.xlsx):
- Row 0: `NGAY_KN | NGAY_SX | CHUNG_LOAI | LOAI_KN | TIEU_CHUAN | SO_MAU`
- Row 1: values (ngày, loại, tiêu chuẩn...)
- Row 2: `LO_NM | TC_M1..M6 | TRO_M1..M6 | BH_M1..M6 | NI_M1..M6 | PO_M1..M6 | PRI_M1..M6 | ML_M1..M6 | MAU_M1..M6`
- Row 3+: lot data

Auto-detect: `soMau = count(TC_M* columns)` → `soMau >= 14 ? "ngat" : "thuong"`
Tất cả lô trong 1 file → 1 phiếu (shared `batch_id` + `pkn`)
