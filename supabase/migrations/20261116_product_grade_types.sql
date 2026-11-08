-- Quy cách chủng loại thành phẩm theo nhà máy (2026-11-08) — GĐ2: Chủng loại × Loại bành.
-- Thay các hàm hard-code getLoaiCSRByDayChuyen / getLoaiBanhOptions / getLoaiBanhConfig (product-lot-config.ts,
-- product/page.tsx, export/page.tsx, warehouse getMaxBanh) và CASE "20kg → 240, khác → 144" trong SQL.
--
-- Chạy tay trên Supabase SQL Editor TRƯỚC khi deploy code. Idempotent.
-- Bảng chưa có ⇒ code tự dùng quy tắc cũ (không gãy).
--
-- QUY TẮC:
--  * Mỗi dòng = 1 (chủng loại × loại bành). Lô tròn = 4 × max_per_kien (luôn 4 kiện A-D), KHÔNG lưu riêng.
--  * Dòng đã có lô / lô dự đoán / nháp quét QR dùng (cùng factory, loai_csr, loai_banh) ⇒ KHÔNG đổi được
--    loai_csr / loai_banh / max_per_kien và KHÔNG xoá được (trigger bên dưới) — chỉ tắt/bật, đổi thứ tự,
--    dây chuyền, mặc định. Đổi bành/kiện của dòng đã dùng sẽ làm lô cũ đổi Hoàn thành ↔ Dở dang.
--  * is_default: loại bành gợi ý đầu tiên trên form cho chủng loại đó (mỗi chủng loại tối đa 1 dòng).

CREATE TABLE IF NOT EXISTS product_grade_types (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id    UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  day_chuyen    TEXT NOT NULL CHECK (day_chuyen IN ('Mủ tạp', 'Mủ nước')),
  loai_csr      TEXT NOT NULL CHECK (btrim(loai_csr) <> '' AND loai_csr = upper(regexp_replace(loai_csr, '\s', '', 'g'))),
  loai_banh     NUMERIC(8, 2) NOT NULL CHECK (loai_banh > 0),
  max_per_kien  INTEGER NOT NULL CHECK (max_per_kien > 0 AND max_per_kien <= 500),
  is_default    BOOLEAN NOT NULL DEFAULT false,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_product_grade_types_factory_csr_banh
  ON product_grade_types (factory_id, loai_csr, loai_banh);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_product_grade_types_default
  ON product_grade_types (factory_id, loai_csr) WHERE is_default;

CREATE INDEX IF NOT EXISTS idx_product_grade_types_factory
  ON product_grade_types (factory_id, day_chuyen, sort_order);

ALTER TABLE product_grade_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_grade_types_select ON product_grade_types;
CREATE POLICY product_grade_types_select ON product_grade_types
  FOR SELECT TO authenticated
  USING (factory_id = current_profile_factory_id());

DROP POLICY IF EXISTS product_grade_types_insert ON product_grade_types;
CREATE POLICY product_grade_types_insert ON product_grade_types
  FOR INSERT TO authenticated
  WITH CHECK (
    factory_id = current_profile_factory_id()
    AND (current_profile_role() = 'admin' OR current_profile_has_permission('settings.manage_config'))
  );

DROP POLICY IF EXISTS product_grade_types_update ON product_grade_types;
CREATE POLICY product_grade_types_update ON product_grade_types
  FOR UPDATE TO authenticated
  USING (
    factory_id = current_profile_factory_id()
    AND (current_profile_role() = 'admin' OR current_profile_has_permission('settings.manage_config'))
  )
  WITH CHECK (factory_id = current_profile_factory_id());

DROP POLICY IF EXISTS product_grade_types_delete ON product_grade_types;
CREATE POLICY product_grade_types_delete ON product_grade_types
  FOR DELETE TO authenticated
  USING (
    factory_id = current_profile_factory_id()
    AND (current_profile_role() = 'admin' OR current_profile_has_permission('settings.manage_config'))
  );

-- ── Số lần dùng của 1 (factory, chủng loại, loại bành) — SECURITY DEFINER để đếm đủ bất kể RLS ──
CREATE OR REPLACE FUNCTION product_grade_usage_count(p_factory_id uuid, p_loai_csr text, p_loai_banh numeric)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT count(*)::int FROM lots l
      WHERE l.factory_id = p_factory_id
        AND upper(regexp_replace(coalesce(l.loai_csr, ''), '\s', '', 'g')) = p_loai_csr
        AND round(l.loai_banh::numeric, 2) = round(p_loai_banh, 2))
  + (SELECT count(*)::int FROM lot_prediction_lots p
      WHERE p.factory_id = p_factory_id
        AND upper(regexp_replace(coalesce(p.loai_csr, ''), '\s', '', 'g')) = p_loai_csr
        AND round(p.loai_banh::numeric, 2) = round(p_loai_banh, 2))
  + (SELECT count(*)::int FROM product_confirm_drafts d
      WHERE d.factory_id = p_factory_id
        AND upper(regexp_replace(coalesce(d.loai_csr, ''), '\s', '', 'g')) = p_loai_csr
        AND round(d.loai_banh::numeric, 2) = round(p_loai_banh, 2));
