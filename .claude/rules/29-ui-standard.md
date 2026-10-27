# QUY CHUẨN GIAO DIỆN MODULE — BẮT BUỘC (2026-10-14)

File này là nguồn DUY NHẤT cho bố cục danh sách / dòng xổ / trang chi tiết / thao tác. Khi đụng
vào BẤT KỲ module nào có danh sách hoặc trang chi tiết, tự áp dụng đủ checklist dưới đây — không
chờ người dùng nhắc. Mẫu tham chiếu đã chạy: Bảo trì (`maintenance/records/[id]`), Điều xe
(`dispatch/page.tsx`). Chi tiết component: rule 05.

## A. Danh sách & Cân chỉnh bố cục
1. Banner `PageHeaderBanner` màu module; vùng module bọc `moduleThemeClass(theme)`; tab
   `SegmentedTabs`; KPI `StatGrid`/`StatCard`; bộ lọc `FilterBar layout="grid"`.
2. **Cân chỉnh Header & Action (Desktop & Mobile)**:
   - Các trường header và các action luôn phải cân chỉnh vừa vặn với desktop hoặc mobile, không lệch trái, lệch phải hoặc xuống dòng vô điều kiện.
   - Header bảng và ô dữ liệu bên dưới phải gióng hàng đồng nhất: văn bản căn trái, số liệu căn phải, cột thao tác/mũi tên căn phải.
   - Ô tìm kiếm và các action trong thanh lọc/header phải có kích thước vừa vặn (`w-full sm:w-72` hoặc `sm:w-80`), không để ô tìm kiếm phình to chiếm hết diện tích làm xô lệch hoặc đẩy các bộ lọc/nút bấm xuống dòng vô lý trên desktop.
3. Bảng `enterprise-table dense` trong `ResponsiveTableWrapper`. Trạng thái CHỈ qua `StatusBadge
   domain=…`; ký duyệt CHỈ qua `SignStatusBadge`.
4. **Dòng có chi tiết con ⇒ `ExpandableRow`** (phiếu có chuyến, biên bản có thiết bị, ngày có lô…):
   mũi tên XUỐNG ở ô CUỐI (sau cụm thao tác, `endCell`), bấm dòng mở/thu, mũi tên KHÔNG chuyển
   trang, header cột cuối `ExpandHeaderCell`, có `ExpandAllToggle` trên bảng, chi tiết = bảng con
   `enterprise-table dense`. Không có con ⇒ `canExpand={false}`. Ô có nút riêng (mã, badge ký) phải
   `stopPropagation`.
5. Cột cuối "Thao tác" — `IconActionGroup` + `RowAction`:
   - Hiển thị tự nhiên ở cuối dòng, KHÔNG ghim cố định (`position: sticky`) trên cả Desktop lẫn Mobile.
   - Kết hợp với khai báo `min-w-[...]` phù hợp (`min-w-[640px]` đến `min-w-[980px]`) trên `enterprise-table dense` trong `ResponsiveTableWrapper` để bảng cuộn ngang tự nhiên, tuyệt đối không để cụm nút thao tác đè lên nội dung các cột dữ liệu.

## B. Thao tác (từ điển `action-registry.ts`) — một icon = một nghĩa
Thứ tự: [Ký ngay] → **view** `Eye` → signed `FileCheck2` → download `Download` → draft `FileText` /
print `Printer` → riêng module → edit `Pencil` → copy `Copy` → delete `Trash2`.
- **Con mắt (`view`): BẮT BUỘC mở trang/khung xem CHI TIẾT (Detail View) có kèm nhúng file PDF** (`DocViewer`), không bao giờ mở file tải về riêng lẻ hay mở form sửa:
  + Nếu đã gửi ký duyệt / có file ký: nhúng file PDF đã ký.
  + Nếu chưa gửi ký duyệt (hoặc đang là bản nháp): BẮT BUỘC render bản xem trước PDF chưa ký duyệt (qua `loadBytes` dựng PDF trực tiếp trong trình duyệt).
- `signed` = xem file ĐÃ KÝ trong tab mới qua route token (mục D). `download` = tải đúng tên.
- `draft`/`print` = bản CHƯA ký — CHỈ hiện khi chưa có file ký.
- Sửa/Xoá: giữ nguyên điều kiện quyền + chủ sở hữu + khoá sau ký của module; không hiện khi chưa
  tải xong trạng thái ký.

