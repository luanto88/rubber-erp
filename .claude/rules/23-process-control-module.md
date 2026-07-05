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

## OCR Po/Mo — model đã fix (2026-07-04)

- Route: `src/app/api/process/ocr-image/route.ts`
- Model đã đổi từ `gemini-1.5-flash` (đã bị Google gỡ bỏ, trả 404) sang **`gemini-2.5-flash-lite`** — lý do đầy đủ và cách phát hiện quota xem `.claude/rules/08-module-export.md` mục "OCR biển số xe (2026-07-04)" (cùng nguyên nhân gốc: `gemini-2.5-flash` chỉ có 20 request/ngày free-tier, `gemini-1.5-flash`/`gemini-2.0-flash` đã bị gỡ/quota=0).
- Đã thêm `generationConfig.thinkingConfig: { thinkingBudget: 0 }` — bắt buộc với mọi model `gemini-2.5-*` để tránh bị tiêu hết `maxOutputTokens` cho suy luận nội bộ.
- Đây chỉ là fix hạ tầng (model + quota); prompt đọc số Po/Mo đã được hiệu chỉnh theo ảnh thật ở mục dưới.

## Cải tiến OCR Po/Mo + UX form đo nhanh (2026-07-04, đã hoàn tất)

### Prompt Po/Mo đã hiệu chỉnh theo ảnh thiết bị thật

Ảnh tham khảo trong repo: `cung_cap_dl/dn.jpg` (Wallace MK III Mooney Viscometer), `cung_cap_dl/po.jpg` (Wallace Rapid Plastimeter).

- `dn.jpg`: LCD xanh lá 2 dòng — dòng 1 là nhãn tĩnh `"* Mooney *"`, dòng 2 là số liệu thật (`82.0` bên trái + số phụ đếm/timer bên phải cần bỏ qua). Panel còn có 2 màn hình nhiệt độ riêng ("upper platen"/"lower platen", vd `100.3`) — không phải giá trị Mo, dễ bị OCR nhầm nếu prompt không loại trừ rõ.
- `po.jpg`: LCD xanh dương hiển thị thẳng `39.0` (đã là số thập phân có dấu chấm, không phải số nguyên cần chia 10).
- `PROMPTS` trong `ocr-image/route.ts` đã viết lại để mô tả đúng layout 2 dòng của Mooney (loại trừ số phụ bên phải + 2 màn nhiệt độ khác) và để Po tự phân biệt: có dấu chấm thập phân thì giữ nguyên, số nguyên không dấu chấm mới chia 10.
- **Chưa verify được bằng script Node gọi thẳng Gemini** trong phiên 2026-07-04: quota free-tier `gemini-2.5-flash-lite` (20 request/ngày/project, xem `feedback_ocr_gemini_model` trong memory) đã cạn từ các lần test OCR khác trong cùng ngày, script test (`node --env-file=.env.local` gọi trực tiếp REST API với 2 ảnh mẫu) liên tục nhận `429 RESOURCE_EXHAUSTED` dù đã retry với backoff dài. Prompt được viết dựa trên soát xét trực quan chính xác nội dung 2 ảnh mẫu (đọc từng pixel LCD), nhưng **phiên sau nên chạy lại script test này khi quota đã reset** để xác nhận Gemini thực sự trả đúng `Po = 39` và `Mo = 82` trước khi yên tâm hoàn toàn.

### UX form đo nhanh (`measurements/page.tsx`) — đã áp dụng

