-- Thêm cột snapshot tên người đã ghi/import dòng sản lượng (tránh phải resolve created_by
-- qua bảng profiles lúc hiển thị, vì RLS profiles chỉ cho admin đọc toàn bộ hồ sơ nhà máy).
ALTER TABLE production_records ADD COLUMN IF NOT EXISTS nguoi_upload TEXT;
