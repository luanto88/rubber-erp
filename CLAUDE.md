# CLAUDE.md — Rubber ERP · PTCS Phước Hòa

## Tổng quan dự án

Web ERP quản lý sản xuất cao su cho **CÔNG TY TNHH PTCS PHƯỚC HÒA KAMPONG THOM**.

- **Deploy:** https://qlsxkpt.vercel.app
- **GitHub:** https://github.com/luanto88/rubber-erp
- **Supabase:** https://kaoeenrewvltnrbxmjfe.supabase.co
- **Stack:** Next.js 14 App Router · TypeScript · Tailwind CSS · Supabase

---

## Cấu trúc thư mục

```
src/
  app/
    page.tsx                  ← Login page
    dashboard/
      layout.tsx              ← Sidebar + nav layout
      page.tsx                ← Dashboard (stats cards)
      dispatch/page.tsx       ← Điều xe
      storage/page.tsx        ← Kho nguyên liệu (Ngăn lưu / Hồ chứa tùy dây chuyền)
      product/page.tsx        ← Thành phẩm
      quality/page.tsx        ← Kiểm nghiệm
      export/page.tsx         ← Xuất hàng
      settings/page.tsx       ← Cài đặt
  lib/
    supabase.ts               ← Supabase client
```

---

## Database Schema (Supabase)

### Bảng chính

| Bảng               | Mô tả                           | PK        |
| ------------------ | ------------------------------- | --------- |
| `factories`        | Nhà máy (phuochoa_kt, cuaparis) | id UUID   |
| `users`            | Tài khoản người dùng            | id UUID   |
| `ngans`            | Ngăn lưu mủ cao su              | id UUID   |
| `lots`             | Lô thành phẩm                   | id UUID   |
| `qc_results`       | Kết quả kiểm nghiệm             | id UUID   |
| `dispatch_entries` | Bảng phân xe điều mủ            | id UUID   |
| `export_orders`    | Đơn xuất hàng                   | id UUID   |
| `customers`        | Khách hàng                      | id UUID   |
| `suffixes`         | Hậu tố mã lô (cs, m, gca...)    | code TEXT |
| `kv_store`         | Key-value store (legacy backup) | id UUID   |

### Quan hệ quan trọng

- `lots.ngan_id` → `ngans.id`
- `lots.factory_id` → `factories.id`
- `qc_results.lot_id` → `lots.id`
- `export_orders.customer_id` → `customers.id`
- Tất cả bảng đều có `factory_id` → multi-tenant theo nhà máy

---

## Nhà máy

| Field | NMPHK (`phuochoa_kt`) | NMCP (`cuaparis`) |
|---|---|---|
| Tên | Phước Hòa Kampong Thom | Cuaparis |
| Quốc gia | Campuchia | Việt Nam |
| Tọa độ | 12.581870, 105.497249 | 11.178232, 106.680421 |
| Tiêu chuẩn | TCCS 112:2022; TCVN 3769:2016 | TCCS 112:2022; TCVN 3769:2016 |
| Chứng nhận NL | PEFC CS; Không | PEFC FM; PEFC CS; Không |
| Chứng nhận QT | PEFC EUDR DDS; ISO 9001:2015; ISO 14001:2015; ISO 14067:2018 | PEFC EUDR DDS; ISO 9001:2015; ISO 14001:2015; ISO 14067:2018 |
| Sản phẩm | CSR series | SVR series |

---

## Dây chuyền sản xuất

> **Hierarchy bắt buộc:** Nhà máy → Dây chuyền → Loại SP → Bành → Bọc → Pallet  
> Mọi module CRUD phải lọc dropdown theo trục này — không hiện tùy chọn không hợp lệ cho nhà máy/dây chuyền đang đăng nhập.

Mỗi nhà máy có **2 dây chuyền**: `"Mủ tạp"` và `"Mủ nước"`. Dây chuyền quyết định loại NL đầu vào, loại sản phẩm, loại bành, bọc và pallet hợp lệ.

### Dây chuyền: Mủ tạp

