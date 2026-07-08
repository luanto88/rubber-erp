---
description: Module xuất hàng, assignments, EUDR
---

# Module Xuất hàng

## Schema chính (`export_orders`)

```ts
{
  id: UUID,
  factory_id: UUID,
  ma_don: string,
  ngay: date,
  so_thong_bao: string,
  so_hoa_don: string,
  so_hop_dong: string,
  customer_id: UUID,
  chung_loai: string,
  loai_pallet: string,
  loai_banh: number,
  loai_boc: string,
  vehicles: Vehicle[],
  assignments: Assignment[],
  tong_banh: number,
  yeu_cau_chi_tieu: object[],
  files: object[],
}

type Vehicle = {
  id: string,
  loai_xe: string,
  bien_truoc: string,
  bien_sau: string,
  ghi_chu: string,
  image_url_1?: string,
  image_url_2?: string,
  image_url_3?: string,
}
```

## Rule `loai_pallet_xuat`

`du_lieu_nha_may.xlsx` là source cao nhất cho `loai_pallet_xuat`.

Rule chính thức:

- `loai_pallet_xuat` chỉ lọc theo `nhà máy`
- Giá trị mặc định ban đầu lấy từ Excel
- Giá trị mở rộng runtime được lưu vào database theo đúng nhà máy
- UI có nút `+` bên phải ô chọn để thêm mới
- Giá trị thêm mới phải được dùng lại cho lần sau của cùng nhà máy

### NMPHK

- `Rời`
- `Pallet sắt đế gỗ`

### NMCP

- `Rời`
- `PE đế gỗ`
- `PE đế nhựa`
- `Pallet gỗ`
- `MB4`
- `MB5`

## Rule `loai_boc`

- `loai_boc` phải filter theo `nhà máy + dây chuyền + chủng loại`
- Không dùng danh sách chung hard-code cho tất cả nhà máy

## Mã đơn

```ts
ma_don = `XH-${ma_kh}-${so_thong_bao}-${ddmmyy(ngay)}`;
```

- Read-only
- Chỉ auto tạo khi đủ thông tin
- Edit mode giữ nguyên mã đã lưu

## Chọn lô và remaining

- Hiển thị lô có `trang_thai IN ("Hoàn thành", "Xuất hàng")`
- Chỉ đưa lô vào panel nếu còn `remaining > 0`
- `remaining` = tổng số kiện của lô - tổng đã gán trong **TẤT CẢ** đơn khác (kể cả pending, không lọc chỉ approved)
- `lotsExt` useMemo trong `export/page.tsx` tính remaining từ `orders.filter(o => o.id !== editId)` — **không có `.filter(isApproved)`**.
- Nếu bộ lọc lot picker không ra lô, kiểm tra trước tiên:
  - chuỗi `trang_thai` của query có đúng tiếng Việt chuẩn
  - chuỗi `loai_boc`, `loai_pallet`, `chỉ tiêu` có bị sai chính tả hoặc lỗi mã hóa không
  - text tìm kiếm `ma_lo` có đang được normalize đúng không

## Server-side validation khi lưu đơn (2026-06-19)

Kể từ migration `20260619_export_validate_rpc.sql`, `handleSave()` trong `export/page.tsx` **phải gọi RPC `validate_export_assignments` trước khi upsert** `export_orders`.

```typescript
// Trong handleSave(), trước khi upsert
if (form.assignments.length > 0) {
  const { error: validErr } = await supabase.rpc("validate_export_assignments", {
    p_factory_id: factoryId,
    p_exclude_order_id: editId ?? null,
    p_assignments: form.assignments,
  })
  if (validErr) { showToast(validErr.message, "error"); return }
}
```

### Quy tắc RPC `validate_export_assignments`

- Tham số: `p_factory_id UUID`, `p_exclude_order_id UUID` (null khi tạo mới), `p_assignments JSONB`.
- Dùng `CROSS JOIN LATERAL jsonb_array_elements(eo.assignments)` để đếm kiện đã assign trong **tất cả** đơn còn lại (không chỉ approved).
- Raise exception với message tiếng Việt rõ ràng nếu tổng (đã assign + đơn này) vượt `kien_X` của lô.
- `SECURITY DEFINER` — `GRANT EXECUTE TO authenticated`.

