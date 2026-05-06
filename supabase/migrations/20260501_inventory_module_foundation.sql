-- ============================================
-- INVENTORY MODULE FOUNDATION
-- ============================================

CREATE TABLE inventory_warehouses (
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

CREATE TABLE inventory_item_categories (
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

CREATE TABLE inventory_items (
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

CREATE TABLE inventory_item_warehouse_rules (
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

CREATE TABLE inventory_documents (
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

CREATE TABLE inventory_document_lines (
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

CREATE TABLE inventory_stock_balances (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID REFERENCES factories(id),
  warehouse_id UUID REFERENCES inventory_warehouses(id),
  item_id UUID REFERENCES inventory_items(id),
  on_hand NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(factory_id, warehouse_id, item_id)
);

CREATE TABLE inventory_lot_balances (
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

CREATE TABLE inventory_stock_movements (
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

CREATE TABLE inventory_document_attachments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID REFERENCES factories(id),
  document_id UUID REFERENCES inventory_documents(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  caption TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE inventory_consumption_norms (
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

CREATE TABLE inventory_consumption_norm_lines (
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

CREATE TABLE inventory_monthly_norm_reports (
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

CREATE TABLE inventory_monthly_norm_report_lines (
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

CREATE INDEX idx_inventory_warehouses_factory ON inventory_warehouses(factory_id);
CREATE INDEX idx_inventory_categories_factory ON inventory_item_categories(factory_id);
CREATE INDEX idx_inventory_items_factory ON inventory_items(factory_id);
CREATE INDEX idx_inventory_documents_factory ON inventory_documents(factory_id);
CREATE INDEX idx_inventory_documents_date ON inventory_documents(document_date);
CREATE INDEX idx_inventory_document_lines_factory ON inventory_document_lines(factory_id);
CREATE INDEX idx_inventory_document_lines_document ON inventory_document_lines(document_id);
CREATE INDEX idx_inventory_document_attachments_factory ON inventory_document_attachments(factory_id);
CREATE INDEX idx_inventory_balances_item_wh ON inventory_stock_balances(factory_id, warehouse_id, item_id);
CREATE INDEX idx_inventory_lot_balances_item_wh ON inventory_lot_balances(factory_id, warehouse_id, item_id);
CREATE INDEX idx_inventory_movements_doc ON inventory_stock_movements(document_id);
CREATE INDEX idx_inventory_movements_item_wh ON inventory_stock_movements(factory_id, warehouse_id, item_id);
CREATE INDEX idx_inventory_norms_factory ON inventory_consumption_norms(factory_id);
CREATE INDEX idx_inventory_norm_lines_factory ON inventory_consumption_norm_lines(factory_id);
CREATE INDEX idx_inventory_norm_reports_factory ON inventory_monthly_norm_reports(factory_id);
CREATE INDEX idx_inventory_norm_report_lines_factory ON inventory_monthly_norm_report_lines(factory_id);

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
    RAISE EXCEPTION 'Khong the xuat kho vuot ton. So xuat: %, ton hien tai: %',
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
      RAISE EXCEPTION 'Khong the xuat lo vuot ton. So xuat: %, ton lo hien tai: %',
        NEW.quantity_out, current_lot_on_hand;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_inventory_prevent_negative_stock
BEFORE INSERT ON inventory_stock_movements
FOR EACH ROW
EXECUTE FUNCTION inventory_prevent_negative_stock();

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

CREATE POLICY "Allow all" ON inventory_warehouses FOR ALL USING (true);
CREATE POLICY "Allow all" ON inventory_item_categories FOR ALL USING (true);
CREATE POLICY "Allow all" ON inventory_items FOR ALL USING (true);
CREATE POLICY "Allow all" ON inventory_item_warehouse_rules FOR ALL USING (true);
CREATE POLICY "Allow all" ON inventory_documents FOR ALL USING (true);
CREATE POLICY "Allow all" ON inventory_document_lines FOR ALL USING (true);
CREATE POLICY "Allow all" ON inventory_stock_balances FOR ALL USING (true);
CREATE POLICY "Allow all" ON inventory_lot_balances FOR ALL USING (true);
CREATE POLICY "Allow all" ON inventory_stock_movements FOR ALL USING (true);
CREATE POLICY "Allow all" ON inventory_document_attachments FOR ALL USING (true);
CREATE POLICY "Allow all" ON inventory_consumption_norms FOR ALL USING (true);
CREATE POLICY "Allow all" ON inventory_consumption_norm_lines FOR ALL USING (true);
CREATE POLICY "Allow all" ON inventory_monthly_norm_reports FOR ALL USING (true);
CREATE POLICY "Allow all" ON inventory_monthly_norm_report_lines FOR ALL USING (true);
