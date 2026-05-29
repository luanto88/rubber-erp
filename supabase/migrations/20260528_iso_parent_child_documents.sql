-- Link ISO child records to their parent document.
ALTER TABLE iso_documents
  ADD COLUMN IF NOT EXISTS parent_doc_id UUID REFERENCES iso_documents(id) ON DELETE SET NULL;

ALTER TABLE iso_documents
  ADD COLUMN IF NOT EXISTS file_template_url TEXT;

CREATE INDEX IF NOT EXISTS idx_iso_documents_parent_doc_id
  ON iso_documents(parent_doc_id);

CREATE INDEX IF NOT EXISTS idx_iso_documents_factory_parent
  ON iso_documents(factory_id, parent_doc_id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_iso_documents_factory_ma_tai_lieu
  ON iso_documents(factory_id, upper(trim(ma_tai_lieu)))
  WHERE ma_tai_lieu IS NOT NULL AND trim(ma_tai_lieu) <> '';
