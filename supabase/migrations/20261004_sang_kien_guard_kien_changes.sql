-- GĐ6b (2026-09-29): Sang kiện / Thay bọc — chặn đổi trùng + sổ cái thay đổi theo kiện.
--
-- Chép nguyên từ 20260930b_sang_kien_thay_boc_tron_kien.sql (chữ ký KHÔNG đổi), chỉ thêm:
--   1. Chặn Thay bọc sang ĐÚNG bọc kiện đang mang, chặn Sang kiện sang ĐÚNG tập pallet kiện đang có
--      (trước đây ghi được bản sk_history "nhãn→nhãn" vô nghĩa).
--   2. sk_history.kien_changes: 1 phần tử / kiện đổi — bọc/pallet TRƯỚC khi đổi đọc từ giao dịch thật
--      (sk_history.from_boc cũ lấy theo lots.boc = bản chụp giao dịch cuối, không tin được theo kiện).
--      Báo cáo F12 dùng cột này để ghi −bọc nguồn / +bọc đích vào đúng ngày thao tác.
--   3. sk_history.ngay = ngày theo giờ nhà máy (client cũ gửi toISOString() = UTC).
--
-- Chạy tay trên Supabase SQL Editor. Idempotent.

ALTER TABLE sk_history ADD COLUMN IF NOT EXISTS kien_changes JSONB;
COMMENT ON COLUMN sk_history.kien_changes IS 'GĐ6b: [{lot_id, ma_lo, kien, so_banh, so_kg, from_boc, to_boc, from_pallet, to_pallet}] — trạng thái TRƯỚC khi đổi đọc từ lot_transactions. Nguồn cho F12.';