| NM | Loại NL đầu vào | Loại SP | Bành (kg) | Bọc | Pallet |
|---|---|---|---|---|---|
| NMPHK | Mủ chén; Đông chén; Đông khối; Mủ dây | CSR10, CSR20 | 35 | Bọc trơn 0,04; Bọc nhãn 0,04 VRG CSR10/CSR20 | Sắt đế gỗ; Sắt mỏng; MB5; Gỗ |
| NMCP | Mủ chén; Đông chén; Đông khối; Mủ dây; **Mủ dơ** | SVR10, SVR20 | 35 | Bọc trơn 0,04; Bọc nhãn 0,04 VRG SVR10/SVR20 | Sắt đế gỗ; **Sắt đế nhựa**; Sắt mỏng; MB5; Gỗ |

### Dây chuyền: Mủ nước

| NM | Loại SP | Bành (kg) | Bọc | Pallet |
|---|---|---|---|---|
| NMPHK | CSRL, CSR3L | 35; 33,33 | Bọc trơn 0,04; Bọc nhãn 0,04 VRG CSRL/CSR3L; Bọc trơn 0,13; Bọc nhãn 0,13 VRG CSRL/CSR3L | Sắt đế gỗ; Sắt mỏng; MB5; Gỗ |
| NMPHK | CSRCV50, CSRCV60 | 35; 20 | Bọc trơn 0,04; Bọc nhãn 0,04 VRG CSRCV50/CV60; Bọc trơn 0,13; Bọc nhãn 0,13 VRG CSRCV50/CV60 | Sắt đế gỗ; Sắt mỏng; MB5; Gỗ |
| NMCP | SVRL, SVR3L | 35; 33,33 | Bọc trơn 0,04; Bọc nhãn 0,04 VRG SVRL/SVR3L; Bọc trơn 0,13; Bọc nhãn 0,13 VRG SVRL/SVR3L | Sắt đế gỗ; Sắt đế nhựa; Sắt mỏng; MB5; Gỗ |
| NMCP | SVRCV50, SVRCV60 | 35; 20 | Bọc trơn 0,04; Bọc nhãn 0,04 VRG SVRCV50/CV60; Bọc trơn 0,13; Bọc nhãn 0,13 VRG SVRCV50/CV60 | Sắt đế gỗ; Sắt đế nhựa; Sắt mỏng; MB5; Gỗ |

> **Mủ nước NL đầu vào:** Mủ nước (cả 2 nhà máy — không dùng mủ chén/đông chén/đông khối/mủ dây cho dây chuyền này)

### Quy tắc filter dropdown theo hierarchy

```typescript
// 1. Nhà máy (factory_id) — đã xác định từ session
// 2. Dây chuyền → quyết định loại NL và loại SP
const dayChuyenOptions = ["Mủ tạp", "Mủ nước"]

// 3. Loại SP → filter theo NM + dây chuyền
const loaiSPByNMDC = {
  NMPHK: { "Mủ tạp": ["CSR10","CSR20"], "Mủ nước": ["CSRL","CSR3L","CSRCV50","CSRCV60"] },
  NMCP:  { "Mủ tạp": ["SVR10","SVR20"], "Mủ nước": ["SVRL","SVR3L","SVRCV50","SVRCV60"] },
}

// 4. Bành → filter theo NM + dây chuyền + loại SP
const loaiBanhByLoaiSP = {
  "Mủ tạp": [35],
  "CSRL": [35, 33.33], "CSR3L": [35, 33.33], "SVRL": [35, 33.33], "SVR3L": [35, 33.33],
  "CSRCV50": [35, 20],  "CSRCV60": [35, 20],  "SVRCV50": [35, 20],  "SVRCV60": [35, 20],
}

// 5. Bọc → filter theo NM + dây chuyền
const bocByDayChuyen = {
  "Mủ tạp": ["Bọc trơn 0,04", "Bọc nhãn 0,04 VRG {loaiSP}"],
  "Mủ nước": ["Bọc trơn 0,04","Bọc nhãn 0,04 VRG {loaiSP}","Bọc trơn 0,13","Bọc nhãn 0,13 VRG {loaiSP}"],
}

// 6. Pallet → filter theo NM
const palletByNM = {
  NMPHK: ["Sắt đế gỗ","Sắt mỏng","MB5","Gỗ"],
  NMCP:  ["Sắt đế gỗ","Sắt đế nhựa","Sắt mỏng","MB5","Gỗ"],
}
```

---

## Tên module theo Dây chuyền

Module **"Kho nguyên liệu"** (tên sidebar) thay thế tên cũ "Ngăn lưu". Sub-term hiển thị trong UI thay đổi theo dây chuyền đang chọn:

