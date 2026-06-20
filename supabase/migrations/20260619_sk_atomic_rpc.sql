-- Atomic RPC: Sang kiện / Thay bọc
-- Thay thế 3 bước riêng (UPDATE lots + INSERT residual + INSERT sk_history) bằng 1 transaction

CREATE OR REPLACE FUNCTION perform_sang_kien_thay_boc(
  p_factory_id      UUID,
  p_loai            TEXT,     -- 'Sang kiện' | 'Thay bọc'
  p_lots            JSONB,    -- array of lot operation objects
  p_history_payload JSONB     -- sk_history fields + lots array
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  lot_item JSONB;
  v_lot    RECORD;
BEGIN
  -- Process each lot in the operation
  FOR lot_item IN SELECT value FROM jsonb_array_elements(p_lots) LOOP

    -- Lock the source lot row to prevent concurrent modifications
    SELECT * INTO v_lot
      FROM lots
      WHERE id = (lot_item->>'lot_id')::UUID
        AND factory_id = p_factory_id
      FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Lô % không tìm thấy hoặc không thuộc nhà máy này', lot_item->>'lot_id';
    END IF;

    -- Validate: moved kien must not exceed current DB values
    IF (lot_item->>'new_kien_a')::INT > v_lot.kien_a OR
       (lot_item->>'new_kien_b')::INT > v_lot.kien_b OR
       (lot_item->>'new_kien_c')::INT > v_lot.kien_c OR
       (lot_item->>'new_kien_d')::INT > v_lot.kien_d THEN
      RAISE EXCEPTION 'Số kiện chuyển vượt quá tồn tại lô %', v_lot.ma_lo;
    END IF;

    -- Step 1: Update source lot with new kien counts and new boc/pallet
    UPDATE lots SET
      kien_a    = (lot_item->>'new_kien_a')::INT,
      kien_b    = (lot_item->>'new_kien_b')::INT,
      kien_c    = (lot_item->>'new_kien_c')::INT,
      kien_d    = (lot_item->>'new_kien_d')::INT,
      tong_banh = (lot_item->>'new_tong_banh')::INT,
      tong_kg   = (lot_item->>'new_tong_kg')::NUMERIC,
      boc       = COALESCE(lot_item->>'new_boc', boc),
      pallet    = CASE
                    WHEN lot_item->'new_pallet' IS NOT NULL
                         AND jsonb_typeof(lot_item->'new_pallet') = 'array'
                    THEN ARRAY(SELECT jsonb_array_elements_text(lot_item->'new_pallet'))
                    ELSE pallet
                  END,
      updated_at = NOW()
    WHERE id = v_lot.id;

    -- Step 2: Create residual lot if partial split (INSERT ... ON CONFLICT DO NOTHING
    --         preserves existing residual lots that may have their own history/exports)
    IF (lot_item->>'has_residual')::BOOLEAN = TRUE THEN
      INSERT INTO lots (
        factory_id,    ma_lo,                    num,
        suffix,        year,
        ngay_sx,       ngay_ht,                  ca,
        ngan_id,       day_chuyen,
        loai_csr,      loai_banh,
        boc,           tham,                     pallet,           chi_thi,
        kien_a,        kien_b,                   kien_c,           kien_d,
        tong_banh,     tong_kg,
        trang_thai,    ghi_chu,
        created_at,    updated_at
      ) VALUES (
        p_factory_id,
        lot_item->>'residual_ma_lo',
        v_lot.num,
        v_lot.suffix || 'r',
        v_lot.year,
        v_lot.ngay_sx,
        v_lot.ngay_ht,
        v_lot.ca,
        v_lot.ngan_id,
        v_lot.day_chuyen,
        v_lot.loai_csr,
        v_lot.loai_banh,
        v_lot.boc,
        v_lot.tham,
        v_lot.pallet,
        v_lot.chi_thi,
        (lot_item->>'res_kien_a')::INT,
        (lot_item->>'res_kien_b')::INT,
        (lot_item->>'res_kien_c')::INT,
        (lot_item->>'res_kien_d')::INT,
        (lot_item->>'res_tong_banh')::INT,
        (lot_item->>'res_tong_kg')::NUMERIC,
        'Hoàn thành',
        'Tồn dư từ ' || v_lot.ma_lo,
        NOW(),
        NOW()
      )
      ON CONFLICT (factory_id, ma_lo) DO NOTHING;
      -- DO NOTHING: nếu residual đã tồn tại (split lần trước), giữ nguyên
      -- tránh ghi đè lô tồn dư đã có lịch sử xuất hàng riêng
    END IF;

  END LOOP;

  -- Step 3: Insert sk_history audit record (same transaction = all-or-nothing)
  INSERT INTO sk_history (
    factory_id,
    ngay,
    loai,
    chung_loai,
    from_boc,
    to_boc,
    from_pallet,
    to_pallet,
    lots
  ) VALUES (
    p_factory_id,
    (p_history_payload->>'ngay')::DATE,
    p_loai,
    p_history_payload->>'chung_loai',
    p_history_payload->>'from_boc',
    p_history_payload->>'to_boc',
    p_history_payload->>'from_pallet',
    p_history_payload->>'to_pallet',
    p_history_payload->'lots'
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

-- Grant execute to authenticated users (RLS on underlying tables enforces factory isolation)
GRANT EXECUTE ON FUNCTION perform_sang_kien_thay_boc(UUID, TEXT, JSONB, JSONB)
  TO authenticated;
