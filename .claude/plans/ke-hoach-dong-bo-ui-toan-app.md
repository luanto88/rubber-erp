# Kế hoạch đồng bộ giao diện toàn app — lộ trình còn lại (rút gọn 2026-10-27)

Chuẩn bắt buộc: `.claude/rules/29-ui-standard.md` + component ở `.claude/rules/05-ui-components.md`.
Đã xong U0–U7 (Bảo trì, Điều xe, Kiểm nghiệm, Đề nghị mua, Kho vật tư Nhập/Xuất/Chuyển/Tồn, Xuất hàng, Thành phẩm,
Kho NL) — chi tiết lịch sử: `.claude/history/ke-hoach-dong-bo-ui-history.md`.

## Cách làm mỗi giai đoạn
- 1 giai đoạn = 1 phiên, dừng cho người dùng test. Giai đoạn "a" = sửa bug, "b" = đổi giao diện.
- Trước khi code: lên plan liệt kê từng bug/thay đổi + file:dòng, người dùng duyệt.
- Đổi giao diện KHÔNG đổi quyền, truy vấn, hành vi nghiệp vụ.
- Kiểm tra: `npx tsc --noEmit` + `npx eslint <file>` (không `npm run build`); test tay localhost/preview, mobile ≤430px.

## Bug chờ sửa (2026-10-27) — khảo sát đọc code, CHƯA sửa

### Kiểm soát quá trình (`process/`) — ĐÃ SỬA P1–P10 ở U8a (2026-10-28, chờ test tay + chạy migration `20261028_process_permission_rls.sql`; chi tiết rule 23)
- P1 🔴 Xoá phiếu đo nhanh 1 cú bấm, không hỏi, không quyền `process.delete`, không kiểm lỗi (`measurements/page.tsx:1192-1195`, `:573-577`).
- P2 🔴 `params/page.tsx` không kiểm quyền nào (không guard `process.view`, nút Thêm/Sửa/Xoá hiện cho mọi người, `handleDelete` không kiểm lỗi).
- P3 🔴 API `api/process/ocr-image` không xác thực ⇒ ai cũng gọi được, đốt quota Gemini.
- P4 🟠 Mở "Sửa" thông số bị effect tự điền ghi đè nhiệt độ/thời gian bằng bản ghi khác (`params/page.tsx:89-134`).
- P5 🟠 Mã phiếu đếm +1 ⇒ trùng mã sau khi xoá, race giữa 2 người (`measurements:254-267`).
- P6 🟠 Trục X biểu đồ Tổng quan sắp theo chuỗi "dd/mm" ⇒ sai thứ tự qua tháng, gộp nhầm khác năm (`page.tsx:160-185`).
- P7 🟠 `quick_measurements`/`process_params` tải toàn bộ lịch sử không `.range()`, không kiểm `error`.
- P8 🟡 OCR: `res.json()` lỗi làm hỏng cả lượt (không lưu ảnh, không báo); ảnh ghi đè do closure cũ; tự tick Po/Mo cả với CSR L/3L.
- P9 🟡 Ngày mặc định theo UTC (`toISOString().slice(0,10)`) ⇒ 00:00-06:59 ra hôm qua.
- P10 🟡 Trang in lấy `user.factory_id` thay `getActiveFactoryId()`; `ngans` không lọc nhà máy; `ket_qua` null làm crash; KPI không reset khi rỗng; đổi ngày khi Sửa không tính lại `so_ngay_luu`; effect tự điền `che_do_say` sửa ngầm dòng cũ.

### Sản lượng (`output/`) — ĐÃ SỬA S1–S10 ở U9a (2026-10-28, chờ test tay; chi tiết rule 15; S10 còn biển số 3A1064/đội 1-12 ở form)
- S1 🔴 Nút "Xóa lọc" đặt ngày = "" ⇒ `.gte("ngay","")` lỗi ⇒ danh sách trống; nút luôn hiện (`page.tsx:474-487`).
- S2 🔴 `production_records`, `dispatch_entries` (qua `loadDispatchEntriesWithResolvedRows` — cắt mất phiếu MỚI NHẤT), `ngans`, import `loadExistingRecords` không `.range()` ⇒ quá 1000 dòng sai KPI / import nhầm NO_DISPATCH_DATE / chèn trùng.
- S3 🟠 Sửa bản ghi đổi ngày chỉ write-back ngày mới — điều xe ngày cũ giữ KL cũ (`page.tsx:617`).
- S4 🟠 `handleSave` đóng form rồi `await writeBackToDispatch` ⇒ lỗi bị nuốt, danh sách không tải lại; `handleDelete` không kiểm lỗi/không try.
- S5 🟠 Converter: không truyền `showToast` ⇒ mọi lỗi "đẩy lên hệ thống" bị nuốt; ghi `warn_codes` sai mã ⇒ badge "undefined"; delete-rồi-insert không nguyên tử, `.eq("doi", null)` tạo bản trùng.
- S6 🟠 Write-back reset KL điều xe về 0 khi xoá hết sản lượng xe (trái rule 15).
- S7 🟡 Sửa/import ghi đè `created_by`/`nguoi_upload` người tạo gốc.
- S8 🟡 Nút "Bắt đầu import" ở tab Hướng dẫn không kiểm `canImport`; Converter chỉ kiểm `tech_support` dù cần quyền ghi.
- S9 🟡 Ngày mặc định theo UTC (`page.tsx:206-211`, `output-types.ts:96`).
- S10 🟡 Hard-code biển số/mã nguồn ngoài (`output-form.tsx:169-180`), đội 1-12, loại mủ lặp 3 nơi; sắp xe "10" trước "2"; phụ đề banner là câu ghi chú lập trình viên.

