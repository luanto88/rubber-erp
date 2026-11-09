-- GĐ3 phần B (2026-11-08): NẮP pallet theo kiện + "Xuất kèm nắp" ở đơn xuất.
-- Chạy tay trên Supabase SQL Editor TRƯỚC khi deploy code (sau 20261117_pallet_components.sql). Idempotent.
--
-- 1. lot_transactions.nap JSONB {"a":"nap_sat","c":"nap_go"} (mã thành phần la_nap, chỉ kiện có nắp).
-- 2. product_confirm_drafts.nap TEXT (nháp quét = 1 kiện).
-- 3. export_orders.xuat_nap BOOLEAN.
-- 4. Hàm pallet_names_need_nap (pallet có thành phần co_nap) + lot_nap_sanitize (lọc nắp hợp lệ).
-- 5. CREATE OR REPLACE 3 RPC — chép NGUYÊN bản mới nhất, chỉ thêm phần nắp:
--    submit_confirm_draft_batch   ← 20260928b (GIỮ vòng v_touched_ngans)
--    admin_update_lot_transaction ← 20261001 (+ tham số p_nap JSONB DEFAULT NULL ở CUỐI; code cũ gọi 14 tham số vẫn chạy)
--    perform_sang_kien_thay_boc   ← 20261004 (chữ ký không đổi)
-- 6. pallet_component_usage_count đếm thêm nắp đã ghi trên giao dịch / nháp.
--
-- ⚠️ Mọi CREATE OR REPLACE 3 hàm trên về sau PHẢI chép từ FILE NÀY.

ALTER TABLE lot_transactions ADD COLUMN IF NOT EXISTS nap JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN lot_transactions.nap IS 'GĐ3B: nắp pallet theo kiện {"a":"nap_sat"} — mã pallet_components (la_nap). Chỉ kiện có nắp.';
ALTER TABLE product_confirm_drafts ADD COLUMN IF NOT EXISTS nap TEXT;
ALTER TABLE export_orders ADD COLUMN IF NOT EXISTS xuat_nap BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN export_orders.xuat_nap IS 'GĐ3B: true = nắp đi theo kiện khi xuất (mất nắp); false = nắp trả về kho.';