1. Mặc định khi bấm "Tạo phiếu mới": `Dây chuyền = "Mủ tạp"`, `Loại CSR = "10"`, dòng đo đầu tiên tick sẵn `chi_tieu = ["Po", "Mo"]` (theo `CHI_TIEU_BY_CSR["10"]`). Nút "Thêm dòng" (`addRow`) cũng tick sẵn theo `chiTieuForCsr` của `formLoaiCsr` hiện tại.
2. `emptyMeasurementRow(defaultNguoiDo, defaultCheDo, defaultChiTieu)` trong `process-types.ts` nhận thêm tham số thứ 3 để tick sẵn chỉ tiêu và khởi tạo sẵn key rỗng trong `ket_qua`.
3. **Người đo**: bootstrap đổi sang `hydrateActiveSession()` (không đọc `localStorage.erp_user` trực tiếp) để lấy `full_name`/`username` thật của session; input "Người đo" trong `MeasurementRowForm` đổi thành `readOnly`, nền xám, không cho sửa tay.
4. **Ngăn lưu gợi ý**: nguồn gợi ý đổi từ `lots.created_at` (thời điểm tạo bản ghi lô, có thể rất cũ) sang `lot_transactions.created_at` (thời điểm nhập liệu thật gần nhất ở module Thành phẩm), join `lots!inner(factory_id)` để lọc đúng nhà máy — cùng pattern đã dùng trong `src/lib/storage-detail.ts`.
5. **Layout desktop**: Row 1 (Chỉ tiêu/Thùng/Lô/Mẫu/Chế độ sấy/Ca SX) và Row 2 (Kết quả từng chỉ tiêu/Ngăn lưu/Người đo/Ghi chú) trong `MeasurementRowForm` đổi từ `flex flex-wrap` + width cố định (`w-24`, `w-36`...) sang CSS grid `grid-cols-2 md:grid-cols-3 xl:grid-cols-6` (row 1) / `...xl:grid-cols-5` (row 2) — cùng breakpoint chuyển 2→3 cột ở `md` như card "Thông tin phiếu" phía trên, mở rộng thêm ở `xl` cho màn hình lớn.
6. **OCR điền thẳng, không banner xác nhận**: giữ nguyên nguyên tắc đã có — `handleOcrUpload` set thẳng `ket_qua`/`image_urls` vào state ngay khi Gemini trả kết quả; chỉ thêm toast xanh góc dưới phải tự tắt sau 3s ("Đã tự điền {chỉ tiêu} = {giá trị} từ ảnh"), theo đúng pattern `showToast` của module Xuất hàng.
7. **Hợp nhất 2 khối upload ảnh thành 1**: đã bỏ icon Camera OCR riêng cạnh từng ô "Kết quả {ct}". Chỉ còn 1 khối "Hình ảnh / OCR (tối đa 6)" ở dưới — bấm vào ô "+": nếu dòng đo chưa chọn chỉ tiêu nào thì mở picker ảnh thường; nếu đã chọn ít nhất 1 chỉ tiêu thì mở popover cho chọn "OCR ảnh {ct}" (theo từng chỉ tiêu đang tick) hoặc "Ảnh khác (không OCR)".
8. **Chia sẻ ảnh nhanh**: thêm nút `Share2` trong bảng danh sách phiếu (`measurements/page.tsx`, cạnh icon `Printer`) — gom toàn bộ `image_urls` của mọi dòng trong phiếu (tối đa 6 ảnh), tải blob rồi dùng `navigator.share({ files })` (Web Share API), fallback tải file trực tiếp nếu trình duyệt không hỗ trợ. Không cần mở trang in trước.

`npx tsc --noEmit` và `npx eslint` đã chạy sạch trên các file đã sửa (`ocr-image/route.ts`, `measurements/page.tsx`, `process-types.ts`).

## OCR Po/Mo — tự nhận dạng thiết bị, upload nhiều ảnh cùng lúc (2026-07-04, bổ sung)

Sau phản hồi thực tế của người dùng: khi 1 dòng đo chọn cả 2 chỉ tiêu Po + Mo (mặc định), người dùng muốn chọn 2 ảnh (1 ảnh Po, 1 ảnh Mo) trong **cùng một lần bấm upload**, AI tự nhận dạng ảnh nào là thiết bị nào và điền đúng — không bắt người dùng chọn trước từng chỉ tiêu rồi upload riêng lẻ từng ảnh.

