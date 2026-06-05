-- Migration v2: Tái thiết kho thành phẩm — mỗi ô = 1 slot_code
-- Slot_code format: "{frameCode}-R{row}C{col}" ví dụ "1A-R1C1"
-- KHO1: khung 6 hàng sâu | KHO2: khung 8 hàng sâu
-- Khung lớn: 2 cột, Khung nhỏ: 1 cột

-- ── 1. Thêm cột mới vào warehouse_slots ──────────────────────
ALTER TABLE warehouse_slots
  ADD COLUMN IF NOT EXISTS frame_code TEXT,    -- "1A", "11B" — khung chứa ô này
  ADD COLUMN IF NOT EXISTS frame_row  INTEGER, -- hàng trong khung: 1=phía trước (gần lối đi)
  ADD COLUMN IF NOT EXISTS frame_col  INTEGER; -- cột trong khung: 1=trái, 2=phải

-- ── 2. Xóa data cũ của phuochoa_kt ──────────────────────────
DO $$
DECLARE v_fid UUID;
BEGIN
  SELECT id INTO v_fid FROM factories WHERE code = 'phuochoa_kt' LIMIT 1;
  IF v_fid IS NULL THEN RETURN; END IF;
  DELETE FROM warehouse_lot_placements WHERE factory_id = v_fid;
  DELETE FROM warehouse_slots           WHERE factory_id = v_fid;
END $$;

-- ── 3. Seed slots mới ────────────────────────────────────────
DO $$
DECLARE
  v_fid UUID;
  base_so INTEGER := 0;
