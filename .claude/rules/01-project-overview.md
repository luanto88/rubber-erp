---
description: Tổng quan dự án Rubber ERP - đọc file này đầu tiên khi bắt đầu task
---

# Rubber ERP - Project Overview

## Mục tiêu

Hệ thống ERP quản lý sản xuất cao su theo nhà máy, dây chuyền, lô thành phẩm, kiểm nghiệm, xuất hàng và truy xuất EUDR.

## Stack

- Framework: Next.js App Router
- Language: TypeScript
- Styling: Tailwind CSS
- Backend: Supabase
- Icons: lucide-react
- UI: tự viết, không dùng component library ngoài

## Multi-tenant

Hệ thống có nhiều nhà máy, mọi dữ liệu nghiệp vụ đều thuộc một `factory_id`.
Mọi query và mọi danh sách hiển thị đều phải filter theo nhà máy đang đăng nhập.

## Dây chuyền và matrix sản phẩm

Trục nghiệp vụ bắt buộc:

`Nhà máy -> Dây chuyền -> Chủng loại SP -> Loại bánh / Loại bọc / Loại thảm / Pallet`

Nguồn cao nhất cho matrix này là:

- `cung_cap_dl/du_lieu_nha_may.xlsx`

Excel là source of truth ban đầu cho:

- `loai_banh`
- `loai_boc`
- `loai_tham`
- `loai_pallet_sx`
- `loai_pallet_xuat`

Quy tắc lọc:

- `loai_pallet_xuat`: theo nhà máy
- `loai_banh`, `loai_boc`, `loai_tham`: theo `nhà máy + dây chuyền + chủng loại SP`
- `loai_pallet_sx`: theo matrix cấu hình nhà máy

## Quy tắc master data runtime

- Excel dùng để seed và đối chiếu spec ban đầu
- Database là nguồn chạy thực tế
- Giá trị mở rộng runtime theo từng nhà máy phải lưu vào database
- Không hard-code option rải rác trong từng page

Riêng danh mục điểm giao nhận của module điều xe:

- Master data được lưu trong bảng `dispatch_delivery_points`
- Dữ liệu phải filter theo `factory_id`
- `dispatch_entries.rows[].diem_gn` chỉ lưu các mã điểm đã chọn cho từng chuyến, không thay thế bảng master

## Quy tắc lô tròn

- Bánh `35` và `33.33`: 4 kiện x 36 bánh = 144 bánh
- Bánh `20`: 4 kiện x 60 bánh = 240 bánh

## Module Cài đặt

`Cài đặt` là nơi quản trị tập trung cho:

- Xe
- Hậu tố
- Khách hàng
- Cấu hình nhà máy
- Người dùng
- Phân quyền
- Các danh mục mở rộng được thêm nhanh trong module nghiệp vụ

Giao diện `Cài đặt` được tổ chức theo nhiều tab:

- `Công ty`
- `Người dùng`
- `Phân quyền`
- `Cấu hình nhà máy`
- `Danh mục`

Nguyên tắc:

- Matrix cấu hình theo nhà máy -> `Cấu hình nhà máy`
- Danh mục điểm giao nhận theo nhà máy -> `Cấu hình nhà máy`
- Master data dùng chung -> `Danh mục`
- Domain mới như `Bảo trì` ban đầu đưa vào `Danh mục`, khi đủ lớn có thể tách thành tab riêng

Module nghiệp vụ có thể giữ nút thêm nhanh, nhưng dữ liệu tạo ra phải đồng bộ về `Cài đặt`.

## Đăng ký và phân quyền

- User mới đăng ký -> `pending`
- Admin duyệt trong `Cài đặt`
- Phân quyền theo `module + action` chuẩn, thêm một số action đặc biệt

## Modules chính

- `dispatch`: Điều xe
- `storage`: Kho nguyên liệu / Ngăn lưu / Hồ chứa
- `product`: Thành phẩm
- `quality`: Kiểm nghiệm
- `export`: Xuất hàng
- `eudr`: Truy xuất chuỗi cung ứng
- `settings`: Quản trị danh mục, cấu hình, user, phân quyền
