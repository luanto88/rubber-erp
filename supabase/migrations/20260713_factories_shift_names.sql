-- Tên hiển thị của từng ca sản xuất (vd Ca A: "Sok Khum", Ca B: "Binh Ban") — dùng để in trên
-- phiếu báo thành phẩm nhập kho (mỗi ca 1 section riêng, xem confirm/shift-report-pdf.ts) và
-- hiển thị gợi ý trong dropdown "Ca sản xuất" ở trang quét QR xác nhận sản xuất
-- (/dashboard/product/confirm). Chỉ 3 ca cố định (A/B/C, xem CA_OPTS trong confirm/page.tsx) nên
-- dùng 3 cột text riêng thay vì tạo bảng con — quản trị tại Cài đặt → Danh mục → Thông tin công ty.
ALTER TABLE factories
  ADD COLUMN IF NOT EXISTS ca_a_ten TEXT,
  ADD COLUMN IF NOT EXISTS ca_b_ten TEXT,
  ADD COLUMN IF NOT EXISTS ca_c_ten TEXT;
