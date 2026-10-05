-- GĐ2g — Liên kết phiếu Đề nghị mua với biên bản Bảo trì (vật tư mua ngoài đi qua Kho tạm KT).
-- maintenance_record_id: phiếu lập từ biên bản (nút "Lập đề nghị mua"). Phiếu này nhập cứng vào kho KT,
--   ai có purchase.create được sửa/gửi ký khi còn nháp; người GỬI KÝ trở thành người đề nghị.
-- lap_boi_id: người bấm "Lập đề nghị mua" trên biên bản (có thể không có purchase.create).
-- Chạy tay trên Supabase SQL Editor TRƯỚC khi deploy code.

ALTER TABLE purchase_requests
  ADD COLUMN IF NOT EXISTS maintenance_record_id UUID REFERENCES maintenance_records(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lap_boi_id UUID REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_purchase_requests_maintenance_record
  ON purchase_requests (factory_id, maintenance_record_id)
  WHERE maintenance_record_id IS NOT NULL;

COMMENT ON COLUMN purchase_requests.maintenance_record_id IS
  'Biên bản bảo trì sinh ra phiếu (vật tư mua ngoài). Phiếu có cột này nhập kho cứng vào kho tạm KT.';
COMMENT ON COLUMN purchase_requests.lap_boi_id IS
  'Người lập phiếu nháp từ biên bản bảo trì; người đề nghị chính thức là người gửi ký.';
