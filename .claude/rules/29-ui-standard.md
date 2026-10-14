# QUY CHUẨN GIAO DIỆN MODULE — BẮT BUỘC (2026-10-14)

File này là nguồn DUY NHẤT cho bố cục danh sách / dòng xổ / trang chi tiết / thao tác. Khi đụng
vào BẤT KỲ module nào có danh sách hoặc trang chi tiết, tự áp dụng đủ checklist dưới đây — không
chờ người dùng nhắc. Mẫu tham chiếu đã chạy: Bảo trì (`maintenance/records/[id]`), Điều xe
(`dispatch/page.tsx`). Chi tiết component: rule 05.

## A. Danh sách
1. Banner `PageHeaderBanner` màu module; vùng module bọc `moduleThemeClass(theme)`; tab
   `SegmentedTabs`; KPI `StatGrid`/`StatCard`; bộ lọc `FilterBar layout="grid"`.
2. Bảng `enterprise-table dense` trong `ResponsiveTableWrapper`. Trạng thái CHỈ qua `StatusBadge
   domain=…`; ký duyệt CHỈ qua `SignStatusBadge`.
3. **Dòng có chi tiết con ⇒ `ExpandableRow`** (phiếu có chuyến, biên bản có thiết bị, ngày có lô…):
   mũi tên XUỐNG ở ô CUỐI (sau cụm thao tác, `endCell`), bấm dòng mở/thu, mũi tên KHÔNG chuyển
   trang, header cột cuối `ExpandHeaderCell`, có `ExpandAllToggle` trên bảng, chi tiết = bảng con
   `enterprise-table dense`. Không có con ⇒ `canExpand={false}`. Ô có nút riêng (mã, badge ký) phải
   `stopPropagation`.
4. Cột cuối "Thao tác" ghim phải (`sticky-end`) — `IconActionGroup` + `RowAction`.

## B. Thao tác (từ điển `action-registry.ts`) — một icon = một nghĩa
Thứ tự: [Ký ngay] → **view** `Eye` → signed `FileCheck2` → download `Download` → draft `FileText` /
print `Printer` → riêng module → edit `Pencil` → copy `Copy` → delete `Trash2`.
- **Con mắt (`view`) = MỞ TRANG CHI TIẾT trong app**, không bao giờ mở file. Mã bản ghi (link) cũng
  mở chi tiết.
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

## E. Bàn giao mỗi lần sửa (bắt buộc cuối phiên)
1. Liệt kê việc đã làm theo file. 2. Hướng dẫn test tay (từng bước, kết quả mong đợi). 3. Việc còn
lại / lệch chuẩn đã thấy. 4. Prompt bàn giao cho phiên sau (đọc rule 29 + phần còn lại).
Kiểm tra: `npx tsc --noEmit` + `npx eslint <file>` — không `npm run build`.

## F. Tình trạng áp dụng
| Module | Danh sách | Dòng xổ | Chi tiết 70/30 + PDF | Xem file token |
|---|---|---|---|---|
| Bảo trì | ✅ | Lý lịch ✅ · Biên bản ✅ · Tổng quan "Biên bản gần đây" ❌ | ✅ | ✅ |
| Điều xe | ✅ | ✅ | ✅ (2026-10-14) | ✅ |
| Kiểm nghiệm, Đề nghị mua, Kho vật tư, Xuất hàng, Thành phẩm, Sản lượng, Kho NL | ❌ | ❌ | ❌ | ❌ |
| Văn bản, ISO | (Doc-UI riêng) | mũi tên ĐẦU dòng — lệch | ✅ | ❌ (lưu tên object) |
