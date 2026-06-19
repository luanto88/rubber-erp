---
description: Business logic các module sản xuất - Điều xe, Kho nguyên liệu, Thành phẩm
---

# Business Logic: Sản xuất

## 1. Rule chung

- Mọi query phải filter theo `factory_id`.
- Mọi form CRUD phải có field `day_chuyen` đặt ở đầu form khi nghiệp vụ phụ thuộc dây chuyền.
- Các dropdown phụ thuộc phải reset khi đổi `day_chuyen`.
- Các option sản phẩm phải lấy từ matrix cấu hình nhà máy, không hard-code rải rác.

## 2. Điều xe

- `dispatch_entries` là header/chứng từ.
- `dispatch_entry_rows` là nguồn dữ liệu vật lý chính cho từng chuyến.
- Không đọc/ghi trực tiếp `dispatch_entries.rows` cho logic mới, chỉ xem như cache legacy tạm thời.
- Khi thêm/sửa/import điều xe, chi tiết phải đi qua `dispatch_entry_rows`.
- Khối lượng khô phải auto-calc từ khối lượng tươi và DRC.
- `chuyen` được auto-assign theo xe trong ngày.
- Danh mục `diem_gn` dùng `dispatch_delivery_points`, có filter `factory_id`.
- `lo_thu_hoach` của chuyến phải suy ra từ `diem_gn + phiên`.

## 3. Kho nguyên liệu (`ngans`)

### Trạng thái hợp lệ

- `Đang nhận`
- `Đóng`
- `Chờ sản xuất`
- `Đang sản xuất`
- `Đã sản xuất`

### Rule trạng thái

- Không có trạng thái `Hoàn thành` cho ngăn.
- Nếu đã có `Từ ngày` nhưng chưa có `Đến ngày` thì trạng thái là `Đang nhận`.
- Nếu đã có cả `Từ ngày` và `Đến ngày` thì trạng thái nền là `Đóng`.
- Nếu đã có cả `Từ ngày` và `Đến ngày`, đồng thời `ngày hiện tại - Từ ngày >= 21` thì tự động chuyển `Chờ sản xuất`.
- Admin được chuyển tay từ `Đóng` sang `Chờ sản xuất` khi `ngày lưu >= 6`.
- Nút đổi trạng thái ngăn nằm ở hàng icon header của card ngăn trong `src/app/dashboard/storage/page.tsx`.
- Không đặt nút đổi trạng thái trong vùng chọn ngăn của module Thành phẩm.

### Rule tạo/sửa ngăn

- Được phép tạo ngăn rỗng để giữ chỗ và cập nhật nguyên liệu sau.
- Khi nhập `Ngày bắt đầu`, hệ thống phải lọc chuyến xe ngay, không chờ `Ngày kết thúc`.
- Vẫn cho phép lưu khi chỉ có `Ngày bắt đầu`.
- Chuyển `Đóng -> Chờ sản xuất` là thao tác chỉ dành cho admin.
- Chuyển `Đã sản xuất -> Đang sản xuất` để mở lại cho nhập tiếp cũng chỉ dành cho admin.

## 4. Thành phẩm (`lots`)

- `lots` là bảng master tổng hợp theo `ma_lo`.
- `lot_transactions` là lịch sử chi tiết theo từng ca / ngày / ngăn.
- Trong cùng `factory_id`, chỉ được 1 dòng `lots` cho mỗi `ma_lo`.
- `ma_lo` là định danh nghiệp vụ duy nhất trong cùng `factory_id`.
- `tong_banh = kien_a + kien_b + kien_c + kien_d`.
- `tong_kg = tong_banh * loai_banh`.
- `ma_lo = ${num}${suffix}/${year}`.

### Rule chọn ngăn cho Thành phẩm

- Picker ngăn ở `src/app/dashboard/product/page.tsx` hiển thị chung một danh sách.
- Các mã chuẩn `N1-N24` và mã nhập tay như `BN`, `10.2`, `MN` không tách khu riêng.
- Một phiếu thành phẩm có thể có nhiều `block`; mỗi `block` chọn `ngan_id` riêng, không còn mô hình cả phiếu chỉ có 1 ngăn.
- Khi lưu phiếu, phải ưu tiên `block.ngan_id`; không quay lại dùng `session.ngan_id` cho logic ghi transaction.
- Chỉ hiển thị ngăn có trạng thái `Chờ sản xuất` hoặc `Đang sản xuất`.
- Ngăn `Đã sản xuất`, `Đóng`, `Đang nhận` không được hiện trong form nhập thành phẩm.
- Chỉ hiển thị ngăn có nguyên liệu thực sự, tức có baseline nguyên liệu như `tong_kho > 0`.
- Ngăn rỗng tuyệt đối không được dùng để tạo thành phẩm.
- Ngăn chỉ xuất hiện lại trong form khi admin chuyển tay từ `Đã sản xuất` về `Đang sản xuất`.
- Không tự chuyển trạng thái ngăn sang `Đang sản xuất` chỉ vì người dùng vừa chọn ngăn trong form.

### Rule lưu thành phẩm và trạng thái ngăn

