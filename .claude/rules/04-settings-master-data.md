---
description: Quy định trung tâm cho dữ liệu thêm nhanh trong Cài đặt / Cấu hình nhà máy
---

# Settings Master Data

## 1. Mục tiêu

File này là nguồn quy định trung tâm cho toàn bộ danh mục “thêm nhanh” trong:

- `Cài đặt`
- `Cấu hình nhà máy`

Các file module đơn lẻ chỉ nên tham chiếu tới file này, không lặp lại toàn bộ logic chi tiết nếu không thật sự cần thiết.

## 2. Nguyên tắc chung

- Mọi danh mục thêm nhanh phải tách theo `factory_id`, trừ khi đó là danh mục hệ thống dùng chung toàn app
- Nguồn chuẩn là database, không hard-code rải rác trong UI
- Nếu UI cần fallback để tránh gãy màn hình thì fallback chỉ là tạm thời, không phải nguồn nghiệp vụ chuẩn
- Các thao tác thêm, sửa, xóa trong `Cài đặt` không được làm thay đổi dữ liệu lịch sử đã chốt trên chứng từ
- Các module nghiệp vụ khi dùng danh mục thêm nhanh phải đọc từ bảng master tương ứng

## 3. Danh mục hiện có trong Cấu hình nhà máy

### Inventory

- `inventory_warehouses`
- `inventory_item_categories`
- `inventory_items`

### Dispatch

- `dispatch_delivery_points`
- `dispatch_drivers`
- `dispatch_vehicles`
- `dispatch_vehicle_driver_assignments`

## 4. Quy định cho từng nhóm

### 4.1. Điểm giao nhận

- Bảng: `dispatch_delivery_points`
- Vai trò: master data điểm giao nhận cho `Điều xe` và các logic liên quan
- Dữ liệu phải tách theo `factory_id`
- `ma_lo` là mã điểm giao nhận duy nhất trong phạm vi từng nhà máy
- `is_active = false` nghĩa là tạm ngưng sử dụng trên UI nhưng không xóa lịch sử

### 4.2. Tài xế

- Bảng: `dispatch_drivers`
- Vai trò: master data tài xế cho module `Điều xe`
- Mỗi tài xế thuộc một `factory_id`
- `name` là tên hiển thị nghiệp vụ
- `code`, `phone` là metadata mở rộng, có thể bổ sung dần
- Không dùng danh sách hard-code trong code làm nguồn chuẩn

### 4.3. Xe

- Bảng: `dispatch_vehicles`
- Vai trò: master data xe cho module `Điều xe`
- Mỗi xe thuộc một `factory_id`
- `code` là mã xe nghiệp vụ như `1B`, `4A`, `X01`
- `name` là tên xe hiển thị
- `vehicle_type` là nhóm xe
- `plate_number` là thông tin mở rộng nếu có

### 4.4. Tài xế chính theo xe

- Bảng: `dispatch_vehicle_driver_assignments`
- Vai trò: lưu lịch sử gán tài xế chính theo xe
- Một xe có thể có nhiều dòng lịch sử theo thời gian
- Tại một thời điểm chỉ nên có 1 dòng hiện hành với `is_current = true`
- Khi đổi tài xế chính:
  - đóng dòng hiện hành bằng `effective_to`
  - set `is_current = false`
  - insert dòng mới với `effective_from` mới và `is_current = true`
- Không sửa đè lịch sử cũ nếu mục tiêu là lưu vết thay đổi

## 5. Quy định khi dùng trong Điều xe

- Khi chọn xe, hệ thống phải tự điền tài xế chính hiện hành theo `dispatch_vehicle_driver_assignments`
- Người dùng vẫn được phép override tài xế trên từng dòng điều xe
- Override trên chứng từ chỉ làm thay đổi snapshot của chuyến đó
- Override trên chứng từ không được tự động cập nhật master data xe/tài xế chính
- `dispatch_entries.rows[].so_xe` và `dispatch_entries.rows[].tai_xe` là snapshot lịch sử, phải được giữ nguyên sau khi lưu

## 6. Seed mặc định hiện tại

- Seed master data xe và tài xế hiện tại chỉ áp dụng cho nhà máy:
  - `factories.code = 'phuochoa_kt'`
  - `Phước Hòa Kampong Thom`
- Nếu cần cho nhà máy khác thì phải seed riêng, không dùng chung mặc định

## 7. Quy tắc tài liệu

- Logic chi tiết của danh mục thêm nhanh phải được mô tả ở file này trước
- File module như `06-module-production.md` chỉ nên giữ:
  - rule nghiệp vụ đặc thù của module
  - tham chiếu sang file này cho phần master data
- File schema như `03-database-schema.md` chỉ nên giữ:
  - mô tả bảng và quan hệ
  - không lặp lại toàn bộ flow UI / thao tác thêm nhanh
- File roadmap như `10-roadmap.md` chỉ nên giữ:
  - trạng thái triển khai
  - không giữ chi tiết rule nghiệp vụ đã ổn định
