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

## Quy ước EUDR hiện tại

- Luồng upload file EUDR phải giữ fix `sanitize` cho path/tên file. Ký tự có dấu, khoảng trắng hoặc ký tự đặc biệt không được đẩy nguyên trạng lên storage key.
- Route fallback server upload ở `src/app/api/eudr/upload/route.ts` vẫn được giữ để dự phòng khi policy bucket `eudr-files` lệch giữa các môi trường.
- Panel debug file đính kèm trong `src/app/dashboard/eudr/EudrClient.tsx` không hiển thị mặc định. Chỉ bật khi có cờ `NEXT_PUBLIC_EUDR_DEBUG=1`.
- Dữ liệu lô vườn trên màn EUDR phải ưu tiên `forest_plots` cho geometry và metadata đã seed trong DB, nhưng vẫn cần ghép thêm thuộc tính từ GeoJSON chuẩn `Lo cao su - 2026_Full.geojson` theo mã `Ten` để không mất các field như giống, năm trồng, năm mở cạo, đội nhỏ, tổng cây KK, mặt cạo, tọa độ.
- Popup và thẻ chi tiết lô trên map EUDR phải dùng bộ field đã merge nói trên để hiển thị gần tương đương module `ban_do_lo`.
- Không render thẻ overlay HTML thường bên trong cây con của `MapContainer`. Các panel như legend, chi tiết lô, trạng thái tải phải nằm ngoài `MapContainer` để tránh lỗi runtime kiểu Leaflet `appendChild`.
- Các callback truyền vào `GeoJSON` như `style` và `onEachFeature` nên giữ ổn định bằng `useCallback` nếu state UI bên ngoài map có thể thay đổi khi click/chọn lô.

## Quy ước ISO & Nhân bản chữ ký / tên hiện tại

- **Luồng ký ISO theo Cấp tài liệu**:
  - **Cấp 1 (3 bước)**: Soạn thảo (Ký & Gửi xem xét) → Xem xét (Ký xem xét & Gửi phê duyệt) → Phê duyệt (Ký phê duyệt & Ban hành).
  - **Cấp 2 (2 bước)**: Gửi phê duyệt (Người soạn ký & Gửi phê duyệt trực tiếp, bỏ qua bước Xem xét) → Phê duyệt (Ký phê duyệt & Ban hành). Giao diện Cấp 2 hiển thị nhãn `Cấp 2 (2 bước: Gửi phê duyệt → Phê duyệt)` và ẩn vùng thông tin xem xét.
- **Quy tắc Nhân bản Chữ ký và Tên người ký (Signature & Name Duplication)**:
  - Nút icon `+` (Nhân bản chữ ký và tên) hiển thị trên cả ô chữ ký gốc lẫn ô tên người ký gốc trong giao diện đặt vị trí ký (`SignPlacementModal`).
  - Khi bấm `+`: Tạo ra cặp ô chữ ký bản sao và ô tên bản sao mới, vị trí khởi tạo nằm lệch 30px so với ô gốc để kéo-thả.
  - Các bản sao được trang bị icon mắt (`👁`) để ẩn/hiện và nút xóa (`×`) để tắt/xóa nếu bấm nhầm.
  - **Chỉ ô gốc (bản chính) mới có nút icon `+`** để tiếp tục nhân bản; các bản sao KHÔNG có nút `+`.
  - Trong React JSX, mảng các bản sao `extraSigBoxes` phải dùng `<Fragment key={box.id}>` (không dùng wrapper `<div>`) và component kéo-thả `ExtraDraggableBox` phải đặt ở top-level scope ngoài Modal, chỉ dùng handler `onStop` (không dùng `onDrag` cập nhật state) để tránh `bounds="parent"` bị lỗi reset tọa độ `y = 0` hoặc nổ lỗi `findDOMNode` trên React 19.
  - Phía backend (`generate-pdf`, `documents/sign`, `iso/forms/finalize`), đối với mọi loại file PDF (cả file chính và file phụ), đều tiếp nhận mảng `extraPlacements` để đóng dấu đầy đủ toàn bộ các bản sao chữ ký & tên lên file PDF kết quả.

