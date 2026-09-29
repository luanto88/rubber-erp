-- Migration: 20260929_shift_lock_gaps.sql
--
-- GĐ7a — Bịt các lỗ vượt "Khóa ca sản xuất" + 1 lỗ bảo mật.
--
-- 1) sync_lot_master_snapshot: KHÔNG hạ lô "Xuất hàng". Trước đây hàm luôn ghi đè trang_thai thành
--    'Hoàn thành'/'Dở dang' theo số bành ⇒ mọi lần admin sửa 1 lô đã xuất đều làm lô tụt về
--    'Hoàn thành', xuất hiện lại ở module Xuất hàng. Nay lô đang 'Xuất hàng' giữ nguyên trang_thai và
--    ngay_ht, chỉ cập nhật số liệu (mirror fix trigger 20260708).
--    Dựng từ 20260715_fix_sync_lot_master_snapshot_kien_types.sql (kiểu INTEGER) — đồng thời chấm
--    dứt việc 2 file cùng ngày 20260715 ghi đè lẫn nhau tuỳ thứ tự chạy.
--
-- 2) delete_orphan_lot: bản cũ SECURITY DEFINER, cấp cho authenticated, KHÔNG kiểm gì — ai đăng nhập
--    cũng xóa được lô bất kỳ của nhà máy bất kỳ cùng toàn bộ giao dịch. Nay: chỉ admin (auth.uid()),
--    cùng nhà máy, lô phải thật sự mồ côi (0 giao dịch), không "Xuất hàng", không có kết quả KN.
--    Giữ nguyên chữ ký (p_lot_id uuid) để code đang chạy trên production không gãy khi chạy migration
--    trước lúc deploy.
--
-- 3) RLS DELETE của lot_transactions / lots: thêm điều kiện khóa ca giống policy UPDATE
--    (20260828_product_shift_lock_rls_extend.sql).
--
-- Chạy thủ công trên Supabase SQL Editor. Idempotent.

-- ── 1) sync_lot_master_snapshot ──────────────────────────────────────────
DROP FUNCTION IF EXISTS sync_lot_master_snapshot(uuid);