## Lộ trình U8–U14
Hiện trạng khảo sát 2026-10-27 (cả nhóm dưới đều 0 lần dùng SegmentedTabs/StatGrid/enterprise-table/
ExpandableRow/RowAction/StatusBadge):

| GĐ | Module | Hiện có | Cần làm |
|---|---|---|---|
| U8a | Kiểm soát quá trình — sửa bug P1-P10 ✅ (test pass 2026-10-28) | banner chỉ Tổng quan, tab Link tay, bảng `w-full`, không ExpandableRow/RowAction/ListState | sửa bug trước (1 phiên) |
| U8b | Kiểm soát quá trình — UI ✅ (test pass 2026-10-28) | | `ModuleThemeScope teal` + SegmentedTabs ở shell; StatGrid; FilterBar grid; bảng dense; ExpandableRow mẫu đo; RowAction; chi tiết phiếu `/process/measurements/[id]` 70/30 + PDF jsPDF có QR; Quét QR mã phiếu |
| U9a | Sản lượng — sửa bug S1-S10 ✅ (2026-10-28, chờ test tay) | danh sách đã đạt (banner, SegmentedTabs, FilterBar grid, ExpandableRow, RowAction) | sửa bug (1 phiên) |
| U9b | Sản lượng — UI | ✅ code xong 2026-10-28, chờ test tay | StatusBadge cho cảnh báo/nguồn (domain mới), ListState có lỗi, Quét QR, bảng Thống kê `min-w` + căn phải; chi tiết ngày `/output/day/[date]` 70/30 + PDF nhúng; Converter bọc theme + banner |
| U10 | Kho vật tư — Thẻ kho/Sổ chi tiết/Tổng quan | banner amber qua `InventoryPageShell`, tab Link tự viết, bảng `w-full text-sm`, FilterBar không grid | `moduleThemeClass("amber")` ở shell, tab → SegmentedTabs, thẻ số → StatGrid, bảng → enterprise-table dense, FilterBar grid |
| U11 | KPI (`kpi/**`) | banner chỉ trang chủ; route con `<h1>` thường; tab tự viết `kpi-shell.tsx:47-71`; badge span tay `tasks:472` | banner violet mọi route con, ModuleThemeScope, SegmentedTabs, StatusBadge domain mới `kpi_task`, bảng scores → enterprise-table |
| U12 | Ghi chú (`notes/`) | banner rose, FilterBar không grid, thẻ pastel | FilterBar grid + moduleThemeClass (giữ thẻ pastel — thiết kế riêng có chủ đích) |
| U13 | Chất lượng phân tích + Báo cáo | `<h1>` thường, bảng tay | banner mint + FilterBar grid + enterprise-table (giữ HTML print của báo cáo — rule 25) |
| U14 | EUDR, Customer portal, Cài đặt | banner moss / `<h1>` / tab button tay | banner + SegmentedTabs; Cài đặt ~20 bảng → enterprise-table (lớn, tách phiên) |
| — | Bản đồ, Kho TP (sơ đồ), Dashboard | màn đặc thù | KHÔNG áp đủ rule 29 (giữ như hiện tại) |

## Backlog còn mở
- Danh sách Bảo trì: báo thiếu kho tạm theo từng dòng; thẻ "Biên bản gần đây" đổi thành chỉ số hữu ích; Quét QR ở ô tìm Biên bản.
- ISO/Văn bản: đưa mũi tên dòng xổ về ô cuối dòng.
- Gợi ý chưa chốt: menu "⋯" cho cột thao tác >3 nút trên mobile; chip đếm theo trạng thái bấm để lọc; thời gian tương đối;
  toast một kiểu duy nhất; script `scripts/ui-lint.mjs` báo `Edit2`, span trạng thái tự viết, nút thiếu aria-label.
