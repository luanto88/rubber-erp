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