$$;

GRANT EXECUTE ON FUNCTION product_grade_usage_count(uuid, text, numeric) TO authenticated, service_role;

-- ── Chặn đổi số / xoá dòng đã dùng ──
CREATE OR REPLACE FUNCTION product_grade_types_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_used integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
    IF NEW.loai_csr IS NOT DISTINCT FROM OLD.loai_csr
       AND NEW.loai_banh IS NOT DISTINCT FROM OLD.loai_banh
       AND NEW.max_per_kien IS NOT DISTINCT FROM OLD.max_per_kien
       AND NEW.factory_id IS NOT DISTINCT FROM OLD.factory_id THEN
      RETURN NEW;
    END IF;
  END IF;

  v_used := product_grade_usage_count(OLD.factory_id, OLD.loai_csr, OLD.loai_banh);
  IF v_used > 0 THEN
    RAISE EXCEPTION 'PRODUCT_GRADE_IN_USE: % bành % kg đã dùng ở % lô/lô dự đoán/nháp — không đổi chủng loại, loại bành, bành/kiện và không xoá được; chỉ tắt.',
      OLD.loai_csr, OLD.loai_banh, v_used;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_grade_types_guard ON product_grade_types;
CREATE TRIGGER trg_product_grade_types_guard
  BEFORE UPDATE OR DELETE ON product_grade_types
  FOR EACH ROW EXECUTE FUNCTION product_grade_types_guard();

-- ── Lô tròn theo cấu hình: dòng đúng (csr, bành) → dòng mặc định của csr → CASE cũ ──
-- Khớp getLoaiBanhConfig() bản có cấu hình (src/lib/product-grade.ts). Đọc cả dòng đã tắt (lô cũ).
CREATE OR REPLACE FUNCTION product_grade_lo_tron(p_factory_id uuid, p_loai_csr text, p_loai_banh numeric)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT 4 * g.max_per_kien FROM product_grade_types g
      WHERE g.factory_id = p_factory_id
        AND g.loai_csr = upper(regexp_replace(coalesce(p_loai_csr, ''), '\s', '', 'g'))
        AND round(g.loai_banh, 2) = round(p_loai_banh, 2)
      LIMIT 1),
    (SELECT 4 * g.max_per_kien FROM product_grade_types g
      WHERE g.factory_id = p_factory_id
        AND g.loai_csr = upper(regexp_replace(coalesce(p_loai_csr, ''), '\s', '', 'g'))
      ORDER BY g.is_default DESC, g.is_active DESC, g.sort_order, g.loai_banh DESC
      LIMIT 1),
    CASE WHEN p_loai_banh = 20 THEN 240 ELSE 144 END
  )::numeric;
$$;

GRANT EXECUTE ON FUNCTION product_grade_lo_tron(uuid, text, numeric) TO authenticated, service_role;

-- ── sync_lot_master_snapshot: chép NGUYÊN bản 20260929_shift_lock_gaps.sql, chỉ đổi dòng tính lô tròn ──
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
  v_factory_id   uuid;
  v_loai_csr     text;
BEGIN
  PERFORM 1 FROM lots lk WHERE lk.id = p_lot_id FOR UPDATE;

  SELECT l.loai_banh, l.trang_thai, l.factory_id, l.loai_csr
  INTO v_loai_banh, v_cur_status, v_factory_id, v_loai_csr
  FROM lots l WHERE l.id = p_lot_id;
  v_lo_tron := product_grade_lo_tron(v_factory_id, v_loai_csr, v_loai_banh);

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