## Quan hệ với Thành phẩm

- Xuất hết remaining -> lô chuyển `Xuất hàng`
- Còn remaining -> giữ `Hoàn thành`
- Xóa đơn hàng -> phải tính lại remaining của từng lô
- Nếu lô có hàng khả dụng trở lại sau khi xóa đơn -> quay về `Hoàn thành`

### Rule KN lại từ flow Xuất hàng

- Nếu người dùng kéo 1 lô `rớt hạng` trong form `Xuất hàng`, hệ thống được phép mở flow `Kiểm nghiệm lại`
- Draft form `Xuất hàng` chỉ được lưu tạm bằng `sessionStorage` để giữ UI state; đây không phải source of truth nghiệp vụ
- Sau khi lưu KN lại:
  - nếu flow được mở từ `Xuất hàng` thì quay lại form `Xuất hàng` và khôi phục draft
  - nếu kết quả KN lại `đạt hạng` thì lô đó tự động nằm lại trên đúng xe mà người dùng vừa định kéo vào
  - nếu kết quả vẫn `rớt hạng` thì vẫn quay lại form `Xuất hàng`, giữ draft nhưng không gán lô lên xe
- Nếu người dùng mở `Kiểm nghiệm lại` trực tiếp trong module `Kiểm nghiệm` thì save xong không được tự động quay về form `Xuất hàng`

### Rule đồng bộ khi xóa đơn xuất

- Khi xóa 1 `export_order`, **KHÔNG** update trạng thái lô theo kiểu cứng nhắc
- Bắt buộc reconcile từ `export_orders.assignments` thực tế trong DB:
  - Tính tổng `assigned = sum(kien_a+kien_b+kien_c+kien_d)` của lô đó qua **TẤT CẢ** đơn còn lại trong `factory_id`
  - `assigned > 0 && assigned >= tong_banh` → `Xuất hàng`
  - còn lại → `Hoàn thành`
- Kết quả tính lại phải phản ánh ngay ở module `Thành phẩm` theo hướng đồng bộ 2 chiều
- Tham chiếu implementation: `reconcileLotStatuses` trong `export/page.tsx`

### Rule đồng bộ khi xóa phiếu Kiểm nghiệm (2026-06-30)

Quy tắc reconcile **áp dụng đồng nhất** cho cả thao tác xóa phiếu KN trong `quality/page.tsx`, không chỉ khi xóa đơn xuất.

**Lý do:** `handleDelete` và `handleBulkDelete` ở `quality/page.tsx` trước đây set cứng `trang_thai = "Hoàn thành"` sau khi xóa `qc_results`. Điều này gây ra: nếu lô vẫn còn gán trong đơn xuất, lô sẽ bị downgrade nhầm về "Hoàn thành" dù không có remaining.

**Canonical reconcile pattern** — dùng thống nhất ở `quality/page.tsx`, `export/page.tsx`, và `product/page.tsx` (admin sync):

```typescript
// Sau khi xóa qc_results, thu thập affectedLotIds rồi:
const { data: allOrders } = await supabase
  .from("export_orders")
  .select("assignments")
  .eq("factory_id", factoryId)
const { data: lotsData } = await supabase
  .from("lots")
  .select("id, tong_banh, trang_thai")
  .eq("factory_id", factoryId)
  .in("id", affectedLotIds)
for (const lot of lotsData ?? []) {
  const assigned = (allOrders ?? []).reduce((sum, order) => {
    const assgns = (order.assignments as Array<{lot_id:string;kien_a:number;kien_b:number;kien_c:number;kien_d:number}>) ?? []
    return sum + assgns
      .filter(a => a.lot_id === lot.id)
      .reduce((s, a) => s + (a.kien_a||0) + (a.kien_b||0) + (a.kien_c||0) + (a.kien_d||0), 0)
  }, 0)
  const nextStatus = assigned > 0 && assigned >= Number(lot.tong_banh || 0)
    ? "Xuất hàng"
    : "Hoàn thành"
  if (lot.trang_thai !== nextStatus) {
    await supabase.from("lots").update({ trang_thai: nextStatus }).eq("id", lot.id)
  }
}
```

