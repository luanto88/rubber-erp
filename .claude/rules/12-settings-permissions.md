---
description: Module Cài đặt, master data, duyệt tài khoản và phân quyền
---

# Module Cài đặt & Permissions

## Vai trò của module Cài đặt

`Cài đặt` là nơi quản trị tập trung cho tất cả:

- Master data dùng chung
- Cấu hình hệ thống theo nhà máy
- Người dùng
- Phân quyền

Bất kỳ danh mục dùng chung nào phát sinh sau này cũng phải được đưa về `Cài đặt`, dù vẫn có thể giữ thao tác thêm nhanh ở module nghiệp vụ.

## Tổ chức giao diện (cấu trúc hiện tại)

`Cài đặt` có 4 tab chính:

| Tab | Icon | Sub-tab |
|---|---|---|
| **Hệ thống** | ShieldCheck | Người dùng, Phân quyền |
| **Cấu hình nhà máy** | SlidersHorizontal | Kho, Nhóm vật tư, Vật tư, Điểm giao nhận, Tài xế, Tài xế chính, Lô vườn |
| **Danh mục** | Database | Hậu tố lô, Thông tin công ty, Khách hàng |
| **Bảo trì** | Wrench | Thiết bị, Nhân sự bảo trì, Xe & Tài xế, Vật tư ngoài |

### Nguyên tắc xếp chức năng

- Cấu hình matrix theo nhà máy → `Cấu hình nhà máy`
- Master data / danh mục dùng chung → `Danh mục`
- Domain bảo trì (đủ lớn) → tab `Bảo trì` riêng

### Chi tiết từng tab

**Tab Hệ thống:**
- Sub-tab `Người dùng` — danh sách tài khoản (chờ duyệt / đang hoạt động / đã khóa)
- Sub-tab `Phân quyền` — gán quyền theo module cho từng user

**Tab Cấu hình nhà máy:**
- Kho vật tư, Nhóm vật tư, Vật tư/Hóa chất (inventory)
- Tài xế (dispatch_drivers)
- Tài xế chính theo xe (dispatch_vehicle_driver_assignments)
- Điểm giao nhận (dispatch_delivery_points)
- Lô vườn (forest_plots) — thêm/sửa/xóa, import GeoJSON, vẽ polygon trên bản đồ
- **Không còn sub-tab Xe** (đã chuyển sang tab Bảo trì)

**Tab Danh mục:**
- Sub-tab `Hậu tố lô` — bảng `suffixes` (đổi tên từ "Hậu tố mã lô")
- Sub-tab `Thông tin công ty` — đọc/ghi bảng `factories` cho nhà máy hiện tại
- Sub-tab `Khách hàng` — bảng `customers`, dạng danh sách dòng click-to-expand

**Tab Bảo trì:**
- Sub-tab `Thiết bị` — bảng `maintenance_assets`
- Sub-tab `Nhân sự bảo trì` — bảng `maintenance_staff`
- Sub-tab `Xe & Tài xế` — bảng `dispatch_vehicles` + `dispatch_vehicle_driver_assignments` (chuyển từ Cấu hình nhà máy)
- Sub-tab `Vật tư ngoài` — bảng `maintenance_external_materials` (fields: mã, tên, ĐVT, quy cách, nhóm, trạng thái)

## Danh mục quản trị tập trung

Tối thiểu gồm:

- Xe & Tài xế (`dispatch_vehicles`, `dispatch_drivers`)
- Hậu tố lô (`suffixes`)
- Khách hàng (`customers`)
- Cấu hình nhà máy / matrix sản phẩm
- Người dùng và phân quyền
- Thiết bị và nhân sự bảo trì (`maintenance_assets`, `maintenance_staff`)
- Vật tư ngoài (`maintenance_external_materials`)

## Quy tắc thao tác nhanh

Một số module nghiệp vụ được phép có nút thêm nhanh:

- Thêm khách hàng (trong `Xuất hàng`)
- Thêm hậu tố (trong `Thành phẩm`)
- Thêm `loai_pallet_sx`, `loai_pallet_xuat` (trong các màn liên quan)

Nhưng dữ liệu tạo ra phải:

- lưu vào database
- gán đúng nhà máy liên quan nếu là cấu hình theo nhà máy
- xuất hiện lại trong `Cài đặt`

## Đăng ký và duyệt tài khoản

### Đăng ký

- User tự đăng ký bằng `Supabase Auth`
- App tạo thêm hồ sơ trong bảng `profiles`
- Trạng thái ban đầu → `pending`
- Form đăng ký có dropdown `Phòng ban` load từ bảng `departments` (9 phòng ban chuẩn)
- Khi đăng ký, `department` (TEXT) được lưu = tên phòng ban đã chọn (backward-compat)

### Duyệt

Admin hoặc người có quyền `users.approve` duyệt trong `Cài đặt → Hệ thống → Người dùng`.

Khi duyệt tài khoản, cần gán:

- `factory_id`
- `role`
- bộ permission chi tiết

Khi duyệt:

- bắt buộc chọn `role + permissions`
- cập nhật `status = active`
- lưu `approved_by`, `approved_at`

### Khóa tài khoản

- Admin có thể khóa tài khoản `active`
- Khi khóa:
  - `status = disabled`
  - lưu `disabled_by`
  - lưu `disabled_at`
- Tài khoản `disabled` không được vào ứng dụng

## Phân quyền

Mô hình quyền:

`module + action chuẩn`, thêm một số action đặc biệt

### Action chuẩn

- `view`
- `create`
- `edit`
- `delete`

### Action đặc biệt

- `import`
- `export_file`
- `print`
- `approve`
- `manage_config`
- `quick_add`
- `mark_completed`
- `delete_order`

### Ví dụ

- `dispatch.view`
- `dispatch.import`
- `product.mark_completed`
- `export.delete_order`
- `settings.manage_config`
- `users.approve`
- `users.edit_permission`

## Rule về UI và logic

- User không có quyền thì không hiện hoặc disable nút liên quan
- Nhưng phải có guard ở logic thao tác, không chỉ ẩn UI
- Mọi action nhạy cảm như xóa, import, duyệt, sửa config phải check quyền thật

## Gợi ý role tổng quát

- `admin`: toàn quyền
- `manager`: nghiệp vụ rộng, không mặc định quản trị user/config nếu không được cấp thêm
- `user`: quyền theo cấp phát
- `customer`: xem khu vực được mở, chủ yếu là truy xuất
