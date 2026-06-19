-- Module Kiểm soát quá trình
-- Bảng thông số kỹ thuật và đo nhanh chỉ tiêu

-- 1. process_params: thông số vận hành (nhiệt độ, thời gian sấy)
CREATE TABLE IF NOT EXISTS process_params (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id      UUID NOT NULL,
  ngay            DATE NOT NULL,
  day_chuyen      TEXT NOT NULL,
  nhiet_do_dau_1  NUMERIC,
  nhiet_do_dau_2  NUMERIC,
  thoi_gian_say   NUMERIC,
  ghi_chu         TEXT,
  logged_by       UUID REFERENCES auth.users,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_process_params_factory_ngay
  ON process_params (factory_id, ngay DESC);

ALTER TABLE process_params ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "process_params_read" ON process_params;
CREATE POLICY "process_params_read" ON process_params
  FOR SELECT USING (
    factory_id IN (
      SELECT factory_id FROM profiles WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "process_params_write" ON process_params;
CREATE POLICY "process_params_write" ON process_params
  FOR ALL USING (
    factory_id IN (
      SELECT factory_id FROM profiles WHERE id = auth.uid()
    )
  );

-- 2. quick_measurements: header phiếu đo nhanh
CREATE TABLE IF NOT EXISTS quick_measurements (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id  UUID NOT NULL,
  ma_phieu    TEXT,
  ngay        DATE NOT NULL,
  day_chuyen  TEXT,
  chung_loai  TEXT,
  loai_csr    TEXT,
  created_by  UUID REFERENCES auth.users,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quick_measurements_factory_ngay
  ON quick_measurements (factory_id, ngay DESC);

ALTER TABLE quick_measurements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quick_measurements_read" ON quick_measurements;
CREATE POLICY "quick_measurements_read" ON quick_measurements
  FOR SELECT USING (
    factory_id IN (
      SELECT factory_id FROM profiles WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "quick_measurements_write" ON quick_measurements;
CREATE POLICY "quick_measurements_write" ON quick_measurements
  FOR ALL USING (
    factory_id IN (
      SELECT factory_id FROM profiles WHERE id = auth.uid()
    )
  );

-- 3. quick_measurement_rows: dòng đo trong phiếu
CREATE TABLE IF NOT EXISTS quick_measurement_rows (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sheet_id     UUID NOT NULL REFERENCES quick_measurements ON DELETE CASCADE,
  factory_id   UUID NOT NULL,
  so_mau       INTEGER,
  chi_tieu     TEXT[],
  thung        TEXT,
  lo           TEXT,
  mau          TEXT,
  che_do_say   TEXT,
  ca_sx        TEXT,
  ngan_id      UUID,
  so_ngay_luu  INTEGER,
  ket_qua      JSONB DEFAULT '{}',
  image_urls   TEXT[] DEFAULT '{}',
  nguoi_do     TEXT,
  ghi_chu      TEXT,
  sort_order   INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quick_measurement_rows_sheet
  ON quick_measurement_rows (sheet_id);

CREATE INDEX IF NOT EXISTS idx_quick_measurement_rows_factory
  ON quick_measurement_rows (factory_id, created_at DESC);

ALTER TABLE quick_measurement_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quick_measurement_rows_read" ON quick_measurement_rows;
CREATE POLICY "quick_measurement_rows_read" ON quick_measurement_rows
  FOR SELECT USING (
    factory_id IN (
      SELECT factory_id FROM profiles WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "quick_measurement_rows_write" ON quick_measurement_rows;
CREATE POLICY "quick_measurement_rows_write" ON quick_measurement_rows
  FOR ALL USING (
    factory_id IN (
      SELECT factory_id FROM profiles WHERE id = auth.uid()
    )
  );

-- 4. Permissions
INSERT INTO permissions (code, module_name, action_name)
VALUES
  ('process.view',   'process', 'view'),
  ('process.create', 'process', 'create'),
  ('process.edit',   'process', 'edit'),
  ('process.delete', 'process', 'delete'),
  ('process.print',  'process', 'print')
ON CONFLICT (code) DO NOTHING;

-- 5. Cấp mặc định cho admin và manager
INSERT INTO role_permissions (role, permission_code)
VALUES
  ('admin',   'process.view'),
  ('admin',   'process.create'),
  ('admin',   'process.edit'),
  ('admin',   'process.delete'),
  ('admin',   'process.print'),
  ('manager', 'process.view'),
  ('manager', 'process.create'),
  ('manager', 'process.edit'),
  ('manager', 'process.print')
ON CONFLICT DO NOTHING;