**Các trường hợp phải áp dụng:**
- `quality/page.tsx` `handleDelete` — xóa 1 phiếu KN
- `quality/page.tsx` `handleBulkDelete` — xóa nhiều phiếu KN cùng lúc
- `export/page.tsx` — khi xóa đơn xuất (`reconcileLotStatuses`)
- `product/page.tsx` `handleSyncAllLotStatuses` — admin batch sync (fix lô bị kẹt do xóa DB trực tiếp)

## Khách hàng

- Có thao tác tạo nhanh trong module `Xuất hàng`
- Đồng thời phải có trang quản trị đầy đủ trong `Cài đặt`

## EUDR

EUDR đã được triển khai, không còn là ý tưởng tương lai.

- Module: `/dashboard/eudr`
- Chuỗi truy xuất chính: `export_orders -> lots -> ngans -> dispatch_entries -> dispatch_delivery_points -> forest_plots`
- Từ `dispatch_entries.rows[].diem_gn` và `phiên`, hệ thống tra `dispatch_delivery_points` theo `factory_id` để suy ra tập mã lô vườn (`ten`)
- Mã `ten` được dùng để lấy polygon từ bảng `forest_plots` (DB) và render bản đồ
- Hỗ trợ QR code, zip file, file đính kèm

### Nguồn dữ liệu lô vườn (forest_plots)

- **Bảng DB**: `forest_plots` — source of truth runtime, filter theo `factory_id + is_active + ten IN [...]`
- **Fallback**: `/public/geojson/Lo cao su - 2026_Full.geojson` — chỉ dùng khi DB chưa có dữ liệu
- `EudrClient.tsx` thực hiện logic: query DB trước, fallback GeoJSON tĩnh nếu `plotRows` rỗng
- `dispatch_delivery_points.phien_X[]` vẫn lưu mảng `ten` codes — không thay đổi
- Seed dữ liệu ban đầu: `node --env-file=.env.local scripts/seed-forest-plots.mjs`
- Không được hard-code danh sách lô vườn trong code; mọi mở rộng phải vào DB

## Ngôn ngữ giao diện

- Session `Xuất hàng` phải hiển thị tiếng Việt có dấu, đúng chính tả
- Session `Xuất hàng` hiện tại phải đồng bộ cách gọi số lượng theo thuật ngữ nghiệp vụ là `bánh`
- Các nhãn quan trọng cần giữ đúng dạng chuẩn: `Xuất hàng`, `Tạo đơn xuất`, `Tổng bánh`, `Khách hàng`, `Lô hàng`, `Yêu cầu chỉ tiêu`

## OCR biển số xe (2026-07-04)

### Model Gemini và quota

