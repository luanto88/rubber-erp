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

## Phase C - Dashboard và báo cáo ✅ Hoàn thành

- Biểu đồ sản lượng theo tháng ✅ (`dashboard/page.tsx` — bar chart CSR, pie chart trạng thái lô, area chart xuất hàng theo tháng)
- Biểu đồ KL khô theo chủng loại ✅
- Biểu đồ tỷ lệ đạt kiểm nghiệm ✅ (`quality-analytics/page.tsx` — KPI "Tỷ lệ đạt"/"Tỷ lệ rớt hạng" + heatmap phân tích chỉ tiêu)
- Báo cáo tổng hợp / PDF / in ấn ✅ (đã phủ khắp module: storage, maintenance, export, process, quality, dispatch, warehouse...)

## Phase D - Tiếp tục mở rộng ✅ Hoàn thành

- EUDR ✅
- Bảo trì máy móc ✅
- Quản lý kho vật tư ✅
- Module Sản lượng ✅
- Nâng cấp responsive mobile ✅ Hoàn thành (2026-07-04) — toàn bộ module đã áp dụng 3 component dùng chung `FilterBar`/`ResponsiveTableWrapper`/`ModalShell` (xem `.claude/rules/05-ui-components.md` mục "Component dùng chung cho mobile responsive"); còn 2 khu vực kéo-thả (sơ đồ Kho Thành phẩm, đặt chữ ký/QR ISO) cố ý để sau chưa quyết định hướng xử lý mobile

## Phase E - ISO & Văn bản nội bộ

Thay thế AppSheet + Google Apps Script cho workflow ký duyệt tài liệu.

### Giai đoạn 1 ✅ Hoàn thành (2026-05-22)

- Migration SQL: 5 bảng (`sign_pins`, `iso_documents`, `van_ban_documents`, `doc_approval_log`, `notifications`)
- API routes: `/api/sign/set-pin`, `/api/sign/verify`, `/api/sign/generate-pdf`
- Settings tab "ISO & Văn bản" — chữ ký cá nhân (upload ảnh + đặt PIN)
- Packages: `pdf-lib`, `pdfjs-dist`, `bcryptjs`, `jose`, `react-draggable`, `re-resizable`

### Giai đoạn 2 ✅ Hoàn thành (2026-05-22)

- Module ISO shell (`iso-shell.tsx`), KPI overview page, danh sách + bộ lọc
- Form tạo/xem/ký duyệt (`/documents/[id]/page.tsx`) — workflow Cấp 1/Cấp 2, PIN modal, Soát xét auto-invalidate
- My-tasks page
- Sidebar navigation group "ISO & Văn bản"

### Giai đoạn 2 (phần 2) ✅ Hoàn thành

- Drag-and-drop signature placement UI (pdfjs-dist canvas + react-draggable + re-resizable)
- Preview chữ ký và tên người ký thành 2 lớp độc lập
- Fill tag header/footer trực tiếp trên file PDF gốc, không tạo trang phiếu ký duyệt riêng

### Giai đoạn 3 ✅ Hoàn thành

- Module Văn bản (`/dashboard/documents/`): shell, CRUD, upload ✅
- Vòng ký phòng ban Cấp 1 (tuần tự) + Cấp 2 (trực tiếp) ✅
- Logic "Không ký" / trả về với lý do ✅
- Mật vs Thường email routing ✅ (phân loại Thường/Mật, routing người nhận riêng)
- Thông báo Email + Telegram ✅

### Giai đoạn 4 ✅ Hoàn thành

- Trang in (bypass sidebar) — đã xoá hẳn phiên 2026-09-03 (`documents/print/` + nút "In"), xem CLAUDE.md; xem file đã ký thật qua nút "Xem file" thay thế
- In-app notification bell ✅ (`Bell` icon + `notifications` state trong `dashboard/layout.tsx`)
- QR public view cho PDF đã ký ✅ (`qr_url` trong `iso_documents`)

### Giai đoạn 5 ✅ Hoàn thành (2026-07-04)

- Nội bộ đơn vị: người phê duyệt cuối tự động xác định qua "lãnh đạo phòng ban" (API mới `/api/documents/dept-leader`) thay vì chọn tay ✅
- `cap_tl`/`phan_loai` khóa cứng `Cấp 1`/`Thường` cho luồng Nội bộ đơn vị, bước "Ký xác nhận" chuyển thành tùy chọn ✅

Chi tiết đầy đủ module Văn bản: xem `.claude/rules/22-documents-module.md`.

Tham chiếu chi tiết: `.claude/rules/16-iso-vanban-module.md`

## Tham chiếu rule trung tâm

Quy định chi tiết cho danh mục thêm nhanh trong `Cài đặt / Cấu hình nhà máy` xem tại:

- `.claude/rules/04-settings-master-data.md`
