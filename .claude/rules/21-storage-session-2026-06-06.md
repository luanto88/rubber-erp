# Handoff session 2026-06-06 - Module ngăn lưu

## Mục tiêu đã xử lý qua các session liên quan

- Ổn định lại module Kho nguyên liệu, QR chi tiết ngăn, PDF chi tiết ngăn, và logic trạng thái ngăn.
- Đồng bộ rule giữa Kho nguyên liệu và Thành phẩm để tránh mâu thuẫn trạng thái.
- Ghi lại handoff sạch, có dấu, để session sau tiếp tục nhanh hơn.

## Các mốc đã chốt trước đó

### 1. GeoJSON cho ngăn

- Đã có nút `GeoJSON` trên card ngăn ở dashboard.
- GeoJSON lấy theo toàn bộ `trip uid` đã gắn trong `ngans.trips`.
- Từ các trip đó, hệ thống lấy `lo_thu_hoach` trong `dispatch_entry_rows`.
- Ưu tiên đọc polygon từ `forest_plots`, nếu thiếu thì fallback `/geojson/Lo cao su - 2026_Full.geojson`.
- Nếu không tìm thấy `lo_thu_hoach`, phải báo lỗi rõ thay vì tải file rỗng.

### 2. PDF chi tiết ngăn

- QR của phiếu chi tiết ngăn nằm gọn trong header màu xanh, góc phải.
- Đã chỉnh chiều cao header và khoảng đệm để QR không rơi xuống bảng thông tin.

### 3. Rule ngày xé

- `Xé từ ngày = ngay_bd + 1`
- `Xé đến ngày = ngay_kt + 1`

### 4. Rule báo cáo kỳ

- Chỉ lấy ngăn nếu:
  - `ngay_bd >= tu_ngay`
  - `ngay_kt <= den_ngay`
- Ngăn chưa có `ngay_kt` thì không vào báo cáo kỳ.

## Cập nhật nghiệp vụ mới nhất 2026-06-13

### 1. Trạng thái ngăn

- Trạng thái hợp lệ:
  - `Đang nhận`
  - `Đóng`
  - `Chờ sản xuất`
  - `Đang sản xuất`
  - `Đã sản xuất`
- Nếu đã có `Từ ngày` nhưng chưa có `Đến ngày` thì là `Đang nhận`.
- Nếu đã có cả `Từ ngày` và `Đến ngày` thì trạng thái nền là `Đóng`.
- Nếu đã có cả `Từ ngày` và `Đến ngày`, đồng thời `ngày hiện tại - Từ ngày >= 21` thì tự động thành `Chờ sản xuất`.
- Admin được chuyển tay `Đóng -> Chờ sản xuất` khi `ngày lưu >= 6`.
- Nút đổi trạng thái nằm ở header card ngăn trong `src/app/dashboard/storage/page.tsx`.
- Các nút đổi trạng thái này phải chỉ dành cho admin.

### 2. Tạo ngăn

- Được phép tạo ngăn rỗng để giữ chỗ.
- Vừa nhập `Ngày bắt đầu` là phải lọc chuyến Điều xe ngay.
- Không cần chờ `Ngày kết thúc` mới được lọc.
- Vẫn chấp nhận lưu khi chỉ có `Ngày bắt đầu`.

### 3. Quan hệ giữa ngăn và Thành phẩm

- Form chọn ngăn ở `src/app/dashboard/product/page.tsx` hiển thị chung một danh sách.
- Các mã `N1-N24` và mã nhập tay như `BN`, `10.2`, `MN` không tách khu riêng.
- Chỉ hiện ngăn có trạng thái `Chờ sản xuất` hoặc `Đang sản xuất`.
- Nhưng ngoài trạng thái, ngăn còn phải có nguyên liệu thực sự (`tong_kho > 0`) mới được hiện trong form Thành phẩm.
- Ngăn rỗng tuyệt đối không được dùng để tạo thành phẩm.
- Ngăn `Đã sản xuất`, `Đóng`, `Đang nhận` không được hiện trong form nhập thành phẩm.
- Ngăn chỉ hiện lại trong form khi admin chuyển tay từ `Đã sản xuất` về `Đang sản xuất`.

