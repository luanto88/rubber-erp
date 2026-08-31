-- ============================================================
-- Hệ thống ký số dùng chung — bổ sung hành động "Trả về" (reject-and-resign) cho
-- yeu_cau_ky. Thiết kế đã chốt qua trao đổi trực tiếp với người dùng (2026-09-05):
--
--   - Giữ NGUYÊN 1 yeu_cau_ky (không tạo bản mới phien_ban+1) — người bị trả về
--     (thường là bước ký trước, vd "Lập biểu") sửa & ký lại NGAY trên cùng yêu cầu.
--   - Bắt buộc nhập lý do trả về.
--
-- Giới hạn cố ý (đã ghi rõ cho người dùng, không phải thiếu sót): "Trả về" chỉ
-- reset LỚP CHỮ KÝ (khôi phục file_hien_tai về đúng file_goc ban đầu, huỷ mọi
-- chữ ký đã stamp của các bước trước) — KHÔNG render lại nội dung file_goc. Nếu lý
-- do trả về là "sai số liệu/nội dung phiếu" (không phải "sai vị trí ký"/"chọn nhầm
-- người ký"), người tạo phải dùng "Hủy yêu cầu" (đã có sẵn) rồi sửa dữ liệu nghiệp
-- vụ gốc (vd qc_results) và "Gửi ký duyệt" lại từ đầu để PDF được render lại đúng.
-- ============================================================

ALTER TABLE public.yeu_cau_ky
  ADD COLUMN IF NOT EXISTS tra_ve_ly_do TEXT,
  ADD COLUMN IF NOT EXISTS tra_ve_boi   UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS tra_ve_luc   TIMESTAMPTZ;

COMMENT ON COLUMN public.yeu_cau_ky.tra_ve_ly_do IS
  'Lý do của LẦN TRẢ VỀ GẦN NHẤT chưa được xử lý — tự xoá (set NULL) ngay khi có người ký lại thành công (xem src/lib/signing/requests.ts signField()). NULL nghĩa là không có/đã xử lý xong lần trả về gần nhất.';
COMMENT ON COLUMN public.yeu_cau_ky.tra_ve_boi IS
  'user_id người đã bấm "Trả về" — luôn là 1 nguoi_ky của đúng yeu_cau_id đó, thu_tu lớn hơn (các) người bị reset.';
