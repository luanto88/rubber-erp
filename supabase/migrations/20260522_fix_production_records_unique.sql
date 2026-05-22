-- Đổi unique constraint production_records: thêm doi
-- Cho phép cùng xe+chuyến nhưng khác đội (xe chở 2 đội, cân 2 lần)
ALTER TABLE public.production_records
  DROP CONSTRAINT IF EXISTS production_records_factory_id_ngay_so_xe_chuyen_key;

ALTER TABLE public.production_records
  ADD CONSTRAINT production_records_factory_id_ngay_so_xe_chuyen_doi_key
  UNIQUE (factory_id, ngay, so_xe, chuyen, doi);
