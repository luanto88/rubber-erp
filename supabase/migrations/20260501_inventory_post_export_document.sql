CREATE OR REPLACE FUNCTION inventory_post_export_document(
  p_factory_id UUID,
  p_document_id UUID,
  p_posted_by UUID DEFAULT NULL
)
RETURNS TABLE (
  document_id UUID,
  document_code TEXT,
  posted_lines INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_document inventory_documents%ROWTYPE;
  v_line inventory_document_lines%ROWTYPE;
  v_item inventory_items%ROWTYPE;
  v_balance_after NUMERIC;
  v_current_stock NUMERIC;
  v_lot_stock NUMERIC;
  v_posted_lines INTEGER := 0;
BEGIN
  SELECT *
  INTO v_document
  FROM inventory_documents
  WHERE id = p_document_id
    AND factory_id = p_factory_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay phieu xuat can ghi so.';
  END IF;

  IF v_document.document_type <> 'export' THEN
    RAISE EXCEPTION 'Chi duoc ghi so bang ham nay cho phieu xuat kho.';
  END IF;

  IF v_document.status = 'posted' THEN
    RAISE EXCEPTION 'Phieu xuat % da duoc ghi so truoc do.', v_document.document_code;
  END IF;

  IF v_document.status = 'cancelled' THEN
    RAISE EXCEPTION 'Phieu xuat % da bi huy, khong the ghi so.', v_document.document_code;
  END IF;

  IF v_document.source_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Phieu xuat % chua co kho nguon.', v_document.document_code;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM inventory_document_lines
    WHERE document_id = p_document_id
      AND factory_id = p_factory_id
  ) THEN
    RAISE EXCEPTION 'Phieu xuat % chua co dong vat tu.', v_document.document_code;
  END IF;

  FOR v_line IN
    SELECT *
    FROM inventory_document_lines
    WHERE document_id = p_document_id
      AND factory_id = p_factory_id
    ORDER BY created_at, id
  LOOP
    SELECT *
    INTO v_item
    FROM inventory_items
    WHERE id = v_line.item_id
      AND factory_id = p_factory_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Khong tim thay vat tu cua dong %.', v_line.item_code;
    END IF;

    IF v_item.manages_lot AND COALESCE(NULLIF(trim(v_line.lot_no), ''), '') = '' THEN
      RAISE EXCEPTION 'Vat tu % bat buoc chon so lo truoc khi xuat.', v_line.item_code;
    END IF;

    SELECT COALESCE(on_hand, 0)
    INTO v_current_stock
    FROM inventory_stock_balances
    WHERE factory_id = p_factory_id
      AND warehouse_id = v_document.source_warehouse_id
      AND item_id = v_line.item_id
    FOR UPDATE;

    v_current_stock := COALESCE(v_current_stock, 0);

    IF v_line.quantity > v_current_stock THEN
      RAISE EXCEPTION
        'Khong the xuat % % cua vat tu % vi ton hien tai chi con %.',
        v_line.quantity,
        v_line.unit,
        v_line.item_code,
        v_current_stock;
    END IF;

    IF COALESCE(NULLIF(trim(v_line.lot_no), ''), '') <> '' THEN
      SELECT COALESCE(on_hand, 0)
      INTO v_lot_stock
      FROM inventory_lot_balances
      WHERE factory_id = p_factory_id
        AND warehouse_id = v_document.source_warehouse_id
        AND item_id = v_line.item_id
        AND lot_no = v_line.lot_no
        AND (expiry_date IS NOT DISTINCT FROM v_line.expiry_date)
      FOR UPDATE;

      v_lot_stock := COALESCE(v_lot_stock, 0);

      IF v_line.quantity > v_lot_stock THEN
        RAISE EXCEPTION
          'Khong the xuat lo % cua vat tu % vi ton lo chi con %.',
          v_line.lot_no,
          v_line.item_code,
          v_lot_stock;
      END IF;

      UPDATE inventory_lot_balances
      SET
        on_hand = inventory_lot_balances.on_hand - v_line.quantity,
        updated_at = now()
      WHERE factory_id = p_factory_id
        AND warehouse_id = v_document.source_warehouse_id
        AND item_id = v_line.item_id
        AND lot_no = v_line.lot_no
        AND (expiry_date IS NOT DISTINCT FROM v_line.expiry_date);
    END IF;

    UPDATE inventory_stock_balances
    SET
      on_hand = inventory_stock_balances.on_hand - v_line.quantity,
      updated_at = now()
    WHERE factory_id = p_factory_id
      AND warehouse_id = v_document.source_warehouse_id
      AND item_id = v_line.item_id
    RETURNING on_hand INTO v_balance_after;

    INSERT INTO inventory_stock_movements (
      factory_id,
      document_id,
      document_line_id,
      movement_type,
      warehouse_id,
      item_id,
      quantity_in,
      quantity_out,
      balance_after,
      lot_no,
      expiry_date,
      movement_date,
      created_at
    )
    VALUES (
      p_factory_id,
      p_document_id,
      v_line.id,
      'export',
      v_document.source_warehouse_id,
      v_line.item_id,
      0,
      v_line.quantity,
      v_balance_after,
      v_line.lot_no,
      v_line.expiry_date,
      v_document.document_date,
      now()
    );

    v_posted_lines := v_posted_lines + 1;
  END LOOP;

  UPDATE inventory_documents
  SET
    status = 'posted',
    updated_at = now()
  WHERE id = p_document_id
    AND factory_id = p_factory_id;

  RETURN QUERY
  SELECT v_document.id, v_document.document_code, v_posted_lines;
END;
$$;
