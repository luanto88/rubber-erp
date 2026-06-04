-- Migration: Quản lý kho thành phẩm
-- Tạo bảng warehouse_slots (master data vị trí kho)
-- Tạo bảng warehouse_lot_placements (kiện ở vị trí nào)

-- ────────────────────────────────────────────────────────────
-- 1. warehouse_slots
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouse_slots (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id    UUID REFERENCES factories NOT NULL,
  warehouse_code TEXT NOT NULL,      -- 'kho1' | 'kho2'
  slot_code      TEXT NOT NULL,      -- '1A', '2A', '13B'
  row_label      TEXT NOT NULL,      -- 'A' | 'B'
  col_number     INTEGER NOT NULL,   -- 1, 2, ...
  is_restricted  BOOLEAN DEFAULT false,   -- true = ô nét đỏ đứt (khuyến cáo không để)
  max_stack      INTEGER DEFAULT 3,        -- số tầng chồng tối đa
  is_active      BOOLEAN DEFAULT true,
  sort_order     INTEGER DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE(factory_id, warehouse_code, slot_code)
);

-- ────────────────────────────────────────────────────────────
-- 2. warehouse_lot_placements
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouse_lot_placements (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id      UUID REFERENCES factories NOT NULL,
  warehouse_code  TEXT NOT NULL,
  slot_code       TEXT NOT NULL,
  stack_level     INTEGER NOT NULL DEFAULT 1,  -- 1 = tầng dưới cùng
  lot_id          UUID REFERENCES lots NOT NULL,
  kien_label      TEXT NOT NULL,    -- 'A' | 'B' | 'C' | 'D'
  placed_at       TIMESTAMPTZ DEFAULT now(),
  placed_by       UUID REFERENCES auth.users,
  removed_at      TIMESTAMPTZ,
  removed_by      UUID REFERENCES auth.users,
  export_order_id UUID,             -- link đơn xuất nếu bị removed do xuất hàng
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Mỗi slot+level chỉ có 1 kiện đang active (removed_at IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_warehouse_placement
ON warehouse_lot_placements(factory_id, warehouse_code, slot_code, stack_level)
WHERE removed_at IS NULL;

-- Mỗi kiện (lot_id + kien_label) chỉ active ở 1 slot tại 1 thời điểm
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_kien_placement
ON warehouse_lot_placements(factory_id, lot_id, kien_label)
WHERE removed_at IS NULL;

-- ────────────────────────────────────────────────────────────
-- 3. RLS
-- ────────────────────────────────────────────────────────────
ALTER TABLE warehouse_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_lot_placements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "warehouse_slots_select" ON warehouse_slots
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "warehouse_slots_insert" ON warehouse_slots
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "warehouse_slots_update" ON warehouse_slots
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "warehouse_lot_placements_select" ON warehouse_lot_placements
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "warehouse_lot_placements_insert" ON warehouse_lot_placements
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "warehouse_lot_placements_update" ON warehouse_lot_placements
  FOR UPDATE TO authenticated USING (true);

-- ────────────────────────────────────────────────────────────
-- 4. Permissions
-- ────────────────────────────────────────────────────────────
INSERT INTO public.permissions (code, module_name, action_name)
VALUES
  ('warehouse.view',   'warehouse', 'view'),
  ('warehouse.manage', 'warehouse', 'manage')
ON CONFLICT (code) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 5. Seed slots cho nhà máy phuochoa_kt
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_factory_id UUID;
BEGIN
  SELECT id INTO v_factory_id FROM factories WHERE code = 'phuochoa_kt' LIMIT 1;
  IF v_factory_id IS NULL THEN RETURN; END IF;

  -- KHO 1 — Mủ tạp
  -- Hàng A: 1A–15A (tất cả regular)
  INSERT INTO warehouse_slots (factory_id, warehouse_code, slot_code, row_label, col_number, is_restricted, sort_order)
  SELECT v_factory_id, 'kho1', n::text || 'A', 'A', n,
    false,
    n
  FROM generate_series(1, 15) AS n
  ON CONFLICT (factory_id, warehouse_code, slot_code) DO NOTHING;

  -- Hàng B: 1B–12B (regular), 13B–16B (restricted)
  INSERT INTO warehouse_slots (factory_id, warehouse_code, slot_code, row_label, col_number, is_restricted, sort_order)
  SELECT v_factory_id, 'kho1', n::text || 'B', 'B', n,
    (n >= 13),
    100 + n
  FROM generate_series(1, 16) AS n
  ON CONFLICT (factory_id, warehouse_code, slot_code) DO NOTHING;

  -- KHO 2 — Mủ nước
  -- Hàng A: 1A–14A (regular), 15A–16A (restricted), 17A–21A (regular)
  INSERT INTO warehouse_slots (factory_id, warehouse_code, slot_code, row_label, col_number, is_restricted, sort_order)
  SELECT v_factory_id, 'kho2', n::text || 'A', 'A', n,
    (n IN (15, 16)),
    n
  FROM generate_series(1, 21) AS n
  ON CONFLICT (factory_id, warehouse_code, slot_code) DO NOTHING;

  -- Hàng B: 1B–7B (regular), 8B–12B (regular), 13B (restricted), 14B–15B (regular)
  INSERT INTO warehouse_slots (factory_id, warehouse_code, slot_code, row_label, col_number, is_restricted, sort_order)
  SELECT v_factory_id, 'kho2', n::text || 'B', 'B', n,
    (n = 13),
    100 + n
  FROM generate_series(1, 15) AS n
  ON CONFLICT (factory_id, warehouse_code, slot_code) DO NOTHING;
END $$;
