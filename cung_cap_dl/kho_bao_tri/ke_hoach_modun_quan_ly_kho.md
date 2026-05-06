# Kế hoạch module Quản lý kho

## 1. Quy ước đã chốt

- `KA`: Kho vật tư
- `KB`: Kho hóa chất
- Hạn sử dụng và số lô ưu tiên quản lý chặt cho nhóm hóa chất.
- Một vật tư có thể nằm ở nhiều kho; cột `kho_chua` sẽ lưu danh sách kho chuẩn, phân tách bằng dấu phẩy.
- Mã phiếu:
  - `N-MAKHO-DDMMYY/XXX`
  - `X-MAKHO-DDMMYY/XXX`
  - `C-MAKHO-DDMMYY/XXX`

## 2. Dữ liệu nguồn đã chuẩn hóa

- File sạch vật tư: [danh_muc_vat_tu.cleaned.xlsx](/c:/Users/Software/rubber-erp/cung_cap_dl/kho_bao_tri/danh_muc_vat_tu.cleaned.xlsx)
- File sạch nhập xuất tồn: [nhap_xuat_ton.cleaned.xlsx](/c:/Users/Software/rubber-erp/cung_cap_dl/kho_bao_tri/nhap_xuat_ton.cleaned.xlsx)
- Báo cáo làm sạch: [warehouse_cleaning_report.json](/c:/Users/Software/rubber-erp/cung_cap_dl/kho_bao_tri/warehouse_cleaning_report.json)
- Script chuẩn hóa: [normalize-warehouse-maintenance-data.mjs](/c:/Users/Software/rubber-erp/scripts/normalize-warehouse-maintenance-data.mjs)

## 3. Phạm vi MVP

- Module kho là một module riêng trong `dashboard`, không gộp vào `Kho nguyên liệu`.
- Danh mục kho.
- Danh mục nhóm vật tư.
- Danh mục vật tư và hóa chất.
- Phiếu nhập kho.
- Phiếu xuất kho.
- Phiếu chuyển kho.
- Tồn kho hiện tại.
- Thẻ kho.
- Cảnh báo tồn thấp, tồn cao.
- Cảnh báo sắp hết hạn, hết hạn.
- Chặn xuất kho nếu số xuất lớn hơn số tồn.
- QR tra cứu phiếu trên web.
- Đính kèm ảnh cho phiếu nhập, xuất, chuyển.
- Báo cáo nhập xuất tồn theo kỳ, theo kho, theo vật tư, theo phân loại vật tư.
- Báo cáo định mức hàng tháng theo công thức `thành phẩm trong kỳ * định mức`.

## 3.1 Cấu trúc module riêng

- `Tổng quan kho`
  - KPI nhanh
  - cảnh báo nổi bật
  - biểu đồ biến động nhập xuất tồn
- `Nghiệp vụ`
  - nhập kho
  - xuất kho
  - chuyển kho
- `Tồn kho`
  - tồn hiện tại
  - tồn theo lô / hạn
  - thẻ kho
- `Thống kê`
  - cảnh báo tồn thấp / tồn cao
  - cảnh báo sắp hết hạn / hết hạn
  - biểu đồ nhập xuất tồn theo kỳ
  - báo cáo định mức tháng
  - xuất file kiểm tra nhập xuất tồn
- `Danh mục / Cài đặt`
  - kho
  - nhóm vật tư
  - vật tư / hóa chất
  - định mức

## 3.2 Gợi ý route

- `/dashboard/inventory`
- `/dashboard/inventory/receipts`
- `/dashboard/inventory/issues`
- `/dashboard/inventory/transfers`
- `/dashboard/inventory/on-hand`
- `/dashboard/inventory/cards`
- `/dashboard/inventory/analytics`
- `/dashboard/inventory/settings`

## 4. Luồng nghiệp vụ

### 4.1 Nhập kho

- Tạo phiếu `Nháp`.
- Chọn kho nhập, ngày chứng từ, người giao, người nhận, nguồn nhập.
- Thêm các dòng vật tư.
- Với hóa chất hoặc vật tư có bật quản lý lô/hạn:
  - bắt buộc `số lô`
  - bắt buộc `hạn sử dụng`
- Ghi sổ:
  - tăng tồn kho
  - tăng tồn theo lô nếu có
  - sinh lịch sử thẻ kho
  - chốt QR tra cứu
- Trước khi ghi sổ cần cảnh báo nếu tồn sau nhập của kho đích vượt `tồn tối đa` hoặc chạm ngưỡng cảnh báo.

### 4.2 Xuất kho

- Tạo phiếu `Nháp`.
- Chọn kho xuất, bộ phận nhận, người nhận, mục đích xuất.
- Kiểm tra tồn khả dụng trước khi ghi sổ.
- Với hàng có hạn:
  - gợi ý lô theo `FEFO`
- Ghi sổ:
  - giảm tồn kho
  - giảm tồn theo lô
  - sinh lịch sử thẻ kho

### 4.3 Chuyển kho