| Dây chuyền | Sub-term | Đơn vị lưu trữ |
|---|---|---|
| Mủ tạp | **Ngăn lưu** | Ngăn (compartment) |
| Mủ nước | **Hồ chứa** | Hồ/Bể (tank/basin) |

> File: `src/app/dashboard/storage/page.tsx` (tên route giữ nguyên `/storage`)

---

## Quy tắc: Dây chuyền trong Form Header (Bắt buộc)

**Tất cả module CRUD** phải có trường **Dây chuyền** hiển thị ở đầu form (header section), **trước tất cả các trường khác**. Các dropdown và giá trị phụ đều filter theo dây chuyền đang chọn.

### Áp dụng cho từng module

| Module | File | Ảnh hưởng khi đổi Dây chuyền |
|---|---|---|
| Điều xe | `dispatch/page.tsx` | loại NL (KL modal groups hiện/ẩn) |
| Kho nguyên liệu | `storage/page.tsx` | tên sub-term (Ngăn/Hồ), loại NL options, chứng nhận |
| Thành phẩm | `product/page.tsx` | loại SP options, bành options, bọc options |
| Chất lượng | `quality/page.tsx` | loại SP options (CSR* vs SVR*) |
| Xuất hàng | `export/page.tsx` | loại SP options, pallet options |

### UI Pattern bắt buộc cho Form Header

```tsx
{/* LUÔN đặt ở đầu form, trước mọi field khác */}
<div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4">
  <label className="text-xs font-bold text-slate-600 block mb-1.5">
    Dây chuyền <span className="text-red-500">*</span>
  </label>
  <div className="flex gap-3">
    {["Mủ tạp", "Mủ nước"].map(dc => (
      <button
        key={dc}
        onClick={() => setForm(f => ({ ...f, day_chuyen: dc }))}
        className={`px-4 py-2 rounded-xl text-sm font-bold border-2 transition-all ${
          form.day_chuyen === dc
            ? "border-emerald-500 bg-emerald-50 text-emerald-700"
            : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
        }`}
      >
        {dc}
      </button>
    ))}
  </div>
  {/* Sub-label hiển thị tên đơn vị theo dây chuyền */}
  {form.day_chuyen && (
    <p className="text-xs text-slate-400 mt-1">
      {form.day_chuyen === "Mủ tạp" ? "→ Ngăn lưu" : "→ Hồ chứa"}
    </p>
  )}
</div>
```

### Cascade reset rule

Khi user đổi `day_chuyen`, **bắt buộc reset** tất cả các field phụ thuộc về `""` để tránh giá trị không hợp lệ:

```typescript
const handleDayChuyenChange = (dc: string) => {
  setForm(prev => ({
    ...prev,
    day_chuyen: dc,
    // Reset các field phụ thuộc
    loai_csr: "",
    loai_sp: "",
    loai_banh: 35,
    boc: "",
    // Giữ nguyên: ngay, ca, ngan_id, suffix, num, year, ...
  }))
}
```

---

## Auth & Session

- Login lưu vào `localStorage`:
  - `erp_user` → JSON object user
  - `erp_factory` → factory UUID
- Tất cả query Supabase đều filter `.eq("factory_id", fid)`
- `fid = localStorage.getItem("erp_factory")`

---

## Module: Điều xe (`dispatch_entries`)

### Schema

```typescript
{
  id: UUID,
  factory_id: UUID,
  ngay: string,         // "YYYY-MM-DD"
  chung_nhan: string,   // "PEFC CS" | "PEFC FM" | "Không"
  rows: DxRow[],        // JSONB — mảng các chuyến xe
  created_at: string,   // dùng để tính ma_dx
  ma_dx?: string        // computed: "DX-ddmmyy/N" (không lưu DB)
}
```

### DxRow structure

