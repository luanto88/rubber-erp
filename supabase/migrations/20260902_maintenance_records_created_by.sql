-- Thêm cột created_by cho maintenance_records để /api/signing/create-request có thể
-- kiểm tra sở hữu ở tầng server (trước đây chỉ check factory_id, không check chủ
-- sở hữu bản ghi — bất kỳ ai cùng nhà máy cũng gọi thẳng API tạo được yêu cầu ký
-- cho biên bản của người khác). Mirror đúng migration 20260910_ownership_created_by_columns.sql
-- đã áp dụng cho dispatch_entries/qc_results.
--
-- Rule chặt: created_by IS NULL (biên bản cũ, trước migration này) => chỉ admin xử
-- lý được, KHÔNG fallback về so khớp nguoi_tao (TEXT) — quyết định đã chốt với
-- người dùng, chấp nhận đánh đổi này cho dữ liệu lịch sử.

ALTER TABLE maintenance_records
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_maintenance_records_created_by ON maintenance_records(created_by);