## C. Trang chi tiết (chuẩn 70/30)
- `DetailPageHeader`: quay lại, eyebrow (loại chứng từ), tiêu đề, `code` (mã), chip phụ; actions:
  có file ký ⇒ "Xem file ký" + "Tải file ký", chưa có ⇒ "Xuất/In bản chưa ký"; "Chỉnh sửa" theo quyền;
  `HeaderQr` nếu bản ghi có URL riêng.
- `DetailSplitLayout` (`mobileTab` "doc"/"info", mặc định "info"):
  - Cột trái: có file ký ⇒ `SegmentedTabs` ["File đã ký" | "Nội dung"], tab file = **`DocViewer`
    nhúng PDF** (`active = (isDesktop || mobileTab==="doc") && !modal ký đang mở`, `key=fileHienTai`);
    không có file ⇒ chỉ nội dung (bảng `enterprise-table dense`).
  - Cột phải: `StatusSummaryBar` (+ `SignStatusBadge chipOnly`) → `SignActionBox` (primary DUY NHẤT:
    Ký ngay / Sửa & ký lại / Gửi ký duyệt; secondary: thao tác phụ; danger: huỷ/xoá) →
    `InspectorCard` "Tiến trình ký" (`TimelineSteps` + `TimelineProgress`) → thẻ tổng hợp (`MetaList`).
- Hộp xác nhận + modal ký phải render ở CẢ danh sách lẫn chi tiết (tách thành node dùng chung).

## D. File đã ký — xem & tải
- Xem: `openSecureFile('/api/signing/requests/{yeuCauId}/file-url?view=1&name=<tên>')` → route
  `/api/files/view/<token>/<tên>` (token 120s, `Content-Disposition: inline` đúng tên; file >4MB tự
  302 về Signed URL). KHÔNG href thẳng `fileHienTai` (lưu ra `v4.pdf`).
- Tải: `buildStorageDownloadUrl(fileHienTai, tên)` hoặc `…/file-url?download=1&name=…`.
- `DocViewer` endpoint = `/api/signing/requests/{yeuCauId}/file-url` (không tham số).
- Tên file: "<Loại chứng từ> <mã>" (vd "Biên bản DX-…", "Phiếu điều xe ĐX-…").

## D2. QR trên phiếu + Quét QR ở ô tìm (2026-10-14)
- Mọi phiếu PDF có URL riêng ⇒ in QR **GÓC PHẢI TRÊN** trang đầu (không bao giờ góc trái), không
  đè tiêu đề/dòng chữ đầu trang. QR trỏ trang chi tiết trong app (chưa đăng nhập → `/login?next=`).
  Đã áp: Bảo trì, Đề nghị mua (có từ trước), Kiểm nghiệm (`buildQualityKqknLookupUrl` →
  `/dashboard/quality/{ngay_kn}`), Điều xe (`buildDispatchEntryLookupUrl` →
  `/dashboard/dispatch?entry={id}`, trang danh sách tự mở chi tiết). PDF đã ký trước đó bất biến.
- Ô tìm của danh sách có nút **Quét QR** (`QrScanner` qua `next/dynamic ssr:false` +
  `createPortal` ra `document.body`, mirror `maintenance/history`). Quét ra URL phiếu ⇒ lọc/mở đúng
  phiếu; ra chuỗi khác ⇒ đưa vào ô tìm.

## E. Bàn giao mỗi lần sửa (bắt buộc cuối phiên)
1. Liệt kê việc đã làm theo file. 2. Hướng dẫn test tay (từng bước, kết quả mong đợi). 3. Việc còn
lại / lệch chuẩn đã thấy. 4. Prompt bàn giao cho phiên sau (đọc rule 29 + phần còn lại).
Kiểm tra: `npx tsc --noEmit` + `npx eslint <file>` — không `npm run build`.

