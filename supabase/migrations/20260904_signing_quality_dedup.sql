-- ============================================================
-- Hệ thống ký số dùng chung — chặn trùng yêu cầu ký cho cùng 1 "đơn vị ký"
-- nghiệp vụ (thí điểm phát hiện ở module Chất lượng: bấm "Ký duyệt" nhiều lần
-- cho cùng 1 ngày KQKN tạo ra vô số yeu_cau_ky độc lập, không có cách nào chặn
-- hay hiển thị lại).
--
-- ⚠️ BẮT BUỘC làm TRƯỚC khi chạy migration này (không tự động trong file, đây
-- là quyết định nghiệp vụ cần người vận hành xác nhận):
--
--   1. Chạy trong Supabase SQL Editor:
--        SELECT id, ma_ho_so, trang_thai, nguoi_tao, tao_luc
--        FROM yeu_cau_ky
--        WHERE modun = 'quality' AND loai_tai_lieu = 'quality_kqkn'
--          AND trang_thai IN ('dang_luan_chuyen', 'hoan_tat')
--        ORDER BY tao_luc;
--      Xem có bao nhiêu dòng trùng lặp (thường phát sinh khi test trước khi có
--      migration này — vd nhiều dòng cùng ma_ho_so kiểu cũ tính từ batches[0]).
--   2. Tự quyết định giữ đúng 1 dòng (thường là dòng có người phê duyệt THẬT
--      gần nhất) làm yêu cầu chính thức, rồi:
--        UPDATE yeu_cau_ky SET trang_thai = 'huy' WHERE id IN (...các dòng thừa...);
--      Nếu bỏ qua bước này và các dòng cũ trùng ma_ho_so, CREATE UNIQUE INDEX
--      bên dưới sẽ báo lỗi ngay khi chạy (Postgres từ chối tạo unique index
--      trên dữ liệu đã vi phạm) — không phải lỗi ẩn, chỉ cần dọn xong rồi chạy
--      lại migration này.
-- ============================================================

-- Chỉ chặn khi yêu cầu còn hiệu lực (đang luân chuyển hoặc đã hoàn tất) — yêu
-- cầu đã huỷ/từ chối không tính, để 1 "đơn vị ký" có thể tạo lại từ đầu sau khi
-- huỷ yêu cầu cũ. Gộp cả modun + loai_tai_lieu vào khoá vì bảng này dùng chung
-- cho nhiều module (Kiểm nghiệm, và các module sẽ triển khai sau).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_yeu_cau_ky_active_business_key
  ON public.yeu_cau_ky (factory_id, modun, loai_tai_lieu, ma_ho_so)
  WHERE trang_thai IN ('dang_luan_chuyen', 'hoan_tat') AND ma_ho_so IS NOT NULL;
