-- Migration: Tạo bảng forest_plots cho module EUDR
-- Lưu dữ liệu lô vườn cao su (plantation plots) thay cho file GeoJSON tĩnh.
-- Không thay đổi bất kỳ bảng nào hiện có.
--
-- Chạy trong Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS forest_plots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id      UUID REFERENCES factories(id) ON DELETE CASCADE NOT NULL,

  -- Định danh — "ten" là key matching với dispatch_delivery_points.phien_X[]
  ten             TEXT NOT NULL,      -- Mã ngắn (J1T, B5, C14...)
  ma_lo_full      TEXT,               -- Mã đầy đủ (5.14PH.04.10.118)

  -- Metadata vườn
  nong_truong     TEXT,               -- Nông trường (NT 1, NT 2...)
  doi             INTEGER,            -- Đội (1-12)
  giong           TEXT,               -- Giống cây (PB 260, RRIM 600...)
  dien_tich_ha    NUMERIC(10, 4),     -- Diện tích (ha)
  nam_trong       INTEGER,            -- Năm trồng
  nam_cao_up      INTEGER,            -- Năm cạo ủ

  -- Geometry GeoJSON polygon (lưu nguyên cấu trúc để reconstruct FeatureCollection)
  geometry        JSONB,              -- { "type": "Polygon", "coordinates": [...] }

  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),

  UNIQUE(factory_id, ten)
);

-- Index query theo ten (path truy vấn chính của EUDR)
CREATE INDEX IF NOT EXISTS forest_plots_factory_ten ON forest_plots(factory_id, ten);
-- Index phụ cho lọc theo đội / nông trường
CREATE INDEX IF NOT EXISTS forest_plots_factory_doi ON forest_plots(factory_id, doi);

-- Row Level Security
ALTER TABLE forest_plots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "factory members can read forest_plots"
  ON forest_plots FOR SELECT
  USING (
    factory_id IN (
      SELECT factory_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "admin can manage forest_plots"
  ON forest_plots FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