- Route: `src/app/api/export/ocr-plate/route.ts`
- Model bắt buộc: `gemini-2.5-flash-lite` — **không dùng `gemini-2.5-flash`**.
- Lý do: `gemini-2.5-flash` chỉ có **20 request/ngày** trên free tier của API key hiện tại (`GEMINI_API_KEY`, dạng Vertex AI `AQ.Ab8...`). Verify trực tiếp bằng `ListModels`/test burst: `gemini-2.5-flash` bị `429 RESOURCE_EXHAUSTED` (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`, limit 20) ngay cả khi gọi tuần tự có delay; `gemini-2.5-flash-lite` chịu được burst 6 request song song không lỗi.
- `gemini-1.5-flash` và `gemini-2.0-flash` đã bị Google gỡ khỏi key này (404 / quota=0) — không dùng lại các model này cho bất kỳ route Gemini Vision nào trong app.
- Model có "thinking" (`gemini-2.5-*`) bắt buộc phải set `generationConfig.thinkingConfig: { thinkingBudget: 0 }`, nếu không sẽ tiêu hết `maxOutputTokens` cho suy luận nội bộ và trả về rỗng/cụt khi `maxOutputTokens` thấp.
- 2 route OCR khác trong app (`src/app/api/process/ocr-image/route.ts`, `src/app/api/product/extract-image-codes/route.ts`) cũng đã đổi sang `gemini-2.5-flash-lite` cùng lý do quota.

### Prompt đọc biển số Campuchia

- Prompt (`PLATE_PROMPT` trong `route.ts`) phải mô tả đúng đặc điểm biển số Campuchia: nền trắng, chữ xanh dương/đen, format `1 chữ số + 1-2 chữ cái + gạch ngang + 3-4 chữ số` (vd `3F-9676`, `4B-0189`), kèm chữ Khmer nhỏ (tên tỉnh) phía trên/dưới.
- Phải liệt kê rõ những gì KHÔNG được lấy nhầm làm biển số: mã ISO container (`ZCSU 273812`, `WHLU 423353`), thông số tải trọng (MAX GROSS/TARE/NET), số hotline/decal, số sơn tay trực tiếp lên khung gầm/sát-xi.
- Route trả về plain text (không dùng `responseMimeType: "application/json"`) — đã thử JSON mode kèm nhãn vị trí "trước/sau" (`vi_tri`) nhưng làm giảm độ tin cậy OCR (model phải làm 2 việc cùng lúc); đã bỏ hẳn, quay về chỉ đọc text biển số đơn giản.
- `normalizePlate()` dùng regex `(\d[A-Z]{1,2})[\s-]*(\d{3,5})` để chuẩn hóa lại định dạng (tự thêm dấu gạch ngang, viết hoa), fallback về text gốc nếu không khớp.

### Client-side: gán Biển trước/Biển sau

- `handleVehicleImageUpload` trong `export/page.tsx` chạy OCR **song song** (`Promise.all`) cho **tất cả ảnh vừa upload** trong 1 lượt (tối đa 6 ảnh/xe), không chỉ ảnh đầu tiên.
- Không dùng AI để đoán ảnh nào là "đầu xe" hay "đuôi xe" — độ tin cậy thấp trong thực tế. Thay vào đó:
  1. Đếm tần suất mỗi biển số xuất hiện trong các ảnh vừa OCR (nhiều ảnh có thể chụp trùng 1 biển) — chỉ giữ lại **tối đa 2 giá trị khác nhau xuất hiện nhiều nhất**, loại nhiễu do OCR đọc sai lệch.
  2. Nếu có 2 giá trị khác nhau: so sánh **chữ số đầu tiên** của mỗi biển — biển có số đầu **nhỏ hơn** → `Biển trước`, số đầu **lớn hơn** → `Biển sau` (vd `3F-9676` → trước, `4B-0189` → sau). Quy tắc này dựa trên quy ước thực tế của nhà máy (đầu kéo đăng ký số nhỏ hơn rơ-moóc).
  3. Nếu chỉ nhận diện được 1 giá trị: điền vào ô còn trống đầu tiên (ưu tiên Biển trước).
  4. Không ghi đè ô đã có sẵn dữ liệu.
- **Điền thẳng vào form ngay khi OCR xong, không qua bước xác nhận** — đã bỏ hẳn banner `OcrConfirmBar` (nút "Điền"/"Bỏ qua") vì rườm rà; chỉ hiện toast ngắn báo đã tự điền biển số nào (`showToast(..., "success")`).
- Không tạo lại banner xác nhận này nếu cải tiến thêm — giữ nguyên tắc "OCR xong là điền thẳng".

## Customer Portal — khách hàng xem đơn xuất hàng được cấp quyền (2026-07-07/08)

### Mục tiêu và kiến trúc

- Admin tạo tài khoản `role="customer"`, **gán tay từng đơn xuất hàng cụ thể** (không tự động theo `customer_id`) cho tài khoản đó xem, kèm toàn bộ chuỗi truy xuất EUDR (bản đồ, polygon, điểm giao nhận) của các lô trong đơn. Customer không xem được bất kỳ dữ liệu nào khác trong hệ thống.
- Bảng `export_order_customer_grants` (migration `20260708_customer_portal_export_grants.sql`, mirror `operation_note_shares`) lưu cấp quyền theo `(export_order_id, granted_to_user_id)`.
- RESTRICTIVE RLS policy chặn `role='customer'` đọc thẳng 8 bảng chuỗi trace (`export_orders, customers, lots, ngans, dispatch_entries, qc_results, forest_plots, dispatch_delivery_points`) — không đụng policy hiện có của admin/manager/user.
- Toàn bộ dữ liệu khách hàng xem đi qua 2 API route dùng `getSupabaseAdmin()` (service role) + `requireAuthUser()` (`src/app/api/customer-portal/orders/route.ts`, `.../[id]/route.ts`) — tự verify `role='customer'` + tồn tại grant trước khi trả dữ liệu, không cho browser khách hàng query thẳng Supabase.
- Trang: `src/app/dashboard/customer-portal/page.tsx` (danh sách), `.../[id]/_components/order-client.tsx` (chi tiết + bản đồ + tải DDS PDF/GeoJSON). Admin cấp quyền qua modal `src/app/dashboard/export/_components/customer-grant-modal.tsx` (nút "Cấp quyền KH", chỉ admin) trên `/dashboard/export`.
- Permission mới `export.view_own`, mặc định gán cho `ROLE_DEFAULTS.customer`.

### Bug đã fix (2026-07-08): admin không cấp quyền được, báo "Phiên đăng nhập không hợp lệ"

- **Root cause**: `fetchGrantCandidates()` trong `src/lib/export-order-grants.ts` gọi `fetch("/api/export/customer-grant-candidates?...")` **không đính kèm header `Authorization: Bearer <token>`**, trong khi route đích bắt buộc `requireAuthUser()` (throw đúng chuỗi "Phiên đăng nhập không hợp lệ" khi thiếu token — xem `src/app/api/account/_lib/security.ts`). Lỗi này xảy ra **với mọi admin, mọi lúc** ngay khi mở modal "Cấp quyền KH" — không phải lỗi phiên đăng nhập thật, không liên quan gì tới tài khoản customer đích.
- **Hệ quả**: vì modal không bao giờ tải được danh sách candidate, chưa admin nào từng cấp quyền thành công qua UI — bảng `export_order_customer_grants` luôn rỗng dù đã "cấp quyền" nhiều lần.
- **Fix**: `fetchGrantCandidates()` giờ lấy `access_token` qua `supabase.auth.getSession()` và gắn `Authorization: Bearer <token>` vào request, đúng pattern đã dùng ở `customer-portal/page.tsx`.
- **Cứng hóa thêm** (2026-07-08): `customer-portal/page.tsx` và `[id]/_components/order-client.tsx` — bootstrap giờ tái dùng `session` từ `hydrateActiveSession()` để build Bearer token (không gọi `supabase.auth.getSession()` lần 2 riêng), và thêm guard `authBlockReason(user)` (pending/disabled/no_factory) trước khi gọi API, đề phòng tài khoản bị khóa giữa chừng sau khi đã đăng nhập.
- Khi rà lỗi này, đã quét toàn bộ client `fetch()` gọi các route dùng `requireAuthUser` trong repo — không phát hiện thêm nơi nào khác thiếu Authorization header tương tự.

### Trạng thái (2026-07-08)

- Migration `20260708_customer_portal_export_grants.sql` đã áp dụng một phần trên DB thật (bảng + permission `export.view_own` đã có); code + bug fix trên đã qua `tsc`/`eslint`/`npm run build`.
- **Chưa test tay trên trình duyệt thật**: cần admin thử lại modal "Cấp quyền KH" (giờ phải tải được danh sách và lưu thành công), rồi đăng nhập bằng tài khoản customer để xác nhận xem được đúng đơn đã cấp + chuỗi trace EUDR + tải DDS PDF/GeoJSON.
