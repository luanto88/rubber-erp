-- Preserve the original uploaded ISO template so each workflow step can render
-- from a clean DOCX/XLSX instead of reusing the previously processed file.
ALTER TABLE iso_documents
  ADD COLUMN IF NOT EXISTS file_template_url TEXT;

-- Document/record codes must be unique within one factory, for both parent
-- documents and child records.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_iso_documents_factory_ma_tai_lieu
  ON iso_documents(factory_id, upper(trim(ma_tai_lieu)))
  WHERE ma_tai_lieu IS NOT NULL AND trim(ma_tai_lieu) <> '';
