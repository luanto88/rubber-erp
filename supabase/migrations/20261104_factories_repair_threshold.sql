-- ============================================================
-- Bảo trì — GĐ4 A6: ngưỡng phân loại sửa chữa Lớn / Nhỏ theo nhà máy (USD).
--   Tổng chi phí dòng thiết bị (quy USD) > ngưỡng ⇒ "Sửa chữa lớn", còn lại "Sửa chữa nhỏ".
--   Lớn/Nhỏ luôn tự tính (form biên bản + đồng bộ server trước khi gửi ký), không ai chọn tay.
--   Sửa tại Cài đặt → Bảo trì → "Giá trị sửa chữa lớn" (API service role, admin / settings.maintenance_config).
-- Không trigger. Biên bản đã gửi ký / đã duyệt không bị tính lại.
-- Chạy thủ công trên Supabase SQL Editor. Idempotent.
-- ============================================================

ALTER TABLE factories
  ADD COLUMN IF NOT EXISTS nguong_sua_chua_lon NUMERIC NOT NULL DEFAULT 200;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'factories_nguong_sua_chua_lon_positive'
  ) THEN
    ALTER TABLE factories
      ADD CONSTRAINT factories_nguong_sua_chua_lon_positive CHECK (nguong_sua_chua_lon > 0);
  END IF;
END $$;

COMMENT ON COLUMN factories.nguong_sua_chua_lon IS
  'Ngưỡng USD phân loại biên bản bảo trì: tổng chi phí > ngưỡng ⇒ Sửa chữa lớn. Mặc định 200.';

-- Kiểm chứng:
--   SELECT code, name, nguong_sua_chua_lon FROM factories;
