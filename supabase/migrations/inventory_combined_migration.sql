-- ============================================================
-- INVENTORY MODULE - COMBINED MIGRATION (idempotent / safe to re-run)
-- Paste toàn bộ nội dung này vào Supabase SQL Editor → Run
-- ============================================================

-- ── BẢNG CHÍNH ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inventory_warehouses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID REFERENCES factories(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  keeper_name TEXT,
  warehouse_type TEXT DEFAULT 'general',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(factory_id, code)
);

CREATE TABLE IF NOT EXISTS inventory_item_categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID REFERENCES factories(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(factory_id, code)
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID REFERENCES factories(id),
  category_id UUID REFERENCES inventory_item_categories(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  specification TEXT,
  default_warehouse_ids UUID[] DEFAULT '{}',
  manages_lot BOOLEAN DEFAULT false,
  manages_expiry BOOLEAN DEFAULT false,
  min_stock NUMERIC DEFAULT 0,
  max_stock NUMERIC DEFAULT 0,
  opening_stock NUMERIC DEFAULT 0,
  image_url TEXT,
  equipment_name TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(factory_id, code)
);

CREATE TABLE IF NOT EXISTS inventory_item_warehouse_rules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID REFERENCES factories(id),
  item_id UUID REFERENCES inventory_items(id) ON DELETE CASCADE,
  warehouse_id UUID REFERENCES inventory_warehouses(id) ON DELETE CASCADE,
  min_stock NUMERIC DEFAULT 0,
  max_stock NUMERIC DEFAULT 0,
  reorder_point NUMERIC DEFAULT 0,
  safety_stock NUMERIC DEFAULT 0,
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(item_id, warehouse_id)
);

CREATE TABLE IF NOT EXISTS inventory_documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID REFERENCES factories(id),
  document_code TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('import', 'export', 'transfer')),
  document_date DATE NOT NULL,
  source_warehouse_id UUID REFERENCES inventory_warehouses(id),
  target_warehouse_id UUID REFERENCES inventory_warehouses(id),
  source_name TEXT,
  recipient_name TEXT,
  requester_name TEXT,
  created_by UUID REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'cancelled')),
  qr_value TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(factory_id, document_code)
);

CREATE TABLE IF NOT EXISTS inventory_document_lines (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID REFERENCES factories(id),
  document_id UUID REFERENCES inventory_documents(id) ON DELETE CASCADE,
  item_id UUID REFERENCES inventory_items(id),
  item_code TEXT NOT NULL,
  item_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  specification TEXT,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  lot_no TEXT,
  expiry_date DATE,
  location_code TEXT,
  line_notes TEXT,
  image_urls TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_stock_balances (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID REFERENCES factories(id),
  warehouse_id UUID REFERENCES inventory_warehouses(id),
  item_id UUID REFERENCES inventory_items(id),
  on_hand NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(factory_id, warehouse_id, item_id)
);

CREATE TABLE IF NOT EXISTS inventory_lot_balances (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID REFERENCES factories(id),
  warehouse_id UUID REFERENCES inventory_warehouses(id),
  item_id UUID REFERENCES inventory_items(id),
  lot_no TEXT NOT NULL,
  expiry_date DATE,
  on_hand NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(factory_id, warehouse_id, item_id, lot_no, expiry_date)
);

CREATE TABLE IF NOT EXISTS inventory_stock_movements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID REFERENCES factories(id),
  document_id UUID REFERENCES inventory_documents(id) ON DELETE CASCADE,
  document_line_id UUID REFERENCES inventory_document_lines(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('import', 'export', 'transfer_in', 'transfer_out')),
  warehouse_id UUID REFERENCES inventory_warehouses(id),
  item_id UUID REFERENCES inventory_items(id),
  quantity_in NUMERIC DEFAULT 0,
  quantity_out NUMERIC DEFAULT 0,
  balance_after NUMERIC,
  lot_no TEXT,
  expiry_date DATE,
  movement_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_document_attachments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID REFERENCES factories(id),
  document_id UUID REFERENCES inventory_documents(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  caption TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_consumption_norms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID REFERENCES factories(id),
  product_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  basis_unit TEXT NOT NULL DEFAULT 'tan_thanh_pham',
  report_group TEXT DEFAULT 'monthly',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(factory_id, product_code)
);

CREATE TABLE IF NOT EXISTS inventory_consumption_norm_lines (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID REFERENCES factories(id),
  norm_id UUID REFERENCES inventory_consumption_norms(id) ON DELETE CASCADE,
  item_id UUID REFERENCES inventory_items(id),
  resource_code TEXT NOT NULL,
  resource_name TEXT NOT NULL,
  resource_group TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity_per_unit NUMERIC NOT NULL DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(norm_id, resource_code)
);

CREATE TABLE IF NOT EXISTS inventory_monthly_norm_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID REFERENCES factories(id),
  report_month DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(factory_id, report_month)
);

