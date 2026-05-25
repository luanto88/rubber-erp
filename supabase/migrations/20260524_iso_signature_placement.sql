-- Thêm 3 cột JSONB lưu placement chữ ký từng bước cho iso_documents
ALTER TABLE iso_documents
  ADD COLUMN IF NOT EXISTS soan_thao_placement JSONB,
  ADD COLUMN IF NOT EXISTS xem_xet_placement   JSONB,
  ADD COLUMN IF NOT EXISTS phe_duyet_placement  JSONB;