- Tạo phiếu `Nháp`.
- Chọn kho nguồn, kho đích.
- Chọn vật tư, lô, hạn, số lượng.
- Trước khi ghi sổ cần cảnh báo:
  - kho nguồn sau chuyển có thấp hơn `tồn tối thiểu`
  - kho đích sau chuyển có vượt `tồn tối đa`
- Ghi sổ:
  - giảm tồn kho nguồn
  - tăng tồn kho đích
  - giữ nguyên lô, hạn, đơn vị tính
  - sinh 2 bút toán thẻ kho

## 5. Bộ dữ liệu chính

### 5.1 Kho

- `mã kho`
- `tên kho`
- `thủ kho`
- `loại kho`
- `đang hoạt động`

### 5.2 Nhóm vật tư

- `mã nhóm`
- `tên nhóm`
- `thứ tự`

### 5.3 Vật tư

- `mã vật tư`
- `tên vật tư`
- `đơn vị tính`
- `quy cách`
- `phân loại vật tư`
- `danh sách kho chứa`
- `có quản lý lô`
- `có quản lý hạn`
- `tồn tối thiểu`
- `tồn tối đa`
- `bật cảnh báo min-max`
- `hình ảnh`
- `thuộc thiết bị`

### 5.4 Phiếu kho

- `mã phiếu`
- `loại phiếu`
- `ngày chứng từ`
- `kho nguồn`
- `kho đích`
- `người lập`
- `người nhận`
- `người giao`
- `trạng thái`
- `ghi chú`
- `qr_url`

### 5.5 Dòng phiếu kho

- `mã vật tư`
- `tên vật tư snapshot`
- `đơn vị tính snapshot`
- `quy cách snapshot`
- `số lượng`
- `số lô`
- `hạn sử dụng`
- `vị trí`
- `ghi chú`

### 5.6 Ảnh đính kèm

- `loại phiếu`
- `phiếu`
- `đường dẫn file`
- `caption`
- `thứ tự`

## 6. Quy tắc cảnh báo

- Cảnh báo `tồn thấp` khi `tồn hiện tại < tồn tối thiểu`.
- Cảnh báo `tồn cao` khi `tồn hiện tại > tồn tối đa`.
- Cảnh báo `sắp hết hạn` theo ngưỡng 30 ngày.
- Cảnh báo `hết hạn` khi ngày hiện tại lớn hơn hạn dùng.
- Cảnh báo chỉ áp dụng với vật tư có bật cờ phù hợp.

## 7. Báo cáo MVP

- Nhập xuất tồn theo kỳ.
- Thẻ kho theo vật tư.
- Tồn kho theo kho.
- Tồn kho theo phân loại vật tư.
- Tồn kho theo lô và hạn dùng.
- Danh sách vật tư sắp hết hạn.
- Danh sách vật tư thấp hơn tối thiểu hoặc cao hơn tối đa.
- Báo cáo định mức tháng: sản lượng thành phẩm, nhu cầu định mức, tiêu hao thực tế, chênh lệch.
- Xuất file kiểm tra nhập xuất tồn để đối chiếu nội bộ.

## 8. Định mức tiêu hao

- File nguồn tham khảo: [dinh_muc.xlsx](/c:/Users/Software/rubber-erp/cung_cap_dl/kho_bao_tri/dinh_muc.xlsx)
- Mỗi dòng là một mã hoặc nhóm thành phẩm.
- Mỗi cột là một vật tư, hóa chất hoặc tài nguyên tiêu hao theo đơn vị chuẩn.
- Báo cáo tháng tính theo:
  - `định mức kế hoạch = thành phẩm trong kỳ * định mức`
  - `chênh lệch = tiêu hao thực tế - định mức kế hoạch`
- Cần lưu riêng cấu hình định mức theo từng nhà máy.

## 9. Thứ tự triển khai

1. Chuẩn hóa dữ liệu gốc và khóa danh mục kho.
2. Tạo schema Supabase cho module kho.
3. Import danh mục kho, nhóm vật tư, vật tư.
4. Import cấu hình định mức theo nhà máy.
5. Tạo màn hình danh mục admin.
6. Tạo nghiệp vụ nhập, xuất, chuyển.
7. Tạo tồn kho và thẻ kho.
8. Tạo cảnh báo.
9. Tạo QR và báo cáo.

## 10. Điểm cần lưu ý khi code

- Không dùng chung module `storage` hiện tại vì đó là quản lý ngăn lưu nguyên liệu.
- Module kho mới nên nằm tách biệt trong `dashboard`.
- Khu vực `Thống kê` của kho nên làm theo tinh thần module `quality-analytics`: có KPI, bộ lọc, cảnh báo, biểu đồ, drill-down, export.
- UI nhập liệu là Client Component.
- Nếu làm trang tra cứu QR công khai hoặc nội bộ, dùng App Router route riêng.
- Tất cả bảng module kho phải có `factory_id`.
- Kiểm tra tồn phải chạy cả ở UI lẫn backend; backend là chốt cuối.
