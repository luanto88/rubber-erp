-- Cho phép mỗi giao dịch (mỗi kiện xác nhận) tự khai báo bọc/pallet/số chỉ thị riêng —
-- phục vụ tính năng "Xác nhận sản xuất qua QR" (confirm/page.tsx): khi quét kiện thứ 2-4 của
-- một lô đã tồn tại, người dùng vẫn được sửa các trường này, gợi ý theo giá trị của kiện gần
-- nhất cùng lô. syncLotMasterSnapshot() sẽ tự lấy giá trị non-null MỚI NHẤT của từng cột này
-- (theo ngay_nhap/created_at) để cập nhật lại lots.boc/lots.pallet/lots.chi_thi — mirror đúng
-- cách cột lots.ca/lots.ngan_id đã được suy ra từ giao dịch mới nhất.
--
-- Giá trị NULL ở các dòng giao dịch cũ hoặc do luồng nhập tay (product/page.tsx không gửi 3
-- cột này) không ảnh hưởng gì — syncLotMasterSnapshot() bỏ qua các dòng NULL khi tìm giá trị
-- mới nhất, không tự ý xoá boc/pallet/chi_thi hiện có của lô.
ALTER TABLE lot_transactions
  ADD COLUMN IF NOT EXISTS boc TEXT,
  ADD COLUMN IF NOT EXISTS pallet TEXT[],
  ADD COLUMN IF NOT EXISTS chi_thi TEXT;
