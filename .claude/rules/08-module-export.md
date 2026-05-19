---
description: Module xuất hàng, assignments, EUDR
---

# Module Xuất hàng

## Schema chính (`export_orders`)

```ts
{
  id: UUID,
  factory_id: UUID,
  ma_don: string,
  ngay: date,
  so_thong_bao: string,
  so_hoa_don: string,
  so_hop_dong: string,
  customer_id: UUID,
  chung_loai: string,
  loai_pallet: string,
  loai_banh: number,
  loai_boc: string,
  vehicles: Vehicle[],
  assignments: Assignment[],
  tong_banh: number,
  yeu_cau_chi_tieu: object[],
  files: object[],
}

type Vehicle = {
  id: string,
  loai_xe: string,
  bien_truoc: string,
  bien_sau: string,
  ghi_chu: string,
  image_url_1?: string,
  image_url_2?: string,
  image_url_3?: string,
}
```

## Rule `loai_pallet_xuat`

`du_lieu_nha_may.xlsx` là source cao nhất cho `loai_pallet_xuat`.

Rule chính thức:

- `loai_pallet_xuat` chỉ lọc theo `nhà máy`
- Giá trị mặc định ban đầu lấy từ Excel
- Giá trị mở rộng runtime được lưu vào database theo đúng nhà máy
- UI có nút `+` bên phải ô chọn để thêm mới
- Giá trị thêm mới phải được dùng lại cho lần sau của cùng nhà máy

### NMPHK

- `Rời`
- `Pallet sắt đế gỗ`

### NMCP

- `Rời`
- `PE đế gỗ`
- `PE đế nhựa`
- `Pallet gỗ`
- `MB4`
- `MB5`

## Rule `loai_boc`

- `loai_boc` phải filter theo `nhà máy + dây chuyền + chủng loại`
- Không dùng danh sách chung hard-code cho tất cả nhà máy

## Mã đơn

```ts
ma_don = `XH-${ma_kh}-${so_thong_bao}-${ddmmyy(ngay)}`;
```

- Read-only
- Chỉ auto tạo khi đủ thông tin
- Edit mode giữ nguyên mã đã lưu

## Chọn lô và remaining

- Hiển thị lô có `trang_thai IN ("Hoàn thành", "Xuất hàng")`
- Chỉ đưa lô vào panel nếu còn `remaining > 0`
- `remaining` = tổng số kiện của lô - tổng đã gán trong các đơn khác
- Nếu bộ lọc lot picker không ra lô, kiểm tra trước tiên:
  - chuỗi `trang_thai` của query có đúng tiếng Việt chuẩn
  - chuỗi `loai_boc`, `loai_pallet`, `chỉ tiêu` có bị sai chính tả hoặc lỗi mã hóa không
  - text tìm kiếm `ma_lo` có đang được normalize đúng không

## Quan hệ với Thành phẩm

- Xuất hết remaining -> lô chuyển `Xuất hàng`
- Còn remaining -> giữ `Hoàn thành`
- Xóa đơn hàng -> phải tính lại remaining của từng lô
- Nếu lô có hàng khả dụng trở lại sau khi xóa đơn -> quay về `Hoàn thành`

### Rule KN lại từ flow Xuất hàng

- Nếu người dùng kéo 1 lô `rớt hạng` trong form `Xuất hàng`, hệ thống được phép mở flow `Kiểm nghiệm lại`
- Draft form `Xuất hàng` chỉ được lưu tạm bằng `sessionStorage` để giữ UI state; đây không phải source of truth nghiệp vụ
- Sau khi lưu KN lại:
  - nếu flow được mở từ `Xuất hàng` thì quay lại form `Xuất hàng` và khôi phục draft
  - nếu kết quả KN lại `đạt hạng` thì lô đó tự động nằm lại trên đúng xe mà người dùng vừa định kéo vào
  - nếu kết quả vẫn `rớt hạng` thì vẫn quay lại form `Xuất hàng`, giữ draft nhưng không gán lô lên xe
- Nếu người dùng mở `Kiểm nghiệm lại` trực tiếp trong module `Kiểm nghiệm` thì save xong không được tự động quay về form `Xuất hàng`

### Rule đồng bộ khi xóa đơn xuất

- Khi xóa 1 `export_order`, không update trạng thái lô theo kiểu cứng nhắc
- Bắt buộc tính lại theo các đơn xuất còn lại:
  - `remaining <= 0` -> `Xuất hàng`
  - `remaining > 0` -> `Hoàn thành`
- Kết quả tính lại phải phản ánh ngay ở module `Thành phẩm` theo hướng đồng bộ 2 chiều

## Khách hàng

- Có thao tác tạo nhanh trong module `Xuất hàng`
- Đồng thời phải có trang quản trị đầy đủ trong `Cài đặt`

## EUDR

EUDR đã được triển khai, không còn là ý tưởng tương lai.

- Module: `/dashboard/eudr`
- Chuỗi truy xuất chính: `export_orders -> lots -> ngans -> dispatch_entries`
- Từ `dispatch_entries.rows[].diem_gn` và `phiên`, hệ thống phải tra bảng `dispatch_delivery_points` theo `factory_id` để suy ra `lô thu hoạch`
- Không dùng một danh sách điểm giao nhận hard-code chung cho tất cả nhà máy làm source of truth
- Hỗ trợ QR code, zip file, file đính kèm

## Ngôn ngữ giao diện

- Session `Xuất hàng` phải hiển thị tiếng Việt có dấu, đúng chính tả
- Session `Xuất hàng` hiện tại phải đồng bộ cách gọi số lượng theo thuật ngữ nghiệp vụ là `bánh`
- Các nhãn quan trọng cần giữ đúng dạng chuẩn: `Xuất hàng`, `Tạo đơn xuất`, `Tổng bánh`, `Khách hàng`, `Lô hàng`, `Yêu cầu chỉ tiêu`