```typescript
{
  uid: string,
  _date: string,
  so_xe: string,        // "5B", "7A", "2A"... xe cố định
  chuyen: number,       // AUTO-ASSIGN: 1 (lần đầu) | 2 (lần 2) — read-only
  tai_xe: string,       // Tên tài xế — dropdown từ VEHICLES
  diem_gn: string[],    // Điểm giao nhận — mã lô vườn: ["Q7","P11"]
  phien: string[],      // ["Phiên A","Phiên B","Phiên C","Phiên D"]
  lo_thu_hoach: string[], // AUTO-FILL từ phiên + điểm GN
  xu_ly: string,        // "Xé" | "Không xé"
  lo_trinh: string[],   // Lộ trình — chỉ hiện điểm cùng đội với diem_gn
  so_km: number,
  kl_ct: string,        // Chén tươi (kg)
  drc_c: string,        // DRC% chén
  kl_ck: string,        // Chén khô — AUTO-CAL
  kl_dct: string,       // Đông chén tươi (kg)
  drc_dc: string,       // DRC% đông chén
  kl_dck: string,       // Đông chén khô — AUTO-CALC
  kl_dkt: string,       // Đông khối tươi (kg)
  drc_dk: string,       // DRC% đông khối
  kl_dkk: string,       // Đông khối khô — AUTO-CALC
  kl_dt: string,        // Mủ dây tươi (kg)
  drc_d: string,        // DRC% mủ dây (mặc định "65")
  kl_dk: string,        // Mủ dây khô — AUTO-CALC
  ngan_ref: string[],
  locked?: boolean,
  _warn?: string        // cảnh báo xe trùng chuyến (ephemeral)
}
```

### Mã điều xe

Format: `DX-ddmmyy/N` — computed từ `created_at` order trong cùng ngày.  
Ví dụ: phiếu đầu tiên ngày 01/01/2026 → `DX-010126/1`.

### Logic tính tự động

- `kl_ck = kl_ct × drc_c / 100` (chén khô)
- `kl_dck = kl_dct × drc_dc / 100` (đông chén khô)
- `kl_dkk = kl_dkt × drc_dk / 100` (đông khối khô)
- `kl_dk  = kl_dt  × drc_d  / 100` (mủ dây khô)
- `chuyen` = auto-assign khi chọn xe (đếm xe đã chọn trong ngày)
- `lo_trinh` chỉ hiện điểm GN cùng đội (`doi`) với `diem_gn` đã chọn
- `lo_thu_hoach` auto-fill từ `phien_a/b/c/d` của các điểm GN

### DiemGN Master Data

Mỗi điểm giao nhận có trường `doi: number` lấy từ `lo_chi_tiet.csv`.  
Đội phân bổ: Đội 1 (E1,G3,G5), Đội 2 (B5,D9), Đội 3 (G8,G9,J7),  
Đội 4 (L2,N7), Đội 5 (C16,C17,D11), Đội 6 (H11,K10,L12),  
Đội 7 (L14,H13), Đội 8 (F16,I16), Đội 9 (U2,P3), Đội 10 (Q7,P11),  
Đội 11 (T7,U11), Đội 12 (S15,S12,P14).  
*(D9 chuyển từ Đội 3 → Đội 2; H13 chuyển từ Đội 6 → Đội 7)*

### UI Pattern

- View **list**: Cột đầu "Mã ĐX" (`DX-ddmmyy/N`), click hàng → detail
- View **detail**: Bảng đầy đủ, header hiện mã ĐX
- View **add**: Pre-fill rows từ ngày gần nhất (xóa KL), ngày mặc định = maxDate+1
- Nhà máy điểm đến: lấy từ `factories` table, disabled
- Chứng nhận: "PEFC CS" | "PEFC FM" | "Không" (không có "ISO")
- Toolbar: Tải bảng (CSV template, admin only) | Nhập CSV (import, admin only) | Nhập KL | GeoJSON | + Thêm xe
- KL modal: 4 nhóm — Chén (kl_ct/drc_c/kl_ck) |Đông chén (kl_dct/drc_dc/kl_dck) | Đông khối (kl_dkt/drc_dk/kl_dkk) | Mủ dây (kl_dt/drc_d/kl_dk)

---

## Module: Ngăn lưu (`ngans`)

### Schema