CREATE FUNCTION sync_lot_master_snapshot(p_lot_id uuid)
RETURNS TABLE (
  kien_a integer,
  kien_b integer,
  kien_c integer,
  kien_d integer,
  tong_banh integer,
  tong_kg numeric,
  trang_thai text,
  ca text,
  ngan_id uuid,
  ngay_ht date,
  boc text,
  pallet text[],
  chi_thi text
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_loai_banh    numeric;
  v_lo_tron      numeric;
  v_tong_banh    numeric;
  v_tong_kg      numeric;
  v_kien_a       numeric;
  v_kien_b       numeric;
  v_kien_c       numeric;
  v_kien_d       numeric;
  v_trang_thai   text;
  v_cur_status   text;
  v_last_ca      text;
  v_last_ngan_id uuid;
  v_last_ngay    date;
  v_last_boc     text;
  v_last_pallet  text[];
  v_last_chi_thi text;
BEGIN
  PERFORM 1 FROM lots lk WHERE lk.id = p_lot_id FOR UPDATE;

  SELECT l.loai_banh, l.trang_thai INTO v_loai_banh, v_cur_status FROM lots l WHERE l.id = p_lot_id;
  v_lo_tron := CASE WHEN v_loai_banh = 20 THEN 240 ELSE 144 END;

  SELECT
    COALESCE(SUM(lt.kien_a), 0), COALESCE(SUM(lt.kien_b), 0),
    COALESCE(SUM(lt.kien_c), 0), COALESCE(SUM(lt.kien_d), 0),
    COALESCE(SUM(lt.so_banh), 0), COALESCE(SUM(lt.so_kg), 0)
  INTO v_kien_a, v_kien_b, v_kien_c, v_kien_d, v_tong_banh, v_tong_kg
  FROM lot_transactions lt
  WHERE lt.lot_id = p_lot_id;

  v_trang_thai := CASE WHEN v_tong_banh >= v_lo_tron THEN 'Hoàn thành' ELSE 'Dở dang' END;

  SELECT lt.ca, lt.ngan_id, lt.ngay_nhap
  INTO v_last_ca, v_last_ngan_id, v_last_ngay
  FROM lot_transactions lt
  WHERE lt.lot_id = p_lot_id
  ORDER BY lt.ngay_nhap DESC, lt.created_at DESC
  LIMIT 1;

  SELECT lt.boc INTO v_last_boc FROM lot_transactions lt
  WHERE lt.lot_id = p_lot_id AND lt.boc IS NOT NULL
  ORDER BY lt.ngay_nhap DESC, lt.created_at DESC LIMIT 1;

  SELECT lt.pallet INTO v_last_pallet FROM lot_transactions lt
  WHERE lt.lot_id = p_lot_id AND lt.pallet IS NOT NULL
  ORDER BY lt.ngay_nhap DESC, lt.created_at DESC LIMIT 1;

  SELECT lt.chi_thi INTO v_last_chi_thi FROM lot_transactions lt
  WHERE lt.lot_id = p_lot_id AND lt.chi_thi IS NOT NULL
  ORDER BY lt.ngay_nhap DESC, lt.created_at DESC LIMIT 1;

  UPDATE lots lu SET
    kien_a     = v_kien_a,
    kien_b     = v_kien_b,
    kien_c     = v_kien_c,
    kien_d     = v_kien_d,
    tong_banh  = v_tong_banh,
    tong_kg    = v_tong_kg,
    -- Lô đã "Xuất hàng": giữ nguyên trạng thái + ngày hoàn tất (quyết định bởi module Xuất hàng).
    trang_thai = CASE WHEN v_cur_status = 'Xuất hàng' THEN lu.trang_thai ELSE v_trang_thai END,
    ca         = v_last_ca,
    ngan_id    = v_last_ngan_id,
    ngay_ht    = CASE
                   WHEN v_cur_status = 'Xuất hàng' THEN lu.ngay_ht
                   WHEN v_trang_thai = 'Hoàn thành' THEN v_last_ngay
                   ELSE NULL
                 END,
    boc        = COALESCE(v_last_boc, lu.boc),
    pallet     = COALESCE(v_last_pallet, lu.pallet),
    chi_thi    = COALESCE(v_last_chi_thi, lu.chi_thi)
  WHERE lu.id = p_lot_id;

  RETURN QUERY
    SELECT
      lr.kien_a, lr.kien_b, lr.kien_c, lr.kien_d,
      lr.tong_banh, lr.tong_kg, lr.trang_thai, lr.ca,
      lr.ngan_id, lr.ngay_ht, lr.boc, lr.pallet, lr.chi_thi
    FROM lots lr
    WHERE lr.id = p_lot_id;
END;
$$;

GRANT EXECUTE ON FUNCTION sync_lot_master_snapshot(uuid) TO authenticated, service_role;

-- ── 2) delete_orphan_lot ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION delete_orphan_lot(p_lot_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_actor RECORD;
  v_lot   RECORD;
BEGIN
  SELECT pr.role, pr.status, pr.factory_id INTO v_actor FROM profiles pr WHERE pr.id = auth.uid();
  IF v_actor.role IS DISTINCT FROM 'admin' OR v_actor.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Chỉ admin được xóa lô.';
  END IF;

  SELECT l.id, l.factory_id, l.ma_lo, l.trang_thai INTO v_lot FROM lots l WHERE l.id = p_lot_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy lô cần xóa.';
  END IF;
  IF v_lot.factory_id IS DISTINCT FROM v_actor.factory_id THEN
    RAISE EXCEPTION 'Lô không thuộc nhà máy hiện tại.';
  END IF;
  IF v_lot.trang_thai = 'Xuất hàng' THEN
    RAISE EXCEPTION 'Lô % đã Xuất hàng, không thể xóa.', v_lot.ma_lo;
  END IF;
  IF EXISTS (SELECT 1 FROM lot_transactions lt WHERE lt.lot_id = p_lot_id) THEN
    RAISE EXCEPTION 'Lô % vẫn còn giao dịch — hãy xóa từng giao dịch thay vì xóa cả lô.', v_lot.ma_lo;
  END IF;
  IF EXISTS (
    SELECT 1 FROM qc_results q
    WHERE q.factory_id = v_lot.factory_id AND (q.lot_id = p_lot_id OR q.ma_lo = v_lot.ma_lo)
  ) THEN
    RAISE EXCEPTION 'Lô % đã có phiếu kiểm nghiệm, không thể xóa.', v_lot.ma_lo;
  END IF;

  UPDATE lot_prediction_lots lp
  SET real_lot_id = NULL, trang_thai = 'Dự kiến'
  WHERE lp.real_lot_id = p_lot_id;

  DELETE FROM lots l WHERE l.id = p_lot_id;
END;
$$;

REVOKE ALL ON FUNCTION delete_orphan_lot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_orphan_lot(uuid) TO authenticated;

-- ── 3) RLS DELETE theo khóa ca ────────────────────────────────────────────
DROP POLICY IF EXISTS "lot_transactions_delete" ON lot_transactions;
CREATE POLICY "lot_transactions_delete" ON lot_transactions
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM lots l
      WHERE l.id = lot_transactions.lot_id
        AND l.factory_id = public.current_profile_factory_id()
    )
    AND (
      public.current_profile_role() = 'admin'
      OR NOT public.product_shift_is_locked(
        public.current_profile_factory_id(), lot_transactions.ngay_nhap, lot_transactions.ca
      )
    )
  );

DROP POLICY IF EXISTS "lots_delete" ON lots;
CREATE POLICY "lots_delete" ON lots
  FOR DELETE TO authenticated
  USING (
    factory_id = public.current_profile_factory_id()
    AND (
      public.current_profile_role() = 'admin'
      OR NOT public.product_shift_is_locked(factory_id, ngay_sx, ca)
    )
  );

-- Kiểm chứng sau khi chạy:
--   SELECT policyname, cmd FROM pg_policies WHERE tablename IN ('lots','lot_transactions') ORDER BY 1;
--   -- Tài khoản không phải admin gọi: select delete_orphan_lot('<id>');  → "Chỉ admin được xóa lô."
