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

## Phase D - Tiếp tục mở rộng ✅ Hoàn thành

- EUDR ✅
- Bảo trì máy móc ✅
- Quản lý kho vật tư ✅
- Module Sản lượng ✅
- Nâng cấp responsive và browser compatibility (đang tiếp tục)

## Phase E - ISO & Văn bản nội bộ

Thay thế AppSheet + Google Apps Script cho workflow ký duyệt tài liệu.

### Giai đoạn 1 ✅ Hoàn thành (2026-05-22)

- Migration SQL: 5 bảng (`sign_pins`, `iso_documents`, `van_ban_documents`, `doc_approval_log`, `notifications`)
- API routes: `/api/sign/set-pin`, `/api/sign/verify`, `/api/sign/generate-pdf`
- Settings tab "ISO & Văn bản" — chữ ký cá nhân (upload ảnh + đặt PIN)
- Packages: `pdf-lib`, `pdfjs-dist`, `@react-pdf/renderer`, `bcryptjs`, `jose`, `react-draggable`, `re-resizable`

### Giai đoạn 2 ✅ Hoàn thành (2026-05-22)

- Module ISO shell (`iso-shell.tsx`), KPI overview page, danh sách + bộ lọc
- Form tạo/xem/ký duyệt (`/documents/[id]/page.tsx`) — workflow Cấp 1/Cấp 2, PIN modal, Soát xét auto-invalidate
- My-tasks page
- Sidebar navigation group "ISO & Văn bản"

### Giai đoạn 2 (phần 2) ⏳ Pending

- Drag-and-drop signature placement UI (pdfjs-dist canvas + react-draggable + re-resizable)

### Giai đoạn 3 ⏳ Pending

- Module Văn bản (`/dashboard/documents/`): shell, CRUD, upload
- Vòng ký phòng ban Cấp 1 (tuần tự) + Cấp 2 (trực tiếp)
- Logic "Không ký" / trả về với lý do
- Mật vs Thường email routing
- Thông báo Email + Telegram

### Giai đoạn 4 ⏳ Pending

- Trang in (bypass sidebar)
- In-app notification bell (Supabase Realtime subscribe `notifications` table)
- QR public view cho PDF đã ký

Tham chiếu chi tiết: `.claude/rules/16-iso-vanban-module.md`

## Tham chiếu rule trung tâm

Quy định chi tiết cho danh mục thêm nhanh trong `Cài đặt / Cấu hình nhà máy` xem tại:

- `.claude/rules/04-settings-master-data.md`
