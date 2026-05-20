---
description: Roadmap phát triển
---

# Roadmap

## Phase A - Chuẩn hóa nền tảng

- Chuẩn hóa tài liệu `CLAUDE.md` và `rules`
- Đưa matrix cấu hình nhà máy vào spec riêng
- Đưa master data và phân quyền về `Cài đặt`
- Chuẩn hóa đăng ký, duyệt tài khoản, permission guard

## Phase B - Hoàn thiện nghiệp vụ

- Chuẩn hóa cấu hình runtime trong database thay vì hard-code
- Đưa danh mục điểm giao nhận của điều xe sang bảng `dispatch_delivery_points` và quản trị trong `Cài đặt`
- Đưa danh mục xe sang `dispatch_vehicles`, tài xế sang `dispatch_drivers`
- Đưa lịch sử tài xế chính theo xe sang `dispatch_vehicle_driver_assignments`
- Hoàn thiện flow:
  - chọn xe tự hiện tài xế chính
  - vẫn cho phép override tài xế trên từng chuyến điều xe
  - chỉ tạo dòng lịch sử mới khi đổi tài xế chính trong cấu hình
- Phạm vi seed mặc định hiện tại chỉ áp dụng cho nhà máy `Phước Hòa Kampong Thom` (`phuochoa_kt`)
- Hoàn thiện quan hệ `Thành phẩm <-> Xuất hàng`
- Hoàn thiện quản lý remaining và rollback trạng thái lô khi xóa đơn
- Chuẩn hóa `Thảm` về 2 giá trị `Cũ`, `Mới`

## Phase C - Dashboard và báo cáo

- Biểu đồ sản lượng theo tháng
- Biểu đồ KL khô theo chủng loại
- Biểu đồ tỷ lệ đạt kiểm nghiệm
- Báo cáo tổng hợp / PDF / in ấn

## Phase D - Tiếp tục mở rộng

- EUDR đã triển khai, tiếp tục hoàn thiện
- Bảo trì máy móc
- Quản lý kho vật tư
- Nâng cấp responsive và browser compatibility

## Checklist hoàn tất cho luồng xe và tài xế

- Có tab `Cấu hình nhà máy > Xe & tài xế`
- Có thể quản lý tài xế
- Có thể quản lý xe
- Có thể xem lịch sử tài xế chính theo xe
- Màn `Điều xe` lấy tài xế chính từ database
- Chứng từ `dispatch_entries.rows[]` vẫn giữ snapshot `so_xe` và `tai_xe`
- Đổi tài xế trên chứng từ không làm thay master data
