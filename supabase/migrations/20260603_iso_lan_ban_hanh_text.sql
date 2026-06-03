ALTER TABLE iso_documents
  ALTER COLUMN lan_ban_hanh TYPE TEXT
  USING LPAD(COALESCE(lan_ban_hanh::TEXT, '0'), 2, '0');

ALTER TABLE iso_documents
  ALTER COLUMN lan_ban_hanh SET DEFAULT '00';

UPDATE iso_documents
SET lan_ban_hanh = '00'
WHERE lan_ban_hanh IS NULL OR BTRIM(lan_ban_hanh) = '';