- **API đã đổi hoàn toàn sang tự nhận dạng**: `POST /api/process/ocr-image` không còn nhận `chiTieu` trong body. Body chỉ còn `{ imageBase64, mimeType }`. Response: `{ chiTieu: "Po" | "Mo", value: number } | { error }`.
- `AUTO_PROMPT` duy nhất mô tả cả 2 thiết bị (Rapid Plastimeter cho Po, Mooney Viscometer cho Mo) và yêu cầu Gemini tự xác định ảnh thuộc thiết bị nào trước khi trích số, trả về đúng 1 dòng dạng `LABEL:VALUE` (vd `"Po:39.0"`, `"Mo:82.0"`) để parse bằng regex `/(Po|Mo)\s*:\s*(-?[0-9]+(?:\.[0-9]+)?)/i`.
- Client (`measurements/page.tsx`) chỉ còn **1 hàm OCR duy nhất**: `handleOcrAutoUpload(files: FileList, rowId)` — nhận nhiều file cùng lúc, gọi Gemini song song (`Promise.all`) cho từng ảnh, mỗi ảnh tự trả về chỉ tiêu đã nhận dạng + giá trị.
  - Ảnh luôn được upload lên Storage dù OCR có nhận dạng được hay không (không mất ảnh hiện trường).
  - Chỉ tiêu nhận dạng được nhưng dòng đo chưa tick sẵn thì **tự động tick thêm** vào `row.chi_tieu` (không chặn, không bắt phải tick trước).
  - Toast xanh báo tổng hợp tất cả chỉ tiêu đã điền trong 1 lượt (vd "Đã tự nhận dạng và điền Po=39, Mo=82 từ ảnh"); ảnh không nhận dạng được thì liệt kê tên file trong banner đỏ, không chặn các ảnh còn lại.
- **Đã xóa hoàn toàn** code đường dẫn cũ (chọn từng chỉ tiêu rồi mới OCR 1 ảnh): `PROMPTS` (Po/Mo riêng), `onOcrImage`, `ocrFileInputRef`, `ocrActiveRef`, `handleOcrUpload`. Không giữ lại làm dead code.
- Popover khi bấm ô "+" trong khối "Hình ảnh / OCR" (chỉ hiện khi `row.chi_tieu.length > 0`) giờ chỉ còn 2 lựa chọn: **"OCR ảnh (chọn nhiều ảnh cùng lúc, AI tự nhận dạng)"** (input `multiple`) và **"Ảnh khác (không OCR)"**.
- Vẫn giữ nguyên tắc **điền thẳng, không banner xác nhận** — chỉ khác là giờ điền cho nhiều chỉ tiêu trong 1 lượt thay vì 1 chỉ tiêu/lần.
- **Verify bằng script Node vẫn đang bị chặn bởi quota** (xem mục "Chưa verify được..." phía trên) — quota `gemini-2.5-flash-lite` chưa reset trong suốt phiên 2026-07-04, đã thử retry với backoff dài (tới 13+ lần, giãn cách tới 5 phút) vẫn `429 RESOURCE_EXHAUSTED`. Phiên sau cần chạy lại script test khi quota đã reset.

## Sửa phiếu đã có + Thêm mẫu vào phiếu (nhiều người đo chung 1 phiếu) — 2026-07-04

Trước đây danh sách phiếu đo nhanh chỉ có Xem/In/Xóa — không sửa được phiếu đã lưu, và mỗi lần muốn đo thêm phải tạo phiếu mới (dù cùng ngày, cùng dây chuyền, cùng loại CSR). Đã bổ sung 2 luồng mới, dùng lại chung 1 form với `measurements/page.tsx`:

### Phân quyền (permission có sẵn từ `20260619_process_control.sql`: `process.create`, `process.edit`)

- `canCreate = hasPermission(currentUser, "process.create")` — quyết định hiện nút "Tạo phiếu mới" (header) và nút "Thêm" (mỗi dòng phiếu trong danh sách). Không yêu cầu là người tạo phiếu — đúng nghiệp vụ "1 phiếu trong ngày nhiều mẫu có thể nhiều người đo".
- `canEditSheet(sheet) = currentUser?.role === "admin" || (hasPermission(currentUser, "process.edit") && sheet.created_by === currentUser.id)` — quyết định hiện nút "Sửa" (Pencil) trên từng dòng. Admin luôn sửa được mọi phiếu; user thường chỉ sửa được phiếu do chính mình tạo.
- Phiếu tạo trước khi có `created_by` (dữ liệu cũ) sẽ có `created_by = null` → chỉ admin sửa được, user thường (kể cả người thực tế đã tạo) không sửa được nữa vì không có cách xác định lại chủ sở hữu — đây là giới hạn chấp nhận được của dữ liệu lịch sử, không phải bug.
- Nút "Xóa" (Trash2) giữ nguyên không gate quyền — chưa nằm trong yêu cầu, không tự ý thêm.