```typescript
{
  id: UUID,
  factory_id: UUID,
  ma_ngan: string,      // "N11-NT-ĐC-X-29/12/25-31/12/25"
  ten_ngan: string,     // "N11"
  loai_nl: string,      // "Mủ chén" | "Mủ đông chén" | "Mủ đông khối" | "Mủ dây" | "Mủ dơ" | "Mủ tạp" | "Mủ nước"
  nguon_goc: string,    // "NT" | "M" | "GCA"
  xu_ly: string,        // "Xé" | "Không xé" | "Hỗn hợp"
  chung_nhan: string,   // "PEFC CS" | "PEFC FM" | "Không" — lọc theo nhà máy: phuochoa_kt=["PEFC CS","Không"], cuaparis=["PEFC CS","PEFC FM","Không"]
  ngay_bd: date,        // Ngày bắt đầu
  ngay_kt: date,        // Ngày kết thúc
  trang_thai: string,   // "Đang nhận" | "Đóng" | "Chờ sản xuất" | "Đang sản xuất" | "Đã sản xuất"
  // "Đang nhận"     = chỉ có ngay_bd, chưa có ngay_kt (set khi tạo ngăn)
  // "Đóng"          = có ngay_kt (set khi nhập ngày kết thúc, ngay_bd = ngay_kt hợp lệ)
  // "Chờ sản xuất"  = đủ 21 ngày kể từ ngay_bd — tự động chuyển
  // "Đang sản xuất" = user chọn ngăn trong Thành phẩm — cập nhật ngay
  // "Đã sản xuất"   = user bấm "Lưu và đánh dấu đã sản xuất" trong Thành phẩm
  // → Chi tiết logic xem .claude/rules/storage.md
  tong_tuoi: number,    // KL tươi tổng (kg)
  tong_kho: number,     // KL khô quy đổi (kg)
  trips: string[],      // JSONB — mảng uid của các chuyến xe
  lo_nguon_goc: string
}
```

### Business Rules

- Chỉ có `ngay_bd` → trạng thái `Đang nhận`; có thêm `ngay_kt` → `Đóng`
- Sau **21 ngày** kể từ `ngay_bd` → **tự động** chuyển thành `Chờ sản xuất`
- Ngăn `Chờ sản xuất` mới xuất hiện trong dropdown chọn ngăn tại Thành phẩm
- Thanh progress bar: `days / 21 × 100%`, xanh nếu ≥ 21 ngày, vàng nếu chưa đủ
- Mã ngăn pattern: `[Vị trí]-[Nguồn gốc]-[Loại NL viết tắt]-[XửLý]-[dd/mm/yy]-[dd/mm/yy]`
- Một ngăn có thể cung cấp mủ cho nhiều lô thành phẩm

### UI Pattern

- View dạng **card grid** (3 cột), không phải bảng
- Card header màu theo trạng thái (xanh = đang SX, xanh dương = Chờ sản xuất, xám = Đang nhận/Đóng)
- Mỗi card: tên ngăn, mã ngăn, loại NL, nguồn gốc/xử lý, chứng nhận, KL tươi/khô, KL thành phẩm/quy khô ngăn kèm phần trăm, thanh tiến độ ủ
- Modal add/edit: form 2 cột

---

## Module: Thành phẩm (`lots`)

### Schema

```typescript
{
  id: UUID,
  factory_id: UUID,
  day_chuyen: string,   // "Mủ tạp" | "Mủ nước" — quyết định loại SP, bành, bọc hợp lệ
  ma_lo: string,        // "144cs/26" = num + suffix + "/" + year
  num: number,          // Số thứ tự lô
  suffix: string,       // "cs"=nội tuyển PEFC, "m"=mua ngoài, "gca"=gia công
  year: string,         // "26" (2 chữ số cuối năm)
  ngay_sx: date,
  ca: string,           // "A" | "B" | "C" | "D"
  ngan_id: UUID,        // FK → ngans
  loai_csr: string,     // NMPHK: "CSR10"|"CSR20"|"CSRL"|"CSR3L"|"CSRCV50"|"CSRCV60" / NMCP: "SVR10"|"SVR20"|"SVRL"|"SVR3L"|"SVRCV50"|"SVRCV60"
  loai_banh: number,    // Mủ tạp=35; Mủ nước L/3L=35 hoặc 33,33; CV50/CV60=35 hoặc 20
  boc: string,          // Mủ tạp: bọc 0,04 / Mủ nước: bọc 0,04 hoặc 0,13
  tham: string,         // "Củ" | "Mới"
  pallet: string[],     // NMPHK: [sắt đế gỗ/sắt mỏng/MB5/gỗ] / NMCP: +sắt đế nhựa
  chi_thi: string,      // Số chỉ thị
  kien_a: number,       // Số bành kiện A (chuẩn = 36)
  kien_b: number,       // Số bành kiện B (chuẩn = 36)
  kien_c: number,       // Số bành kiện C (chuẩn = 36)
  kien_d: number,       // Số bành kiện D (chuẩn = 36)
  tong_banh: number,    // = kien_a + kien_b + kien_c + kien_d (AUTO-CALC)
  tong_kg: number,      // = tong_banh × loai_banh (AUTO-CALC)
  trang_thai: string,   // "Hoàn thành" | "Dở dang" | "Xuất hàng"
  ghi_chu: string,
  dd_snapshot: JSONB,   // Snapshot khi lô dở dang (kien_a/b/c/d tại thời điểm dở dang)
  is_manual_edit: boolean,
  edit_key: string
}
```

