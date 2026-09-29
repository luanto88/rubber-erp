-- Sửa lỗi admin_update_lot_transaction (2026-09-29) — CHẠY TAY trên Supabase SQL Editor.
--
-- Thân hàm chép nguyên từ 20260929_lot_admin_edits.sql, chỉ đổi:
--   1. Bọc: chỉ lan ra toàn lô khi lô đang đồng nhất 1 bọc. Lô đã có kiện khác bọc (sau Thay bọc tròn
--      kiện) thì chỉ đổi đúng giao dịch đang sửa — trước đây sửa số bành kiện A ghi đè bọc cả 4 kiện.
--   2. Chặn "giảm dưới số đã gán đơn xuất" khớp cả lot_id LẪN ma_lo (đơn cũ trỏ lot_id cũ).
--   3. Guard jsonb_typeof(assignments) = 'array'.
--   4. SET search_path = public (SECURITY DEFINER).
-- Chữ ký hàm KHÔNG đổi ⇒ code đang chạy không gãy; chạy trước hay sau deploy đều được.

CREATE OR REPLACE FUNCTION admin_update_lot_transaction(
  p_tx_id         UUID,
  p_kien_a        INTEGER,
  p_kien_b        INTEGER,
  p_kien_c        INTEGER,
  p_kien_d        INTEGER,
  p_ngan_id       UUID,
  p_ca            TEXT,
  p_ngay_nhap     DATE,
  p_boc           TEXT,
  p_pallet        TEXT[],
  p_chi_thi       TEXT,
  p_max_per_kien  INTEGER,
  p_actor_id      UUID,
  p_ly_do         TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx            RECORD;
  v_lot           RECORD;
  v_actor         RECORD;
  v_new           INTEGER[];
  v_letters       TEXT[] := ARRAY['A', 'B', 'C', 'D'];
  v_i             INTEGER;
  v_other         INTEGER;
  v_assigned      NUMERIC;
  v_total_after   INTEGER;
  v_so_banh       INTEGER;
  v_so_kg         NUMERIC;
  v_ngan_status   TEXT;
  v_ngan_tong_kho NUMERIC;
  v_real_kg       NUMERIC;
  v_has_qc        BOOLEAN;
  v_boc_changed   BOOLEAN;
  v_boc_uniform   BOOLEAN;
  v_new_boc       TEXT;
  v_truoc         JSONB;
BEGIN
  IF p_ly_do IS NULL OR btrim(p_ly_do) = '' THEN
    RAISE EXCEPTION 'Vui lòng nhập lý do sửa.';
  END IF;

  SELECT pr.role, pr.status, pr.factory_id INTO v_actor FROM profiles pr WHERE pr.id = p_actor_id;
  IF v_actor.role IS DISTINCT FROM 'admin' OR v_actor.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Chỉ admin được sửa giao dịch thành phẩm đã gửi.';
  END IF;

  SELECT lt.* INTO v_tx FROM lot_transactions lt WHERE lt.id = p_tx_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy giao dịch cần sửa.';
  END IF;

  SELECT l.* INTO v_lot FROM lots l WHERE l.id = v_tx.lot_id;
  IF NOT FOUND OR v_lot.factory_id IS DISTINCT FROM v_actor.factory_id THEN
    RAISE EXCEPTION 'Giao dịch không thuộc nhà máy hiện tại.';
  END IF;

  -- Cùng khóa với submit_confirm_draft_batch / swap_predicted_kien_ngan.
  PERFORM pg_advisory_xact_lock(hashtext(v_lot.factory_id::text || ':' || v_lot.ma_lo));
  PERFORM 1 FROM lots l WHERE l.id = v_lot.id FOR UPDATE;
  SELECT lt.* INTO v_tx FROM lot_transactions lt WHERE lt.id = p_tx_id FOR UPDATE;
  PERFORM 1 FROM ngans n
    WHERE n.id IN (v_tx.ngan_id, p_ngan_id) ORDER BY n.id FOR UPDATE;

  -- Khóa ca: kiểm cả nguồn lẫn đích (hiện chỉ admin gọi được nên luôn qua — giữ để an toàn).
  IF v_actor.role IS DISTINCT FROM 'admin' AND (
       public.product_shift_is_locked(v_lot.factory_id, v_tx.ngay_nhap, v_tx.ca)
    OR public.product_shift_is_locked(v_lot.factory_id, p_ngay_nhap, p_ca)
  ) THEN
    RAISE EXCEPTION 'Ca sản xuất đã được duyệt & khóa, không thể sửa.';
  END IF;

  -- Lô đã Xuất hàng VÀ đã có kết quả kiểm nghiệm → chặn cả admin (mirror luật hiện hành).
  IF v_lot.trang_thai = 'Xuất hàng' THEN
    SELECT EXISTS (
      SELECT 1 FROM qc_results q
      WHERE q.factory_id = v_lot.factory_id AND (q.lot_id = v_lot.id OR q.ma_lo = v_lot.ma_lo)
    ) INTO v_has_qc;
    IF v_has_qc THEN
      RAISE EXCEPTION 'Lô % đã Xuất hàng và đã có phiếu kiểm nghiệm, không thể sửa.', v_lot.ma_lo;
    END IF;
  END IF;

  v_new := ARRAY[COALESCE(p_kien_a, 0), COALESCE(p_kien_b, 0), COALESCE(p_kien_c, 0), COALESCE(p_kien_d, 0)];
  IF v_new[1] < 0 OR v_new[2] < 0 OR v_new[3] < 0 OR v_new[4] < 0 THEN
    RAISE EXCEPTION 'Số bành không được âm.';
  END IF;
  v_so_banh := v_new[1] + v_new[2] + v_new[3] + v_new[4];
  IF v_so_banh <= 0 THEN
    RAISE EXCEPTION 'Số bành phải lớn hơn 0.';
  END IF;
  IF p_max_per_kien IS NULL OR p_max_per_kien <= 0 THEN
    RAISE EXCEPTION 'Thiếu số bành tối đa mỗi kiện.';
  END IF;

  FOR v_i IN 1..4 LOOP
    SELECT COALESCE(SUM(CASE v_i
        WHEN 1 THEN lt.kien_a WHEN 2 THEN lt.kien_b WHEN 3 THEN lt.kien_c WHEN 4 THEN lt.kien_d END), 0)
      INTO v_other
      FROM lot_transactions lt
      WHERE lt.lot_id = v_lot.id AND lt.id <> p_tx_id;
    v_total_after := v_other + v_new[v_i];

    IF v_new[v_i] > 0 AND v_total_after > p_max_per_kien THEN
      RAISE EXCEPTION 'Kiện % của lô % sẽ vượt quá % bành (các giao dịch khác đã có % bành).',
        v_letters[v_i], v_lot.ma_lo, p_max_per_kien, v_other;
    END IF;

    SELECT COALESCE(SUM(COALESCE(NULLIF(a ->> ('kien_' || lower(v_letters[v_i])), '')::NUMERIC, 0)), 0)
      INTO v_assigned
      FROM export_orders eo
      -- Guard kiểu: 1 đơn có assignments không phải mảng không được làm hỏng mọi lần sửa.
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(eo.assignments) = 'array' THEN eo.assignments ELSE '[]'::jsonb END
      ) a
      WHERE eo.factory_id = v_lot.factory_id
        -- Đơn cũ có thể trỏ lô bằng mã lô với lot_id cũ (lô bị tạo lại) — khớp cả hai.
        AND (a ->> 'lot_id' = v_lot.id::text
             OR lower(btrim(COALESCE(a ->> 'ma_lo', ''))) = lower(btrim(v_lot.ma_lo)));
    IF v_total_after < v_assigned THEN
      RAISE EXCEPTION 'Kiện % của lô % đã gán % bành vào đơn xuất — không thể giảm còn % bành.',
        v_letters[v_i], v_lot.ma_lo, v_assigned, v_total_after;
    END IF;
  END LOOP;

  v_so_kg := ROUND(v_so_banh * v_lot.loai_banh, 2);

  -- Ngăn đích.
  SELECT n.trang_thai, n.tong_kho INTO v_ngan_status, v_ngan_tong_kho
    FROM ngans n WHERE n.id = p_ngan_id AND n.factory_id = v_lot.factory_id;
  IF v_ngan_status IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy ngăn nguồn được chọn.';
  END IF;
  IF p_ngan_id IS DISTINCT FROM v_tx.ngan_id AND v_ngan_status IN ('Đang nhận', 'Đóng') THEN
    RAISE EXCEPTION 'Ngăn đích đang ở trạng thái "%", không nhận thành phẩm.', v_ngan_status;
  END IF;
  SELECT COALESCE(SUM(lt.so_kg), 0) INTO v_real_kg
    FROM lot_transactions lt JOIN lots l ON l.id = lt.lot_id
    WHERE lt.ngan_id = p_ngan_id AND l.factory_id = v_lot.factory_id AND lt.id <> p_tx_id;
  IF v_real_kg + v_so_kg > COALESCE(v_ngan_tong_kho, 0) * 1.1 + 0.01 THEN
    RAISE EXCEPTION 'Ngăn đích sẽ vượt quá 110%% sau khi sửa — kiểm tra lại số bành hoặc chọn ngăn khác.';
  END IF;

  v_truoc := jsonb_build_object(
    'ngan_id', v_tx.ngan_id, 'ca', v_tx.ca, 'ngay_nhap', v_tx.ngay_nhap,
    'kien_a', v_tx.kien_a, 'kien_b', v_tx.kien_b, 'kien_c', v_tx.kien_c, 'kien_d', v_tx.kien_d,
    'so_banh', v_tx.so_banh, 'so_kg', v_tx.so_kg, 'boc', v_tx.boc, 'pallet', to_jsonb(v_tx.pallet),
    'chi_thi', v_tx.chi_thi, 'lot_boc', v_lot.boc, 'lot_trang_thai', v_lot.trang_thai
  );

  UPDATE lot_transactions lt SET
    ngan_id   = p_ngan_id,
    ca        = p_ca,
    ngay_nhap = p_ngay_nhap,
    kien_a    = v_new[1],
    kien_b    = v_new[2],
    kien_c    = v_new[3],
    kien_d    = v_new[4],
    so_banh   = v_so_banh,
    so_kg     = v_so_kg,
    boc       = COALESCE(NULLIF(btrim(p_boc), ''), lt.boc),
    pallet    = p_pallet,
    chi_thi   = NULLIF(btrim(COALESCE(p_chi_thi, '')), '')
  WHERE lt.id = p_tx_id;

  -- Đổi bọc. Sau "Thay bọc tròn kiện" một lô có thể có kiện khác bọc — CHỈ lan ra toàn lô (+ dự đoán
  -- + nháp) khi lô đang đồng nhất 1 bọc; lô đã nhiều bọc thì chỉ đổi đúng giao dịch này, không xoá
  -- bọc riêng của các kiện khác (bug 2026-09-29).
  v_new_boc := NULLIF(btrim(p_boc), '');
  v_boc_changed := v_new_boc IS NOT NULL AND v_new_boc IS DISTINCT FROM COALESCE(v_tx.boc, v_lot.boc);
  SELECT NOT EXISTS (
    SELECT 1 FROM lot_transactions lt
    WHERE lt.lot_id = v_lot.id AND lt.id <> p_tx_id
      AND COALESCE(lt.boc, v_lot.boc) IS DISTINCT FROM COALESCE(v_tx.boc, v_lot.boc)
  ) INTO v_boc_uniform;
  IF v_boc_changed AND v_boc_uniform THEN
    UPDATE lot_transactions lt SET boc = btrim(p_boc) WHERE lt.lot_id = v_lot.id;
    UPDATE lots l SET boc = btrim(p_boc) WHERE l.id = v_lot.id;
    UPDATE lot_prediction_lots lp SET boc = btrim(p_boc)
      WHERE lp.factory_id = v_lot.factory_id AND lp.ma_lo = v_lot.ma_lo AND lp.trang_thai <> 'Hủy';
    UPDATE product_confirm_drafts d SET boc = btrim(p_boc)
      WHERE d.factory_id = v_lot.factory_id AND d.ma_lo = v_lot.ma_lo;
  END IF;

  -- Đổi ngăn → kế hoạch dự đoán của các kiện có bành trong dòng này đi theo.
  IF p_ngan_id IS DISTINCT FROM v_tx.ngan_id THEN
    UPDATE lot_prediction_lots lp SET
      kien_a_ngan_id = CASE WHEN v_new[1] > 0 THEN p_ngan_id ELSE lp.kien_a_ngan_id END,
      kien_b_ngan_id = CASE WHEN v_new[2] > 0 THEN p_ngan_id ELSE lp.kien_b_ngan_id END,
      kien_c_ngan_id = CASE WHEN v_new[3] > 0 THEN p_ngan_id ELSE lp.kien_c_ngan_id END,
      kien_d_ngan_id = CASE WHEN v_new[4] > 0 THEN p_ngan_id ELSE lp.kien_d_ngan_id END
    WHERE lp.factory_id = v_lot.factory_id AND lp.ma_lo = v_lot.ma_lo AND lp.trang_thai <> 'Hủy';
  END IF;

  PERFORM sync_lot_master_snapshot(v_lot.id);

  PERFORM sync_ngan_production_status(p_ngan_id);
  IF v_tx.ngan_id IS NOT NULL AND v_tx.ngan_id IS DISTINCT FROM p_ngan_id THEN
    PERFORM sync_ngan_production_status(v_tx.ngan_id);
  END IF;

  INSERT INTO lot_admin_edits (factory_id, lot_id, transaction_id, loai, actor_id, ly_do, truoc, sau)
  VALUES (
    v_lot.factory_id, v_lot.id, p_tx_id, 'sua_giao_dich', p_actor_id, btrim(p_ly_do), v_truoc,
    jsonb_build_object(
      'ngan_id', p_ngan_id, 'ca', p_ca, 'ngay_nhap', p_ngay_nhap,
      'kien_a', v_new[1], 'kien_b', v_new[2], 'kien_c', v_new[3], 'kien_d', v_new[4],
      'so_banh', v_so_banh, 'so_kg', v_so_kg,
      'boc', CASE WHEN v_boc_changed THEN btrim(p_boc) ELSE COALESCE(v_tx.boc, v_lot.boc) END,
      'pallet', to_jsonb(p_pallet), 'chi_thi', p_chi_thi,
      'boc_lan_ca_lo', v_boc_changed AND v_boc_uniform
    )
  );

  RETURN jsonb_build_object('lot_id', v_lot.id, 'old_ngan_id', v_tx.ngan_id, 'new_ngan_id', p_ngan_id);
END;
$$;

REVOKE ALL ON FUNCTION admin_update_lot_transaction(
  UUID, INTEGER, INTEGER, INTEGER, INTEGER, UUID, TEXT, DATE, TEXT, TEXT[], TEXT, INTEGER, UUID, TEXT
) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION admin_update_lot_transaction(
  UUID, INTEGER, INTEGER, INTEGER, INTEGER, UUID, TEXT, DATE, TEXT, TEXT[], TEXT, INTEGER, UUID, TEXT
) TO service_role;

-- Kiểm chứng:
--   SELECT proname, prosecdef, proconfig FROM pg_proc WHERE proname = 'admin_update_lot_transaction';
--   -- prosecdef = true, proconfig chứa search_path=public