### "Sửa" — chỉnh sửa toàn bộ phiếu đã có

- `openEdit(sheet)`: load lại tất cả `quick_measurement_rows` của phiếu, map sang `MeasurementRowDraft` qua `rowToDraft()` (giữ nguyên `id` thật của dòng DB để phân biệt với dòng mới thêm trong form, giữ nguyên `nguoi_do` gốc — **không** ghi đè bằng tên người đang sửa).
- Header (Ngày/Dây chuyền/Loại CSR) vẫn editable như lúc tạo mới; `ma_phieu` giữ nguyên, không sinh lại.
- `handleSave` nhánh sửa: UPDATE header `quick_measurements`; so `existingRowIds` (chụp lúc mở form) với id còn lại trong `rows` để tính `removedIds` → DELETE các dòng bị xóa khỏi form; dòng có id nằm trong `existingRowIds` → UPDATE; dòng còn lại (id mới sinh bởi `emptyMeasurementRow`) → INSERT. `sort_order`/`so_mau` được đánh lại theo vị trí hiện tại trong `rows`.

### "Thêm" — thêm mẫu mới vào phiếu đã có, không đụng dữ liệu cũ

- `openAddRows(sheet)`: header hiển thị **read-only** (không phải input) lấy từ phiếu gốc — không cho đổi Ngày/Dây chuyền/CSR vì mục đích chỉ là bổ sung mẫu cùng bối cảnh với phiếu đã có. `rows` khởi tạo chỉ 1 dòng trắng mới (gợi ý ngăn + chỉ tiêu như tạo mới), **không load dòng cũ**.
- `handleSave` nhánh này: chỉ INSERT các dòng trong `rows` (toàn bộ đều là dòng mới), `sort_order`/`so_mau` nối tiếp từ `existingRowCount` (đếm số dòng đã có của phiếu tại thời điểm mở form) — không UPDATE/DELETE gì ở header hay dòng cũ.
- `nguoi_do` của dòng mới vẫn tự điền theo người đang thao tác (đúng nghiệp vụ: người khác đo thêm thì đứng tên người đó), độc lập với người đã tạo phiếu ban đầu.

### Helper dùng chung

- `rowToDraft(row: QuickMeasurementRow): MeasurementRowDraft` — nạp dòng DB vào form sửa.
- `rowDraftToFields(row)` / `rowDraftToPayload(row, sheetId, factoryId, sortOrder)` — chuẩn hoá field ghi DB, dùng chung cho cả 3 nhánh insert/update của `handleSave` (tạo mới, sửa, thêm mẫu) để tránh lặp code 3 nơi.
- `resetEditingState()` — reset `editingSheetId/editingSheet/addRowsMode/existingRowIds/existingRowCount`, gọi khi mở "Tạo phiếu mới", khi bấm "Quay lại", và sau khi lưu thành công (mọi nhánh).

### UI theo mode (biến `editingSheetId` + `addRowsMode`)

- Tiêu đề: "Tạo phiếu đo nhanh" / "Sửa phiếu đo nhanh" / "Thêm mẫu vào phiếu".
- Badge mã phiếu: mode tạo mới hiện preview (`getMaPhieuPreview`), mode sửa/thêm hiện đúng `editingSheet.ma_phieu` đã có.
- Nút lưu: "Lưu phiếu" / "Lưu thay đổi" / "Thêm mẫu" tương ứng.

### Fix layout Row 1 + Ca SX động theo Thành phẩm (2026-07-04, bổ sung)