-- ── Pallet (tên loại pallet SX) có thành phần cần nắp (co_nap) không ──
-- Tên so khớp bỏ tiền tố "Pallet ", không phân biệt hoa thường (giống palletComponentsFromConfig ở JS).
-- Không có cấu hình cho tên đó ⇒ quy đổi cũ: "sắt đế gỗ" / "sắt đế nhựa" = có sắt dày.
CREATE OR REPLACE FUNCTION pallet_names_need_nap(p_factory_id uuid, p_names text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH n AS (
    SELECT lower(regexp_replace(regexp_replace(btrim(x), '^pallet\s+', '', 'i'), '\s+', ' ', 'g')) AS k
    FROM unnest(COALESCE(p_names, '{}'::text[])) x
    WHERE btrim(x) <> ''
  ), cfg AS (
    SELECT lower(regexp_replace(regexp_replace(btrim(p.ten), '^pallet\s+', '', 'i'), '\s+', ' ', 'g')) AS k, p.thanh_phan
    FROM product_packaging_types p
    WHERE p.factory_id = p_factory_id AND p.kind = 'pallet_sx' AND cardinality(p.thanh_phan) > 0
  ), comp AS (
    SELECT pc.code, pc.co_nap FROM pallet_components pc WHERE pc.factory_id = p_factory_id
  ), need AS (
    SELECT CASE WHEN EXISTS (SELECT 1 FROM comp)
      THEN COALESCE((SELECT array_agg(code) FROM comp WHERE co_nap), '{}'::text[])
      ELSE ARRAY['sat_day']::text[] END AS codes
  )
  SELECT EXISTS (
    SELECT 1 FROM n
    CROSS JOIN need
    WHERE COALESCE(
      (SELECT c.thanh_phan FROM cfg c WHERE c.k = n.k LIMIT 1),
      CASE WHEN n.k IN ('sắt đế gỗ', 'sắt đế nhựa') THEN ARRAY['sat_day']::text[] ELSE '{}'::text[] END
    ) && need.codes
  );
$$;
GRANT EXECUTE ON FUNCTION pallet_names_need_nap(uuid, text[]) TO authenticated, service_role;

-- ── Lọc nắp: chỉ kiện a..d có bành (p_kien = [a,b,c,d]), mã là nắp (la_nap), pallet cần nắp ──
CREATE OR REPLACE FUNCTION lot_nap_sanitize(p_factory_id uuid, p_nap jsonb, p_kien integer[], p_pallet text[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_nap IS NULL OR jsonb_typeof(p_nap) IS DISTINCT FROM 'object' THEN '{}'::jsonb
    WHEN NOT pallet_names_need_nap(p_factory_id, p_pallet) THEN '{}'::jsonb
    ELSE COALESCE((
      SELECT jsonb_object_agg(e.key, to_jsonb(btrim(e.value)))
      FROM jsonb_each_text(p_nap) e
      WHERE e.key IN ('a', 'b', 'c', 'd')
        AND COALESCE(p_kien[array_position(ARRAY['a','b','c','d'], e.key)], 0) > 0
        AND btrim(COALESCE(e.value, '')) <> ''
        AND (
          EXISTS (SELECT 1 FROM pallet_components pc
                   WHERE pc.factory_id = p_factory_id AND pc.code = btrim(e.value) AND pc.la_nap)
          OR (NOT EXISTS (SELECT 1 FROM pallet_components pc WHERE pc.factory_id = p_factory_id)
              AND btrim(e.value) IN ('nap_sat', 'nap_go'))
        )
    ), '{}'::jsonb)
  END;
$$;
GRANT EXECUTE ON FUNCTION lot_nap_sanitize(uuid, jsonb, integer[], text[]) TO authenticated, service_role;

-- ── Đếm chỗ dùng thành phần: thêm nắp trên giao dịch / nháp ──
CREATE OR REPLACE FUNCTION pallet_component_usage_count(p_factory_id uuid, p_code text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT count(*)::int FROM product_packaging_types p
      WHERE p.factory_id = p_factory_id AND p_code = ANY (p.thanh_phan))
  + (SELECT count(*)::int FROM export_pallet_types e
      WHERE e.factory_id = p_factory_id AND p_code = ANY (e.mat_thanh_phan))
  + (SELECT count(*)::int FROM lot_transactions lt JOIN lots l ON l.id = lt.lot_id
      WHERE l.factory_id = p_factory_id AND lt.nap <> '{}'::jsonb
        AND EXISTS (SELECT 1 FROM jsonb_each_text(lt.nap) x WHERE x.value = p_code))
  + (SELECT count(*)::int FROM product_confirm_drafts d
      WHERE d.factory_id = p_factory_id AND d.nap = p_code);
$$;

-- ── admin_update_lot_transaction: đổi chữ ký (thêm p_nap) ⇒ DROP bản 14 tham số ──
DROP FUNCTION IF EXISTS admin_update_lot_transaction(
  UUID, INTEGER, INTEGER, INTEGER, INTEGER, UUID, TEXT, DATE, TEXT, TEXT[], TEXT, INTEGER, UUID, TEXT
);

CREATE OR REPLACE FUNCTION submit_confirm_draft_batch(
  p_draft_ids  UUID[],
  p_user_id    UUID,
  p_recomputed JSONB
) RETURNS TABLE (
  draft_id UUID,
  lot_id   UUID,
  ma_lo    TEXT,
  kien     TEXT,
  so_kg    NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_draft            RECORD;
  v_match            TEXT[];
  v_num              INTEGER;
  v_suffix           TEXT;
  v_year             TEXT;
  v_lot_id           UUID;
  v_lot_status       TEXT;
  v_lot_csr          TEXT;
  v_lot_banh         NUMERIC;
  v_lot_boc          TEXT;
  v_max_per_kien     INTEGER;
  v_so_kg            NUMERIC;
  v_existing_banh    NUMERIC;
  v_ngan_tong_kho    NUMERIC;
  v_existing_real_kg NUMERIC;
  v_cap_kg           NUMERIC;
  v_existing_boc     TEXT;
  v_existing_pallet  TEXT[];
  v_touched_lots     UUID[] := '{}';
  v_dup_count        INTEGER;
  v_actor_role       TEXT;
  v_touched_ngans    UUID[] := '{}';
  v_ngan_id          UUID;
  v_nap              JSONB;
BEGIN
  IF p_draft_ids IS NULL OR array_length(p_draft_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Danh sách nháp trống.';
  END IF;

  SELECT COUNT(DISTINCT x) INTO v_dup_count FROM unnest(p_draft_ids) x;
  IF v_dup_count <> array_length(p_draft_ids, 1) THEN
    RAISE EXCEPTION 'Danh sách nháp có id trùng lặp.';
  END IF;

  IF (SELECT COUNT(*) FROM product_confirm_drafts WHERE id = ANY(p_draft_ids)) <> array_length(p_draft_ids, 1) THEN
    RAISE EXCEPTION 'Một số nháp không còn tồn tại — vui lòng tải lại danh sách.';
  END IF;
  IF (SELECT COUNT(*) FROM product_confirm_drafts WHERE id = ANY(p_draft_ids) AND created_by = p_user_id) <> array_length(p_draft_ids, 1) THEN
    RAISE EXCEPTION 'Không có quyền gửi một số nháp trong danh sách này.';
  END IF;

  SELECT role INTO v_actor_role FROM profiles WHERE id = p_user_id;

  PERFORM 1 FROM ngans
    WHERE id IN (SELECT DISTINCT ngan_id FROM product_confirm_drafts WHERE id = ANY(p_draft_ids))
    ORDER BY id FOR UPDATE;

  PERFORM 1 FROM lots lk
    WHERE lk.ma_lo IN (SELECT DISTINCT pcdk.ma_lo FROM product_confirm_drafts pcdk WHERE pcdk.id = ANY(p_draft_ids))
    ORDER BY lk.ma_lo FOR UPDATE;

  FOR v_draft IN
    SELECT * FROM product_confirm_drafts WHERE id = ANY(p_draft_ids) ORDER BY created_at ASC
  LOOP
    IF public.product_shift_is_locked(v_draft.factory_id, v_draft.ngay_sx, v_draft.ca)
       AND v_actor_role IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION 'Ca sản xuất % - Ca % của lô % đã được duyệt & khóa, không thể gửi nháp này.',
        v_draft.ngay_sx, v_draft.ca, v_draft.ma_lo;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_draft.factory_id::text || ':' || v_draft.ma_lo));

    SELECT l.id, l.trang_thai, l.loai_csr, l.loai_banh, l.boc
      INTO v_lot_id, v_lot_status, v_lot_csr, v_lot_banh, v_lot_boc
      FROM lots l WHERE l.factory_id = v_draft.factory_id AND l.ma_lo = v_draft.ma_lo
      ORDER BY l.created_at DESC LIMIT 1;

    IF v_lot_id IS NULL THEN
      v_match := regexp_match(v_draft.ma_lo, '^(\d+)([a-z]*)/(\d{2,4})$');
      IF v_match IS NULL THEN
        RAISE EXCEPTION 'Mã lô "%" không hợp lệ.', v_draft.ma_lo;
      END IF;
      v_num := v_match[1]::INTEGER;
      v_suffix := v_match[2];
      v_year := v_match[3];
      INSERT INTO lots (
        factory_id, ma_lo, num, suffix, year, ngay_sx, ca, ngan_id, loai_csr, loai_banh,
        tong_banh, tong_kg, trang_thai, ghi_chu, day_chuyen, boc, tham, pallet, chi_thi
      ) VALUES (
        v_draft.factory_id, v_draft.ma_lo, v_num, v_suffix, v_year, v_draft.ngay_sx, v_draft.ca,
        v_draft.ngan_id, v_draft.loai_csr, v_draft.loai_banh, 0, 0, 'Dở dang', v_draft.ghi_chu,
        v_draft.day_chuyen, v_draft.boc, v_draft.tham, v_draft.pallet, v_draft.chi_thi
      ) RETURNING id INTO v_lot_id;
    ELSE
      IF v_lot_status NOT IN ('Dở dang', 'Do dang') THEN
        RAISE EXCEPTION 'Lô % đang ở trạng thái "%", không thể nhập thêm giao dịch.', v_draft.ma_lo, v_lot_status;
      END IF;

      -- Kiểm tra đồng nhất thuộc tính toàn lô (Chủng loại, Bọc, Loại bành)
      IF v_lot_csr IS NOT NULL AND v_lot_csr IS DISTINCT FROM v_draft.loai_csr THEN
        RAISE EXCEPTION 'Cùng lô %, chủng loại (%) không khớp với kiện trước (%).', v_draft.ma_lo, v_draft.loai_csr, v_lot_csr;
      END IF;
      IF v_lot_banh IS NOT NULL AND v_lot_banh IS DISTINCT FROM v_draft.loai_banh THEN
        RAISE EXCEPTION 'Cùng lô %, loại bành (%kg) không khớp với kiện trước (%kg).', v_draft.ma_lo, v_draft.loai_banh, v_lot_banh;
      END IF;
      IF v_lot_boc IS NOT NULL AND v_lot_boc IS DISTINCT FROM v_draft.boc THEN
        RAISE EXCEPTION 'Cùng lô %, loại bọc (%) không khớp với kiện trước (%).', v_draft.ma_lo, v_draft.boc, v_lot_boc;
      END IF;
    END IF;

    SELECT (elem->>'max_per_kien')::INTEGER INTO v_max_per_kien
      FROM jsonb_array_elements(p_recomputed) elem
      WHERE (elem->>'draft_id')::UUID = v_draft.id;
    IF v_max_per_kien IS NULL THEN
      RAISE EXCEPTION 'Thiếu dữ liệu tính toán cho nháp %.', v_draft.id;
    END IF;
    v_so_kg := ROUND(v_draft.so_banh * v_draft.loai_banh, 2);

    SELECT COALESCE(SUM(
      CASE v_draft.kien
        WHEN 'A' THEN ltk.kien_a WHEN 'B' THEN ltk.kien_b WHEN 'C' THEN ltk.kien_c WHEN 'D' THEN ltk.kien_d
      END
    ), 0) INTO v_existing_banh
    FROM lot_transactions ltk WHERE ltk.lot_id = v_lot_id;

    IF v_existing_banh + v_draft.so_banh > v_max_per_kien THEN
      RAISE EXCEPTION 'Kiện % của lô % đã có % bành, nháp này (thêm % bành) sẽ vượt quá % bành cho phép.',
        v_draft.kien, v_draft.ma_lo, v_existing_banh, v_draft.so_banh, v_max_per_kien;
    END IF;

    SELECT lt.boc, lt.pallet INTO v_existing_boc, v_existing_pallet
      FROM lot_transactions lt WHERE lt.lot_id = v_lot_id
      AND (
        CASE v_draft.kien
          WHEN 'A' THEN lt.kien_a WHEN 'B' THEN lt.kien_b WHEN 'C' THEN lt.kien_c WHEN 'D' THEN lt.kien_d
        END
      ) > 0
      ORDER BY lt.created_at DESC LIMIT 1;
    IF v_existing_boc IS NOT NULL AND v_existing_boc IS DISTINCT FROM v_draft.boc THEN
      RAISE EXCEPTION 'Bọc của kiện % lô % (%) không khớp lần nhập trước (%).', v_draft.kien, v_draft.ma_lo, v_draft.boc, v_existing_boc;
    END IF;
    IF v_existing_pallet IS NOT NULL AND array_length(v_existing_pallet, 1) > 0 AND v_existing_pallet IS DISTINCT FROM v_draft.pallet THEN
      RAISE EXCEPTION 'Pallet của kiện % lô % không khớp lần nhập trước.', v_draft.kien, v_draft.ma_lo;
    END IF;

    SELECT tong_kho INTO v_ngan_tong_kho FROM ngans WHERE id = v_draft.ngan_id AND factory_id = v_draft.factory_id;
    IF v_ngan_tong_kho IS NULL THEN
      RAISE EXCEPTION 'Không tìm thấy ngăn nguồn cho lô % kiện %.', v_draft.ma_lo, v_draft.kien;
    END IF;
    SELECT COALESCE(SUM(lt.so_kg), 0) INTO v_existing_real_kg
      FROM lot_transactions lt JOIN lots l ON l.id = lt.lot_id
      WHERE lt.ngan_id = v_draft.ngan_id AND l.factory_id = v_draft.factory_id;
    v_cap_kg := COALESCE(v_ngan_tong_kho, 0) * 1.1;
    IF v_existing_real_kg + v_so_kg > v_cap_kg + 0.01 THEN
      RAISE EXCEPTION 'Ngăn sẽ vượt quá 110%% sau khi gửi lô % kiện % — vui lòng kiểm tra lại.', v_draft.ma_lo, v_draft.kien;
    END IF;

    -- GĐ3B: nắp của kiện (chỉ khi pallet cần nắp + mã là nắp hợp lệ).
    v_nap := '{}'::jsonb;
    IF NULLIF(btrim(COALESCE(v_draft.nap, '')), '') IS NOT NULL THEN
      v_nap := lot_nap_sanitize(
        v_draft.factory_id,
        jsonb_build_object(lower(v_draft.kien), btrim(v_draft.nap)),
        ARRAY[
          CASE WHEN v_draft.kien = 'A' THEN v_draft.so_banh ELSE 0 END,
          CASE WHEN v_draft.kien = 'B' THEN v_draft.so_banh ELSE 0 END,
          CASE WHEN v_draft.kien = 'C' THEN v_draft.so_banh ELSE 0 END,
          CASE WHEN v_draft.kien = 'D' THEN v_draft.so_banh ELSE 0 END
        ],
        v_draft.pallet
      );
    END IF;

    INSERT INTO lot_transactions (lot_id, ngan_id, ca, ngay_nhap, kien_a, kien_b, kien_c, kien_d, so_banh, so_kg, created_by, boc, pallet, chi_thi, nap)
    VALUES (
      v_lot_id, v_draft.ngan_id, v_draft.ca, v_draft.ngay_sx,
      CASE WHEN v_draft.kien = 'A' THEN v_draft.so_banh ELSE 0 END,
      CASE WHEN v_draft.kien = 'B' THEN v_draft.so_banh ELSE 0 END,
      CASE WHEN v_draft.kien = 'C' THEN v_draft.so_banh ELSE 0 END,
      CASE WHEN v_draft.kien = 'D' THEN v_draft.so_banh ELSE 0 END,
      v_draft.so_banh, v_so_kg, v_draft.created_by, v_draft.boc, v_draft.pallet, v_draft.chi_thi, v_nap
    );

    -- Đồng bộ bọc cho toàn bộ giao dịch của lô để không bị phân mảnh
    IF v_draft.boc IS NOT NULL THEN
      UPDATE lot_transactions ltb SET boc = v_draft.boc WHERE ltb.lot_id = v_lot_id;
    END IF;

    DELETE FROM product_confirm_drafts WHERE id = v_draft.id;
    v_touched_lots := array_append(v_touched_lots, v_lot_id);
    v_touched_ngans := array_append(v_touched_ngans, v_draft.ngan_id);

    RETURN QUERY SELECT v_draft.id, v_lot_id, v_draft.ma_lo, v_draft.kien, v_so_kg;
  END LOOP;

  FOR v_lot_id IN SELECT DISTINCT unnest(v_touched_lots) LOOP
    PERFORM sync_lot_master_snapshot(v_lot_id);
  END LOOP;

  -- Khôi phục (mất từ 20260828): tự chuyển ngăn Chờ sản xuất -> Đang sản xuất khi có sản lượng thật.
  FOR v_ngan_id IN SELECT DISTINCT unnest(v_touched_ngans) LOOP
    PERFORM sync_ngan_production_status(v_ngan_id);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_confirm_draft_batch(UUID[], UUID, JSONB) TO authenticated, service_role;


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
  p_ly_do         TEXT,
  p_nap           JSONB DEFAULT NULL
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
  v_nap           JSONB;
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
    'chi_thi', v_tx.chi_thi, 'lot_boc', v_lot.boc, 'lot_trang_thai', v_lot.trang_thai,
    'nap', COALESCE(v_tx.nap, '{}'::jsonb)
  );

  -- GĐ3B: p_nap NULL = giữ nắp cũ (code cũ không truyền). Luôn lọc theo kiện còn bành + pallet cần nắp.
  v_nap := lot_nap_sanitize(v_lot.factory_id, COALESCE(p_nap, v_tx.nap, '{}'::jsonb), v_new, p_pallet);

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
    chi_thi   = NULLIF(btrim(COALESCE(p_chi_thi, '')), ''),
    nap       = v_nap
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
      'boc_lan_ca_lo', v_boc_changed AND v_boc_uniform,
      'nap', v_nap
    )
  );

  RETURN jsonb_build_object('lot_id', v_lot.id, 'old_ngan_id', v_tx.ngan_id, 'new_ngan_id', p_ngan_id);
