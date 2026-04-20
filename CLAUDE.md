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
      storage/page.tsx        ← Ngăn lưu
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

| Code          | Tên                    | Sản phẩm                                          | Chứng nhận                      |
| ------------- | ---------------------- | ------------------------------------------------- | ------------------------------- |
| `phuochoa_kt` | Phước Hòa Kampong Thom | CSR (CSRL/CSR3L/CSR5/CSRCV50/CSRCV60/CSR10/CSR20) | PEFC/ISO 9001/14001/17025/14067 |
| `cuaparis`    | Cuaparis HCM           | SVR (SVRL/SVR3L/SVR5/SVRCV50/SVRCV50/SVR10/SVR20) | ISO                             |

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
  xu_ly: string,        // "Xé" | "Cán"
  lo_trinh: string[],   // Lộ trình — chỉ hiện điểm cùng đội với diem_gn
  so_km: number,
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

- `kl_dck = kl_dct × drc_dc / 100` (đông chén khô)
- `kl_dkk = kl_dkt × drc_dk / 100` (đông khối khô)
- `kl_dk  = kl_dt  × drc_d  / 100` (mủ dây khô)
- `chuyen` = auto-assign khi chọn xe (đếm xe đã chọn trong ngày)
- `lo_trinh` chỉ hiện điểm GN cùng đội (`doi`) với `diem_gn` đã chọn
- `lo_thu_hoach` auto-fill từ `phien_a/b/c/d` của các điểm GN

### DiemGN Master Data

Mỗi điểm giao nhận có trường `doi: number` lấy từ `lo_chi_tiet.csv`.  
Đội phân bổ: Đội 1 (E1,G3,G5,C2), Đội 2 (B5), Đội 3 (D9,G8,G9,J7),  
Đội 4 (L2), Đội 5 (C16,C17,D11), Đội 6 (H11,K10,L12,H13),  
Đội 7 (L14), Đội 8 (F16,I16), Đội 9 (U2,P3), Đội 10 (Q7,P11),  
Đội 11 (T7,U11), Đội 12 (S15,S12,P14).

### UI Pattern

- View **list**: Cột đầu "Mã ĐX" (`DX-ddmmyy/N`), click hàng → detail
- View **detail**: Bảng đầy đủ, header hiện mã ĐX
- View **add**: Pre-fill rows từ ngày gần nhất (xóa KL), ngày mặc định = maxDate+1
- Nhà máy điểm đến: lấy từ `factories` table, disabled
- Chứng nhận: "PEFC CS" | "PEFC FM" | "Không" (không có "ISO")
- Toolbar: Tải bảng (CSV template, admin only) | Nhập CSV (import, admin only) | Nhập KL | GeoJSON | + Thêm xe
- KL modal: 3 nhóm — Đông chén (kl_dct/drc_dc/kl_dck) | Đông khối (kl_dkt/drc_dk/kl_dkk) | Mủ dây (kl_dt/drc_d/kl_dk)

---

## Module: Ngăn lưu (`ngans`)

### Schema

```typescript
{
  id: UUID,
  factory_id: UUID,
  ma_ngan: string,      // "N11-NT-ĐC-X-29/12/25-31/12/25"
  ten_ngan: string,     // "N11"
  loai_nl: string,      // "Mủ đông chén" | "Mủ nước" | "Mủ tạp" | "Mủ skim"
  nguon_goc: string,    // "NT" | "M" | "GCA"
  xu_ly: string,        // "Xé" | "Cán" | "Hỗn hợp"
  chung_nhan: string,   // "PEFC CS" | "PEFC FM" | "ISO" | "Không"
  ngay_bd: date,        // Ngày bắt đầu
  ngay_kt: date,        // Ngày kết thúc
  trang_thai: string,   // "Đang sản xuất" | "Chờ sản xuất" | "Hoàn thành" | "Đóng"
  tong_tuoi: number,    // KL tươi tổng (kg)
  tong_kho: number,     // KL khô quy đổi (kg)
  trips: string[],      // JSONB — mảng uid của các chuyến xe
  lo_nguon_goc: string
}
```

### Business Rules

