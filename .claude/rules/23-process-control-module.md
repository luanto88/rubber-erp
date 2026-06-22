# Module Kiểm soát quá trình (`/dashboard/process`)

## Phạm vi

Module theo dõi hai luồng dữ liệu in-process song song:

1. **Thông số kỹ thuật** — nhiệt độ, thời gian sấy thay đổi trong ngày (tự do nhiều lần/ngày).
2. **Đo nhanh chỉ tiêu** — đo Po/Mooney nhanh tại dây chuyền, xuất phiếu PDF có ảnh thực tế.

Dữ liệu từ cả hai tab được thống kê xu hướng trên tab Tổng quan bằng biểu đồ Recharts.

Route: `/dashboard/process`
Permissions: `process.view`, `process.create`, `process.edit`, `process.delete`, `process.print`
Tất cả bảng có `factory_id`, mọi query filter theo `factory_id`.

---

## Migration

File: `supabase/migrations/20260619_process_control.sql`

Tạo 3 bảng, RLS policies và permissions. Phải chạy thủ công trong Supabase SQL Editor trước khi module hoạt động.

---

## Bảng dữ liệu

### `process_params` — Thông số kỹ thuật

```sql
id              UUID PK DEFAULT gen_random_uuid()
factory_id      UUID NOT NULL
ngay            DATE NOT NULL
day_chuyen      TEXT NOT NULL          -- "Mủ tạp" | "Mủ nước"
nhiet_do_dau_1  NUMERIC                -- nhiệt độ đầu ướt (°C)
nhiet_do_dau_2  NUMERIC                -- nhiệt độ đầu khô (°C)
thoi_gian_say   NUMERIC                -- phút
ghi_chu         TEXT                   -- lý do thay đổi
logged_by       UUID REFERENCES auth.users
created_at      TIMESTAMPTZ DEFAULT now()
```

Nhiều bản ghi/ngày là hợp lệ — mỗi lần thay đổi thông số tạo một bản ghi riêng.

### `quick_measurements` — Header phiếu đo nhanh

```sql
id              UUID PK DEFAULT gen_random_uuid()
factory_id      UUID NOT NULL
ma_phieu        TEXT                   -- MT-ddmmyy/XXX hoặc MN-ddmmyy/XXX
ngay            DATE NOT NULL
day_chuyen      TEXT
chung_loai      TEXT                   -- "Mủ tạp" | "Mủ nước"
loai_csr        TEXT                   -- "10" | "20" | "L" | "3L" | "CV50" | "CV60"
created_by      UUID REFERENCES auth.users
created_at      TIMESTAMPTZ DEFAULT now()
```

### `quick_measurement_rows` — Dòng đo chi tiết

```sql
id              UUID PK DEFAULT gen_random_uuid()
sheet_id        UUID REFERENCES quick_measurements ON DELETE CASCADE
factory_id      UUID NOT NULL
so_mau          INTEGER
chi_tieu        TEXT[]                 -- ["Po", "Mo"] — list chỉ tiêu đã chọn
thung           TEXT                   -- số thùng (nhập tay)
lo              TEXT                   -- số lô (nhập tay)
mau             TEXT                   -- số mẫu (nhập tay)
che_do_say      TEXT                   -- ví dụ "122-119-9.5"
ca_sx           TEXT
ngan_id         UUID REFERENCES ngans  -- chỉ Mủ tạp
so_ngay_luu     INTEGER                -- ngay_do - ngan.ngay_bd (integer days)
ket_qua         JSONB                  -- {"Po": 42, "Mo": 84}
image_urls      TEXT[]                 -- tối đa 6 ảnh
nguoi_do        TEXT                   -- snapshot tên người đo
ghi_chu         TEXT
sort_order      INTEGER
created_at      TIMESTAMPTZ DEFAULT now()
```

Quan hệ: `quick_measurement_rows` CASCADE DELETE khi xóa `quick_measurements`.

---

## Quy tắc nghiệp vụ

### Mã phiếu đo nhanh

Format: `{PREFIX}-{ddmmyy}/{XXX}` — đếm tuần tự theo `(factory_id, ngay, prefix)`.

- `chung_loai = "Mủ tạp"` → prefix `MT`
- Còn lại → prefix `MN`

Counter: query `quick_measurements` LIKE `{prefix}-{ddmmyy}/%` để đếm số phiếu đã có cùng ngày + prefix, lấy `count + 1` làm số thứ tự mới.

