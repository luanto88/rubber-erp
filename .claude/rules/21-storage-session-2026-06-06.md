# Handoff session 2026-06-06 - Module ngăn lưu

## Mục tiêu đã xử lý

- Hoàn thiện phần chi tiết ngăn lưu sau session thêm ngày `xé`.
- Ổn định lại QR tra cứu, PDF chi tiết ngăn và thao tác xuất dữ liệu từ dashboard.
- Ghi lại rule và handoff bằng tiếng Việt có dấu để session sau tiếp tục nhanh.

## Trạng thái hiện tại

- User đã chạy SQL thật để thêm 2 cột:
  - `ngans.xe_tu_ngay`
  - `ngans.xe_den_ngay`
- Sau khi DB có đủ cột:
  - view dashboard ngăn chạy ổn
  - route chi tiết ngăn qua QR chạy ổn
  - PDF chi tiết ngăn tải được

## Những gì đã chốt trong session này

### 1. GeoJSON cho ngăn

- Đã thêm nút `GeoJSON` trên card ngăn ở dashboard, nằm cạnh nút `Xuất PDF`.
- Dữ liệu GeoJSON lấy theo toàn bộ `trip uid` đã gắn trong `ngans.trips`.
- Từ các trip đó, hệ thống lấy `lo_thu_hoach` trong `dispatch_entry_rows`.
- Khi xuất:
  - ưu tiên đọc polygon từ `forest_plots`
  - nếu chưa có dữ liệu DB thì fallback file `/geojson/Lo cao su - 2026_Full.geojson`
- Nếu không tìm thấy `lo_thu_hoach`, phải báo lỗi rõ thay vì tải file rỗng.

### 2. PDF chi tiết ngăn

- Đã chỉnh lại `src/lib/storage-pdf.ts`.
- QR của phiếu chi tiết ngăn phải:
  - nằm gọn trong header màu xanh
  - ở góc phải
  - không rơi xuống vùng bảng `Thông tin ngăn lưu`
- Sau phản hồi của user, đã chỉnh thêm lần cuối để:
  - tăng chiều cao header
  - tăng khoảng đệm giữa header và bảng
  - đẩy QR lên hẳn trong header

### 3. Rule ngày xé

- `Xé từ ngày = ngay_bd + 1`
- `Xé đến ngày = ngay_kt + 1`

### 4. Rule báo cáo kỳ

- Chỉ lấy ngăn nếu:
  - `ngay_bd >= tu_ngay`
  - `ngay_kt <= den_ngay`
- Ngăn chưa có `ngay_kt` thì không vào báo cáo kỳ.

## File chính đã sửa trong session

- `src/app/dashboard/storage/page.tsx`
- `src/lib/storage-detail.ts`
- `src/lib/storage-pdf.ts`
- `.claude/rules/storage.md`

## Kiểm tra đã chạy

- `npx eslint src/app/dashboard/storage/page.tsx src/lib/storage-detail.ts src/lib/storage-pdf.ts`
- `npx eslint src/lib/storage-pdf.ts`

Kết quả: sạch lỗi eslint ở các file đã chạm.

## Gợi ý cho session tiếp theo

- Xuất lại PDF chi tiết ngăn trên UI để xác nhận vị trí QR đúng như user mong muốn.
- Bấm thử nút `GeoJSON` trên một ngăn có dữ liệu `lo_thu_hoach`.
- Nếu user muốn, tinh tiếp spacing/header của PDF theo mẫu in thực tế.
