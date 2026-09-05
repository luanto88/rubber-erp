-- ============================================================================
-- PAdES cho module Văn bản nội bộ (2026-09-05)
--
-- Module Văn bản dùng hệ ký RIÊNG (api/documents/sign/route.ts), KHÔNG có bản ghi
-- `nguoi_ky` như hệ ký dùng chung (Bảo trì/Chất lượng/Điều xe) — nên không dùng lại
-- được cột `nguoi_ky.pades_sig_index` và trang /sign-verify/[nguoiKyId].
--
-- `doc_approval_log` đã có sẵn ĐÚNG 1 DÒNG cho mỗi bước ký của văn bản (kèm
-- `content_hash` từ Giai đoạn 0) và có trigger bất biến `nhat_ky_bat_bien` chặn mọi
-- UPDATE/DELETE — đây là nơi tự nhiên nhất để lưu chỉ số chữ ký PAdES của từng bước:
-- 1 dòng log = 1 chữ ký = 1 URL xác thực công khai.
--
-- Vì bảng bất biến, route ký phải biết `pades_sig_index` TRƯỚC khi insert (đếm số
-- chữ ký đã nhúng của chính văn bản đó) — không thể ghi bổ sung sau.
--
-- Cột thêm ở đây đều NULLABLE:
--   - Dòng log cũ (trước 2026-09-05) và dòng của module ISO luôn NULL — không ảnh hưởng.
--   - Văn bản đang luân chuyển dở khi deploy cũng NULL (đã chốt: chỉ áp dụng cho văn
--     bản mới), trang xác thực sẽ báo rõ "bước này ký trước khi có chữ ký số".
-- ============================================================================

ALTER TABLE doc_approval_log
  ADD COLUMN IF NOT EXISTS pades_sig_index INTEGER,
  ADD COLUMN IF NOT EXISTS pades_error     TEXT;

COMMENT ON COLUMN doc_approval_log.pades_sig_index IS
  'Chỉ số (0-based) của chữ ký PAdES tương ứng bước ký này bên trong file PDF hiện tại. NULL = bước này không nhúng chữ ký số (văn bản cũ/dở dang, chưa cấu hình root CA, hoặc lỗi nhúng — xem pades_error).';

COMMENT ON COLUMN doc_approval_log.pades_error IS
  'Lý do kỹ thuật khiến bước này không có chữ ký PAdES. Hiển thị trực tiếp trên trang xác thực để chẩn đoán mà không cần xem log server (mirror nguoi_ky.pades_error).';

-- Trang xác thực công khai tra theo id (khoá chính) nên không cần index thêm; index này
-- phục vụ việc ĐẾM số chữ ký đã nhúng của 1 văn bản ở mỗi lượt ký (chạy mỗi lần đóng dấu).
CREATE INDEX IF NOT EXISTS idx_doc_approval_log_pades
  ON doc_approval_log (doc_id, doc_type)
  WHERE pades_sig_index IS NOT NULL;
