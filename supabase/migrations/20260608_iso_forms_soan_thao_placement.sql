-- Migration: thêm cột soạn thảo placement cho iso_form_instances
-- Chạy thủ công trong Supabase SQL Editor

ALTER TABLE iso_form_instances
  ADD COLUMN IF NOT EXISTS soan_thao          TEXT,
  ADD COLUMN IF NOT EXISTS soan_thao_placement JSONB,
  ADD COLUMN IF NOT EXISTS soan_thao_signed_url TEXT,
  ADD COLUMN IF NOT EXISTS ky_soan_thao_at     TIMESTAMPTZ;
