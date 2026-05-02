-- ============================================================
-- Migration: Inventory audit trail + cancel + alert thresholds
-- ============================================================

-- ── 1. Bổ sung cột audit cho inventory_documents ─────────────

ALTER TABLE inventory_documents
  ADD COLUMN IF NOT EXISTS posted_by    UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS posted_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

-- ── 2. Bảng cấu hình ngưỡng cảnh báo ─────────────────────────

CREATE TABLE IF NOT EXISTS inventory_alert_thresholds (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID        NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  code       TEXT        NOT NULL,
  label      TEXT        NOT NULL,
  value      NUMERIC     NOT NULL DEFAULT 50,
  unit       TEXT        NOT NULL DEFAULT '%',
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(factory_id, code)
);

ALTER TABLE inventory_alert_thresholds ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'inventory_alert_thresholds' AND policyname = 'Allow all'
  ) THEN
    CREATE POLICY "Allow all" ON inventory_alert_thresholds FOR ALL USING (true);
  END IF;
END $$;

-- ── 3. Cập nhật stored procedure: lưu posted_by / posted_at ──

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

  UPDATE inventory_documents
  SET status = 'posted', posted_by = p_posted_by, posted_at = now(), updated_at = now()
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

  UPDATE inventory_documents
  SET status = 'posted', posted_by = p_posted_by, posted_at = now(), updated_at = now()
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

  UPDATE inventory_documents
  SET status = 'posted', posted_by = p_posted_by, posted_at = now(), updated_at = now()
  WHERE id = p_document_id AND factory_id = p_factory_id;

  RETURN QUERY SELECT v_document.id, v_document.document_code, v_posted_lines;
END;
$$;

-- ── 4. Stored procedure hủy phiếu ────────────────────────────

CREATE OR REPLACE FUNCTION inventory_cancel_document(
  p_factory_id  UUID,
  p_document_id UUID,
  p_cancelled_by UUID,
  p_cancel_reason TEXT
)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_document inventory_documents%ROWTYPE;
  v_line     inventory_document_lines%ROWTYPE;
  v_movement inventory_stock_movements%ROWTYPE;
BEGIN
  SELECT * INTO v_document FROM inventory_documents
  WHERE id = p_document_id AND factory_id = p_factory_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy phiếu cần hủy.'; END IF;
  IF v_document.status <> 'posted' THEN
    RAISE EXCEPTION 'Chỉ có thể hủy phiếu đã ghi sổ. Trạng thái hiện tại: %.', v_document.status;
  END IF;

  -- Đảo ngược tồn kho theo từng movement đã ghi
  FOR v_movement IN
    SELECT * FROM inventory_stock_movements
    WHERE document_id = p_document_id AND factory_id = p_factory_id
  LOOP
    IF v_movement.quantity_in > 0 THEN
      -- Nhập vào → trừ ra
      UPDATE inventory_stock_balances
      SET on_hand = on_hand - v_movement.quantity_in, updated_at = now()
      WHERE factory_id = p_factory_id AND warehouse_id = v_movement.warehouse_id AND item_id = v_movement.item_id;

      IF v_movement.lot_no IS NOT NULL THEN
        UPDATE inventory_lot_balances
        SET on_hand = on_hand - v_movement.quantity_in, updated_at = now()
        WHERE factory_id = p_factory_id AND warehouse_id = v_movement.warehouse_id
          AND item_id = v_movement.item_id AND lot_no = v_movement.lot_no
          AND (expiry_date IS NOT DISTINCT FROM v_movement.expiry_date);
      END IF;
    END IF;

    IF v_movement.quantity_out > 0 THEN
      -- Xuất ra → cộng lại
      UPDATE inventory_stock_balances
      SET on_hand = on_hand + v_movement.quantity_out, updated_at = now()
      WHERE factory_id = p_factory_id AND warehouse_id = v_movement.warehouse_id AND item_id = v_movement.item_id;

      IF v_movement.lot_no IS NOT NULL THEN
        INSERT INTO inventory_lot_balances(factory_id, warehouse_id, item_id, lot_no, expiry_date, on_hand, created_at, updated_at)
        VALUES (p_factory_id, v_movement.warehouse_id, v_movement.item_id, v_movement.lot_no, v_movement.expiry_date, v_movement.quantity_out, now(), now())
        ON CONFLICT (factory_id, warehouse_id, item_id, lot_no, expiry_date)
        DO UPDATE SET on_hand = inventory_lot_balances.on_hand + EXCLUDED.on_hand, updated_at = now();
      END IF;
    END IF;
  END LOOP;

  -- Đánh dấu phiếu đã hủy
  UPDATE inventory_documents
  SET status = 'cancelled',
      cancelled_by = p_cancelled_by,
      cancelled_at = now(),
      cancel_reason = p_cancel_reason,
      updated_at = now()
  WHERE id = p_document_id AND factory_id = p_factory_id;
END;
$$;
