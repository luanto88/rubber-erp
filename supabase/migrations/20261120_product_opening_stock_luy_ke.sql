-- 2026-11-10 — Cờ "Tính vào lũy kế sản xuất năm sau" cho từng dòng Tồn đầu kỳ thành phẩm.
-- Lý do: dòng chốt 31/12/2025 "Sản xuất bù 22 bành lô 54m" (770 kg) phải cộng vào lũy kế sản xuất 2026 trên F09, nhưng
-- KHÔNG được cộng mọi dòng tồn đầu kỳ (kiểm kê toàn kho sẽ làm phình lũy kế). Người dùng tick từng dòng ở
-- Cài đặt → Cấu hình nhà máy → Tồn đầu kỳ thành phẩm.
-- Dòng được tick (ngay_chot thuộc năm Y) hiện trên F09 năm Y+1 thành dòng riêng "Tồn ĐK …" và cộng vào Tổng năm.
-- Chỉ thêm cột, không sửa dữ liệu. Chạy tay trên Supabase SQL Editor. An toàn chạy lại.

ALTER TABLE product_opening_stock
  ADD COLUMN IF NOT EXISTS tinh_luy_ke BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN product_opening_stock.tinh_luy_ke IS
  'true = cộng vào lũy kế sản xuất NĂM SAU năm chốt trên Phiếu báo thành phẩm F09 (sản xuất bù / điều chỉnh). Không tick khi nhập kiểm kê toàn kho.';
