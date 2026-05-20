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
- Đưa danh mục điểm giao nhận của điều xe sang `dispatch_delivery_points`
- Đưa danh mục xe sang `dispatch_vehicles`
- Đưa danh mục tài xế sang `dispatch_drivers`
- Đưa lịch sử tài xế chính theo xe sang `dispatch_vehicle_driver_assignments`
- Hoàn thiện flow:
  - chọn xe tự hiện tài xế chính
  - vẫn cho phép override tài xế trên từng chuyến điều xe
  - chỉ tạo dòng lịch sử mới khi đổi tài xế chính trong cấu hình
- Hoàn thiện quan hệ `Thành phẩm <-> Xuất hàng`
- Hoàn thiện quản lý remaining và rollback trạng thái lô khi xóa đơn

## Phase C - Dashboard và báo cáo

- Biểu đồ sản lượng theo tháng
- Biểu đồ KL khô theo chủng loại
- Biểu đồ tỷ lệ đạt kiểm nghiệm
- Báo cáo tổng hợp / PDF / in ấn

## Phase D - Tiếp tục mở rộng

- EUDR
- Bảo trì máy móc
- Quản lý kho vật tư
- Nâng cấp responsive và browser compatibility

## Tham chiếu rule trung tâm

Quy định chi tiết cho danh mục thêm nhanh trong `Cài đặt / Cấu hình nhà máy` xem tại:

- `.claude/rules/04-settings-master-data.md`
