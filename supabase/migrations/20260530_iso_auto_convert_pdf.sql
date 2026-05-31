-- Add auto_convert_pdf column to iso_documents
-- When true, Office files (DOCX/XLSX) will be automatically converted to PDF after phê duyệt

ALTER TABLE iso_documents
  ADD COLUMN IF NOT EXISTS auto_convert_pdf BOOLEAN DEFAULT false;
