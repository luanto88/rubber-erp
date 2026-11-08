-- Thành phần pallet theo nhà máy (2026-11-08) — GĐ3 phần A.
-- Thay bảng cứng PALLET_COMPONENT_ITEMS / PALLET_COMPONENT_LABEL (src/lib/pallet-usage.ts).
-- Dùng cho: Quy cách đóng gói TP (thành phần của pallet sản xuất), Loại pallet xuất (thành phần mất khi bọc màng),
-- Kho vật tư → Tồn (tồn pallet theo nhóm), và Nắp pallet DPH (GĐ3 phần B).
--
-- Chạy tay trên Supabase SQL Editor TRƯỚC khi deploy code. Idempotent. Bảng chưa có ⇒ code dùng danh sách mặc định.
--
-- QUY TẮC:
--  * code = mã nội bộ (chữ thường, số, gạch dưới), KHÔNG đổi sau khi tạo. Đang được dùng ở product_packaging_types
--    (thanh_phan) / export_pallet_types (mat_thanh_phan) ⇒ không xoá được, chỉ tắt (trigger bên dưới).
--  * group_code = mã nhóm hiển thị ở Tồn pallet (DPH, PM, ĐG...). inventory_item_ids = các mã vật tư kho gộp vào nhóm.
--  * la_nap = thành phần là NẮP (Nắp sắt, Nắp gỗ). co_nap = pallet nền cần chọn nắp (Pallet sắt dày DPH).

CREATE TABLE IF NOT EXISTS pallet_components (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id          UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  code                TEXT NOT NULL CHECK (code ~ '^[a-z0-9_]{2,40}$'),
  ten                 TEXT NOT NULL CHECK (btrim(ten) <> ''),
  group_code          TEXT NOT NULL CHECK (btrim(group_code) <> ''),
  inventory_item_ids  UUID[] NOT NULL DEFAULT '{}',
  la_nap              BOOLEAN NOT NULL DEFAULT false,
  co_nap              BOOLEAN NOT NULL DEFAULT false,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (NOT (la_nap AND co_nap))
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_pallet_components_factory_code
  ON pallet_components (factory_id, code);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_pallet_components_factory_group
  ON pallet_components (factory_id, upper(btrim(group_code)));

ALTER TABLE pallet_components ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pallet_components_select ON pallet_components;
CREATE POLICY pallet_components_select ON pallet_components
  FOR SELECT TO authenticated
  USING (factory_id = current_profile_factory_id());

DROP POLICY IF EXISTS pallet_components_insert ON pallet_components;
CREATE POLICY pallet_components_insert ON pallet_components
  FOR INSERT TO authenticated
  WITH CHECK (
    factory_id = current_profile_factory_id()
    AND (current_profile_role() = 'admin' OR current_profile_has_permission('settings.manage_config'))
  );

DROP POLICY IF EXISTS pallet_components_update ON pallet_components;
CREATE POLICY pallet_components_update ON pallet_components
  FOR UPDATE TO authenticated
  USING (
    factory_id = current_profile_factory_id()
    AND (current_profile_role() = 'admin' OR current_profile_has_permission('settings.manage_config'))
  )
  WITH CHECK (factory_id = current_profile_factory_id());

DROP POLICY IF EXISTS pallet_components_delete ON pallet_components;
CREATE POLICY pallet_components_delete ON pallet_components
  FOR DELETE TO authenticated
  USING (
    factory_id = current_profile_factory_id()
    AND (current_profile_role() = 'admin' OR current_profile_has_permission('settings.manage_config'))
  );

-- ── Số chỗ đang dùng 1 thành phần (GĐ3 phần B sẽ CREATE OR REPLACE thêm lot_transactions.nap) ──
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
      WHERE e.factory_id = p_factory_id AND p_code = ANY (e.mat_thanh_phan));
$$;

GRANT EXECUTE ON FUNCTION pallet_component_usage_count(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION pallet_components_guard()
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
    IF NEW.code IS NOT DISTINCT FROM OLD.code AND NEW.factory_id IS NOT DISTINCT FROM OLD.factory_id THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'PALLET_COMPONENT_CODE_LOCKED: không đổi mã thành phần "%" — thêm thành phần mới rồi tắt thành phần cũ.', OLD.code;
  END IF;

  v_used := pallet_component_usage_count(OLD.factory_id, OLD.code);
  IF v_used > 0 THEN
    RAISE EXCEPTION 'PALLET_COMPONENT_IN_USE: thành phần "%" đang dùng ở % chỗ (quy cách đóng gói / loại pallet xuất / nắp của kiện) — không xoá được, chỉ tắt.',
      OLD.ten, v_used;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_pallet_components_guard ON pallet_components;
CREATE TRIGGER trg_pallet_components_guard
  BEFORE UPDATE OR DELETE ON pallet_components
  FOR EACH ROW EXECUTE FUNCTION pallet_components_guard();

-- ── Seed: đúng bảng cứng cũ + Nắp sắt (NS), Nắp gỗ (NG). PHẢI khớp DEFAULT trong src/lib/pallet-components.ts ──
INSERT INTO pallet_components (factory_id, code, ten, group_code, inventory_item_ids, la_nap, co_nap, sort_order, is_active)
SELECT
  f.id, v.code, v.ten, v.grp,
  COALESCE(
    (SELECT array_agg(i.id ORDER BY i.code) FROM inventory_items i
      WHERE i.factory_id = f.id AND upper(btrim(i.code)) = ANY (v.item_codes)),
    '{}'::uuid[]
  ),
  v.la_nap, v.co_nap, v.ord, true
FROM factories f
CROSS JOIN (VALUES
  ('sat_day',   'Pallet sắt dày',  'DPH',  ARRAY['DPH'],            false, true,  10),
  ('sat_mong',  'Pallet sắt mỏng', 'PM',   ARRAY['MUBEZ', 'MCH'],   false, false, 20),
  ('de_go',     'Đế gỗ',           'ĐG',   ARRAY['ĐG'],             false, false, 30),
  ('de_nhua',   'Đế nhựa',         'ĐN',   ARRAY['ĐN'],             false, false, 40),
  ('mb5',       'Pallet MB5',      'PMB5', ARRAY['PMB5'],           false, false, 50),
  ('mb4',       'Pallet MB4',      'PMB4', ARRAY['PMB4'],           false, false, 60),
  ('pallet_go', 'Pallet gỗ',       'PG',   ARRAY['PG'],             false, false, 70),
  ('nap_sat',   'Nắp sắt',         'NS',   ARRAY['NS'],             true,  false, 80),
  ('nap_go',    'Nắp gỗ',          'NG',   ARRAY['NG'],             true,  false, 90)
) AS v(code, ten, grp, item_codes, la_nap, co_nap, ord)
ON CONFLICT (factory_id, code) DO NOTHING;

-- Kiểm chứng:
-- SELECT f.code, c.code, c.ten, c.group_code, c.la_nap, c.co_nap,
--        (SELECT string_agg(i.code, ', ') FROM inventory_items i WHERE i.id = ANY (c.inventory_item_ids)) AS ma_kho
--   FROM pallet_components c JOIN factories f ON f.id = c.factory_id ORDER BY f.code, c.sort_order;
--   -- kỳ vọng 9 dòng/nhà máy; phuochoa_kt: DPH | MUBEZ, MCH | ĐG | ĐN | PMB5 | (PMB4 trống) | PG | NS | NG