- Khi ngăn ở `Chờ sản xuất`, người dùng được chọn để nhập thành phẩm.
- Khi phiếu có nhiều block, save-time phải kiểm tra theo từng ngăn được chọn trong từng block, không chỉ theo tổng của cả phiếu.
- Save-time phải chặn cứng nếu bất kỳ ngăn nào sau lưu vượt `110%`.
- Sau khi lưu thành công, nếu có ngăn nào đạt trong khoảng `100% - 110%` thì UI phải hiện banner cho phép tick nhanh và đánh dấu các ngăn đó sang `Đã sản xuất`.
- Banner hậu lưu hoạt động theo danh sách ngăn đạt chuẩn của phiên vừa nhập, không được suy diễn lại từ header cũ của phiếu.
- `Lưu`: lưu phiếu và giữ ngăn ở luồng nhập tiếp, kể cả khi ngăn đã đạt `100% - 110%`.
- Từ banner hậu lưu hoặc thao tác admin tay, người dùng/admin mới chuyển ngăn sang `Đã sản xuất`.
- Save-time phải chặn cứng nếu:
  - ngăn không có nguyên liệu
  - thiếu `ngan_id` ở bất kỳ block nào
  - tỷ lệ sau lưu vượt `110%`
- Nếu ngăn đang là `Đang sản xuất` và tỷ lệ nằm trong `100% - 110%`, admin có thể chuyển tay sang `Đã sản xuất`.
- Nếu ngăn đang là `Đã sản xuất` và dữ liệu đồng bộ làm tỷ lệ xuống dưới `100%`, hệ thống tự chuyển về `Đang sản xuất`.
- Nếu ngăn đang là `Đã sản xuất` và tỷ lệ sau đồng bộ vẫn trong `100% - 110%`, giữ nguyên `Đã sản xuất`.
- Không tự trả về `Đang sản xuất` chỉ vì user bấm nhầm `Lưu & đánh dấu đã sản xuất` sớm nhưng tỷ lệ vẫn còn trong `100% - 110%`; case này admin xử lý tay.
- Sau khi nhập/sửa/xóa thành phẩm, việc đồng bộ trạng thái ngăn phải tuân theo logic của module Kho nguyên liệu, không dùng rule cũ mâu thuẫn.

### Rule sửa transaction thành phẩm

- Modal sửa ở `src/app/dashboard/product/page.tsx` là modal sửa theo transaction cụ thể, không phải header chung của cả phiếu.
- Trong modal sửa phải hiện rõ `ngan_id` của transaction đang sửa và cho đổi trực tiếp tại đó.
- Danh sách ngăn trong modal sửa vẫn theo rule chọn ngăn của Thành phẩm, nhưng được phép giữ lại ngăn hiện tại của transaction để tránh mất dấu dữ liệu cũ khi ngăn đó không còn nằm trong trạng thái chọn bình thường.
- `pallet` là dữ liệu nhiều giá trị; UI sửa phải dùng kiểu chọn nhiều giá trị rõ ràng, không dùng input text thô.
- `ca`, `bọc`, `pallet`, `thảm` nên là nhóm chọn nhanh dễ bấm, dễ đọc để người dùng không nhầm giữa header phiếu và dòng nhập.
- Modal sửa nên hiển thị thêm thông tin tỷ lệ dự kiến của ngăn sau lưu để cảnh báo sớm trước khi bấm lưu.

## 5. Kiểm nghiệm và Xuất hàng

- Luồng chính phải giữ:
  - `Tròn lô -> Kiểm nghiệm`
  - `Kiểm nghiệm Đạt hạng -> Xuất hàng`
  - `Xuất hàng -> Không cho sửa lô`
  - `Ngăn có nguyên liệu -> Mới tạo Thành phẩm`
- Lô `Xuất hàng` không được phép sửa/xóa theo luồng thành phẩm.
- Logic `Xuất hàng` phải reconcile theo snapshot `export_orders` đọc lại từ DB, không tin snapshot cục bộ.

## 6. Sản lượng

- Khóa nghiệp vụ chuẩn của `production_records` là `factory_id + ngay + doi + so_xe + chuyen`.
- Preview import phải cảnh báo:
  - trùng trong cùng file
  - trùng với dữ liệu đã có trong hệ thống
- Nếu file tự chứa nhiều dòng trùng cùng khóa thì phải chặn import.
- Import phải chủ động đọc trước dữ liệu hiện có để:
  - `insert` dòng chưa tồn tại
  - `update` dòng đã tồn tại đúng khóa
  - dọn bản ghi trùng cũ nếu lịch sử dữ liệu đã bị lỗi
- Sau import/sửa/xóa thủ công, phải write-back sang Điều xe.
- Thêm/sửa/xóa thủ công trong Sản lượng chỉ dành cho `admin`.

## 7. UI filter và thống kê

### Điều xe

- Danh sách và Thống kê có filter `Loại nguyên liệu` dạng `multi-select`.
- Filter này phải kết hợp được với `Ghi chú`.
- Thống kê phải hiển thị tổng bảng phân xe, tổng chuyến, tổng km, khối lượng tươi/khô theo loại.
- Không để text mojibake; mọi text phải là Unicode tiếng Việt bình thường.

### Sản lượng

- Danh sách và Thống kê có filter `Loại nguyên liệu` dạng `multi-select`.
- Danh sách hiển thị theo ngày, bấm mở rộng mới thấy chi tiết từng dòng.
- Header ngày phải có tổng `Tươi/Khô` và action của ngày.
- Thống kê phải hiển thị được khối lượng các loại nguyên liệu tươi/khô.
