---
description: Quy định trung tâm cho dữ liệu thêm nhanh trong Cài đặt / Cấu hình nhà máy
---

# Settings Master Data

## 1. Mục tiêu

File này là nguồn quy định trung tâm cho toàn bộ danh mục "thêm nhanh" trong:

- `Cài đặt`
- `Cấu hình nhà máy`

Các file module đơn lẻ chỉ nên tham chiếu tới file này, không lặp lại toàn bộ logic chi tiết nếu không thật sự cần thiết.

## 2. Nguyên tắc chung

- Mọi danh mục thêm nhanh phải tách theo `factory_id`, trừ khi đó là danh mục hệ thống dùng chung toàn app
- Nguồn chuẩn là database, không hard-code rải rác trong UI
- Nếu UI cần fallback để tránh gãy màn hình thì fallback chỉ là tạm thời, không phải nguồn nghiệp vụ chuẩn
- Các thao tác thêm, sửa, xóa trong `Cài đặt` không được làm thay đổi dữ liệu lịch sử đã chốt trên chứng từ
- Các module nghiệp vụ khi dùng danh mục thêm nhanh phải đọc từ bảng master tương ứng

## 3. Danh mục theo tab

### Tab Cấu hình nhà máy

#### Inventory

- `inventory_warehouses`
- `inventory_item_categories`
- `inventory_items`

#### Dispatch

- `dispatch_delivery_points`
- `dispatch_drivers`

#### EUDR

- `forest_plots`

### Tab Danh mục

- `suffixes` — Hậu tố lô (đổi tên từ "Hậu tố mã lô")
- `factories` — Thông tin công ty (đọc từ factory hiện tại, sub-tab "Thông tin công ty")
- `customers` — Khách hàng

### Tab Bảo trì

- `maintenance_assets` — Thiết bị
- `maintenance_staff` — Nhân sự bảo trì
- `dispatch_vehicles` + `dispatch_vehicle_driver_assignments` — Xe & Tài xế
- `maintenance_external_materials` — Vật tư ngoài (mua ngoài)

### Bảng hệ thống dùng chung (không theo factory_id)

- `departments` — Phòng ban chuẩn; dùng cho dropdown đăng ký tài khoản

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
- Quản trị tại: `Cài đặt → Cấu hình nhà máy → Tài xế`
- Mỗi tài xế thuộc một `factory_id`
- `name` là tên hiển thị nghiệp vụ
- `code`, `phone` là metadata mở rộng, có thể bổ sung dần
- Không dùng danh sách hard-code trong code làm nguồn chuẩn

### 4.3. Xe

- Bảng: `dispatch_vehicles`
- Vai trò: master data xe cho module `Điều xe`
- Quản trị tại: `Cài đặt → Bảo trì → Xe & Tài xế` (chuyển từ Cấu hình nhà máy — 2026-05)
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

### 4.5. Lô vườn cao su (EUDR)

- Bảng: `forest_plots`
- Vai trò: master data lô vườn cao su cho module EUDR — source of truth polygon địa lý
- Dữ liệu phải tách theo `factory_id`
- `ten` là mã ngắn duy nhất trong phạm vi nhà máy (VD: `J1T`, `B5`), dùng để khớp với `dispatch_delivery_points.phien_X[]`
- `geometry` lưu GeoJSON Polygon dạng JSONB — không chọn trong list query vì nặng
- Geometry chỉ load khi mở modal sửa (query riêng per row)
- Quản trị tại `Cài đặt → Cấu hình nhà máy → Lô vườn`
- Hỗ trợ 2 cách nhập dữ liệu:
  - Import hàng loạt qua file `.geojson` (upsert, dedup theo `ten`)
  - Thêm / sửa đơn lẻ + vẽ polygon trực tiếp trên bản đồ (leaflet + geoman)
- `is_active = false` nghĩa là tạm ngưng hiển thị trên EUDR nhưng không xóa lịch sử
- Seed dữ liệu ban đầu: `node --env-file=.env.local scripts/seed-forest-plots.mjs`
- Không hard-code danh sách lô vườn trong code; mọi mở rộng phải vào DB

### 4.6. Khách hàng

- Bảng: `customers`
- Vai trò: master data khách hàng, dùng trong module `Xuất hàng`
- Quản trị tại: `Cài đặt → Danh mục → Khách hàng`
- Có thể thêm nhanh trong module `Xuất hàng`
- Fields: `ma_kh`, `ten_kh_en`, `email`, `dia_chi`
- UI: danh sách dòng click để mở chi tiết inline (không modal toàn màn hình)
- Schema không thay đổi (không thêm cột `type`)

### 4.7. Hậu tố lô

- Bảng: `suffixes`
- Vai trò: phân loại lô sản phẩm và tạo mã lô (ký tự suffix trong mã lô, VD: `01cs/26`)
- Quản trị tại: `Cài đặt → Danh mục → Hậu tố lô` (đổi tên từ "Hậu tố mã lô")
- Ghi chú UI: "Ký tự hậu tố dùng trong mã lô (VD: 01cs/26) và phân loại lô sản phẩm"
- Hai khái niệm "hậu tố mã lô" và "hậu tố lô" là cùng một bảng, chỉ khác cách gọi
- Giá trị rỗng (không có hậu tố) là trường hợp mặc định, không cần lưu DB

### 4.8. Phòng ban

- Bảng: `departments`
- Vai trò: danh mục phòng ban chuẩn dùng chung toàn app (không theo factory_id)
- Quản trị: hiện chỉ có seed data, chưa có trang quản trị trong UI
- Dùng trong: dropdown "Phòng ban" ở trang đăng ký tài khoản (`login/page.tsx`)
- `profiles.department_id` là FK optional trỏ vào bảng này
- `profiles.department` TEXT cũ giữ nguyên (backward-compatible)
- Khi user đăng ký chọn phòng ban từ dropdown → lưu `department = department.name` (backward-compat)
- Seed 9 phòng ban: PHK, KTNN, QLCL, KHXD, TCKT, TCHC, TTBV, NMCB, CS

### 4.9. Vật tư ngoài (bảo trì)

- Bảng: `maintenance_external_materials`
- Vai trò: gợi ý tên vật tư mua ngoài khi tạo biên bản bảo trì
- Quản trị tại: `Cài đặt → Bảo trì → Vật tư ngoài`
- Fields hiện tại: `ten_vat_tu`, `dvt`, `code`, `specification`, `category_id`, `is_active`
  - `code` — mã vật tư (optional, unique per factory)
  - `specification` — quy cách / đặc tính
  - `category_id` — nhóm vật tư (tái dùng `inventory_item_categories`)
  - `is_active` — trạng thái hiển thị

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