```typescript
// getMaPhieuPrefix() trong process-types.ts
"Mủ tạp" → "MT"
else      → "MN"
```

### Chỉ tiêu cố định theo loại CSR

```typescript
// CHI_TIEU_BY_CSR trong process-types.ts
"10"  → ["Po", "Mo"]
"20"  → ["Po", "Mo"]
"L"   → ["Po", "Màu sắc"]
"3L"  → ["Po", "Màu sắc"]
"CV50"→ ["Po", "Mo"]
"CV60"→ ["Po", "Mo"]
```

- Khi toggle bỏ chỉ tiêu, phải xóa key tương ứng trong `ket_qua` để tránh stale data.
- Không được thêm chỉ tiêu tùy ý ngoài danh sách trên.

### Ngăn lưu (Mủ tạp)

- Picker ngăn chỉ hiện khi `chung_loai = "Mủ tạp"`.
- Dùng cùng filter với module Thành phẩm: `isProductSelectableStorageStatus(trang_thai) AND tong_kho > 0`.
- `so_ngay_luu = ngay_do - ngan.ngay_bd` (integer days, tính bằng `calcSoNgayLuu()`).
- Thay đổi ngăn hoặc ngày → phải tính lại `so_ngay_luu` ngay lập tức.

### Upload ảnh

- Bucket: `order-files`
- Path: `{factory_id}/process/{Date.now()}_{random}.{ext}`
- Tối đa 6 ảnh mỗi dòng đo.
- Dùng shared hidden `<input type="file" multiple>` + `activeRowRef` — giống pattern của bảo trì.

---

## Cấu trúc file

```
src/app/dashboard/process/
  page.tsx                         -- Tab Tổng quan: KPI + 2 biểu đồ Recharts
  params/page.tsx                  -- Tab Thông số kỹ thuật: CRUD bảng
  measurements/page.tsx            -- Tab Đo nhanh chỉ tiêu: tạo/xem phiếu
  print/page.tsx                   -- Trang in (bypass sidebar, ?sheetId=uuid)
  _components/
    process-shell.tsx              -- Shell 3 tab (teal color scheme)
    process-types.ts               -- Types, constants, helpers
```

---

## Tab Tổng quan (`page.tsx`)

- Bộ lọc: Từ ngày (mặc định -30 ngày), Đến ngày, Dây chuyền, Chủng loại.
- **3 KPI cards**: Số phiếu đo, Po trung bình, Nhiệt độ đầu ướt gần nhất.
- **Biểu đồ nhiệt độ** (LineChart): `T1_{dc}` solid và `T2_{dc}` dashed cho từng dây chuyền. Dùng `<Fragment key={dc}>` khi render nhiều `<Line>` trong một `.map()`.
- **Biểu đồ chất lượng** (LineChart): Po (teal) và Mooney (blue dashed) trung bình theo ngày.
- Trục X dùng `toLabel(ngay)` → format `dd/mm`.

### Lưu ý Recharts

- Import `Fragment` từ `react` khi render nhiều component trong `.map()` — fragments ẩn danh `<>` không hỗ trợ `key`.
- Tooltip formatter: không annotate explicit type để tránh lỗi TypeScript: `formatter={(v) => \`${v}°C\`}`.

---

## Tab Thông số kỹ thuật (`params/page.tsx`)

- Nhiều bản ghi/ngày là bình thường — không chặn trùng ngày + dây chuyền.
- Modal thêm/sửa: Ngày, Dây chuyền (select), Nhiệt độ đầu ướt, Nhiệt độ đầu khô, Thời gian sấy, Ghi chú.
- Xóa: confirm dialog trước khi delete.

---

## Tab Đo nhanh chỉ tiêu (`measurements/page.tsx`)

### View states

- `"list"` → danh sách phiếu + bộ lọc
- `"create"` → form tạo phiếu mới
- `"view"` → xem chi tiết phiếu đã lưu

### Luồng tạo phiếu

1. Nhập header: Ngày, Dây chuyền, Chủng loại, Loại CSR → preview mã phiếu.
2. Thêm dòng đo: toggle chỉ tiêu → nhập kết quả động theo chỉ tiêu đã chọn.
3. Lưu: insert header vào `quick_measurements` trước, rồi insert tất cả rows vào `quick_measurement_rows`.

### UX nâng cao (2026-06-22)