- **Bug layout**: Row 1 của dòng đo (`grid xl:grid-cols-6`) có Chỉ tiêu (span 2) + Thùng/Lô/Mẫu/Chế độ sấy/Ca SX (mỗi field 1 cột) = 2+5 = 7 đơn vị cột nhưng lưới chỉ có 6 cột ở `xl` → "Ca SX" tràn xuống dòng riêng, để trống phần lớn dòng đó. Fix: đổi `xl:grid-cols-6` → `xl:grid-cols-7` để đúng 7 đơn vị vừa khít 1 dòng, "Ca SX" nằm cùng dòng với "Chỉ tiêu" như mong đợi.
- **Ca SX không còn hard-code**: đã bỏ hằng số `CA_SX_OPTIONS` (`["Ca 1", "Ca 2 (Ban)", "Ca 2", "Ca 3", "Ban ngày"]`) — không khớp với hệ thống ca thực tế của Thành phẩm. Dropdown "Ca SX" giờ lấy từ `caSxOptions` state, tính bằng cách kiểm tra ca nào (`"A"`, `"B"`, `"C"`) thực sự tồn tại trong `lot_transactions.ca` của nhà máy hiện tại (bảng Thành phẩm dùng chữ cái đơn `"A"/"B"/"C"`, xem `product/page.tsx` `CA_OPTS`), hiển thị dạng `Ca A`, `Ca B`, `Ca C`. Nếu nhà máy chưa từng có giao dịch `ca = "C"` thì dropdown chỉ còn `Ca A`, `Ca B`. Nếu nhà máy hoàn toàn chưa có `lot_transactions` nào (factory mới), fallback mặc định `["Ca A", "Ca B"]`.
- **Kỹ thuật quan trọng**: `loadCaSxOptions(fid)` chạy **3 query `.limit(1)` riêng cho từng ca** (`Promise.all`) thay vì 1 query `select("ca")` không giới hạn rồi tự suy distinct ở client — vì `lot_transactions` là bảng có thể vượt 1000 dòng, PostgREST sẽ âm thầm cắt kết quả ở 1000 dòng nếu không phân trang (xem `.claude/rules/04-code-patterns.md` mục "Phân trang khi query bảng lớn"), có thể làm sai lệch kết luận "nhà máy có dùng Ca C hay không" nếu các dòng có `ca = "C"` nằm ngoài 1000 dòng đầu trả về.
- **Rủi ro dữ liệu cũ cần lưu ý cho session sau**: các phiếu đã lưu trước khi đổi (`ca_sx` mang giá trị cũ như `"Ca 2 (Ban)"`, `"Ca 3"`...) khi mở lại bằng nút "Sửa" sẽ có `<select>` không khớp option nào (hiển thị trống) vì giá trị cũ không còn nằm trong danh sách `caSxOptions` mới. Đây là hệ quả tất yếu của việc đổi chuẩn dữ liệu, không phải bug — nếu người dùng phản ánh, hướng xử lý là chọn lại giá trị đúng theo chuẩn mới, không cố gắng auto-migrate ngược.

### Danh sách phiếu (`sheets` table trong list view)

- Đã bỏ cột "Dây chuyền" đứng riêng (trùng lặp với cột "Dây chuyền / CSR" ngay cạnh).
- Thêm cột "Người đo" — gom `Array.from(new Set(sheet.rows.map(r => r.nguoi_do).filter(Boolean)))`, join bằng dấu phẩy vì 1 phiếu có thể có nhiều người đo khác nhau qua nhiều mẫu.
- Thứ tự nút hành động mỗi dòng: Xem (Eye) → In (Printer) → Chia sẻ (Share2) → Sửa (Pencil, có điều kiện) → Thêm (Plus, có điều kiện) → Xóa (Trash2).

## Fix gợi ý "Chế độ sấy" không phản ánh đúng bản ghi mới nhất (2026-07-05)

### Nguyên nhân

Cột `process_params.loai_csr` được thêm bằng migration sau (`20260619_process_params_loai_csr.sql`), không backfill dữ liệu cũ, và trường "Loại CSR" trên form nhập từng là optional. Trong Postgres `NULL = 'x'` luôn `false`, nên câu query gợi ý cũ (`.eq("loai_csr", formLoaiCsr)`) bỏ sót bản ghi mới nhất của 1 dây chuyền nếu bản ghi đó thiếu CSR, tụt xuống lấy 1 bản ghi cũ hơn.

### Fix: query 2 tầng + cảnh báo, thay vì bỏ hẳn lọc CSR

Nghiệp vụ xác nhận 1 dây chuyền CÓ THỂ chạy chế độ sấy khác nhau tùy Loại CSR, nên không được bỏ hẳn điều kiện lọc CSR (sẽ làm sai gợi ý khi 2 CSR xen kẽ). Thay vào đó, chạy song song 2 query (`Promise.all`) ở cả 2 nơi có cùng pattern:

- `src/app/dashboard/process/measurements/page.tsx` (effect lấy `defaultCheDo`)
- `src/app/dashboard/process/params/page.tsx` (effect `fetchLast`)

1. `csrMatch` — bản ghi mới nhất khớp đúng `factory_id + day_chuyen + loai_csr`.
2. `latestAny` — bản ghi mới nhất của cả dây chuyền, KHÔNG lọc CSR.

Helper dùng chung `resolveCheDoSuggestion(csrMatch, latestAny, formLoaiCsr, formatDateFn)` trong `process-types.ts`:

- Có `csrMatch` → dùng làm giá trị chính thức; nếu `latestAny` mới hơn (so `ngay` rồi `created_at`) và `loai_csr` khác → set cảnh báo nhẹ "Có chế độ mới hơn ngày X ghi nhận cho CSR khác — kiểm tra lại nếu dây chuyền chỉ chạy 1 chế độ."
- Không có `csrMatch` nhưng có `latestAny` → dùng `latestAny` làm fallback, cảnh báo "Chưa có dữ liệu riêng cho CSR X, đang dùng chế độ gần nhất của dây chuyền (ngày Y, CSR Z)."
- Không có cả 2 → rỗng, không cảnh báo.
- Nếu `formLoaiCsr` rỗng (chưa chọn CSR) → bỏ qua toàn bộ logic cảnh báo, chỉ dùng `latestAny` im lặng.

Cảnh báo hiển thị dạng dòng chữ nhỏ màu amber:
- `measurements/page.tsx`: state `cheDoWarning`, hiện ngay dưới card "Thông tin phiếu" (cả 2 biến thể editable và read-only của `addRowsMode`).
- `params/page.tsx`: state `cheDoWarning`, hiện ngay dưới dòng "✓ Thông số sẽ tự điền..." đã có sẵn.

### Bắt buộc chọn Loại CSR khi lưu Thông số kỹ thuật

`params/page.tsx` `handleSave` giờ chặn cứng nếu `!form.loai_csr` (cùng pattern với validate `day_chuyen` đã có) — chặn phát sinh thêm bản ghi `loai_csr = NULL` từ nay về sau. UI vẫn cho phép bấm lại vào chip CSR đang chọn để bỏ chọn khi đang thao tác (không ép cứng ở tầng UI), chỉ chặn tại thời điểm lưu. Nhãn "Loại CSR" đã thêm dấu `*` bắt buộc.

**Lưu ý dữ liệu cũ**: các bản ghi `process_params` có sẵn với `loai_csr = NULL` KHÔNG bị migrate/xóa — vẫn đóng vai trò `latestAny` fallback bình thường, chỉ không còn phát sinh thêm bản ghi NULL mới.

## Redesign chuông thông báo — "Việc cần làm theo module" (2026-07-05)

Chi tiết đầy đủ kiến trúc xem `.claude/rules/24-notification-bell-module-tasks.md`. Tóm tắt phần liên quan module này: khi đang đứng ở `/dashboard/process*`, chuông KHÔNG có section riêng (chưa nằm trong danh sách module được hỗ trợ: ISO, Văn bản, Xuất hàng, Kho vật tư, Chất lượng) — fallback về "Thông báo chung" như các module khác chưa được hỗ trợ.

## Handoff cho session sau (2026-07-04)

Toàn bộ thay đổi trong phiên này (OCR auto-detect đa ảnh, Sửa/Thêm mẫu + phân quyền, fix layout Row 1, Ca SX động) mới chỉ qua `npx tsc --noEmit` + `npx eslint`, **chưa test tay trên trình duyệt thật**. Việc cần làm tiếp:

