-- GĐ2b module Đề nghị mua vật tư: Bộ phận (bắt buộc từ nay) + ảnh đính kèm theo TỪNG DÒNG vật tư.
-- Chạy tay trên Supabase SQL Editor, SAU 20261007 và 20261008. Không backfill — phiếu cũ để NULL.

ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS bo_phan TEXT;
CREATE INDEX IF NOT EXISTS idx_purchase_requests_factory_bo_phan ON purchase_requests(factory_id, bo_phan);

ALTER TABLE purchase_request_lines ADD COLUMN IF NOT EXISTS image_urls TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN purchase_requests.bo_phan IS 'Bộ phận đề nghị (danh sách BO_PHAN_LIST dùng chung với Bảo trì).';
COMMENT ON COLUMN purchase_request_lines.image_urls IS 'Ảnh đính kèm của dòng vật tư (tối đa 10). Không in lên PDF; người đề nghị/admin cập nhật được cả sau khi ký.';
