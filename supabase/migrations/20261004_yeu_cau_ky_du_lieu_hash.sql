-- 20261004 — Dấu vân tay dữ liệu nghiệp vụ lúc gửi ký
--
-- Trước đây badge "Đã ký — dữ liệu đã đổi" so dispatch_entries.updated_at với
-- yeu_cau_ky.tao_luc. writeBackToDispatch (module Sản lượng) cập nhật updated_at của
-- MỌI phiếu điều xe dù không đổi số nào ⇒ mọi phiếu đã ký đều bị báo "đã đổi" sai.
--
-- Nay lưu SHA-256 của các trường in lên chứng từ ngay lúc tạo yêu cầu ký, rồi so lại
-- với dữ liệu hiện tại. NULL = yêu cầu tạo trước bản này ⇒ coi như không đổi.
-- Chạy tay trong Supabase SQL Editor. Idempotent.

ALTER TABLE yeu_cau_ky
  ADD COLUMN IF NOT EXISTS du_lieu_hash TEXT NULL;

COMMENT ON COLUMN yeu_cau_ky.du_lieu_hash IS
  'SHA-256 các trường nghiệp vụ in lên chứng từ, tính lúc tạo yêu cầu ký; NULL = yêu cầu cũ';
