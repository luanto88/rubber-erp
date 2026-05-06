CREATE OR REPLACE FUNCTION inventory_post_import_document(
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
  v_balance_after NUMERIC;
  v_posted_lines INTEGER := 0;
BEGIN
  SELECT *
  INTO v_document
  FROM inventory_documents
  WHERE id = p_document_id
    AND factory_id = p_factory_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Khong tim thay phieu nhap can ghi so.';
  END IF;

  IF v_document.document_type <> 'import' THEN
    RAISE EXCEPTION 'Chi duoc ghi so bang ham nay cho phieu nhap kho.';
  END IF;

  IF v_document.status = 'posted' THEN
    RAISE EXCEPTION 'Phieu nhap % da duoc ghi so truoc do.', v_document.document_code;
  END IF;

  IF v_document.status = 'cancelled' THEN
    RAISE EXCEPTION 'Phieu nhap % da bi huy, khong the ghi so.', v_document.document_code;
  END IF;

  IF v_document.target_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Phieu nhap % chua co kho dich.', v_document.document_code;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM inventory_document_lines
    WHERE document_id = p_document_id
      AND factory_id = p_factory_id
  ) THEN
    RAISE EXCEPTION 'Phieu nhap % chua co dong vat tu.', v_document.document_code;
  END IF;

  FOR v_line IN
    SELECT *
    FROM inventory_document_lines
    WHERE document_id = p_document_id
      AND factory_id = p_factory_id
    ORDER BY created_at, id
  LOOP
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
    RETURNING on_hand INTO v_balance_after;

    IF v_line.lot_no IS NOT NULL THEN
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
    VALUES (
      p_factory_id,
      p_document_id,
      v_line.id,
      'import',
      v_document.target_warehouse_id,
      v_line.item_id,
      v_line.quantity,
      0,
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