- Thời gian ủ tối thiểu **21 ngày** (ngay_bd → hiện tại)
- Thanh progress bar: `days / 21 × 100%`, xanh nếu ≥ 21 ngày, vàng nếu chưa đủ
- Mã ngăn pattern: `[Vị trí]-[Nguồn gốc]-[Loại NL viết tắt]-[XửLý]-[dd/mm/yy]-[dd/mm/yy]`
- Một ngăn có thể cung cấp mủ cho nhiều lô thành phẩm

### UI Pattern

- View dạng **card grid** (3 cột), không phải bảng
- Card header màu theo trạng thái (xanh = đang SX, xanh dương = hoàn thành, xám = khác)
- Mỗi card: tên ngăn, mã ngăn, loại NL, nguồn gốc/xử lý, chứng nhận, KL tươi/khô, KL thành phẩm/quy khô ngăn kèm phần trăm, thanh tiến độ ủ
- Modal add/edit: form 2 cột

---

## Module: Thành phẩm (`lots`)

### Schema

```typescript
{
  id: UUID,
  factory_id: UUID,
  ma_lo: string,        // "144cs/26" = num + suffix + "/" + year
  num: number,          // Số thứ tự lô
  suffix: string,       // "cs"=nội tuyển PEFC, "m"=mua ngoài, "gca"=gia công
  year: string,         // "26" (2 chữ số cuối năm)
  ngay_sx: date,
  ca: string,           // "A" | "B" | "C" | "D"
  ngan_id: UUID,        // FK → ngans
  loai_csr: string,     // "CSR10" | "CSR20" | "CSRL" | "CSR3L" | "CSR5" | "CSRCV50" | "CSRCV60"
  loai_banh: number,    // Trọng lượng 1 bành (kg), thường = 35
  boc: string,          // Loại bọc nhãn
  tham: string,         // "Củ" | "Mới"
  pallet: string[],     // ["Sắt đế gỗ","Sắt mỏng"]
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

```typescript
const handleSave = async () => {
  if (!factoryId) return;
  setSaving(true);
  if (editId) {
    await supabase.from("table").update(payload).eq("id", editId);
  } else {
    await supabase.from("table").insert({ ...payload, factory_id: factoryId });
  }
  setSaving(false);
  setModal(null);
  loadData(factoryId);
};
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

## Roadmap

### Phase A — Fix & Polish

- Redirect sau login đúng route
- Copyright footer
- Browser compatibility check

### Phase B — Dashboard Nâng cấp

- Charts (biểu đồ sản lượng, KL theo tháng)
- Responsive mobile
- Dark mode

### Phase C — Tính năng mới

- Excel import/export
- GeoJSON map (416 lô vườn, 12 đội)
- Báo cáo tổng hợp

---

## Bảng tiêu chuẩn kiểm nghiệm

### TCCS 112:2022 (có kiểm DR - độ lệch)

| Loại     | Tạp chất | Tro | Bay hơi | Bay hơi DR | Nitơ | Nitơ DR | Po min | Po DR | PRI min | PRI TB | PRI DR | Mooney | Màu | Màu DR |
| -------- | -------- | --- | ------- | ---------- | ---- | ------- | ------ | ----- | ------- | ------ | ------ | ------ | --- | ------ |
| CSR-L    | 0.02     | 0.4 | 0.7     | 0.1        | 0.5  | 0.06    | 35     | 8     | 60      | 70     | 10     | —      | ≤4  | 1      |
| CSR-3L   | 0.03     | 0.4 | 0.7     | 0.1        | 0.5  | 0.06    | 35     | 8     | 60      | 70     | 10     | 73-93  | ≤6  | 1      |
| CSR-5    | 0.04     | 0.5 | 0.7     | 0.1        | 0.5  | 0.06    | 30     | —     | 60      | 70     | 10     | —      | —   | —      |
| CSR-CV50 | 0.02     | 0.4 | 0.7     | 0.1        | 0.5  | 0.06    | —      | —     | 60      | 70     | 10     | 45-55  | —   | —      |
| CSR-CV60 | 0.02     | 0.4 | 0.7     | 0.1        | 0.5  | 0.06    | —      | —     | 60      | 70     | 10     | 55-65  | —   | —      |
| CSR-10   | 0.07     | 0.6 | 0.7     | 0.1        | 0.5  | 0.06    | 30     | 8     | 50      | 60     | 10     | 73-93  | —   | —      |
| CSR-20   | 0.15     | 0.7 | 0.7     | 0.1        | 0.5  | 0.06    | 30     | 8     | 40      | 50     | 10     | —      | —   | —      |