END;
$$;

REVOKE ALL ON FUNCTION admin_update_lot_transaction(
  UUID, INTEGER, INTEGER, INTEGER, INTEGER, UUID, TEXT, DATE, TEXT, TEXT[], TEXT, INTEGER, UUID, TEXT, JSONB
) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION admin_update_lot_transaction(
  UUID, INTEGER, INTEGER, INTEGER, INTEGER, UUID, TEXT, DATE, TEXT, TEXT[], TEXT, INTEGER, UUID, TEXT, JSONB
) TO service_role;


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
  v_sel_keys   TEXT[];
  v_tx_nap     JSONB;
  v_move_nap   JSONB;
  v_keep_nap   JSONB;
  v_new_need_nap BOOLEAN;
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

  -- GĐ3B: Sang kiện sang pallet KHÔNG cần nắp ⇒ nắp của kiện trả về kho (xoá khoá nắp). Thay bọc giữ nắp.
  v_new_need_nap := v_is_boc OR pallet_names_need_nap(p_factory_id, p_new_pallet);

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
    v_sel_keys := v_kiens;

    FOR v_tx IN
      SELECT lt.* FROM lot_transactions lt WHERE lt.lot_id = v_lot.id ORDER BY lt.created_at FOR UPDATE
    LOOP
      v_has_sel := (v_sel_a AND COALESCE(v_tx.kien_a, 0) <> 0) OR (v_sel_b AND COALESCE(v_tx.kien_b, 0) <> 0)
                OR (v_sel_c AND COALESCE(v_tx.kien_c, 0) <> 0) OR (v_sel_d AND COALESCE(v_tx.kien_d, 0) <> 0);
      IF NOT v_has_sel THEN CONTINUE; END IF;
      v_has_unsel := (NOT v_sel_a AND COALESCE(v_tx.kien_a, 0) <> 0) OR (NOT v_sel_b AND COALESCE(v_tx.kien_b, 0) <> 0)
                  OR (NOT v_sel_c AND COALESCE(v_tx.kien_c, 0) <> 0) OR (NOT v_sel_d AND COALESCE(v_tx.kien_d, 0) <> 0);
      v_tx_count := v_tx_count + 1;
      v_tx_nap := CASE WHEN jsonb_typeof(v_tx.nap) = 'object' THEN v_tx.nap ELSE '{}'::jsonb END;
      SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb) INTO v_move_nap
        FROM jsonb_each(v_tx_nap) e WHERE e.key = ANY (v_sel_keys);
      SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb) INTO v_keep_nap
        FROM jsonb_each(v_tx_nap) e WHERE NOT (e.key = ANY (v_sel_keys));
      IF NOT v_new_need_nap THEN v_move_nap := '{}'::jsonb; END IF;

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
          created_by, created_at, boc, pallet, chi_thi, nap
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
          v_tx.chi_thi,
          v_move_nap
        );

        UPDATE lot_transactions lt SET
          kien_a  = CASE WHEN v_sel_a THEN 0 ELSE lt.kien_a END,
          kien_b  = CASE WHEN v_sel_b THEN 0 ELSE lt.kien_b END,
          kien_c  = CASE WHEN v_sel_c THEN 0 ELSE lt.kien_c END,
          kien_d  = CASE WHEN v_sel_d THEN 0 ELSE lt.kien_d END,
          so_banh = COALESCE(lt.so_banh, 0) - v_move_banh,
          so_kg   = COALESCE(lt.so_kg, 0) - v_move_kg,
          nap     = v_keep_nap
        WHERE lt.id = v_tx.id;
      ELSE
        UPDATE lot_transactions lt SET
          boc    = CASE WHEN v_is_boc THEN v_new_boc ELSE lt.boc END,
          pallet = CASE WHEN v_is_boc THEN lt.pallet ELSE p_new_pallet END,
          nap    = v_keep_nap || v_move_nap
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



-- Kiểm chứng:
--   SELECT table_name, column_name FROM information_schema.columns
--     WHERE (table_name, column_name) IN (('lot_transactions','nap'),('product_confirm_drafts','nap'),('export_orders','xuat_nap'));
--   SELECT pg_get_function_identity_arguments(p.oid) FROM pg_proc p WHERE p.proname = 'admin_update_lot_transaction';
--   -- đúng 1 dòng, cuối là "p_nap jsonb"
--   SELECT f.code, pallet_names_need_nap(f.id, ARRAY['Sắt đế gỗ']) AS sat_de_go,
--          pallet_names_need_nap(f.id, ARRAY['Sắt mỏng']) AS sat_mong FROM factories f;   -- true / false
--   SELECT f.code, lot_nap_sanitize(f.id, '{"a":"nap_sat","b":"nap_go","c":"sat_day"}', ARRAY[36,0,36,36], ARRAY['Sắt đế gỗ'])
--     FROM factories f;   -- {"a": "nap_sat"}