## F. Tình trạng áp dụng (cập nhật 2026-10-27 — lộ trình U8–U14 ở `.claude/plans/ke-hoach-dong-bo-ui-toan-app.md`)
| Module | Danh sách | Dòng xổ | Chi tiết 70/30 + PDF | Xem file token | QR phiếu + Quét QR |
|---|---|---|---|---|---|
| Bảo trì | ✅ | Lý lịch ✅ · Biên bản ✅ · Tổng quan ✅ | ✅ (+ bản chưa ký nhúng) | ✅ | ✅ (quét ở Lý lịch) |
| Điều xe | ✅ | ✅ | ✅ (+ bản chưa ký nhúng) | ✅ | ✅ |
| Kiểm nghiệm | ✅ | ✅ (ngày → lô → số liệu mẫu) | ✅ `/dashboard/quality/[date]` | ✅ | ✅ (tab Xếp hạng) |
| Đề nghị mua | ✅ | ✅ (dòng vật tư) | ✅ (+ bản chưa ký nhúng khi Nháp) | ✅ | ✅ (Đã tích hợp Quét QR ở ô tìm) |
| Sản lượng | ✅ StatusBadge (cảnh báo/nguồn) + ListState + bảng Thống kê chuẩn; Converter theme + banner | ✅ (ngày → xe / chuyến) | ✅ `/dashboard/output/day/[date]` (PDF ngày nhúng loadBytes) | — | ✅ QR góc phải trên PDF ngày + Quét QR ở ô tìm |
| Văn bản | (Doc-UI riêng) | ✅ tiến trình ký | ✅ | ❌ (lưu tên object) | — |
| ISO tài liệu | (Doc-UI riêng) | ✅ hồ sơ con | ✅ | ❌ (lưu tên object) | — |
| Xuất hàng | ✅ | ✅ (xe + lô gán + chỉ tiêu + KH được cấp) | ✅ `/dashboard/export/[id]` (PDF nhúng loadBytes) | — | ✅ (quét QR EUDR + quét QR kiện lên xe) |
| Kho vật tư (Nhập/Xuất/Chuyển) | ✅ | ✅ (dòng vật tư của phiếu) | ✅ `/dashboard/inventory/document/[type]/[id]` (PDF A5 nhúng loadBytes) | — | ✅ (QR phiếu mới + nhận QR cũ `?documentId=`) |
| Thành phẩm | ✅ theme + StatusBadge lot + StatGrid + FilterBar grid | ✅ (ngày → ca → lô, DateGroupRow) | ✅ chi tiết NGÀY `/dashboard/product/day/[date]` (F09 nhúng, con mắt dòng ngày) + chi tiết lô `/dashboard/product/lot/[id]` (link mã lô) | — | QR góc phải trên PDF lô + ✅ Quét QR ở ô tìm (nhãn kiện / trang lô) |
| Kho nguyên liệu | ✅ theme + StatusBadge storage + SegmentedTabs + StatGrid + FilterBar grid; tab Lịch sử `enterprise-table dense` | ✅ (bảng ngăn, ExpandableRow) | ✅ `/dashboard/storage/[id]` (PDF F03 nhúng loadBytes) | — | QR có sẵn trên PDF (trỏ trang công khai `/storage`) + ✅ Quét QR ở ô tìm (mở chi tiết ngăn) |
| Kho thành phẩm | 🟡 theme orange | — (sơ đồ kho) | — | — | — |
| Kiểm soát quá trình | ✅ theme teal + SegmentedTabs + banner mọi tab + StatGrid + FilterBar grid + enterprise-table | ✅ (phiếu đo → dòng đo) | ✅ `/dashboard/process/measurements/[id]` (PDF A4 nhúng loadBytes) | — | ✅ QR góc phải trên PDF + Quét QR ở ô tìm |
| Kho vật tư — Thẻ kho/Sổ chi tiết/Tổng quan | ✅ theme amber (shell) + SegmentedTabs + StatGrid + FilterBar grid + enterprise-table + StatusBadge + ListState (U10) | — (báo cáo phẳng) | con mắt Sổ chi tiết → chi tiết phiếu | — | — |
| KPI | 🟡 banner chỉ trang chủ, tab tay, badge span — U11 | — | — | — | — |
| Ghi chú | 🟡 banner rose, FilterBar không grid (giữ thẻ pastel) — U12 | — | — | — | — |
| Chất lượng phân tích / Báo cáo | ❌ `<h1>` thường — U13 | — | — | — | — |
| EUDR / Customer portal / Cài đặt | 🟡/❌ — U14 | — | — | — | — |
| Bản đồ / Dashboard | Không áp đủ rule 29 (màn đặc thù) | — | — | — | — |

## G. Bản CHƯA ký trong khung xem nhúng (2026-10-14)
Chưa gửi ký ⇒ tab "Bản xem trước (chưa ký)" dựng PDF ngay trong trình duyệt: `DocViewer`
nhận `loadBytes={() => build…DraftPdfBytes(...)}` + `sourceKey` (đổi để dựng lại; `endpoint` bỏ
trống). Chỉ dựng khi ĐÃ tải xong trạng thái ký và chắc chắn chưa có yêu cầu ký (lỗi tải ⇒ không
dựng). Hàm dựng: `buildMaintenanceDraftPdfBytes(bundle,…)`, `buildDispatchEntryDraftPdfBytes`,
`buildQualityKqknDraftPdfBytes` — cùng nội dung nút "In/Xuất PDF chưa ký".