-- ── Trigger update_lot_master_totals: chép NGUYÊN bản 20260708_fix_lot_status_trigger.sql, chỉ đổi lô tròn ──
CREATE OR REPLACE FUNCTION update_lot_master_totals()
RETURNS TRIGGER AS $$
DECLARE
    v_tong_banh NUMERIC;
    v_tong_kg NUMERIC;
    v_loai_banh NUMERIC;
    v_lo_tron NUMERIC;
    v_trang_thai TEXT;
    v_current_status TEXT;
    v_factory_id UUID;
    v_loai_csr TEXT;
BEGIN
    -- Tinh tong so banh va kg tu tat ca cac giao dich cua lo nay
    SELECT COALESCE(SUM(so_banh), 0), COALESCE(SUM(so_kg), 0)
    INTO v_tong_banh, v_tong_kg
    FROM lot_transactions
    WHERE lot_id = COALESCE(NEW.lot_id, OLD.lot_id);

    -- Lay thong tin loai_banh, loai_csr, factory va trang_thai hien tai tu bang lots
    SELECT loai_banh, trang_thai, factory_id, loai_csr
    INTO v_loai_banh, v_current_status, v_factory_id, v_loai_csr
    FROM lots WHERE id = COALESCE(NEW.lot_id, OLD.lot_id);

    -- Lo tron theo cau hinh nha may (product_grade_types), khong co thi 20kg -> 240, khac -> 144
    v_lo_tron := product_grade_lo_tron(v_factory_id, v_loai_csr, v_loai_banh);

    -- Xac dinh trang thai moi (chuan co dau)
    IF v_tong_banh >= v_lo_tron THEN v_trang_thai := 'Hoàn thành'; ELSE v_trang_thai := 'Dở dang'; END IF;

    IF v_current_status = 'Xuất hàng' THEN
        -- Lo da xuat hang: chi cap nhat lai tong banh/kg, khong ha cap trang_thai
        UPDATE lots
        SET tong_banh = v_tong_banh, tong_kg = v_tong_kg
        WHERE id = COALESCE(NEW.lot_id, OLD.lot_id);
    ELSE
        UPDATE lots
        SET tong_banh = v_tong_banh, tong_kg = v_tong_kg, trang_thai = v_trang_thai
        WHERE id = COALESCE(NEW.lot_id, OLD.lot_id);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Seed đúng quy tắc hard-code cũ, theo factories.prefix (CSR/SVR). Phải khớp legacy ở product-grade.ts ──
INSERT INTO product_grade_types (factory_id, day_chuyen, loai_csr, loai_banh, max_per_kien, is_default, sort_order, is_active)
SELECT f.id, v.dc, coalesce(nullif(btrim(f.prefix), ''), 'CSR') || v.sfx, v.banh, v.mpk, v.def, v.ord, true
FROM factories f
CROSS JOIN (VALUES
  ('Mủ tạp',  '10',   35.00, 36, true,  10),
  ('Mủ tạp',  '20',   35.00, 36, true,  20),
  ('Mủ nước', 'L',    35.00, 36, true,  30),
  ('Mủ nước', 'L',    33.33, 36, false, 31),
  ('Mủ nước', '3L',   35.00, 36, true,  40),
  ('Mủ nước', '3L',   33.33, 36, false, 41),
  ('Mủ nước', 'CV50', 35.00, 36, true,  50),
  ('Mủ nước', 'CV50', 20.00, 60, false, 51),
  ('Mủ nước', 'CV60', 35.00, 36, true,  60),
  ('Mủ nước', 'CV60', 20.00, 60, false, 61)
) AS v(dc, sfx, banh, mpk, def, ord)
ON CONFLICT (factory_id, loai_csr, loai_banh) DO NOTHING;

-- Kiểm chứng:
-- SELECT f.code, g.day_chuyen, g.loai_csr, g.loai_banh, g.max_per_kien, 4*g.max_per_kien AS lo_tron, g.is_default
--   FROM product_grade_types g JOIN factories f ON f.id = g.factory_id ORDER BY f.code, g.sort_order;
-- SELECT product_grade_lo_tron(id, prefix || '10', 35), product_grade_lo_tron(id, prefix || 'CV50', 20) FROM factories;
--   -- kỳ vọng 144 | 240
-- Lô cũ không đổi trạng thái (phải ra 0 dòng):
-- SELECT l.ma_lo, l.trang_thai, l.tong_banh FROM lots l
--  WHERE l.trang_thai IN ('Hoàn thành','Dở dang')
--    AND (l.tong_banh >= product_grade_lo_tron(l.factory_id, l.loai_csr, l.loai_banh))
--        <> (l.trang_thai = 'Hoàn thành');