> **TCCS đặc trưng:** Kiểm DR (độ lệch max-min) cho Bay hơi, Nitơ, Po, PRI. Tạp chất dùng X̄+3SD.

---

### TCVN 3769:2016 (không kiểm DR)

| Loại     | Tạp chất | Tro | Bay hơi | Nitơ | Po min | PRI min | PRI TB | Mooney | Màu |
| -------- | -------- | --- | ------- | ---- | ------ | ------- | ------ | ------ | --- |
| CSR-L    | 0.02     | 0.4 | 0.8     | 0.6  | 35     | 60      | 70     | —      | ≤4  |
| CSR-3L   | 0.03     | 0.5 | 0.8     | 0.6  | 35     | 60      | 70     | 73-93  | ≤6  |
| CSR-5    | 0.05     | 0.6 | 0.8     | 0.6  | 30     | 60      | 70     | —      | —   |
| CSR-CV50 | 0.02     | 0.4 | 0.8     | 0.6  | —      | 60      | 70     | 45-55  | —   |
| CSR-CV60 | 0.02     | 0.4 | 0.8     | 0.6  | —      | 60      | 70     | 55-65  | —   |
| CSR-10   | 0.08     | 0.6 | 0.8     | 0.6  | 30     | 50      | 60     | 73-93  | —   |
| CSR-20   | 0.16     | 0.8 | 0.8     | 0.6  | 30     | 40      | 50     | —      | —   |

> **TCVN đặc trưng:** Không kiểm DR. Bay hơi giới hạn cao hơn (0.8 vs 0.7). Nitơ cao hơn (0.6 vs 0.5). Tạp chất CSR-10 cao hơn (0.08 vs 0.07).

---

### So sánh TCCS vs TCVN

| Chỉ tiêu         | TCCS   | TCVN       | Ghi chú           |
| ---------------- | ------ | ---------- | ----------------- |
| Bay hơi giới hạn | 0.7    | 0.8        | TCVN nới lỏng hơn |
| Bay hơi DR       | ≤ 0.1  | Không kiểm | TCCS chặt hơn     |
| Nitơ giới hạn    | 0.5    | 0.6        | TCVN nới lỏng hơn |
| Nitơ DR          | ≤ 0.06 | Không kiểm | TCCS chặt hơn     |
| Po DR            | ≤ 8    | Không kiểm | TCCS chặt hơn     |
| PRI DR           | ≤ 10   | Không kiểm | TCCS chặt hơn     |
| CSR-10 tạp chất  | 0.07   | 0.08       | TCVN nới lỏng hơn |
| CSR-20 tạp chất  | 0.15   | 0.16       | TCVN nới lỏng hơn |

---

### Tiêu chuẩn khách hàng (TCKH)

- Tạo từ TCCS làm base, có thể chỉnh từng chỉ tiêu
- Lưu trong bảng `qc_custom_std` với key = `"KH_" + tenKhachHang`
- Ví dụ: `KH_KUMHO` cho KUMHO TIRES
- Có lịch sử chỉnh sửa (`history[]`)
- Trong form kiểm nghiệm: dropdown hiện `TCCS | TCVN | KH_KUMHO | ...`

---

### Logic grading engine (áp dụng cho cả TCCS và TCVN)

```typescript
// Tạp chất & Tro: X̄ + 3SD ≤ giới hạn
const x3sd = mean + 3 * stdDev;
dat = x3sd <= limit;

// Bay hơi & Nitơ:
dat =
  max <= limit && // luôn kiểm
  (hasRange ? dr <= dr_limit : true); // kiểm DR chỉ với TCCS/TCKH

// Po:
dat = min >= po_min && (hasRange && po_dr ? dr <= po_dr : true);

// PRI:
dat =
  mean >= pri_tb && // TB ≥ giới hạn TB
  min >= pri_min && // Min ≥ giới hạn min
  (hasRange ? dr <= pri_dr : true);

// Mooney:
dat = min >= ml_min && max <= ml_max; // nằm trong khoảng

// hasRange = true khi tieu_chuan === "TCCS" hoặc bắt đầu bằng "KH_"
// hasRange = false khi tieu_chuan === "TCVN"
```
