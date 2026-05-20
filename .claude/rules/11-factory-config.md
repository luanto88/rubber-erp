---
description: Source of truth và cấu hình nhà máy cho matrix sản phẩm
---

# Factory Config Matrix

## Source of truth

File:

- `cung_cap_dl/du_lieu_nha_may.xlsx`

là source of truth cao nhất cho:

- `loai_banh`
- `loai_boc`
- `loai_tham`
- `loai_pallet_sx`
- `loai_pallet_xuat`

## Cách diễn giải

- Excel = dữ liệu chuẩn ban đầu để seed và đối chiếu spec
- Database = nguồn chạy thực tế
- Giá trị mở rộng runtime của từng nhà máy được lưu vào database

Không ghi ngược giá trị runtime vào file Excel.

## Quy tắc lọc

### Theo nhà máy

- `loai_pallet_xuat`
- `dispatch_delivery_points`

### Theo nhà máy + dây chuyền + chủng loại SP

- `loai_banh`
- `loai_boc`
- `loai_tham`

### Theo matrix cấu hình nhà máy

- `loai_pallet_sx`

## Rule `loai_tham`

- Tên cột cấu hình: `loai_tham`
- Ý nghĩa: loại thảm ngăn cách các bánh mủ
- UI hiển thị: `Thảm`
- Là dropdown
- Dữ liệu sử dụng 2 giá trị chuẩn: `Cũ`, `Mới`
- Khi đọc dữ liệu cũ phải normalize các giá trị lệch về `Cũ` hoặc `Mới`

## Cấu hình mặc định theo Excel

### NMPHK

- `Mủ tạp / 10`
  - `loai_banh`: `35`
  - `loai_boc`: `Bọc trơn 0,04`, `Bọc nhãn 0,04 VRG CSR10`
  - `loai_pallet_sx`: `Pallet sắt đế gỗ`, `Pallet sắt mỏng`, `Pallet MB5`, `Pallet gỗ`
  - `loai_pallet_xuat`: `Rời`, `Pallet sắt đế gỗ`
- `Mủ tạp / 20`
  - `loai_banh`: `35`
  - `loai_boc`: `Bọc trơn 0,04`, `Bọc nhãn 0,04 VRG CSR20`
  - `loai_pallet_sx`: như trên
  - `loai_pallet_xuat`: như trên
- `Mủ nước / L`
  - `loai_banh`: `35`, `33.33`
- `Mủ nước / 3L`
  - `loai_banh`: `35`, `33.33`
- `Mủ nước / CV50`
  - `loai_banh`: `35`, `20`
- `Mủ nước / CV60`
  - `loai_banh`: `35`, `20`

### NMCP

- `Mủ tạp / 10`
  - `loai_banh`: `35`
  - `loai_boc`: `Bọc trơn 0,04`, `Bọc nhãn 0,04 VRG SVR10`
  - `loai_pallet_sx`: `Pallet sắt đế gỗ`, `Pallet sắt đế nhựa`, `Pallet sắt mỏng`, `Pallet MB5`, `Pallet gỗ`
  - `loai_pallet_xuat`: `Rời`, `PE đế gỗ`, `PE đế nhựa`, `Pallet gỗ`, `MB4`, `MB5`
- `Mủ tạp / 20`
  - `loai_banh`: `35`
  - `loai_boc`: `Bọc trơn 0,04`, `Bọc nhãn 0,04 VRG SVR20`
  - `loai_pallet_sx`: như trên
  - `loai_pallet_xuat`: như trên
- `Mủ nước / L`
  - `loai_banh`: `35`, `33.33`
- `Mủ nước / 3L`
  - `loai_banh`: `35`, `33.33`
- `Mủ nước / CV50`
  - `loai_banh`: `35`, `20`
- `Mủ nước / CV60`
  - `loai_banh`: `35`, `20`

## Cấu hình runtime trong database

Hệ thống phải có cấu hình nhà máy để vận hành thực tế, có thể thiết kế theo logic của Excel và cho phép chỉnh sửa toàn bộ.

Nhóm cấu hình này phải hỗ trợ:

- chỉnh `loai_banh`
- chỉnh `loai_boc`
- chỉnh `loai_tham`
- chỉnh `loai_pallet_sx`
- chỉnh `loai_pallet_xuat`
- lưu giá trị mở rộng theo từng nhà máy

## Điểm giao nhận trong cấu hình nhà máy

Danh mục điểm giao nhận thuộc nhóm cấu hình theo nhà máy, không phải danh mục dùng chung toàn hệ thống.

Rule chính thức:

- Dữ liệu lưu trong bảng `dispatch_delivery_points`
- Quản trị tại `Cài đặt -> Cấu hình nhà máy -> Điểm giao nhận`
- Mỗi điểm gồm tối thiểu: `ma_lo`, `doi`, `lat`, `lng`, `phien_a`, `phien_b`, `phien_c`, `phien_d`, `sort_order`, `is_active`
- Module `Điều xe` và `EUDR` phải đọc theo bảng này
- Khi chỉnh cấu hình điểm giao nhận, các lần điều xe và truy xuất sau đó phải dùng logic mới

## Lô vườn trong cấu hình nhà máy

Danh mục lô vườn cao su thuộc nhóm cấu hình theo nhà máy, quản lý data địa lý cho EUDR.

Rule chính thức:

- Dữ liệu lưu trong bảng `forest_plots`
- Quản trị tại `Cài đặt → Cấu hình nhà máy → Lô vườn`
- `ten` là key khớp với `dispatch_delivery_points.phien_X[]` — không được đổi sau khi seed
- `geometry` lưu GeoJSON Polygon JSONB — không select trong list, chỉ load khi sửa
- Import hàng loạt: upload file `.geojson`, dedup theo `ten`, upsert `onConflict: factory_id,ten`
- Vẽ polygon trực tiếp trên bản đồ trong modal form (leaflet + `@geoman-io/leaflet-geoman-free`)
- Module EUDR query DB trước, fallback file GeoJSON tĩnh nếu bảng rỗng

## Nút thêm nhanh

Trong module nghiệp vụ, `loai_pallet_sx` và `loai_pallet_xuat` có thể có nút `+`.

Rule:

- Giá trị mới chỉ áp dụng cho nhà máy đang đăng nhập
- Lưu vào database
- Tự động bổ sung vào cấu hình nhà máy để dùng cho các lần sau