### Business Rules

- **Lô tròn:** 4 kiện × 36 bành = 144 bành → `trang_thai = "Hoàn thành"`
- **Lô dở dang:** Bất kỳ kiện nào < 36 → `trang_thai = "Dở dang"`
- `ma_lo` tự tạo: `${num}${suffix}/${year}` (vd: "144cs/26")
- `tong_banh` và `tong_kg` tự tính khi thay đổi kiện hoặc `loai_banh`
- Màu highlight kiện: xanh = 36 (đủ), vàng = 1-35 (thiếu), xám = 0
- `day_chuyen` bắt buộc không được null/rỗng — insert phải luôn có giá trị "Mủ tạp" hoặc "Mủ nước"
- `ghi_chu: ""` và `is_manual_edit: false` phải có trong insert (không để undefined)

### Lô kế thừa (dở dang → ca tiếp theo)

Khi lô cuối ca trước còn dở dang (`is_continuation = true`):

| Kiện | Điều kiện | Hiển thị | Tính sản lượng |
|---|---|---|---|
| `locked = true` | Ca trước đã đủ (≥ max) | Read-only indigo, badge "Ca trước · đã đủ" | Không tính vào ca này |
| `locked = false` | Ca trước chưa đủ | Input nhập tay, min=prev, max=maxK, có nút X | Chỉ tính phần delta (thêm vào) |

**Quy tắc tính caTongBanh / sessionTotals cho lô kế thừa:**
```typescript
// Chỉ tính phần THÊM VÀO, không tính bành đã có từ ca trước
deltaBanh = Max(0, kien_a - prev_a) + Max(0, kien_b - prev_b)
          + Max(0, kien_c - prev_c) + Max(0, kien_d - prev_d)
```

### Hậu tố (suffixes)

| Code | Tên            | Nguồn gốc | Chứng nhận |
| ---- | -------------- | --------- | ---------- |
| cs   | Nội tuyển PEFC | NT        | PEFC CS    |
| m    | Mua ngoài      | M         | —          |
| gca  | Gia công       | GCA       | —          |

### UI Pattern

- Bảng danh sách + filter (loại CSR, trạng thái, khoảng ngày)
- Stats bar: tổng lô, hoàn thành, dở dang, tổng bành, tổng tấn
- Form add/edit: tự tính ma_lo, tong_banh, tong_kg

---

## Module: Kiểm nghiệm (`qc_results`)

### Schema

```typescript
{
  id: UUID,
  factory_id: UUID,
  lot_id: UUID,         // FK → lots
  ma_lo: string,
  pkn: number,          // Số phiếu kiểm nghiệm
  ngay_kn: date,        // Ngày kiểm nghiệm
  ngay_sx: date,        // Ngày sản xuất (thường = ngay_kn - 1 ngày)
  chung_loai: string,   // "10", "20", "L", "3L"...
  loai_csr: string,     // "CSR10", "CSR20"...
  loai_kn: string,      // "thuong" (6 mẫu) | "ngat" (14 mẫu)
  tieu_chuan: string,   // "TCCS" | "TCVN" | "KH_KUMHO"...
  so_mau: number,       // 6 hoặc 14
  samples: JSONB,       // {tap_chat:[], tro:[], bay_hoi:[], nito:[], po:[], pri:[], mooney:[], mau_sac:[]}
  grade: JSONB,         // Kết quả tính toán từng chỉ tiêu
  dat_hang: string,     // "CSR10" nếu đạt, "Không đạt" nếu trượt
  trang_thai: string,   // "dat" | "khong_dat"
}
```

### Bảng giới hạn TCCS 112:2022