CREATE TABLE IF NOT EXISTS inventory_monthly_norm_report_lines (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID REFERENCES factories(id),
  report_id UUID REFERENCES inventory_monthly_norm_reports(id) ON DELETE CASCADE,
  product_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  resource_code TEXT NOT NULL,
  resource_name TEXT NOT NULL,
  resource_group TEXT NOT NULL,
  unit TEXT NOT NULL,
  output_quantity NUMERIC NOT NULL DEFAULT 0,
  norm_quantity NUMERIC NOT NULL DEFAULT 0,
  actual_quantity NUMERIC DEFAULT 0,
  variance_quantity NUMERIC GENERATED ALWAYS AS (COALESCE(actual_quantity, 0) - norm_quantity) STORED,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── INDEX ───────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_inventory_warehouses_factory ON inventory_warehouses(factory_id);
CREATE INDEX IF NOT EXISTS idx_inventory_categories_factory ON inventory_item_categories(factory_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_factory ON inventory_items(factory_id);
CREATE INDEX IF NOT EXISTS idx_inventory_documents_factory ON inventory_documents(factory_id);
CREATE INDEX IF NOT EXISTS idx_inventory_documents_date ON inventory_documents(document_date);
CREATE INDEX IF NOT EXISTS idx_inventory_document_lines_factory ON inventory_document_lines(factory_id);
CREATE INDEX IF NOT EXISTS idx_inventory_document_lines_document ON inventory_document_lines(document_id);
CREATE INDEX IF NOT EXISTS idx_inventory_document_attachments_factory ON inventory_document_attachments(factory_id);
CREATE INDEX IF NOT EXISTS idx_inventory_balances_item_wh ON inventory_stock_balances(factory_id, warehouse_id, item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_lot_balances_item_wh ON inventory_lot_balances(factory_id, warehouse_id, item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_doc ON inventory_stock_movements(document_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_item_wh ON inventory_stock_movements(factory_id, warehouse_id, item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_norms_factory ON inventory_consumption_norms(factory_id);
CREATE INDEX IF NOT EXISTS idx_inventory_norm_lines_factory ON inventory_consumption_norm_lines(factory_id);
CREATE INDEX IF NOT EXISTS idx_inventory_norm_reports_factory ON inventory_monthly_norm_reports(factory_id);
CREATE INDEX IF NOT EXISTS idx_inventory_norm_report_lines_factory ON inventory_monthly_norm_report_lines(factory_id);

-- ── TRIGGER CHẶN XUẤT ÂM TỒN ────────────────────────────────

CREATE OR REPLACE FUNCTION inventory_prevent_negative_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  current_on_hand NUMERIC;
  current_lot_on_hand NUMERIC;
BEGIN
  IF NEW.movement_type NOT IN ('export', 'transfer_out') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(on_hand, 0)
  INTO current_on_hand
  FROM inventory_stock_balances
  WHERE factory_id = NEW.factory_id
    AND warehouse_id = NEW.warehouse_id
    AND item_id = NEW.item_id;

  IF COALESCE(NEW.quantity_out, 0) > COALESCE(current_on_hand, 0) THEN
    RAISE EXCEPTION 'Không thể xuất kho vượt tồn. Số xuất: %, tồn hiện tại: %',
      NEW.quantity_out, current_on_hand;
  END IF;

  IF NEW.lot_no IS NOT NULL THEN
    SELECT COALESCE(on_hand, 0)
    INTO current_lot_on_hand
    FROM inventory_lot_balances
    WHERE factory_id = NEW.factory_id
      AND warehouse_id = NEW.warehouse_id
      AND item_id = NEW.item_id
      AND lot_no = NEW.lot_no
      AND COALESCE(expiry_date, DATE '1900-01-01') = COALESCE(NEW.expiry_date, DATE '1900-01-01');

    IF COALESCE(NEW.quantity_out, 0) > COALESCE(current_lot_on_hand, 0) THEN
      RAISE EXCEPTION 'Không thể xuất lô vượt tồn. Số xuất: %, tồn lô hiện tại: %',
        NEW.quantity_out, current_lot_on_hand;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_prevent_negative_stock ON inventory_stock_movements;
CREATE TRIGGER trg_inventory_prevent_negative_stock
BEFORE INSERT ON inventory_stock_movements
FOR EACH ROW
EXECUTE FUNCTION inventory_prevent_negative_stock();

-- ── RLS ─────────────────────────────────────────────────────

ALTER TABLE inventory_warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_item_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_item_warehouse_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_document_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_stock_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_lot_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_document_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_consumption_norms ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_consumption_norm_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_monthly_norm_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_monthly_norm_report_lines ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'inventory_warehouses','inventory_item_categories','inventory_items',
    'inventory_item_warehouse_rules','inventory_documents','inventory_document_lines',
    'inventory_stock_balances','inventory_lot_balances','inventory_stock_movements',
    'inventory_document_attachments','inventory_consumption_norms',
    'inventory_consumption_norm_lines','inventory_monthly_norm_reports',
    'inventory_monthly_norm_report_lines'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = tbl AND policyname = 'Allow all'
    ) THEN
      EXECUTE format('CREATE POLICY "Allow all" ON %I FOR ALL USING (true)', tbl);
    END IF;
  END LOOP;
END $$;

-- ── STORED PROCEDURES ────────────────────────────────────────

CREATE OR REPLACE FUNCTION inventory_post_import_document(
  p_factory_id UUID,
  p_document_id UUID,
  p_posted_by UUID DEFAULT NULL
)
RETURNS TABLE (document_id UUID, document_code TEXT, posted_lines INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
  v_document inventory_documents%ROWTYPE;
  v_line inventory_document_lines%ROWTYPE;
  v_balance_after NUMERIC;
  v_posted_lines INTEGER := 0;
BEGIN
  SELECT * INTO v_document FROM inventory_documents
  WHERE id = p_document_id AND factory_id = p_factory_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy phiếu nhập cần ghi sổ.'; END IF;
  IF v_document.document_type <> 'import' THEN RAISE EXCEPTION 'Chỉ được ghi sổ phiếu nhập kho bằng hàm này.'; END IF;
  IF v_document.status = 'posted' THEN RAISE EXCEPTION 'Phiếu nhập % đã được ghi sổ trước đó.', v_document.document_code; END IF;
  IF v_document.status = 'cancelled' THEN RAISE EXCEPTION 'Phiếu nhập % đã bị hủy.', v_document.document_code; END IF;
  IF v_document.target_warehouse_id IS NULL THEN RAISE EXCEPTION 'Phiếu nhập % chưa có kho đích.', v_document.document_code; END IF;
  IF NOT EXISTS (SELECT 1 FROM inventory_document_lines WHERE document_id = p_document_id AND factory_id = p_factory_id) THEN
    RAISE EXCEPTION 'Phiếu nhập % chưa có dòng vật tư.', v_document.document_code;
  END IF;

  FOR v_line IN
    SELECT * FROM inventory_document_lines
    WHERE document_id = p_document_id AND factory_id = p_factory_id ORDER BY created_at, id
  LOOP
    INSERT INTO inventory_stock_balances(factory_id, warehouse_id, item_id, on_hand, created_at, updated_at)
    VALUES (p_factory_id, v_document.target_warehouse_id, v_line.item_id, v_line.quantity, now(), now())
    ON CONFLICT (factory_id, warehouse_id, item_id)
    DO UPDATE SET on_hand = inventory_stock_balances.on_hand + EXCLUDED.on_hand, updated_at = now()
    RETURNING on_hand INTO v_balance_after;

    IF v_line.lot_no IS NOT NULL THEN
      INSERT INTO inventory_lot_balances(factory_id, warehouse_id, item_id, lot_no, expiry_date, on_hand, created_at, updated_at)
      VALUES (p_factory_id, v_document.target_warehouse_id, v_line.item_id, v_line.lot_no, v_line.expiry_date, v_line.quantity, now(), now())
      ON CONFLICT (factory_id, warehouse_id, item_id, lot_no, expiry_date)
      DO UPDATE SET on_hand = inventory_lot_balances.on_hand + EXCLUDED.on_hand, updated_at = now();
    END IF;

    INSERT INTO inventory_stock_movements(factory_id, document_id, document_line_id, movement_type, warehouse_id, item_id, quantity_in, quantity_out, balance_after, lot_no, expiry_date, movement_date, created_at)
    VALUES (p_factory_id, p_document_id, v_line.id, 'import', v_document.target_warehouse_id, v_line.item_id, v_line.quantity, 0, v_balance_after, v_line.lot_no, v_line.expiry_date, v_document.document_date, now());

    v_posted_lines := v_posted_lines + 1;
  END LOOP;

  UPDATE inventory_documents SET status = 'posted', updated_at = now()
  WHERE id = p_document_id AND factory_id = p_factory_id;

  RETURN QUERY SELECT v_document.id, v_document.document_code, v_posted_lines;
END;
$$;

CREATE OR REPLACE FUNCTION inventory_post_export_document(
  p_factory_id UUID,
  p_document_id UUID,
  p_posted_by UUID DEFAULT NULL
)
RETURNS TABLE (document_id UUID, document_code TEXT, posted_lines INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
  v_document inventory_documents%ROWTYPE;
  v_line inventory_document_lines%ROWTYPE;
  v_item inventory_items%ROWTYPE;
  v_balance_after NUMERIC;
  v_current_stock NUMERIC;
  v_lot_stock NUMERIC;
  v_posted_lines INTEGER := 0;
BEGIN
  SELECT * INTO v_document FROM inventory_documents
  WHERE id = p_document_id AND factory_id = p_factory_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy phiếu xuất cần ghi sổ.'; END IF;
  IF v_document.document_type <> 'export' THEN RAISE EXCEPTION 'Chỉ được ghi sổ phiếu xuất kho bằng hàm này.'; END IF;
  IF v_document.status = 'posted' THEN RAISE EXCEPTION 'Phiếu xuất % đã được ghi sổ trước đó.', v_document.document_code; END IF;
  IF v_document.status = 'cancelled' THEN RAISE EXCEPTION 'Phiếu xuất % đã bị hủy.', v_document.document_code; END IF;
  IF v_document.source_warehouse_id IS NULL THEN RAISE EXCEPTION 'Phiếu xuất % chưa có kho nguồn.', v_document.document_code; END IF;
  IF NOT EXISTS (SELECT 1 FROM inventory_document_lines WHERE document_id = p_document_id AND factory_id = p_factory_id) THEN
    RAISE EXCEPTION 'Phiếu xuất % chưa có dòng vật tư.', v_document.document_code;
  END IF;

  FOR v_line IN
    SELECT * FROM inventory_document_lines
    WHERE document_id = p_document_id AND factory_id = p_factory_id ORDER BY created_at, id
  LOOP
    SELECT * INTO v_item FROM inventory_items WHERE id = v_line.item_id AND factory_id = p_factory_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy vật tư của dòng %.', v_line.item_code; END IF;
    IF v_item.manages_lot AND COALESCE(NULLIF(trim(v_line.lot_no), ''), '') = '' THEN
      RAISE EXCEPTION 'Vật tư % bắt buộc chọn số lô trước khi xuất.', v_line.item_code;
    END IF;

    SELECT COALESCE(on_hand, 0) INTO v_current_stock FROM inventory_stock_balances
    WHERE factory_id = p_factory_id AND warehouse_id = v_document.source_warehouse_id AND item_id = v_line.item_id FOR UPDATE;
    v_current_stock := COALESCE(v_current_stock, 0);

    IF v_line.quantity > v_current_stock THEN
      RAISE EXCEPTION 'Không thể xuất % % của vật tư % vì tồn hiện tại chỉ còn %.',
        v_line.quantity, v_line.unit, v_line.item_code, v_current_stock;
    END IF;

    IF COALESCE(NULLIF(trim(v_line.lot_no), ''), '') <> '' THEN
      SELECT COALESCE(on_hand, 0) INTO v_lot_stock FROM inventory_lot_balances
      WHERE factory_id = p_factory_id AND warehouse_id = v_document.source_warehouse_id
        AND item_id = v_line.item_id AND lot_no = v_line.lot_no
        AND (expiry_date IS NOT DISTINCT FROM v_line.expiry_date) FOR UPDATE;
      v_lot_stock := COALESCE(v_lot_stock, 0);
      IF v_line.quantity > v_lot_stock THEN
        RAISE EXCEPTION 'Không thể xuất lô % của vật tư % vì tồn lô chỉ còn %.', v_line.lot_no, v_line.item_code, v_lot_stock;
      END IF;
      UPDATE inventory_lot_balances SET on_hand = on_hand - v_line.quantity, updated_at = now()
      WHERE factory_id = p_factory_id AND warehouse_id = v_document.source_warehouse_id
        AND item_id = v_line.item_id AND lot_no = v_line.lot_no
        AND (expiry_date IS NOT DISTINCT FROM v_line.expiry_date);
    END IF;

    UPDATE inventory_stock_balances SET on_hand = on_hand - v_line.quantity, updated_at = now()
    WHERE factory_id = p_factory_id AND warehouse_id = v_document.source_warehouse_id AND item_id = v_line.item_id
    RETURNING on_hand INTO v_balance_after;

    INSERT INTO inventory_stock_movements(factory_id, document_id, document_line_id, movement_type, warehouse_id, item_id, quantity_in, quantity_out, balance_after, lot_no, expiry_date, movement_date, created_at)
    VALUES (p_factory_id, p_document_id, v_line.id, 'export', v_document.source_warehouse_id, v_line.item_id, 0, v_line.quantity, v_balance_after, v_line.lot_no, v_line.expiry_date, v_document.document_date, now());

    v_posted_lines := v_posted_lines + 1;
  END LOOP;

  UPDATE inventory_documents SET status = 'posted', updated_at = now()
  WHERE id = p_document_id AND factory_id = p_factory_id;

  RETURN QUERY SELECT v_document.id, v_document.document_code, v_posted_lines;
END;
$$;

CREATE OR REPLACE FUNCTION inventory_post_transfer_document(
  p_factory_id UUID,
  p_document_id UUID,
  p_posted_by UUID DEFAULT NULL
)
RETURNS TABLE (document_id UUID, document_code TEXT, posted_lines INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
  v_document inventory_documents%ROWTYPE;
  v_line inventory_document_lines%ROWTYPE;
  v_item inventory_items%ROWTYPE;
  v_source_balance_after NUMERIC;
  v_target_balance_after NUMERIC;
  v_source_stock NUMERIC;
  v_source_lot_stock NUMERIC;
  v_posted_lines INTEGER := 0;
BEGIN
  SELECT * INTO v_document FROM inventory_documents
  WHERE id = p_document_id AND factory_id = p_factory_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy phiếu chuyển kho cần ghi sổ.'; END IF;
  IF v_document.document_type <> 'transfer' THEN RAISE EXCEPTION 'Chỉ được ghi sổ phiếu chuyển kho bằng hàm này.'; END IF;
  IF v_document.status = 'posted' THEN RAISE EXCEPTION 'Phiếu chuyển % đã được ghi sổ trước đó.', v_document.document_code; END IF;
  IF v_document.status = 'cancelled' THEN RAISE EXCEPTION 'Phiếu chuyển % đã bị hủy.', v_document.document_code; END IF;
  IF v_document.source_warehouse_id IS NULL OR v_document.target_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Phiếu chuyển % chưa đủ kho nguồn và kho đích.', v_document.document_code;
  END IF;
  IF v_document.source_warehouse_id = v_document.target_warehouse_id THEN
    RAISE EXCEPTION 'Kho nguồn và kho đích không được trùng nhau.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM inventory_document_lines WHERE document_id = p_document_id AND factory_id = p_factory_id) THEN
    RAISE EXCEPTION 'Phiếu chuyển % chưa có dòng vật tư.', v_document.document_code;
  END IF;

  FOR v_line IN
    SELECT * FROM inventory_document_lines
    WHERE document_id = p_document_id AND factory_id = p_factory_id ORDER BY created_at, id
  LOOP
    SELECT * INTO v_item FROM inventory_items WHERE id = v_line.item_id AND factory_id = p_factory_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy vật tư của dòng %.', v_line.item_code; END IF;
    IF v_item.manages_lot AND COALESCE(NULLIF(trim(v_line.lot_no), ''), '') = '' THEN
      RAISE EXCEPTION 'Vật tư % bắt buộc chọn số lô trước khi chuyển kho.', v_line.item_code;
    END IF;

    SELECT COALESCE(on_hand, 0) INTO v_source_stock FROM inventory_stock_balances
    WHERE factory_id = p_factory_id AND warehouse_id = v_document.source_warehouse_id AND item_id = v_line.item_id FOR UPDATE;
    v_source_stock := COALESCE(v_source_stock, 0);
    IF v_line.quantity > v_source_stock THEN
      RAISE EXCEPTION 'Không thể chuyển % % của vật tư % vì tồn kho nguồn chỉ còn %.',
        v_line.quantity, v_line.unit, v_line.item_code, v_source_stock;
    END IF;

    IF COALESCE(NULLIF(trim(v_line.lot_no), ''), '') <> '' THEN
      SELECT COALESCE(on_hand, 0) INTO v_source_lot_stock FROM inventory_lot_balances
      WHERE factory_id = p_factory_id AND warehouse_id = v_document.source_warehouse_id
        AND item_id = v_line.item_id AND lot_no = v_line.lot_no
        AND (expiry_date IS NOT DISTINCT FROM v_line.expiry_date) FOR UPDATE;
      v_source_lot_stock := COALESCE(v_source_lot_stock, 0);
      IF v_line.quantity > v_source_lot_stock THEN
        RAISE EXCEPTION 'Không thể chuyển lô % của vật tư % vì tồn lô tại kho nguồn chỉ còn %.',
          v_line.lot_no, v_line.item_code, v_source_lot_stock;
      END IF;
      UPDATE inventory_lot_balances SET on_hand = on_hand - v_line.quantity, updated_at = now()
      WHERE factory_id = p_factory_id AND warehouse_id = v_document.source_warehouse_id
        AND item_id = v_line.item_id AND lot_no = v_line.lot_no
        AND (expiry_date IS NOT DISTINCT FROM v_line.expiry_date);
    END IF;

    UPDATE inventory_stock_balances SET on_hand = on_hand - v_line.quantity, updated_at = now()
    WHERE factory_id = p_factory_id AND warehouse_id = v_document.source_warehouse_id AND item_id = v_line.item_id
    RETURNING on_hand INTO v_source_balance_after;

    INSERT INTO inventory_stock_balances(factory_id, warehouse_id, item_id, on_hand, created_at, updated_at)
    VALUES (p_factory_id, v_document.target_warehouse_id, v_line.item_id, v_line.quantity, now(), now())
    ON CONFLICT (factory_id, warehouse_id, item_id)
    DO UPDATE SET on_hand = inventory_stock_balances.on_hand + EXCLUDED.on_hand, updated_at = now()
    RETURNING on_hand INTO v_target_balance_after;

    IF COALESCE(NULLIF(trim(v_line.lot_no), ''), '') <> '' THEN
      INSERT INTO inventory_lot_balances(factory_id, warehouse_id, item_id, lot_no, expiry_date, on_hand, created_at, updated_at)
      VALUES (p_factory_id, v_document.target_warehouse_id, v_line.item_id, v_line.lot_no, v_line.expiry_date, v_line.quantity, now(), now())
      ON CONFLICT (factory_id, warehouse_id, item_id, lot_no, expiry_date)
      DO UPDATE SET on_hand = inventory_lot_balances.on_hand + EXCLUDED.on_hand, updated_at = now();
    END IF;

    INSERT INTO inventory_stock_movements(factory_id, document_id, document_line_id, movement_type, warehouse_id, item_id, quantity_in, quantity_out, balance_after, lot_no, expiry_date, movement_date, created_at)
    VALUES
      (p_factory_id, p_document_id, v_line.id, 'transfer_out', v_document.source_warehouse_id, v_line.item_id, 0, v_line.quantity, v_source_balance_after, v_line.lot_no, v_line.expiry_date, v_document.document_date, now()),
      (p_factory_id, p_document_id, v_line.id, 'transfer_in', v_document.target_warehouse_id, v_line.item_id, v_line.quantity, 0, v_target_balance_after, v_line.lot_no, v_line.expiry_date, v_document.document_date, now());

    v_posted_lines := v_posted_lines + 1;
  END LOOP;

  UPDATE inventory_documents SET status = 'posted', updated_at = now()
  WHERE id = p_document_id AND factory_id = p_factory_id;

  RETURN QUERY SELECT v_document.id, v_document.document_code, v_posted_lines;
END;
$$;

-- ── STORAGE BUCKET ───────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('inventory-files', 'inventory-files', true, 10485760, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Inventory files public read') THEN
    CREATE POLICY "Inventory files public read" ON storage.objects FOR SELECT USING (bucket_id = 'inventory-files');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Inventory files public insert') THEN
    CREATE POLICY "Inventory files public insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'inventory-files');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Inventory files public update') THEN
    CREATE POLICY "Inventory files public update" ON storage.objects FOR UPDATE USING (bucket_id = 'inventory-files') WITH CHECK (bucket_id = 'inventory-files');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Inventory files public delete') THEN
    CREATE POLICY "Inventory files public delete" ON storage.objects FOR DELETE USING (bucket_id = 'inventory-files');
  END IF;
END $$;

-- ── PERMISSIONS ──────────────────────────────────────────────

INSERT INTO public.permissions (code, module_name, action_name) VALUES
  ('inventory.view',     'inventory', 'view'),
  ('inventory.create',   'inventory', 'create'),
  ('inventory.edit',     'inventory', 'edit'),
  ('inventory.delete',   'inventory', 'delete'),
  ('inventory.post',     'inventory', 'post'),
  ('inventory.analytics','inventory', 'analytics'),
  ('inventory.settings', 'inventory', 'settings')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_code)
SELECT 'admin', code FROM public.permissions WHERE code LIKE 'inventory.%'
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role, permission_code) VALUES
  ('manager', 'inventory.view'),
  ('manager', 'inventory.create'),
  ('manager', 'inventory.edit'),
  ('manager', 'inventory.post'),
  ('manager', 'inventory.analytics'),
  ('manager', 'inventory.settings'),
  ('user',    'inventory.view'),
  ('user',    'inventory.analytics')
ON CONFLICT DO NOTHING;

-- Shared stock pool cho dầu theo kho
ALTER TABLE inventory_items
ADD COLUMN IF NOT EXISTS uses_shared_oil_stock BOOLEAN DEFAULT false;

ALTER TABLE inventory_documents
ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS posted_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

CREATE TABLE IF NOT EXISTS inventory_oil_stock_pools (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID REFERENCES factories(id),
  warehouse_id UUID REFERENCES inventory_warehouses(id) ON DELETE CASCADE,
  on_hand NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(factory_id, warehouse_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_oil_stock_pools_factory_wh
  ON inventory_oil_stock_pools(factory_id, warehouse_id);

ALTER TABLE inventory_oil_stock_pools ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'inventory_oil_stock_pools'
      AND policyname = 'Allow all'
  ) THEN
    CREATE POLICY "Allow all" ON inventory_oil_stock_pools FOR ALL USING (true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION inventory_post_import_document(
  p_factory_id UUID,
  p_document_id UUID,
  p_posted_by UUID DEFAULT NULL
)
RETURNS TABLE (document_id UUID, document_code TEXT, posted_lines INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
  v_document inventory_documents%ROWTYPE;
  v_line inventory_document_lines%ROWTYPE;
  v_item inventory_items%ROWTYPE;
  v_balance_after NUMERIC;
  v_posted_lines INTEGER := 0;
BEGIN
  SELECT * INTO v_document FROM inventory_documents
  WHERE id = p_document_id AND factory_id = p_factory_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy phiếu nhập cần ghi sổ.'; END IF;
  IF v_document.document_type <> 'import' THEN RAISE EXCEPTION 'Chỉ được ghi sổ phiếu nhập kho bằng hàm này.'; END IF;
  IF v_document.status = 'posted' THEN RAISE EXCEPTION 'Phiếu nhập % đã được ghi sổ trước đó.', v_document.document_code; END IF;
  IF v_document.status = 'cancelled' THEN RAISE EXCEPTION 'Phiếu nhập % đã bị hủy.', v_document.document_code; END IF;
  IF v_document.target_warehouse_id IS NULL THEN RAISE EXCEPTION 'Phiếu nhập % chưa có kho đích.', v_document.document_code; END IF;
  IF NOT EXISTS (SELECT 1 FROM inventory_document_lines WHERE document_id = p_document_id AND factory_id = p_factory_id) THEN
    RAISE EXCEPTION 'Phiếu nhập % chưa có dòng vật tư.', v_document.document_code;
  END IF;

  FOR v_line IN
    SELECT * FROM inventory_document_lines
    WHERE document_id = p_document_id AND factory_id = p_factory_id ORDER BY created_at, id
  LOOP
    SELECT * INTO v_item FROM inventory_items WHERE id = v_line.item_id AND factory_id = p_factory_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy vật tư của dòng %.', v_line.item_code; END IF;

    IF COALESCE(v_item.uses_shared_oil_stock, false) THEN
      INSERT INTO inventory_oil_stock_pools(factory_id, warehouse_id, on_hand, created_at, updated_at)
      VALUES (p_factory_id, v_document.target_warehouse_id, v_line.quantity, now(), now())
      ON CONFLICT (factory_id, warehouse_id)
      DO UPDATE SET on_hand = inventory_oil_stock_pools.on_hand + EXCLUDED.on_hand, updated_at = now()
      RETURNING on_hand INTO v_balance_after;
    ELSE
      INSERT INTO inventory_stock_balances(factory_id, warehouse_id, item_id, on_hand, created_at, updated_at)
      VALUES (p_factory_id, v_document.target_warehouse_id, v_line.item_id, v_line.quantity, now(), now())
      ON CONFLICT (factory_id, warehouse_id, item_id)
      DO UPDATE SET on_hand = inventory_stock_balances.on_hand + EXCLUDED.on_hand, updated_at = now()
      RETURNING on_hand INTO v_balance_after;
    END IF;

    IF v_line.lot_no IS NOT NULL THEN
      INSERT INTO inventory_lot_balances(factory_id, warehouse_id, item_id, lot_no, expiry_date, on_hand, created_at, updated_at)
      VALUES (p_factory_id, v_document.target_warehouse_id, v_line.item_id, v_line.lot_no, v_line.expiry_date, v_line.quantity, now(), now())
      ON CONFLICT (factory_id, warehouse_id, item_id, lot_no, expiry_date)
      DO UPDATE SET on_hand = inventory_lot_balances.on_hand + EXCLUDED.on_hand, updated_at = now();
    END IF;

    INSERT INTO inventory_stock_movements(factory_id, document_id, document_line_id, movement_type, warehouse_id, item_id, quantity_in, quantity_out, balance_after, lot_no, expiry_date, movement_date, created_at)
    VALUES (p_factory_id, p_document_id, v_line.id, 'import', v_document.target_warehouse_id, v_line.item_id, v_line.quantity, 0, v_balance_after, v_line.lot_no, v_line.expiry_date, v_document.document_date, now());

    v_posted_lines := v_posted_lines + 1;
  END LOOP;

  UPDATE inventory_documents
  SET status = 'posted',
      posted_at = now(),
      posted_by = COALESCE(p_posted_by, posted_by),
      updated_at = now()
  WHERE id = p_document_id AND factory_id = p_factory_id;

  RETURN QUERY SELECT p_document_id, v_document.document_code, v_posted_lines;
END;
$$;

CREATE OR REPLACE FUNCTION inventory_post_export_document(
  p_factory_id UUID,
  p_document_id UUID,
  p_posted_by UUID DEFAULT NULL
)
RETURNS TABLE (document_id UUID, document_code TEXT, posted_lines INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
  v_document inventory_documents%ROWTYPE;
  v_line inventory_document_lines%ROWTYPE;
  v_item inventory_items%ROWTYPE;
  v_balance_after NUMERIC;
  v_current_stock NUMERIC;
  v_lot_stock NUMERIC;
  v_posted_lines INTEGER := 0;
BEGIN
  SELECT * INTO v_document FROM inventory_documents
  WHERE id = p_document_id AND factory_id = p_factory_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy phiếu xuất cần ghi sổ.'; END IF;
  IF v_document.document_type <> 'export' THEN RAISE EXCEPTION 'Chỉ được ghi sổ phiếu xuất kho bằng hàm này.'; END IF;
  IF v_document.status = 'posted' THEN RAISE EXCEPTION 'Phiếu xuất % đã được ghi sổ trước đó.', v_document.document_code; END IF;
  IF v_document.status = 'cancelled' THEN RAISE EXCEPTION 'Phiếu xuất % đã bị hủy.', v_document.document_code; END IF;
  IF v_document.source_warehouse_id IS NULL THEN RAISE EXCEPTION 'Phiếu xuất % chưa có kho nguồn.', v_document.document_code; END IF;
  IF NOT EXISTS (SELECT 1 FROM inventory_document_lines WHERE document_id = p_document_id AND factory_id = p_factory_id) THEN
    RAISE EXCEPTION 'Phiếu xuất % chưa có dòng vật tư.', v_document.document_code;
  END IF;

  FOR v_line IN
    SELECT * FROM inventory_document_lines
    WHERE document_id = p_document_id AND factory_id = p_factory_id ORDER BY created_at, id
  LOOP
    SELECT * INTO v_item FROM inventory_items WHERE id = v_line.item_id AND factory_id = p_factory_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy vật tư của dòng %.', v_line.item_code; END IF;
    IF v_item.manages_lot AND COALESCE(NULLIF(trim(v_line.lot_no), ''), '') = '' THEN
      RAISE EXCEPTION 'Vật tư % bắt buộc chọn số lô trước khi xuất.', v_line.item_code;
    END IF;

    IF COALESCE(v_item.uses_shared_oil_stock, false) THEN
      INSERT INTO inventory_oil_stock_pools(factory_id, warehouse_id, on_hand, created_at, updated_at)
      VALUES (p_factory_id, v_document.source_warehouse_id, 0, now(), now())
      ON CONFLICT (factory_id, warehouse_id) DO NOTHING;

      SELECT COALESCE(on_hand, 0) INTO v_current_stock FROM inventory_oil_stock_pools
      WHERE factory_id = p_factory_id AND warehouse_id = v_document.source_warehouse_id FOR UPDATE;
    ELSE
      SELECT COALESCE(on_hand, 0) INTO v_current_stock FROM inventory_stock_balances
      WHERE factory_id = p_factory_id AND warehouse_id = v_document.source_warehouse_id AND item_id = v_line.item_id FOR UPDATE;
    END IF;
    v_current_stock := COALESCE(v_current_stock, 0);

    IF v_line.quantity > v_current_stock THEN
      RAISE EXCEPTION 'Không thể xuất % % của vật tư % vì tồn hiện tại chỉ còn %.',
        v_line.quantity, v_line.unit, v_line.item_code, v_current_stock;
    END IF;

    IF COALESCE(NULLIF(trim(v_line.lot_no), ''), '') <> '' THEN
      SELECT COALESCE(on_hand, 0) INTO v_lot_stock FROM inventory_lot_balances
      WHERE factory_id = p_factory_id AND warehouse_id = v_document.source_warehouse_id
        AND item_id = v_line.item_id AND lot_no = v_line.lot_no
        AND (expiry_date IS NOT DISTINCT FROM v_line.expiry_date) FOR UPDATE;
      v_lot_stock := COALESCE(v_lot_stock, 0);
      IF v_line.quantity > v_lot_stock THEN
        RAISE EXCEPTION 'Không thể xuất lô % của vật tư % vì tồn lô chỉ còn %.', v_line.lot_no, v_line.item_code, v_lot_stock;
      END IF;
      UPDATE inventory_lot_balances SET on_hand = on_hand - v_line.quantity, updated_at = now()
      WHERE factory_id = p_factory_id AND warehouse_id = v_document.source_warehouse_id
        AND item_id = v_line.item_id AND lot_no = v_line.lot_no
        AND (expiry_date IS NOT DISTINCT FROM v_line.expiry_date);
    END IF;

    IF COALESCE(v_item.uses_shared_oil_stock, false) THEN
      UPDATE inventory_oil_stock_pools SET on_hand = on_hand - v_line.quantity, updated_at = now()
      WHERE factory_id = p_factory_id AND warehouse_id = v_document.source_warehouse_id
      RETURNING on_hand INTO v_balance_after;
    ELSE
      UPDATE inventory_stock_balances SET on_hand = on_hand - v_line.quantity, updated_at = now()
      WHERE factory_id = p_factory_id AND warehouse_id = v_document.source_warehouse_id AND item_id = v_line.item_id
      RETURNING on_hand INTO v_balance_after;
    END IF;

    INSERT INTO inventory_stock_movements(factory_id, document_id, document_line_id, movement_type, warehouse_id, item_id, quantity_in, quantity_out, balance_after, lot_no, expiry_date, movement_date, created_at)
    VALUES (p_factory_id, p_document_id, v_line.id, 'export', v_document.source_warehouse_id, v_line.item_id, 0, v_line.quantity, v_balance_after, v_line.lot_no, v_line.expiry_date, v_document.document_date, now());

    v_posted_lines := v_posted_lines + 1;
  END LOOP;

  UPDATE inventory_documents
  SET status = 'posted',
      posted_at = now(),
      posted_by = COALESCE(p_posted_by, posted_by),
      updated_at = now()
  WHERE id = p_document_id AND factory_id = p_factory_id;

  RETURN QUERY SELECT p_document_id, v_document.document_code, v_posted_lines;
END;
$$;

CREATE OR REPLACE FUNCTION inventory_post_transfer_document(
  p_factory_id UUID,
  p_document_id UUID,
  p_posted_by UUID DEFAULT NULL
)
RETURNS TABLE (document_id UUID, document_code TEXT, posted_lines INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
  v_document inventory_documents%ROWTYPE;
  v_line inventory_document_lines%ROWTYPE;
  v_item inventory_items%ROWTYPE;
  v_source_balance_after NUMERIC;
  v_target_balance_after NUMERIC;
  v_source_stock NUMERIC;
  v_source_lot_stock NUMERIC;
  v_posted_lines INTEGER := 0;
BEGIN
  SELECT * INTO v_document FROM inventory_documents
  WHERE id = p_document_id AND factory_id = p_factory_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy phiếu chuyển kho cần ghi sổ.'; END IF;
  IF v_document.document_type <> 'transfer' THEN RAISE EXCEPTION 'Chỉ được ghi sổ phiếu chuyển kho bằng hàm này.'; END IF;
  IF v_document.status = 'posted' THEN RAISE EXCEPTION 'Phiếu chuyển % đã được ghi sổ trước đó.', v_document.document_code; END IF;
  IF v_document.status = 'cancelled' THEN RAISE EXCEPTION 'Phiếu chuyển % đã bị hủy.', v_document.document_code; END IF;
  IF v_document.source_warehouse_id IS NULL OR v_document.target_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Phiếu chuyển % chưa đủ kho nguồn và kho đích.', v_document.document_code;
  END IF;
  IF v_document.source_warehouse_id = v_document.target_warehouse_id THEN
    RAISE EXCEPTION 'Kho nguồn và kho đích không được trùng nhau.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM inventory_document_lines WHERE document_id = p_document_id AND factory_id = p_factory_id) THEN
    RAISE EXCEPTION 'Phiếu chuyển % chưa có dòng vật tư.', v_document.document_code;
  END IF;

  FOR v_line IN
    SELECT * FROM inventory_document_lines
    WHERE document_id = p_document_id AND factory_id = p_factory_id ORDER BY created_at, id
  LOOP
    SELECT * INTO v_item FROM inventory_items WHERE id = v_line.item_id AND factory_id = p_factory_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy vật tư của dòng %.', v_line.item_code; END IF;
    IF v_item.manages_lot AND COALESCE(NULLIF(trim(v_line.lot_no), ''), '') = '' THEN
      RAISE EXCEPTION 'Vật tư % bắt buộc chọn số lô trước khi chuyển kho.', v_line.item_code;
    END IF;

    IF COALESCE(v_item.uses_shared_oil_stock, false) THEN
      INSERT INTO inventory_oil_stock_pools(factory_id, warehouse_id, on_hand, created_at, updated_at)
      VALUES (p_factory_id, v_document.source_warehouse_id, 0, now(), now())
      ON CONFLICT (factory_id, warehouse_id) DO NOTHING;

      SELECT COALESCE(on_hand, 0) INTO v_source_stock FROM inventory_oil_stock_pools
      WHERE factory_id = p_factory_id AND warehouse_id = v_document.source_warehouse_id FOR UPDATE;
    ELSE
      SELECT COALESCE(on_hand, 0) INTO v_source_stock FROM inventory_stock_balances
      WHERE factory_id = p_factory_id AND warehouse_id = v_document.source_warehouse_id AND item_id = v_line.item_id FOR UPDATE;
    END IF;
    v_source_stock := COALESCE(v_source_stock, 0);
    IF v_line.quantity > v_source_stock THEN
      RAISE EXCEPTION 'Không thể chuyển % % của vật tư % vì tồn kho nguồn chỉ còn %.',
        v_line.quantity, v_line.unit, v_line.item_code, v_source_stock;
    END IF;

    IF COALESCE(NULLIF(trim(v_line.lot_no), ''), '') <> '' THEN
      SELECT COALESCE(on_hand, 0) INTO v_source_lot_stock FROM inventory_lot_balances
      WHERE factory_id = p_factory_id AND warehouse_id = v_document.source_warehouse_id
        AND item_id = v_line.item_id AND lot_no = v_line.lot_no
        AND (expiry_date IS NOT DISTINCT FROM v_line.expiry_date) FOR UPDATE;
      v_source_lot_stock := COALESCE(v_source_lot_stock, 0);
      IF v_line.quantity > v_source_lot_stock THEN
        RAISE EXCEPTION 'Không thể chuyển lô % của vật tư % vì tồn lô tại kho nguồn chỉ còn %.',
          v_line.lot_no, v_line.item_code, v_source_lot_stock;
      END IF;
      UPDATE inventory_lot_balances SET on_hand = on_hand - v_line.quantity, updated_at = now()
      WHERE factory_id = p_factory_id AND warehouse_id = v_document.source_warehouse_id
        AND item_id = v_line.item_id AND lot_no = v_line.lot_no
        AND (expiry_date IS NOT DISTINCT FROM v_line.expiry_date);
    END IF;

    IF COALESCE(v_item.uses_shared_oil_stock, false) THEN
      UPDATE inventory_oil_stock_pools SET on_hand = on_hand - v_line.quantity, updated_at = now()
      WHERE factory_id = p_factory_id AND warehouse_id = v_document.source_warehouse_id
      RETURNING on_hand INTO v_source_balance_after;

      INSERT INTO inventory_oil_stock_pools(factory_id, warehouse_id, on_hand, created_at, updated_at)
      VALUES (p_factory_id, v_document.target_warehouse_id, v_line.quantity, now(), now())
      ON CONFLICT (factory_id, warehouse_id)
      DO UPDATE SET on_hand = inventory_oil_stock_pools.on_hand + EXCLUDED.on_hand, updated_at = now()
      RETURNING on_hand INTO v_target_balance_after;
    ELSE
      UPDATE inventory_stock_balances SET on_hand = on_hand - v_line.quantity, updated_at = now()
      WHERE factory_id = p_factory_id AND warehouse_id = v_document.source_warehouse_id AND item_id = v_line.item_id
      RETURNING on_hand INTO v_source_balance_after;

      INSERT INTO inventory_stock_balances(factory_id, warehouse_id, item_id, on_hand, created_at, updated_at)
      VALUES (p_factory_id, v_document.target_warehouse_id, v_line.item_id, v_line.quantity, now(), now())
      ON CONFLICT (factory_id, warehouse_id, item_id)
      DO UPDATE SET on_hand = inventory_stock_balances.on_hand + EXCLUDED.on_hand, updated_at = now()
      RETURNING on_hand INTO v_target_balance_after;
    END IF;

    IF COALESCE(NULLIF(trim(v_line.lot_no), ''), '') <> '' THEN
      INSERT INTO inventory_lot_balances(factory_id, warehouse_id, item_id, lot_no, expiry_date, on_hand, created_at, updated_at)
      VALUES (p_factory_id, v_document.target_warehouse_id, v_line.item_id, v_line.lot_no, v_line.expiry_date, v_line.quantity, now(), now())
      ON CONFLICT (factory_id, warehouse_id, item_id, lot_no, expiry_date)
      DO UPDATE SET on_hand = inventory_lot_balances.on_hand + EXCLUDED.on_hand, updated_at = now();
    END IF;

    INSERT INTO inventory_stock_movements(factory_id, document_id, document_line_id, movement_type, warehouse_id, item_id, quantity_in, quantity_out, balance_after, lot_no, expiry_date, movement_date, created_at)
    VALUES
      (p_factory_id, p_document_id, v_line.id, 'transfer_out', v_document.source_warehouse_id, v_line.item_id, 0, v_line.quantity, v_source_balance_after, v_line.lot_no, v_line.expiry_date, v_document.document_date, now()),
      (p_factory_id, p_document_id, v_line.id, 'transfer_in', v_document.target_warehouse_id, v_line.item_id, v_line.quantity, 0, v_target_balance_after, v_line.lot_no, v_line.expiry_date, v_document.document_date, now());

    v_posted_lines := v_posted_lines + 1;
  END LOOP;

  UPDATE inventory_documents
  SET status = 'posted',
      posted_at = now(),
      posted_by = COALESCE(p_posted_by, posted_by),
      updated_at = now()
  WHERE id = p_document_id AND factory_id = p_factory_id;

  RETURN QUERY SELECT p_document_id, v_document.document_code, v_posted_lines;
END;
$$;

CREATE OR REPLACE FUNCTION inventory_cancel_document(
  p_factory_id   UUID,
  p_document_id  UUID,
  p_cancelled_by UUID DEFAULT NULL,
  p_cancel_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_document inventory_documents%ROWTYPE;
  v_movement RECORD;
  v_uses_shared_oil_stock BOOLEAN;
BEGIN
  SELECT * INTO v_document FROM inventory_documents
  WHERE id = p_document_id AND factory_id = p_factory_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy phiếu cần hủy.'; END IF;
  IF v_document.status <> 'posted' THEN
    RAISE EXCEPTION 'Chỉ được hủy phiếu đã ghi sổ. Trạng thái hiện tại: %', v_document.status;
  END IF;

  FOR v_movement IN
    SELECT * FROM inventory_stock_movements
    WHERE document_id = p_document_id AND factory_id = p_factory_id
  LOOP
    SELECT COALESCE(uses_shared_oil_stock, false)
    INTO v_uses_shared_oil_stock
    FROM inventory_items
    WHERE id = v_movement.item_id AND factory_id = p_factory_id;

    IF COALESCE(v_uses_shared_oil_stock, false) THEN
      INSERT INTO inventory_oil_stock_pools(factory_id, warehouse_id, on_hand, created_at, updated_at)
      VALUES (p_factory_id, v_movement.warehouse_id, 0, now(), now())
      ON CONFLICT (factory_id, warehouse_id) DO NOTHING;

      UPDATE inventory_oil_stock_pools
      SET on_hand = on_hand - v_movement.quantity_in + v_movement.quantity_out,
          updated_at = now()
      WHERE factory_id = p_factory_id
        AND warehouse_id = v_movement.warehouse_id;
    ELSE
      UPDATE inventory_stock_balances
      SET on_hand = on_hand - v_movement.quantity_in + v_movement.quantity_out,
          updated_at = now()
      WHERE factory_id = p_factory_id
        AND warehouse_id = v_movement.warehouse_id
        AND item_id = v_movement.item_id;
    END IF;

    IF v_movement.lot_no IS NOT NULL THEN
      UPDATE inventory_lot_balances
      SET on_hand = on_hand - v_movement.quantity_in + v_movement.quantity_out,
          updated_at = now()
      WHERE factory_id = p_factory_id
        AND warehouse_id = v_movement.warehouse_id
        AND item_id = v_movement.item_id
        AND lot_no = v_movement.lot_no
        AND (expiry_date IS NOT DISTINCT FROM v_movement.expiry_date);
    END IF;
  END LOOP;

  DELETE FROM inventory_stock_movements
  WHERE document_id = p_document_id AND factory_id = p_factory_id;

  UPDATE inventory_documents
  SET status = 'cancelled',
      cancelled_by = p_cancelled_by,
      cancel_reason = NULLIF(trim(p_cancel_reason), ''),
      cancelled_at = now(),
      updated_at = now()
  WHERE id = p_document_id AND factory_id = p_factory_id;
END;
$$;