1. **Verify OCR bằng script Node thật khi quota Gemini đã reset** — quota `gemini-2.5-flash-lite` (20 req/ngày) bị cạn suốt phiên 2026-07-04, đã retry >13 lần với backoff tới 5 phút vẫn `429`. Gọi lại `/api/process/ocr-image` với `cung_cap_dl/po.jpg` (kỳ vọng Po=39) và `cung_cap_dl/dn.jpg` (kỳ vọng Mo=82) để xác nhận `AUTO_PROMPT` hoạt động đúng.
2. **Test tay luồng OCR đa ảnh**: tạo dòng đo có cả Po+Mo, bấm "+" → "OCR ảnh (chọn nhiều ảnh cùng lúc...)" → chọn 2 ảnh cùng lúc, xác nhận cả 2 ô kết quả được điền đúng chỉ tiêu tương ứng; thử thêm 1 ảnh không rõ nội dung để xác nhận vẫn lưu ảnh nhưng báo lỗi nhận dạng đúng, không chặn ảnh còn lại.
3. **Test tay nút Sửa/Thêm theo quyền**: đăng nhập bằng tài khoản không phải admin, không có `process.edit`/`process.create` → xác nhận 2 nút ẩn đúng; tài khoản có quyền nhưng không phải người tạo phiếu → chỉ thấy nút Thêm, không thấy Sửa; admin → thấy cả 2 trên mọi phiếu.
4. **Test tay luồng "Sửa" toàn bộ phiếu**: đổi header (ngày/dây chuyền/CSR), sửa 1 dòng cũ, xóa 1 dòng cũ, thêm 1 dòng mới trong cùng lần sửa → lưu → tải lại danh sách/DB xác nhận đúng cả update/delete/insert, không sót dòng, `sort_order`/`so_mau` liên tục.
5. **Test tay luồng "Thêm mẫu vào phiếu"**: mở từ 1 phiếu đã có nhiều dòng → xác nhận header hiển thị read-only đúng dữ liệu gốc → thêm 1-2 dòng mới → lưu → xác nhận dòng cũ không bị đụng, dòng mới nối tiếp đúng thứ tự, `nguoi_do` của dòng mới là người đang thao tác (không phải người tạo phiếu gốc).
6. **Test tay layout Row 1** (`xl:grid-cols-7`) trên nhiều độ rộng màn hình thật, xác nhận "Ca SX" luôn nằm cùng dòng với "Chỉ tiêu" ở `xl`, không vỡ ở các breakpoint nhỏ hơn.
7. **Test tay dropdown "Ca SX" động**: xác nhận đúng nhà máy đang test có dùng `Ca C` hay không trong Thành phẩm, đối chiếu dropdown hiện đúng 2 hoặc 3 lựa chọn tương ứng.
8. **Mở lại 1 phiếu cũ có `ca_sx` giá trị lịch sử** (`"Ca 2 (Ban)"`, `"Ca 3"`...) qua nút "Sửa" — xác nhận đúng hành vi đã ghi ở trên (dropdown hiển thị trống vì giá trị cũ không khớp option mới); hỏi người dùng nếu cần xử lý thêm, không tự ý migrate.
9. **Cân nhắc (chưa làm, cần hỏi trước)**: nút "Xóa" phiếu (Trash2) hiện chưa gate theo quyền `process.delete` như 2 nút Sửa/Thêm mới thêm — nếu người dùng muốn nhất quán, cần bổ sung; không tự ý thêm vì ngoài phạm vi yêu cầu ban đầu.

## Handoff cho session sau (2026-07-05)

Fix "Chế độ sấy" (query 2 tầng + cảnh báo + bắt buộc CSR) mới qua `npx tsc --noEmit` + `npx eslint`, **chưa test tay trên trình duyệt/DB thật**:

1. Test case có `csrMatch` cũ + `latestAny` mới hơn khác CSR (dữ liệu lịch sử có sẵn `loai_csr = NULL` hoặc CSR khác) → xác nhận cảnh báo amber xuất hiện đúng cả ở `measurements/page.tsx` (dưới card "Thông tin phiếu") và `params/page.tsx` (dưới dòng "✓ Thông số sẽ tự điền...").
2. Test case chưa từng có dữ liệu cho CSR đang chọn (`csrMatch` rỗng) nhưng dây chuyền có dữ liệu CSR khác → xác nhận fallback dùng đúng `latestAny`, cảnh báo đúng nội dung.
3. Test lưu Thông số kỹ thuật không chọn Loại CSR → bị chặn `"Vui lòng chọn Loại CSR."`, không tạo được bản ghi `loai_csr = NULL` mới.
4. Xác nhận việc bấm lại chip CSR đang chọn để bỏ chọn (giữa lúc thao tác, trước khi lưu) vẫn hoạt động bình thường — chỉ chặn ở bước lưu, không chặn ở UI chọn.
