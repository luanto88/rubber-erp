<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Quy ước nghiệp vụ hiện tại

- Phiếu thành phẩm ở `src/app/dashboard/product/page.tsx` hiển thị chung một danh sách ngăn. Các mã chuẩn `N1` đến `N24` và các mã nhập tay như `BN`, `10.2`, `MN` không tách thành 2 khu riêng.
- Khi chọn ngăn cho phiếu thành phẩm, chỉ hiển thị các ngăn có trạng thái `Chờ sản xuất` hoặc `Đang sản xuất`. Ngăn `Đã sản xuất`, `Đóng`, `Đang nhận` không được hiện trong form nhập thành phẩm.
- Không đặt nút đổi trạng thái ngăn trong vùng chọn ngăn của phiếu thành phẩm.
- Nút đổi trạng thái ngăn phải nằm ở hàng icon header của thẻ ngăn trong module Kho nguyên liệu tại `src/app/dashboard/storage/page.tsx`.
- Trạng thái ngăn được suy ra theo mốc ngày như sau:
- Nếu ngăn đã có `Từ ngày` nhưng chưa có `Đến ngày` thì trạng thái là `Đang nhận`.
- Nếu ngăn đã có cả `Từ ngày` và `Đến ngày` thì trạng thái nền là `Đóng`, nghĩa là không nhận thêm nguyên liệu.
- Nếu ngăn đã có cả `Từ ngày` và `Đến ngày`, đồng thời `ngày hiện tại - Từ ngày` lớn hơn hoặc bằng `21`, thì tự động chuyển sang `Chờ sản xuất`.
- Admin được phép chuyển tay từ `Đóng` sang `Chờ sản xuất` khi `Ngày lưu` lớn hơn hoặc bằng `6`.
- Sau khi thành phẩm đạt tỷ lệ từ `100%` đến `110%`, người dùng có thể lưu và admin có thể đánh dấu ngăn sang `Đã sản xuất`.
- Khi ngăn đang là `Đã sản xuất`, nếu dữ liệu thành phẩm đồng bộ làm tỷ lệ xuống dưới `100%` thì tự động chuyển về `Đang sản xuất`.
- Khi ngăn đang là `Đã sản xuất` và tỷ lệ sau đồng bộ vẫn nằm trong khoảng `100%` đến `110%` thì giữ nguyên `Đã sản xuất`.
- Khi ngăn đang là `Đang sản xuất` và tỷ lệ nằm trong khoảng `100%` đến `110%`, admin có thể chuyển tay sang `Đã sản xuất`.
- Chỉ khi admin chuyển tay ngăn từ `Đã sản xuất` về `Đang sản xuất` thì ngăn mới xuất hiện lại trong danh sách chọn của phiếu thành phẩm.
- Cảnh báo “nhảy lô” cho các dải giữ code hợp lệ như `347CS/26` đến `351CS/26` vẫn chưa được xử lý dứt điểm.