| Loại     | Tạp chất | Tro | Bay hơi(DR) | Nitơ(DR)  | Po min | PRI min | PRI TB | PRI DR | Mooney | Màu   |
| -------- | -------- | --- | ----------- | --------- | ------ | ------- | ------ | ------ | ------ | ----- |
| CSR-L    | 0.02     | 0.4 | 0.7(0.1)    | 0.5(0.06) | 35(8)  | 60      | 70     | 10     | —      | ≤4(1) |
| CSR-3L   | 0.03     | 0.4 | 0.7(0.1)    | 0.5(0.06) | 35(8)  | 60      | 70     | 10     | 73-93  | ≤6(1) |
| CSR-5    | 0.04     | 0.5 | 0.7(0.1)    | 0.5(0.06) | 30     | 60      | 70     | 10     | —      | —     |
| CSR-CV50 | 0.02     | 0.4 | 0.7(0.1)    | 0.5(0.06) | —      | 60      | 70     | 10     | 45-55  | —     |
| CSR-CV60 | 0.02     | 0.4 | 0.7(0.1)    | 0.5(0.06) | —      | 60      | 70     | 10     | 55-65  | —     |
| CSR-10   | 0.07     | 0.6 | 0.7(0.1)    | 0.5(0.06) | 30(8)  | 50      | 60     | 10     | 73-93  | —     |
| CSR-20   | 0.15     | 0.7 | 0.7(0.1)    | 0.5(0.06) | 30(8)  | 40      | 50     | 10     | —      | —     |

### Công thức tính grade

- **Tạp chất & Tro:** X̄ + 3SD ≤ giới hạn
- **Bay hơi & Nitơ:** Max ≤ giới hạn VÀ DR (max-min) ≤ DR_limit
- **Po:** Min ≥ po_min VÀ DR ≤ po_dr
- **PRI:** X̄ ≥ pri_tb VÀ Min ≥ pri_min VÀ DR ≤ pri_dr
- **Mooney:** Min ≥ ml_min VÀ Max ≤ ml_max

### UI Pattern

- Bảng danh sách, click hàng → expand inline xem chi tiết từng mẫu (7 ô × N mẫu)
- Stats: tổng phiếu, đạt, không đạt, tỷ lệ %
- Form nhập: bảng grid 7 chỉ tiêu × N mẫu (6 hoặc 14)
- Tự tính grade sau khi nhập xong

---

## Module: Xuất hàng (`export_orders`)

### Schema

```typescript
{
  id: UUID,
  factory_id: UUID,
  ma_don: string,         // "XH_KUMHO_14_240226"
  ngay: date,
  so_thong_bao: string,
  so_hoa_don: string,
  so_hop_dong: string,
  customer_id: UUID,      // FK → customers
  chung_loai: string,     // "CSR10"...
  loai_pallet: string,    // "Xuất rời" | "Pallet gỗ" | "Pallet sắt"
  vehicles: JSONB,        // Vehicle[]
  assignments: JSONB,     // Assignment[]
  tong_banh: number
}

type Vehicle = {
  id: string,
  loai_xe: string,        // "Container 20ft" | "Container 40ft" | "Xe tải mui bạt"
  bien_truoc: string,     // Biển số đầu kéo
  bien_sau: string,       // Biển số rơ-moóc
  ghi_chu: string
}

type Assignment = {
  lot_id: string,         // UUID của lô
  ma_lo: string,
  vehicleIdx: number,     // Index xe trong mảng vehicles
  kien_a: number, kien_b: number, kien_c: number, kien_d: number
}
```

### UI Pattern

- Layout **2 cột** khi tạo đơn: trái (form + xe) / phải (panel chọn lô)
- Panel chọn lô: chỉ hiện lô `loai_csr = form.chung_loai` và `trang_thai = "Hoàn thành"`
- Mỗi lô có nút chọn cho từng xe (Xe 1, Xe 2...)
- Lô được chọn hiển thị màu xanh, có thể chỉnh số kiện A/B/C/D
- `tong_banh` tự tính từ tất cả assignments

---

## Conventions & Patterns

### Fetch data pattern

```typescript
const loadData = useCallback(
  async (fid: string) => {
    setLoading(true);
    const { data } = await supabase
      .from("table_name")
      .select("*")
      .eq("factory_id", fid)
      .order("created_at", { ascending: false });
    setData(data || []);
    setLoading(false);
  },
  [
    /* dependencies */
  ],
);

useEffect(() => {
  const fid = localStorage.getItem("erp_factory");
  if (!fid) return;
  setFactoryId(fid);
  loadData(fid);
}, [loadData]);
```

### Save pattern

> ⚠️ **Supabase JS v2 KHÔNG throw exception** — phải kiểm tra `error` object thủ công.  
> Nếu bỏ qua `error`, insert/update thất bại nhưng code vẫn chạy tiếp (lô lưu không hiện).

