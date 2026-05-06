CREATE OR REPLACE FUNCTION inventory_post_transfer_document(
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
  v_source_balance_after NUMERIC;
  v_target_balance_after NUMERIC;
  v_source_stock NUMERIC;
  v_source_lot_stock NUMERIC;
  v_posted_lines INTEGER := 0;
BEGIN
  SELECT *
  INTO v_document
  FROM inventory_documents
  WHERE id = p_document_id
    AND factory_id = p_factory_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay phieu chuyen kho can ghi so.';
  END IF;

  IF v_document.document_type <> 'transfer' THEN
    RAISE EXCEPTION 'Chi duoc ghi so bang ham nay cho phieu chuyen kho.';
  END IF;

  IF v_document.status = 'posted' THEN
    RAISE EXCEPTION 'Phieu chuyen % da duoc ghi so truoc do.', v_document.document_code;
  END IF;

  IF v_document.status = 'cancelled' THEN
    RAISE EXCEPTION 'Phieu chuyen % da bi huy, khong the ghi so.', v_document.document_code;
  END IF;

  IF v_document.source_warehouse_id IS NULL OR v_document.target_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Phieu chuyen % chua day du kho nguon va kho dich.', v_document.document_code;
  END IF;

  IF v_document.source_warehouse_id = v_document.target_warehouse_id THEN
    RAISE EXCEPTION 'Kho nguon va kho dich khong duoc trung nhau.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM inventory_document_lines
    WHERE document_id = p_document_id
      AND factory_id = p_factory_id
  ) THEN
    RAISE EXCEPTION 'Phieu chuyen % chua co dong vat tu.', v_document.document_code;
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
      RAISE EXCEPTION 'Vat tu % bat buoc chon so lo truoc khi chuyen kho.', v_line.item_code;
    END IF;

    SELECT COALESCE(on_hand, 0)
    INTO v_source_stock
    FROM inventory_stock_balances
    WHERE factory_id = p_factory_id
      AND warehouse_id = v_document.source_warehouse_id
      AND item_id = v_line.item_id
    FOR UPDATE;

    v_source_stock := COALESCE(v_source_stock, 0);

    IF v_line.quantity > v_source_stock THEN
      RAISE EXCEPTION
        'Khong the chuyen % % cua vat tu % vi ton kho nguon chi con %.',
        v_line.quantity,
        v_line.unit,
        v_line.item_code,
        v_source_stock;
    END IF;

    IF COALESCE(NULLIF(trim(v_line.lot_no), ''), '') <> '' THEN
      SELECT COALESCE(on_hand, 0)
      INTO v_source_lot_stock
      FROM inventory_lot_balances
      WHERE factory_id = p_factory_id
        AND warehouse_id = v_document.source_warehouse_id
        AND item_id = v_line.item_id
        AND lot_no = v_line.lot_no
        AND (expiry_date IS NOT DISTINCT FROM v_line.expiry_date)
      FOR UPDATE;

      v_source_lot_stock := COALESCE(v_source_lot_stock, 0);

      IF v_line.quantity > v_source_lot_stock THEN
        RAISE EXCEPTION
          'Khong the chuyen lo % cua vat tu % vi ton lo tai kho nguon chi con %.',
          v_line.lot_no,
          v_line.item_code,
          v_source_lot_stock;
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
    RETURNING on_hand INTO v_source_balance_after;

    INSERT INTO inventory_stock_balances (
      factory_id,
      warehouse_id,
      item_id,
      on_hand,
      created_at,
      updated_at
    )
    VALUES (
      p_factory_id,
      v_document.target_warehouse_id,
      v_line.item_id,
      v_line.quantity,
      now(),
      now()
    )
    ON CONFLICT (factory_id, warehouse_id, item_id)
    DO UPDATE SET
      on_hand = inventory_stock_balances.on_hand + EXCLUDED.on_hand,
      updated_at = now()
    RETURNING on_hand INTO v_target_balance_after;

    IF COALESCE(NULLIF(trim(v_line.lot_no), ''), '') <> '' THEN
      INSERT INTO inventory_lot_balances (
        factory_id,
        warehouse_id,
        item_id,
        lot_no,
        expiry_date,
        on_hand,
        created_at,
        updated_at
      )
      VALUES (
        p_factory_id,
        v_document.target_warehouse_id,
        v_line.item_id,
        v_line.lot_no,
        v_line.expiry_date,
        v_line.quantity,
        now(),
        now()
      )
      ON CONFLICT (factory_id, warehouse_id, item_id, lot_no, expiry_date)
      DO UPDATE SET
        on_hand = inventory_lot_balances.on_hand + EXCLUDED.on_hand,
        updated_at = now();
    END IF;

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
    VALUES
    (
      p_factory_id,
      p_document_id,
      v_line.id,
      'transfer_out',
      v_document.source_warehouse_id,
      v_line.item_id,
      0,
      v_line.quantity,
      v_source_balance_after,
      v_line.lot_no,
      v_line.expiry_date,
      v_document.document_date,
      now()
    ),
    (
      p_factory_id,
      p_document_id,
      v_line.id,
      'transfer_in',
      v_document.target_warehouse_id,
      v_line.item_id,
      v_line.quantity,
      0,
      v_target_balance_after,
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
