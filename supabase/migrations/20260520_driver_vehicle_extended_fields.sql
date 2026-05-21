-- Mở rộng bảng dispatch_drivers với thông tin bằng lái và CMND
ALTER TABLE dispatch_drivers
  ADD COLUMN IF NOT EXISTS license_number  TEXT,
  ADD COLUMN IF NOT EXISTS license_class   TEXT,
  ADD COLUMN IF NOT EXISTS license_expiry  DATE,
  ADD COLUMN IF NOT EXISTS id_number       TEXT,
  ADD COLUMN IF NOT EXISTS notes           TEXT;

-- Mở rộng bảng maintenance_record_lines cho biên bản sửa chữa xe
-- km_dong_ho: chỉ số đồng hồ Km/giờ (dùng trong F08_NB và F02)
-- chat_luong: chất lượng sau sửa chữa (dùng trong F15 variant nhỏ Đội xe)
ALTER TABLE maintenance_record_lines
  ADD COLUMN IF NOT EXISTS km_dong_ho  NUMERIC,
  ADD COLUMN IF NOT EXISTS chat_luong  TEXT;
