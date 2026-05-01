---
description: Quy tắc nghiệp vụ, UI và schema cho module quản lý kho vật tư hóa chất
---

# Inventory Module Rules

## Phạm vi

Module kho vật tư / hóa chất là module riêng, không dùng chung với `storage` hiện tại vì `storage` đang quản lý ngăn lưu nguyên liệu.

Module này có route riêng trong `dashboard` và có khu vực thống kê riêng.

## Quy ước kho đã chốt

- `KA` = `Kho vật tư`
- `KB` = `Kho hóa chất`
- Hóa chất là nhóm ưu tiên quản lý `số lô` và `hạn sử dụng`
- Một vật tư có thể thuộc nhiều kho; dữ liệu `kho_chứa` phải được chuẩn hóa theo danh sách kho chuẩn

## Rule dữ liệu

- Tất cả bảng của module kho phải có `factory_id`
- Các bảng dùng tiền tố `inventory_`
- `item_code` là duy nhất trong từng nhà máy
- `warehouse_code` là duy nhất trong từng nhà máy
- Nếu vật tư bật `manages_lot = true` thì phiếu nhập / xuất / chuyển phải lưu `lot_no`
- Nếu vật tư bật `manages_expiry = true` thì phiếu nhập / xuất / chuyển phải lưu `expiry_date`

## Rule tồn kho

- Không cho phép xuất kho nếu `số xuất > tồn hiện tại`
- Không cho phép xuất lô nếu `số xuất > tồn lô hiện tại`
- Cảnh báo tồn kho theo giới hạn dưới và giới hạn trên
- Cảnh báo tồn kho phải hỗ trợ theo từng kho và từng vật tư
- Cảnh báo hết hạn / sắp hết hạn Ttrước 6 tháng ưu tiên cho hóa chất
- Khi `nhập kho`, phải kiểm tra tồn sau nhập của kho đích với `giới hạn trên` và `giới hạn dưới`
- Khi `chuyển kho`, phải kiểm tra:
  - kho nguồn sau xuất có thấp hơn `giới hạn dưới` không
  - kho đích sau nhập có vượt `giới hạn trên` không
- Mặc định giai đoạn MVP: hiển thị cảnh báo trước khi ghi sổ; không tự động chặn chỉ vì vượt min-max

## Rule chứng từ

- Mã phiếu:
  - `N-MAKHO-DDMMYY/XXX`
  - `X-MAKHO-DDMMYY/XXX`
  - `C-MAKHO-DDMMYY/XXX`
- `import` = nhập kho
- `export` = xuất kho
- `transfer` = chuyển kho
- QR phiếu chỉ nên lưu URL tra cứu, không nhồi toàn bộ dữ liệu vào mã QR
- Người thực hiện phiếu là người đang đăng nhập
- Người phê duyệt phiếu là người đang đăng nhập và có quyền phê duyệt
- Trường người thực hiện không cần hiển thị trên form nghiệp vụ; dùng trong quá trình tạo và ghi phiếu ở backend / database

## Rule chọn vật tư, số lô và hạn sử dụng

- Với `Xuất kho` và `Chuyển kho`, phải chọn `kho` trước
- Danh sách vật tư phải lọc theo kho đã chọn
- Người dùng có thể chọn nhiều vật tư cùng lúc ở phần header
- Sau khi chọn vật tư, hệ thống tự sinh các dòng chi tiết tương ứng bên dưới
- Nếu cùng một vật tư cần xuất / chuyển từ nhiều lô, phải dùng thao tác `Tách lô`
- Chỉ hiển thị các `số lô` còn tồn trong kho; không hiển thị lô đã hết
- Mỗi cặp `số lô - hạn sử dụng` phải đồng bộ đúng theo dữ liệu tồn lô:
  - chọn `số lô` thì tự suy ra `hạn sử dụng`
  - chọn `hạn sử dụng` thì tự suy ra `số lô`
  - không cho phép ghép sai cặp `lô - hạn`
- Với `Nhập kho`, `số lô` và `hạn sử dụng` là dữ liệu nhập mới; không lấy từ danh sách tồn lô hiện có

## Rule kiến trúc module

- Module kho đi theo route riêng, ví dụ:
  - `/dashboard/inventory`
  - `/dashboard/inventory/receipts`
  - `/dashboard/inventory/issues`
  - `/dashboard/inventory/transfers`
  - `/dashboard/inventory/on-hand`
  - `/dashboard/inventory/cards`
  - `/dashboard/inventory/analytics`
- Trong chính module `Quản lý kho` chỉ có 2 tab lớn:
  - `Nhập xuất tồn`
  - `Thống kê`
- `Nhập`, `Xuất`, `Chuyển`, `Tồn`, `Thẻ kho` là nhóm màn con của tab `Nhập xuất tồn`
- Không đưa `Cài đặt` vào điều hướng chính của module kho
- Danh mục kho, vật tư / hóa chất, định mức phải nằm trong `/dashboard/settings`, khu vực `Cấu hình nhà máy` hoặc `Danh mục`

## Rule UI / UX

- Giao diện module kho phải bám sát pattern UI hiện có của hệ thống
- Mặc định toàn bộ nội dung hiển thị trong app phải là tiếng Việt có dấu trừ khi được yêu cầu hoặc lý do đặc biệt phải dùng tiếng Anh
- Header module kho theo bố cục gọn:
  - tên module
  - mô tả ngắn
  - nút hành động chính ở góc phải
- Card KPI phải có:
  - icon liên quan
  - số liệu chính
  - nội dung text mô tả ngắn
- Các section tĩnh có thể dùng hiệu ứng animation khi cuộn; không lạm dụng cho bảng dữ liệu động
- Với các màn `Nhập kho`, `Xuất kho`, `Chuyển kho`:
  - khối `Danh sách vật tư theo kho đã chọn` nằm chung với header `Thông tin phiếu`
  - không hiển thị trường `Người thực hiện`
  - mỗi dòng chi tiết bố cục cân đối theo từng hàng:
    - hàng 1: `Tên vật tư` - `Số lượng`
    - cảnh báo liên quan số lượng hiển thị ngay tại vùng số lượng
    - hàng 2: `Số lô` - `Hạn sử dụng`
    - hàng 3: `Hình ảnh 1` - `Hình ảnh 2`
    - hàng 4: `Ghi chú`
    - bên dưới là các thông tin và cảnh báo khác

## Rule thống kê

- Trang `inventory analytics` phải có:
  - KPI cards
  - bộ lọc theo kỳ, kho, vật tư, nhóm vật tư
  - bảng cảnh báo
  - biểu đồ quản lý
  - drill-down
  - xuất file kiểm tra nhập xuất tồn

## Rule định mức

- File tham chiếu: `cung_cap_dl/kho_bao_tri/dinh_muc.xlsx`
- Định mức phải lưu theo từng nhà máy
- Báo cáo tháng tính theo công thức:
  - `định mức kế hoạch = thành phẩm trong kỳ * định mức`
  - `chênh lệch = tiêu hao thực tế - định mức kế hoạch`
- Định mức có thể bao gồm:
  - hóa chất
  - vật tư
  - dầu nhớt mỡ
  - điện
  - nước

## Rule backend

- Backend là lớp chốt cuối cho các rule tồn kho
- Nếu UI có cảnh báo nhưng backend không chặn thì xem như chưa đạt
- Trigger / function backend được phép dùng để chặn phát sinh xuất vượt tồn