### 4. Logic lưu Thành phẩm

- Khi ngăn đang ở `Chờ sản xuất` và được chọn để nhập thành phẩm:
  - nếu tỷ lệ sau nhập nằm trong `100% - 110%` thì hiển thị cả `Lưu` và `Lưu & đánh dấu đã sản xuất`
- `Lưu`:
  - lưu phiếu
  - giữ ngăn ở luồng nhập tiếp, để lần sau vẫn chọn nhập thành phẩm tiếp tục được
- `Lưu & đánh dấu đã sản xuất`:
  - lưu phiếu
  - chuyển ngăn sang `Đã sản xuất`
  - từ thời điểm đó ngăn không còn xuất hiện trong form nhập thành phẩm nữa
- Nếu user bấm nhầm `Lưu & đánh dấu đã sản xuất` sớm nhưng tỷ lệ vẫn còn trong `100% - 110%`, không tự mở lại; cần admin chuyển tay về `Đang sản xuất`.
- Nếu xóa/sửa làm tỷ lệ tụt xuống dưới `100%`, ngăn tự trả về `Đang sản xuất`.
- Nếu sau đồng bộ tỷ lệ vẫn ở trong `100% - 110%` và ngăn đang `Đã sản xuất`, giữ nguyên `Đã sản xuất`.

### 5. Luồng chính phải giữ

- `Tròn lô -> Kiểm nghiệm`
- `Kiểm nghiệm Đạt hạng -> Xuất hàng`
- `Xuất hàng -> Không cho sửa lô`
- `Ngăn có nguyên liệu -> Mới tạo Thành phẩm`

## Dữ liệu thật đã phát hiện

- Audit DB trong session 2026-06-13 cho thấy không còn mismatch giữa lot `Xuất hàng` và `export_orders`.
- Không thấy nhóm `ma_lo` trùng trong bảng `lots`.
- Có dữ liệu cũ đáng ngờ ở các ngăn kiểu `N6`, `N8`: `tong_kho = 0`, không có `trips`, nhưng đã có thành phẩm. Đây là hậu quả lịch sử của bug “ngăn rỗng vẫn tạo được thành phẩm”.

## File chính đã sửa trong các session liên quan

- `src/app/dashboard/storage/page.tsx`
- `src/lib/storage-detail.ts`
- `src/lib/storage-pdf.ts`
- `src/lib/storage-status.ts`
- `src/app/dashboard/product/page.tsx`
- `src/app/dashboard/product/shared.ts`
- `src/app/dashboard/product/actions.ts`
- `src/app/dashboard/export/page.tsx`
- `.claude/rules/06-module-production.md`
- `.claude/rules/21-storage-session-2026-06-06.md`

## Kiểm tra đã chạy

- `npx eslint src/app/dashboard/storage/page.tsx src/lib/storage-detail.ts src/lib/storage-pdf.ts`
- `npx eslint src/app/dashboard/product/page.tsx src/app/dashboard/storage/page.tsx src/lib/storage-status.ts`
- `npx eslint src/app/dashboard/export/page.tsx src/app/dashboard/product/shared.ts`
- `npx eslint src/app/dashboard/product/page.tsx`

Kết quả:

- Pass ở các file đã chạm.
- Warning cũ về `<img>` trong `export/page.tsx` không liên quan bug logic.

## Việc nên làm ở session sau

- Rà và xử lý dữ liệu cũ của các ngăn rỗng nhưng đã có thành phẩm, đặc biệt `N6` và `N8`.
- Verify trực tiếp trên UI các mốc ngày lưu `5`, `6`, `21`.
- Test các case tỷ lệ thành phẩm:
  - `<100%`
  - `100% - 110%`
  - `>110%`
- Kiểm tra kỹ luồng admin đổi tay:
  - `Đóng -> Chờ sản xuất`
  - `Đã sản xuất -> Đang sản xuất`
- Rà nốt cảnh báo “nhảy lô” cho các dải giữ code hợp lệ như `347CS/26 -> 351CS/26`, vì hiện vẫn chưa xử lý dứt điểm.
