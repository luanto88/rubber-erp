-- Thêm cột loai_csr vào process_params
ALTER TABLE process_params ADD COLUMN IF NOT EXISTS loai_csr TEXT;

CREATE INDEX IF NOT EXISTS idx_process_params_day_chuyen_csr
  ON process_params (factory_id, day_chuyen, loai_csr);
