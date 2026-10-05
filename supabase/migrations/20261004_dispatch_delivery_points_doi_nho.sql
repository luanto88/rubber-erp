-- 20261004 — Đội nhỏ cho điểm giao nhận + tên nhà máy tiếng Khmer
--
-- dispatch_delivery_points.doi      = Đội lớn (giữ nguyên)
-- dispatch_delivery_points.doi_nho  = Đội nhỏ, dạng '<đội lớn>.<số>' (vd '1.5', '10.3')
--   ⇒ duy nhất toàn công ty, tự mang đội lớn ở phần trước dấu chấm.
-- Nguồn dữ liệu chính thức: cung_cap_dl/doi.xlsx (đã bỏ dòng trùng / dòng trống;
-- P3 ghi 2 giá trị 9.2 và 9.1 — người dùng chốt 9.1). Chỉ áp cho nhà máy phuochoa_kt.
-- 4 điểm chưa có đội nhỏ trong file: C2, G5, G9, C17 → giữ NULL, admin bổ sung ở Cài đặt.
--
-- factories.ten_khmer = dòng 2 tiêu đề ảnh "Phiếu điều xe" — admin nhập ở
-- Cài đặt → Danh mục → Thông tin công ty (không seed để tránh sai chính tả Khmer).
--
-- Chạy tay trong Supabase SQL Editor. Idempotent — chạy lại không đè giá trị admin đã sửa.

ALTER TABLE dispatch_delivery_points
  ADD COLUMN IF NOT EXISTS doi_nho TEXT NULL;

ALTER TABLE dispatch_delivery_points
  DROP CONSTRAINT IF EXISTS dispatch_delivery_points_doi_nho_format;
ALTER TABLE dispatch_delivery_points
  ADD CONSTRAINT dispatch_delivery_points_doi_nho_format
  CHECK (doi_nho IS NULL OR doi_nho ~ ('^' || doi::text || '\.[0-9]+$'));

COMMENT ON COLUMN dispatch_delivery_points.doi IS 'Đội lớn';
COMMENT ON COLUMN dispatch_delivery_points.doi_nho IS 'Đội nhỏ dạng ''<đội lớn>.<số>'' (vd 1.5); NULL = chưa gán';

ALTER TABLE factories
  ADD COLUMN IF NOT EXISTS ten_khmer TEXT NULL;
COMMENT ON COLUMN factories.ten_khmer IS 'Tên nhà máy tiếng Khmer — dòng 2 tiêu đề ảnh phiếu điều xe';

WITH src(ma_lo, doi, doi_nho) AS (
  VALUES
  ('E1', 1, '1.1'),
  ('G3', 1, '1.5'),
  ('B5', 2, '2.2'),
  ('D9', 2, '2.3'),
  ('G8', 3, '3.4'),
  ('J7', 3, '3.6'),
  ('L2', 4, '4.7'),
  ('N7', 4, '4.8'),
  ('D11', 5, '5.1'),
  ('C16', 5, '5.6'),
  ('H11', 6, '6.3'),
  ('L12', 6, '6.4'),
  ('K10', 6, '6.4'),
  ('L14', 7, '7.5'),
  ('H13', 7, '7.7'),
  ('F16', 8, '8.2'),
  ('I16', 8, '8.8'),
  ('P3', 9, '9.1'),
  ('U2', 9, '9.2'),
  ('Q7', 10, '10.3'),
  ('P11', 10, '10.5'),
  ('T7', 11, '11.4'),
  ('U11', 11, '11.6'),
  ('P14', 12, '12.7'),
  ('S12', 12, '12.8'),
  ('S15', 12, '12.8')
)
UPDATE dispatch_delivery_points d
SET doi_nho = src.doi_nho
FROM src
WHERE d.factory_id = (SELECT id FROM factories WHERE code = 'phuochoa_kt')
  AND upper(trim(d.ma_lo)) = src.ma_lo
  AND d.doi = src.doi            -- chỉ ghi khi đội lớn khớp
  AND d.doi_nho IS NULL;         -- không đè giá trị admin đã sửa

-- Kiểm chứng (kỳ vọng: 26 điểm có đội nhỏ; C2, G5, G9, C17 còn NULL):
-- SELECT ma_lo, doi, doi_nho FROM dispatch_delivery_points
-- WHERE factory_id = (SELECT id FROM factories WHERE code = 'phuochoa_kt')
-- ORDER BY doi, doi_nho NULLS LAST, ma_lo;
