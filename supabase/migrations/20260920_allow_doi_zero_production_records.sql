-- Cho phép doi = 0 đại diện cho mủ thu mua (ngoại viện / ngoài vườn)
-- Sửa check constraint production_records_doi_check từ [1, 12] thành NULL hoặc [0, 12]

ALTER TABLE public.production_records
  DROP CONSTRAINT IF EXISTS production_records_doi_check;

ALTER TABLE public.production_records
  ADD CONSTRAINT production_records_doi_check
  CHECK (doi IS NULL OR (doi BETWEEN 0 AND 12));

NOTIFY pgrst, 'reload schema';
