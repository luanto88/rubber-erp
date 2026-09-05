-- Cho phép doi = 0 đại diện cho mủ thu mua (ngoại viện / ngoài vườn)
-- Bảng production_records: nới lỏng check constraint doi từ [1, 12] thành [0, 12]

ALTER TABLE public.production_records
  DROP CONSTRAINT IF EXISTS production_records_doi_check;

ALTER TABLE public.production_records
  ADD CONSTRAINT production_records_doi_check
  CHECK (doi BETWEEN 0 AND 12);
