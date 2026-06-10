-- ============================================================
-- Module Văn bản Nội bộ — Thêm cột phân loại Thường/Mật
-- ============================================================

ALTER TABLE van_ban_documents
  ADD COLUMN IF NOT EXISTS phan_loai TEXT NOT NULL DEFAULT 'Thuong';
-- Giá trị hợp lệ: 'Thuong' | 'Mat'

COMMENT ON COLUMN van_ban_documents.phan_loai IS
  'Phân loại văn bản: Thuong = thông báo cả trưởng/phó phòng ban; Mat = chọn đích danh per bước';