```typescript
const [saveError, setSaveError] = useState<string | null>(null)

const handleSave = async () => {
  if (!factoryId) return
  setSaving(true)
  setSaveError(null)
  if (editId) {
    const { error } = await supabase.from("table").update(payload).eq("id", editId)
    if (error) { setSaveError(error.message); setSaving(false); return }
  } else {
    const { error } = await supabase.from("table").insert({ ...payload, factory_id: factoryId })
    if (error) { setSaveError(error.message); setSaving(false); return }
  }
  setSaving(false)
  setModal(null)
  loadData(factoryId)
}
```

### UI Components tự viết (không dùng thư viện ngoài ngoài lucide-react)

- Modal: `fixed inset-0 bg-black/50 z-50 flex items-center justify-center`
- Stats card: `bg-white rounded-xl border border-slate-200 shadow-md p-4 text-center`
- Content card: `bg-white rounded-xl border border-slate-200 shadow-md p-4` — header dùng gradient nhẹ, icon lucide-react kèm label, value `font-semibold` đậm hơn label `text-slate-500`, phân cách hàng bằng `border-dashed border-slate-200`
- Filter bar: `bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4 flex flex-wrap gap-3`
- Table: `bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden`
- Button primary: `bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl`
- Button danger: `bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl`
- Badge: `px-2 py-0.5 rounded-full text-xs font-bold`

### Màu trạng thái

| Trạng thái         | Class                             |
| ------------------ | --------------------------------- |
| Hoàn thành / Đạt   | `bg-emerald-100 text-emerald-700` |
| Dở dang / Cảnh báo | `bg-amber-100 text-amber-700`     |
| Không đạt / Lỗi    | `bg-red-100 text-red-600`         |
| Xuất hàng / Info   | `bg-blue-100 text-blue-700`       |
| Mặc định           | `bg-slate-100 text-slate-600`     |

---

## Rules tuyệt đối

1. **KHÔNG BAO GIỜ** xóa, drop, truncate dữ liệu Supabase khi chưa được xác nhận
2. Tất cả query Supabase phải có `.eq("factory_id", fid)`
3. Không dùng `localStorage` để lưu data nghiệp vụ (chỉ dùng cho session user/factory)
4. Tất cả form phải có loading state (`saving`) khi submit
5. Sau khi save/delete phải gọi `loadData(factoryId)` để refresh

---

## UI/UX Rules (Bắt buộc)

### 1. Scroll Animation

Các thành phần chính của CRUD (Table, Card list, Form) **phải có hiệu ứng xuất hiện khi cuộn trang**.

- Dùng class `scroll-reveal` + hook `useScrollReveal` có sẵn tại `src/lib/useScrollReveal.ts`
- CSS đã định nghĩa trong `globals.css`: `.scroll-reveal` → `.scroll-reveal.revealed`
- Hiệu ứng: fade-in, slide-up từ dưới lên

```tsx
// Cách dùng trong mỗi page
import { useScrollReveal } from "@/lib/useScrollReveal";

export default function Page() {
  useScrollReveal();
  return <div className="scroll-reveal">{/* nội dung */}</div>;
}
```

### 2. Hover Animation

**Tất cả thành phần tương tác** (hàng bảng, nút, card) **phải có hiệu ứng hover tinh tế**.

| Thành phần  | Classes bắt buộc                                                                   |
| ----------- | ---------------------------------------------------------------------------------- |
| Hàng bảng   | `row-hover` hoặc `transition-colors duration-200 hover:bg-gray-50`                 |
| Card        | `hover-lift` hoặc `hover:shadow-md hover:scale-[1.02] transition-all duration-200` |
| Nút bấm     | `btn-press` hoặc `active:scale-95 transition-all`                                  |
| Glow effect | `hover-glow`                                                                       |

Các utility class `hover-lift`, `hover-glow`, `row-hover`, `btn-press` đã định nghĩa trong `globals.css`.

---

## Quy tắc file

- **KHÔNG được tự ý xóa file** — luôn hỏi người dùng trước khi xóa bất kỳ file nào

---

## Tiêu chuẩn kiểm nghiệm

→ Xem chi tiết bảng TCCS 112:2022, TCVN 3769:2016, so sánh và grading engine tại `.claude/rules/07-module-quality.md`