- **Dropdown ngăn lưu**: helper `shortNganStatus(trang_thai)` hiển thị trạng thái rút gọn (Chờ SX, Đang SX, Đã SX). Option text: `{ma_ngan} – {ten_ngan} ({shortNganStatus} · {tong_kho} kg)`.
- **Gợi ý ngăn gần nhất**: `openCreate()` là async — query `lots.ngan_id` lấy lô tạo gần nhất của nhà máy, pre-fill `rows[0].ngan_id` nếu ngăn đó còn trong `selectableNgans`.
- **OCR Camera Po/Mo**: nút Camera lucide cạnh mỗi input kết quả thuộc chỉ tiêu `Po` hoặc `Mo`. Click → trigger hidden `<input type="file" accept="image/*">` qua `ocrFileInputRef`. Upload ảnh → đọc base64 → POST `/api/process/ocr-image` → auto-fill giá trị + upload ảnh vào Storage bucket `order-files`. State `ocrLoadingKey: string | null` (key = `rowId-chiTieu`) hiện spinner animation khi đang OCR.
- **Lightbox ảnh**: click thumbnail bất kỳ (cả view mode lẫn create mode) → `zoomImageUrl` state → overlay `fixed inset-0 z-[100] bg-black/80` phóng to ảnh toàn màn hình; click ngoài hoặc nút × để đóng.
- **OCR API route**: `src/app/api/process/ocr-image/route.ts` — POST `{ imageBase64, mimeType, chiTieu }` → Gemini `gemini-1.5-flash` Vision → `{ value: number }`. Cần `GEMINI_API_KEY` trong env.

### MeasurementRowDraft

UI dùng `MeasurementRowDraft` (dùng `ket_qua: Record<string, string>` để lưu input string trước khi parse float khi save).

```typescript
type MeasurementRowDraft = {
  id: string          // temp UUID cho React key
  chi_tieu: string[]
  thung, lo, mau, che_do_say, ca_sx: string
  ngan_id: string
  so_ngay_luu: number | null
  ket_qua: Record<string, string>   // string khi nhập, parse float khi save
  image_urls: string[]
  nguoi_do, ghi_chu: string
}
```

---

## Trang in (`print/page.tsx`)

- Bypass sidebar: `dashboard/layout.tsx` kiểm tra `pathname.includes("/print")` → render `{children}` trực tiếp.
- Query params: `?sheetId={uuid}`.
- Auto-print: `setTimeout(() => window.print(), 600)` sau khi load xong.
- CSS: `@page { size: A4; margin: 12mm 10mm; }`

### Layout phiếu in

- **Header đỏ đậm** (`background: #c00`): "PHIẾU ĐO NHANH CHỈ TIÊU NGÀY {dd/mm/yy}" + mã phiếu.
- Dòng meta: Ngày test, Dây chuyền, Chủng loại, Loại CSR.
- **Bảng động**: cột chỉ tiêu suy ra từ `[...new Set(sheet.rows.flatMap(r => r.chi_tieu))]`.
- Cột ngăn lưu chỉ render khi `hasNgan = sheet.rows.some(r => r.ngan_id)`.
- Cột hình ảnh chỉ render khi `hasImages = sheet.rows.some(r => r.image_urls?.length > 0)`.
- Ảnh thumbnail: 40×40px, dùng `<Image unoptimized>` (Next.js Image).
- Màu xen kẽ hàng: `#fff` / `#f8fafc`.

---

## Shell (`process-shell.tsx`)

- Color scheme: `bg-teal-50`, `text-teal-700`, `border-teal-200`.
- 3 tab: Tổng quan (exact match `/dashboard/process`), Thông số kỹ thuật, Đo nhanh chỉ tiêu.
- Tab Tổng quan dùng exact match vì `/dashboard/process/params` và `/dashboard/process/measurements` là prefix của cùng một root.

---

## Sidebar navigation

Entry thêm vào `src/app/dashboard/layout.tsx`:

```typescript
{ key: "/dashboard/process", label: "Kiểm soát quá trình", icon: Activity, permission: "process.view" }
```

Đặt sau entry `maintenance`.

---

## Quy tắc quan trọng

- Không hard-code danh sách chỉ tiêu ngoài `CHI_TIEU_BY_CSR` trong `process-types.ts`.
- `ket_qua` JSONB lưu số thực — parse `parseFloat()` trước khi insert, không lưu string.
- Xóa phiếu (`quick_measurements`) → CASCADE tự xóa tất cả `quick_measurement_rows` liên quan.
- Không dùng `localStorage` cho dữ liệu nghiệp vụ.
- Mọi query phải filter `factory_id`.
