-- GĐ2d module Đề nghị mua vật tư: thông tin nguồn hàng + mức độ gấp theo TỪNG DÒNG vật tư.
-- Chạy tay trên Supabase SQL Editor, SAU 20261009. Không backfill — dòng/phiếu cũ để NULL.
--
--  mua_tai        nơi mua dự kiến (tự do)
--  ngay_co_hang   ngày dự kiến có hàng (tuỳ chọn)
--  ngay_can_hang  ngày cần hàng (bắt buộc ở tầng app với phiếu lập từ nay)
--  purchase_requests.ngay_can_hang = ngày cần hàng SỚM NHẤT trong các dòng (bản chụp do API ghi,
--  dùng để sắp xếp / gắn nhãn "Gấp" cho người duyệt, không cần join dòng).

ALTER TABLE purchase_request_lines ADD COLUMN IF NOT EXISTS mua_tai TEXT;
ALTER TABLE purchase_request_lines ADD COLUMN IF NOT EXISTS ngay_co_hang DATE;
ALTER TABLE purchase_request_lines ADD COLUMN IF NOT EXISTS ngay_can_hang DATE;

ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS ngay_can_hang DATE;
CREATE INDEX IF NOT EXISTS idx_purchase_requests_factory_ngay_can_hang ON purchase_requests(factory_id, ngay_can_hang);

COMMENT ON COLUMN purchase_request_lines.mua_tai IS 'Nơi mua dự kiến của dòng vật tư (in lên phiếu).';
COMMENT ON COLUMN purchase_request_lines.ngay_co_hang IS 'Ngày dự kiến có hàng (tuỳ chọn, in lên phiếu).';
COMMENT ON COLUMN purchase_request_lines.ngay_can_hang IS 'Ngày cần hàng (bắt buộc từ GĐ2d, in lên phiếu) — dùng đánh giá mức độ gấp.';
COMMENT ON COLUMN purchase_requests.ngay_can_hang IS 'Ngày cần hàng sớm nhất trong các dòng (bản chụp do API ghi khi lưu phiếu).';