BEGIN
  SELECT id INTO v_fid FROM factories WHERE code = 'phuochoa_kt' LIMIT 1;
  IF v_fid IS NULL THEN RETURN; END IF;

  -- ── KHO 1 ── Hàng A ──────────────────────────────────────
  -- Large frames 1A-10A (2 cột × 6 hàng = 12 ô mỗi khung)
  INSERT INTO warehouse_slots
    (factory_id, warehouse_code, slot_code, frame_code, row_label, col_number, frame_row, frame_col,
     is_restricted, max_stack, is_active, sort_order)
  SELECT v_fid, 'kho1',
    fn::TEXT || 'A-R' || r || 'C' || c,
    fn::TEXT || 'A', 'A', fn, r, c,
    false, 3, true,
    (fn - 1) * 12 + (r - 1) * 2 + c
  FROM generate_series(1, 10) AS fn
  CROSS JOIN generate_series(1, 6) AS r
  CROSS JOIN generate_series(1, 2) AS c
  ON CONFLICT (factory_id, warehouse_code, slot_code) DO NOTHING;

  -- Small frames 11A, 12A, 13A (1 cột × 6 hàng = 6 ô mỗi khung)
  INSERT INTO warehouse_slots
    (factory_id, warehouse_code, slot_code, frame_code, row_label, col_number, frame_row, frame_col,
     is_restricted, max_stack, is_active, sort_order)
  SELECT v_fid, 'kho1',
    fn::TEXT || 'A-R' || r || 'C1',
    fn::TEXT || 'A', 'A', fn, r, 1,
    false, 3, true,
    120 + (fn - 11) * 6 + r
  FROM unnest(ARRAY[11, 12, 13]) AS fn
  CROSS JOIN generate_series(1, 6) AS r
  ON CONFLICT (factory_id, warehouse_code, slot_code) DO NOTHING;

  -- Large frames 14A, 15A (2 cột × 6 hàng)
  INSERT INTO warehouse_slots
    (factory_id, warehouse_code, slot_code, frame_code, row_label, col_number, frame_row, frame_col,
     is_restricted, max_stack, is_active, sort_order)
  SELECT v_fid, 'kho1',
    fn::TEXT || 'A-R' || r || 'C' || c,
    fn::TEXT || 'A', 'A', fn, r, c,
    false, 3, true,
    138 + (fn - 14) * 12 + (r - 1) * 2 + c
  FROM unnest(ARRAY[14, 15]) AS fn
  CROSS JOIN generate_series(1, 6) AS r
  CROSS JOIN generate_series(1, 2) AS c
  ON CONFLICT (factory_id, warehouse_code, slot_code) DO NOTHING;

  -- ── KHO 1 ── Hàng B ──────────────────────────────────────
  -- Large frames 1B-10B (2 cột × 6 hàng)
  INSERT INTO warehouse_slots
    (factory_id, warehouse_code, slot_code, frame_code, row_label, col_number, frame_row, frame_col,
     is_restricted, max_stack, is_active, sort_order)
  SELECT v_fid, 'kho1',
    fn::TEXT || 'B-R' || r || 'C' || c,
    fn::TEXT || 'B', 'B', fn, r, c,
    false, 3, true,
    200 + (fn - 1) * 12 + (r - 1) * 2 + c
  FROM generate_series(1, 10) AS fn
  CROSS JOIN generate_series(1, 6) AS r
  CROSS JOIN generate_series(1, 2) AS c
  ON CONFLICT (factory_id, warehouse_code, slot_code) DO NOTHING;

  -- Small frames 11B, 12B (1 cột × 6 hàng, regular)
  INSERT INTO warehouse_slots
    (factory_id, warehouse_code, slot_code, frame_code, row_label, col_number, frame_row, frame_col,
     is_restricted, max_stack, is_active, sort_order)
  SELECT v_fid, 'kho1',
    fn::TEXT || 'B-R' || r || 'C1',
    fn::TEXT || 'B', 'B', fn, r, 1,
    false, 3, true,
    320 + (fn - 11) * 6 + r
  FROM unnest(ARRAY[11, 12]) AS fn
  CROSS JOIN generate_series(1, 6) AS r
  ON CONFLICT (factory_id, warehouse_code, slot_code) DO NOTHING;

  -- Large restricted frames 13B, 15B, 16B (2 cột × 6 hàng, restricted)
  INSERT INTO warehouse_slots
    (factory_id, warehouse_code, slot_code, frame_code, row_label, col_number, frame_row, frame_col,
     is_restricted, max_stack, is_active, sort_order)
  SELECT v_fid, 'kho1',
    fn::TEXT || 'B-R' || r || 'C' || c,
    fn::TEXT || 'B', 'B', fn, r, c,
    true, 3, true,
    332 + ROW_NUMBER() OVER (ORDER BY fn, r, c)
  FROM unnest(ARRAY[13, 15, 16]) AS fn
  CROSS JOIN generate_series(1, 6) AS r
  CROSS JOIN generate_series(1, 2) AS c
  ON CONFLICT (factory_id, warehouse_code, slot_code) DO NOTHING;

  -- Small restricted frame 14B (1 cột × 6 hàng, restricted)
  INSERT INTO warehouse_slots
    (factory_id, warehouse_code, slot_code, frame_code, row_label, col_number, frame_row, frame_col,
     is_restricted, max_stack, is_active, sort_order)
  SELECT v_fid, 'kho1',
    '14B-R' || r || 'C1',
    '14B', 'B', 14, r, 1,
    true, 3, true,
    400 + r
  FROM generate_series(1, 6) AS r
  ON CONFLICT (factory_id, warehouse_code, slot_code) DO NOTHING;

  -- ── KHO 2 ── Hàng A ──────────────────────────────────────
  -- Large frames 1A-14A (2 cột × 8 hàng = 16 ô mỗi khung)
  INSERT INTO warehouse_slots
    (factory_id, warehouse_code, slot_code, frame_code, row_label, col_number, frame_row, frame_col,
     is_restricted, max_stack, is_active, sort_order)
  SELECT v_fid, 'kho2',
    fn::TEXT || 'A-R' || r || 'C' || c,
    fn::TEXT || 'A', 'A', fn, r, c,
    false, 3, true,
    (fn - 1) * 16 + (r - 1) * 2 + c
  FROM generate_series(1, 14) AS fn
  CROSS JOIN generate_series(1, 8) AS r
  CROSS JOIN generate_series(1, 2) AS c
  ON CONFLICT (factory_id, warehouse_code, slot_code) DO NOTHING;

  -- Small restricted frames 15A, 16A (1 cột × 8 hàng)
  INSERT INTO warehouse_slots
    (factory_id, warehouse_code, slot_code, frame_code, row_label, col_number, frame_row, frame_col,
     is_restricted, max_stack, is_active, sort_order)
  SELECT v_fid, 'kho2',
    fn::TEXT || 'A-R' || r || 'C1',
    fn::TEXT || 'A', 'A', fn, r, 1,
    true, 3, true,
    224 + (fn - 15) * 8 + r
  FROM unnest(ARRAY[15, 16]) AS fn
  CROSS JOIN generate_series(1, 8) AS r
  ON CONFLICT (factory_id, warehouse_code, slot_code) DO NOTHING;

  -- Large frames 17A-21A (2 cột × 8 hàng)
  INSERT INTO warehouse_slots
    (factory_id, warehouse_code, slot_code, frame_code, row_label, col_number, frame_row, frame_col,
     is_restricted, max_stack, is_active, sort_order)
  SELECT v_fid, 'kho2',
    fn::TEXT || 'A-R' || r || 'C' || c,
    fn::TEXT || 'A', 'A', fn, r, c,
    false, 3, true,
    240 + (fn - 17) * 16 + (r - 1) * 2 + c
  FROM generate_series(17, 21) AS fn
  CROSS JOIN generate_series(1, 8) AS r
  CROSS JOIN generate_series(1, 2) AS c
  ON CONFLICT (factory_id, warehouse_code, slot_code) DO NOTHING;

  -- ── KHO 2 ── Hàng B ──────────────────────────────────────
  -- Large frames 1B-6B (2 cột × 8 hàng)
  INSERT INTO warehouse_slots
    (factory_id, warehouse_code, slot_code, frame_code, row_label, col_number, frame_row, frame_col,
     is_restricted, max_stack, is_active, sort_order)
  SELECT v_fid, 'kho2',
    fn::TEXT || 'B-R' || r || 'C' || c,
    fn::TEXT || 'B', 'B', fn, r, c,
    false, 3, true,
    400 + (fn - 1) * 16 + (r - 1) * 2 + c
  FROM generate_series(1, 6) AS fn
  CROSS JOIN generate_series(1, 8) AS r
  CROSS JOIN generate_series(1, 2) AS c
  ON CONFLICT (factory_id, warehouse_code, slot_code) DO NOTHING;

  -- Small frame 7B (1 cột × 8 hàng)
  INSERT INTO warehouse_slots
    (factory_id, warehouse_code, slot_code, frame_code, row_label, col_number, frame_row, frame_col,
     is_restricted, max_stack, is_active, sort_order)
  SELECT v_fid, 'kho2',
    '7B-R' || r || 'C1',
    '7B', 'B', 7, r, 1,
    false, 3, true,
    496 + r
  FROM generate_series(1, 8) AS r
  ON CONFLICT (factory_id, warehouse_code, slot_code) DO NOTHING;

  -- Large frames 8B-12B (2 cột × 8 hàng)
  INSERT INTO warehouse_slots
    (factory_id, warehouse_code, slot_code, frame_code, row_label, col_number, frame_row, frame_col,
     is_restricted, max_stack, is_active, sort_order)
  SELECT v_fid, 'kho2',
    fn::TEXT || 'B-R' || r || 'C' || c,
    fn::TEXT || 'B', 'B', fn, r, c,
    false, 3, true,
    504 + (fn - 8) * 16 + (r - 1) * 2 + c
  FROM generate_series(8, 12) AS fn
  CROSS JOIN generate_series(1, 8) AS r
  CROSS JOIN generate_series(1, 2) AS c
  ON CONFLICT (factory_id, warehouse_code, slot_code) DO NOTHING;

  -- Large restricted frame 13B (2 cột × 8 hàng)
  INSERT INTO warehouse_slots
    (factory_id, warehouse_code, slot_code, frame_code, row_label, col_number, frame_row, frame_col,
     is_restricted, max_stack, is_active, sort_order)
  SELECT v_fid, 'kho2',
    '13B-R' || r || 'C' || c,
    '13B', 'B', 13, r, c,
    true, 3, true,
    584 + (r - 1) * 2 + c
  FROM generate_series(1, 8) AS r
  CROSS JOIN generate_series(1, 2) AS c
  ON CONFLICT (factory_id, warehouse_code, slot_code) DO NOTHING;

  -- Large frames 14B-15B (2 cột × 8 hàng)
  INSERT INTO warehouse_slots
    (factory_id, warehouse_code, slot_code, frame_code, row_label, col_number, frame_row, frame_col,
     is_restricted, max_stack, is_active, sort_order)
  SELECT v_fid, 'kho2',
    fn::TEXT || 'B-R' || r || 'C' || c,
    fn::TEXT || 'B', 'B', fn, r, c,
    false, 3, true,
    600 + (fn - 14) * 16 + (r - 1) * 2 + c
  FROM generate_series(14, 15) AS fn
  CROSS JOIN generate_series(1, 8) AS r
  CROSS JOIN generate_series(1, 2) AS c
  ON CONFLICT (factory_id, warehouse_code, slot_code) DO NOTHING;

END $$;
