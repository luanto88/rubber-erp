-- ============================================================
-- Ràng buộc "chỉ người tạo mới được sửa/gửi phê duyệt" cho module Chất lượng
-- và Điều xe — mirror đúng nguyên tắc `maintenance_records.nguoi_tao` đã dùng
-- từ trước ở Bảo trì, áp dụng thêm cho nút "Gửi ký duyệt"/"Ký duyệt".
--
-- Cả 2 bảng đích (`dispatch_entries`, `qc_results`) trước đây KHÔNG lưu người
-- tạo bản ghi ở bất kỳ đâu (`dispatch_entries` không có cột nào; `qc_results`
-- có `nguoi_kn` nhưng cột này chưa từng được ghi trong code) — đây là lỗ hổng
-- có sẵn từ trước, không liên quan tới hệ thống ký số.
--
-- Quyết định đã chốt với người dùng (2026-09-08+):
--   - Chỉ áp dụng cho bản ghi TỪ NAY trở đi (app tự set `created_by` khi tạo
--     mới) — KHÔNG backfill dữ liệu cũ (không có thông tin để suy ra).
--   - Bản ghi CŨ (`created_by IS NULL`) vẫn cho phép BẤT KỲ ai có quyền edit
--     thao tác như hiện tại (grandfather clause) — tránh khoá nhầm user thật
--     đang cần sửa dữ liệu lịch sử chỉ vì thiếu thông tin người tạo.
-- ============================================================

ALTER TABLE dispatch_entries
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE qc_results
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dispatch_entries_created_by ON dispatch_entries(created_by);
CREATE INDEX IF NOT EXISTS idx_qc_results_created_by ON qc_results(created_by);