CREATE OR REPLACE FUNCTION perform_sang_kien_thay_boc(
  p_factory_id      UUID,
  p_actor_id        UUID,
  p_loai            TEXT,     -- 'Sang kiện' | 'Thay bọc'
  p_lots            JSONB,    -- [{ "lot_id": uuid, "kiens": ["a","c"] }]
  p_new_boc         TEXT,     -- bắt buộc khi Thay bọc
  p_new_pallet      TEXT[],   -- bắt buộc khi Sang kiện
  p_history_payload JSONB     -- ngay, chung_loai, from_boc, to_boc, from_pallet, to_pallet, lots
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin   BOOLEAN;
  v_item       JSONB;
  v_lot        RECORD;
  v_tx         RECORD;
  v_kiens      TEXT[];
  v_k          TEXT;
  v_prod       NUMERIC;
  v_assigned   NUMERIC;
  v_sel_a      BOOLEAN; v_sel_b BOOLEAN; v_sel_c BOOLEAN; v_sel_d BOOLEAN;
  v_has_sel    BOOLEAN;
  v_has_unsel  BOOLEAN;
  v_move_banh  NUMERIC;
  v_move_kg    NUMERIC;
  v_new_boc    TEXT := NULLIF(btrim(p_new_boc), '');
  v_is_boc     BOOLEAN := (p_loai = 'Thay bọc');
  v_lot_count  INT := 0;
  v_tx_count   INT := 0;
  v_cur_boc    TEXT;
  v_cur_pallet TEXT[];
  v_new_pallet_norm TEXT[] := ARRAY(
    SELECT DISTINCT btrim(x) FROM unnest(COALESCE(p_new_pallet, '{}'::TEXT[])) x WHERE btrim(x) <> '' ORDER BY 1
  );
  v_changes    JSONB := '[]'::jsonb;
  v_today      DATE := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE;
BEGIN
  IF p_loai NOT IN ('Sang kiện', 'Thay bọc') THEN
    RAISE EXCEPTION 'Loại thao tác không hợp lệ: %', p_loai;
  END IF;
  IF v_is_boc AND v_new_boc IS NULL THEN
    RAISE EXCEPTION 'Chưa chọn bọc mới.';
  END IF;
  IF NOT v_is_boc AND COALESCE(array_length(p_new_pallet, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Chưa chọn pallet mới.';
  END IF;
  IF jsonb_typeof(p_lots) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lots) = 0 THEN
    RAISE EXCEPTION 'Chưa chọn lô nào.';
  END IF;

  SELECT (pr.role = 'admin') INTO v_is_admin
  FROM profiles pr
  WHERE pr.id = p_actor_id AND pr.status = 'active' AND pr.factory_id = p_factory_id;
  IF v_is_admin IS NULL THEN
    RAISE EXCEPTION 'Người thao tác không hợp lệ hoặc không thuộc nhà máy này.';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_lots) LOOP
    SELECT l.* INTO v_lot
    FROM lots l
    WHERE l.id = (v_item->>'lot_id')::UUID AND l.factory_id = p_factory_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Lô % không tìm thấy hoặc không thuộc nhà máy này.', v_item->>'lot_id';
    END IF;
    IF v_lot.trang_thai IS DISTINCT FROM 'Hoàn thành' THEN
      RAISE EXCEPTION 'Lô % đang "%", chỉ đổi được lô Hoàn thành.', v_lot.ma_lo, v_lot.trang_thai;
    END IF;

    v_kiens := ARRAY(
      SELECT DISTINCT lower(btrim(x))
      FROM jsonb_array_elements_text(COALESCE(v_item->'kiens', '[]'::jsonb)) x
      WHERE lower(btrim(x)) IN ('a', 'b', 'c', 'd')
    );
    IF COALESCE(array_length(v_kiens, 1), 0) = 0 THEN
      RAISE EXCEPTION 'Lô % chưa chọn kiện nào.', v_lot.ma_lo;
    END IF;

    FOREACH v_k IN ARRAY v_kiens LOOP
      EXECUTE format('SELECT COALESCE(SUM(lt.kien_%s), 0) FROM lot_transactions lt WHERE lt.lot_id = $1', v_k)
        INTO v_prod USING v_lot.id;
      IF v_prod <= 0 THEN
        RAISE EXCEPTION 'Kiện % của lô % chưa có bành.', upper(v_k), v_lot.ma_lo;
      END IF;

      SELECT COALESCE(SUM(COALESCE(NULLIF(a->>('kien_' || v_k), '')::NUMERIC, 0)), 0) INTO v_assigned
      FROM export_orders eo
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(eo.assignments) = 'array' THEN eo.assignments ELSE '[]'::jsonb END
      ) a
      WHERE eo.factory_id = p_factory_id
        AND (a->>'lot_id' = v_lot.id::TEXT OR lower(btrim(COALESCE(a->>'ma_lo', ''))) = lower(v_lot.ma_lo));
      IF v_assigned > 0 THEN
        RAISE EXCEPTION 'Kiện % của lô % đã gán % bành vào đơn xuất — chỉ đổi được kiện chưa xuất (tròn kiện).',
          upper(v_k), v_lot.ma_lo, v_assigned;
      END IF;

      -- Bọc/pallet hiện tại của kiện = giao dịch cuối chứa kiện (dự phòng: bản chụp của lô).
      EXECUTE format(
        'SELECT lt.boc, lt.pallet FROM lot_transactions lt WHERE lt.lot_id = $1 AND lt.kien_%s <> 0
           ORDER BY lt.created_at DESC, lt.id DESC LIMIT 1', v_k)
        INTO v_cur_boc, v_cur_pallet USING v_lot.id;
      v_cur_boc := COALESCE(NULLIF(btrim(v_cur_boc), ''), NULLIF(btrim(v_lot.boc), ''));
      v_cur_pallet := COALESCE(v_cur_pallet, v_lot.pallet, '{}'::TEXT[]);
      IF v_is_boc AND v_cur_boc IS NOT DISTINCT FROM v_new_boc THEN
        RAISE EXCEPTION 'Kiện % của lô % đã mang bọc "%" — không thay trùng bọc.', upper(v_k), v_lot.ma_lo, v_new_boc;
      END IF;
      IF NOT v_is_boc AND ARRAY(
        SELECT DISTINCT btrim(x) FROM unnest(v_cur_pallet) x WHERE btrim(x) <> '' ORDER BY 1
      ) = v_new_pallet_norm THEN
        RAISE EXCEPTION 'Kiện % của lô % đã dùng pallet "%" — không sang trùng pallet.',
          upper(v_k), v_lot.ma_lo, array_to_string(v_new_pallet_norm, ', ');
      END IF;
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'lot_id', v_lot.id, 'ma_lo', v_lot.ma_lo, 'kien', v_k,
        'so_banh', v_prod, 'so_kg', v_prod * COALESCE(v_lot.loai_banh, 0),
        'from_boc', v_cur_boc, 'to_boc', CASE WHEN v_is_boc THEN v_new_boc ELSE v_cur_boc END,
        'from_pallet', to_jsonb(v_cur_pallet),
        'to_pallet', CASE WHEN v_is_boc THEN to_jsonb(v_cur_pallet) ELSE to_jsonb(p_new_pallet) END
      ));

      IF NOT v_is_admin THEN
        EXECUTE format(
          'SELECT EXISTS (SELECT 1 FROM lot_transactions lt WHERE lt.lot_id = $1 AND lt.kien_%s <> 0
             AND public.product_shift_is_locked($2, lt.ngay_nhap, lt.ca))', v_k)
          INTO v_has_sel USING v_lot.id, p_factory_id;
        IF v_has_sel THEN
          RAISE EXCEPTION 'Kiện % của lô % thuộc ca đã duyệt & khóa — liên hệ admin.', upper(v_k), v_lot.ma_lo;
        END IF;
      END IF;
    END LOOP;

    v_sel_a := 'a' = ANY (v_kiens);
    v_sel_b := 'b' = ANY (v_kiens);
    v_sel_c := 'c' = ANY (v_kiens);
    v_sel_d := 'd' = ANY (v_kiens);

    FOR v_tx IN
      SELECT lt.* FROM lot_transactions lt WHERE lt.lot_id = v_lot.id ORDER BY lt.created_at FOR UPDATE
    LOOP
      v_has_sel := (v_sel_a AND COALESCE(v_tx.kien_a, 0) <> 0) OR (v_sel_b AND COALESCE(v_tx.kien_b, 0) <> 0)
                OR (v_sel_c AND COALESCE(v_tx.kien_c, 0) <> 0) OR (v_sel_d AND COALESCE(v_tx.kien_d, 0) <> 0);
      IF NOT v_has_sel THEN CONTINUE; END IF;
      v_has_unsel := (NOT v_sel_a AND COALESCE(v_tx.kien_a, 0) <> 0) OR (NOT v_sel_b AND COALESCE(v_tx.kien_b, 0) <> 0)
                  OR (NOT v_sel_c AND COALESCE(v_tx.kien_c, 0) <> 0) OR (NOT v_sel_d AND COALESCE(v_tx.kien_d, 0) <> 0);
      v_tx_count := v_tx_count + 1;

      IF v_has_unsel THEN
        -- Tách dòng: phần kiện được đổi sang dòng mới, kg chia theo tỷ lệ bành để tổng không đổi.
        v_move_banh := (CASE WHEN v_sel_a THEN COALESCE(v_tx.kien_a, 0) ELSE 0 END)
                     + (CASE WHEN v_sel_b THEN COALESCE(v_tx.kien_b, 0) ELSE 0 END)
                     + (CASE WHEN v_sel_c THEN COALESCE(v_tx.kien_c, 0) ELSE 0 END)
                     + (CASE WHEN v_sel_d THEN COALESCE(v_tx.kien_d, 0) ELSE 0 END);
        v_move_kg := CASE
          WHEN COALESCE(v_tx.so_banh, 0) <> 0 THEN round(COALESCE(v_tx.so_kg, 0) * v_move_banh / v_tx.so_banh, 2)
          ELSE v_move_banh * COALESCE(v_lot.loai_banh, 0)
        END;

        INSERT INTO lot_transactions (
          lot_id, ngan_id, ca, ngay_nhap,
          kien_a, kien_b, kien_c, kien_d, so_banh, so_kg,
          created_by, created_at, boc, pallet, chi_thi
        ) VALUES (
          v_tx.lot_id, v_tx.ngan_id, v_tx.ca, v_tx.ngay_nhap,
          CASE WHEN v_sel_a THEN COALESCE(v_tx.kien_a, 0) ELSE 0 END,
          CASE WHEN v_sel_b THEN COALESCE(v_tx.kien_b, 0) ELSE 0 END,
          CASE WHEN v_sel_c THEN COALESCE(v_tx.kien_c, 0) ELSE 0 END,
          CASE WHEN v_sel_d THEN COALESCE(v_tx.kien_d, 0) ELSE 0 END,
          v_move_banh, v_move_kg,
          v_tx.created_by, v_tx.created_at,
          CASE WHEN v_is_boc THEN v_new_boc ELSE v_tx.boc END,
          CASE WHEN v_is_boc THEN v_tx.pallet ELSE p_new_pallet END,
          v_tx.chi_thi
        );

        UPDATE lot_transactions lt SET
          kien_a  = CASE WHEN v_sel_a THEN 0 ELSE lt.kien_a END,
          kien_b  = CASE WHEN v_sel_b THEN 0 ELSE lt.kien_b END,
          kien_c  = CASE WHEN v_sel_c THEN 0 ELSE lt.kien_c END,
          kien_d  = CASE WHEN v_sel_d THEN 0 ELSE lt.kien_d END,
          so_banh = COALESCE(lt.so_banh, 0) - v_move_banh,
          so_kg   = COALESCE(lt.so_kg, 0) - v_move_kg
        WHERE lt.id = v_tx.id;
      ELSE
        UPDATE lot_transactions lt SET
          boc    = CASE WHEN v_is_boc THEN v_new_boc ELSE lt.boc END,
          pallet = CASE WHEN v_is_boc THEN lt.pallet ELSE p_new_pallet END
        WHERE lt.id = v_tx.id;
      END IF;
    END LOOP;

    -- Đổi bọc cả lô (đủ 4 kiện đang có bành) → lan sang dự đoán + nháp chưa gửi cùng mã lô.
    IF v_is_boc AND NOT EXISTS (
      SELECT 1 FROM lot_transactions lt
      WHERE lt.lot_id = v_lot.id AND lt.so_banh <> 0 AND lt.boc IS DISTINCT FROM v_new_boc
    ) THEN
      UPDATE lot_prediction_lots lp SET boc = v_new_boc
      WHERE lp.factory_id = p_factory_id AND lp.ma_lo = v_lot.ma_lo AND lp.trang_thai <> 'Hủy';
      UPDATE product_confirm_drafts d SET boc = v_new_boc
      WHERE d.factory_id = p_factory_id AND d.ma_lo = v_lot.ma_lo;
    END IF;

    PERFORM sync_lot_master_snapshot(v_lot.id);
    v_lot_count := v_lot_count + 1;
  END LOOP;

  INSERT INTO sk_history (
    factory_id, ngay, loai, chung_loai, from_boc, to_boc, from_pallet, to_pallet, lots, kien_changes
  ) VALUES (
    p_factory_id,
    v_today,
    p_loai,
    p_history_payload->>'chung_loai',
    p_history_payload->>'from_boc',
    p_history_payload->>'to_boc',
    p_history_payload->>'from_pallet',
    p_history_payload->>'to_pallet',
    COALESCE(p_history_payload->'lots', '[]'::jsonb),
    v_changes
  );

  RETURN jsonb_build_object('success', true, 'lots', v_lot_count, 'transactions', v_tx_count);
END;
$$;

REVOKE ALL ON FUNCTION perform_sang_kien_thay_boc(UUID, UUID, TEXT, JSONB, TEXT, TEXT[], JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION perform_sang_kien_thay_boc(UUID, UUID, TEXT, JSONB, TEXT, TEXT[], JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION perform_sang_kien_thay_boc(UUID, UUID, TEXT, JSONB, TEXT, TEXT[], JSONB) TO service_role;


-- Kiểm chứng sau khi chạy:
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'sk_history' AND column_name = 'kien_changes';
--   SELECT pg_get_function_identity_arguments(p.oid) FROM pg_proc p WHERE p.proname = 'perform_sang_kien_thay_boc';
--   -- chỉ 1 dòng: p_factory_id uuid, p_actor_id uuid, p_loai text, p_lots jsonb, p_new_boc text, p_new_pallet text[], p_history_payload jsonb
