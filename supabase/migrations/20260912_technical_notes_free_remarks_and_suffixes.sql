-- Migration: Chuẩn hóa Ký hiệu kỹ thuật vs Ghi chú sự cố tự do, và Nguồn mủ theo Hậu tố lô
-- Ngày tạo: 2026-09-04

-- 1. Bổ sung cột ghi_chu_tu_do (văn bản tự do cho sự cố vận hành như cúp điện, xe nâng hư, mủ tạp chất...)
ALTER TABLE public.production_records
  ADD COLUMN IF NOT EXISTS ghi_chu_tu_do TEXT;

ALTER TABLE public.dispatch_entry_rows
  ADD COLUMN IF NOT EXISTS ghi_chu_tu_do TEXT;

ALTER TABLE public.ngans
  ADD COLUMN IF NOT EXISTS ghi_chu_tu_do TEXT;

ALTER TABLE public.lots
  ADD COLUMN IF NOT EXISTS ghi_chu_tu_do TEXT;

-- 2. Bổ sung cột mô tả ý nghĩa cho danh mục Ký hiệu kỹ thuật (required_notes)
ALTER TABLE public.required_notes
  ADD COLUMN IF NOT EXISTS mo_ta TEXT;

-- 3. Chuẩn hóa Nguồn gốc (ma_nguon) cho production_records
ALTER TABLE public.production_records
  ADD COLUMN IF NOT EXISTS ma_nguon TEXT NOT NULL DEFAULT 'cs';

-- Cho phép cột doi mang giá trị NULL đối với mủ thu mua / mua ngoài / gia công
ALTER TABLE public.production_records
  ALTER COLUMN doi DROP NOT NULL;

-- Nới lỏng check constraint doi để cho phép NULL (hoặc 1..12 cho các đội nông trường nội bộ)
ALTER TABLE public.production_records
  DROP CONSTRAINT IF EXISTS production_records_doi_check;

ALTER TABLE public.production_records
  ADD CONSTRAINT production_records_doi_check
  CHECK (doi IS NULL OR (doi BETWEEN 1 AND 12));

-- Khôi phục unique constraint (factory_id, ngay, so_xe, chuyen, doi) để khớp với ON CONFLICT của lệnh upsert
ALTER TABLE public.production_records
  DROP CONSTRAINT IF EXISTS production_records_factory_id_ngay_so_xe_chuyen_doi_key;

DROP INDEX IF EXISTS idx_production_records_unique_source;

ALTER TABLE public.production_records
  ADD CONSTRAINT production_records_factory_id_ngay_so_xe_chuyen_doi_key
  UNIQUE (factory_id, ngay, so_xe, chuyen, doi);

-- 4. Tải lại PostgREST schema cache
NOTIFY pgrst, 'reload schema';
