-- 2026-11-10 — Module Định mức Kinh tế Kỹ thuật chế biến (`/dashboard/norms`) — GĐ1 "Cấu hình định mức".
-- Kế hoạch: .claude/plans/dinh-muc-ktkt-2026-11-10.md + rule 30.
--
-- Mô hình:
--   tech_norm_items          danh mục chỉ tiêu theo nhà máy (Formic, NH3, Điện…), ánh xạ vật tư kho THEO ID.
--   tech_norm_versions       "khung" định mức có ngày hiệu lực [effective_from, effective_to]; 1 năm có thể nhiều khung.
--                            Trạng thái draft (Nháp) → active (Đang áp dụng) → locked (Đã khoá, GĐ4 khi có báo cáo ký).
--                            2 khung active/locked của cùng nhà máy KHÔNG được chồng ngày.
--   tech_norm_version_items  cột của khung: chỉ tiêu + cơ sở tính (tấn TP / tấn NL quy khô / tấn tươi / 100 km) + đơn vị.
--   tech_norm_rows           dòng của khung: dây chuyền + 1..n CSR + 1..n nguồn (rỗng = mọi nguồn).
--                            Trong 1 khung, 1 (dây chuyền, CSR, nguồn) chỉ thuộc tối đa 1 dòng.
--   tech_norm_matrix_values  ô = (cột × dòng) hoặc (cột 100 km, row_id NULL). merge_key = ô gộp (chỉ hiển thị/sửa chung).
-- Chỉ sửa được dòng/cột/ô khi khung đang Nháp.
-- KHÔNG đụng 4 bảng inventory_consumption_norms* (lỗi thời, 0 dòng).
-- Chạy TAY trên Supabase SQL Editor. Idempotent — chạy lại an toàn (seed chỉ tạo khi chưa có khung DM2026).

BEGIN;

-- ── 1. Bảng ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tech_norm_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id         UUID NOT NULL REFERENCES factories(id),
  code               TEXT NOT NULL,
  name               TEXT NOT NULL,
  norm_group         TEXT NOT NULL DEFAULT 'khac'
                     CHECK (norm_group IN ('hoa_chat','vat_tu','dau_nhot_mo','dien_nuoc','van_chuyen','khac')),
  actual_source      TEXT NOT NULL DEFAULT 'kho' CHECK (actual_source IN ('kho','dong_ho')),
  inventory_item_ids UUID[] NOT NULL DEFAULT '{}',
  vehicle_types      TEXT[] NOT NULL DEFAULT '{}',
  ghi_chu            TEXT,
  sort_order         INTEGER NOT NULL DEFAULT 100,
  is_active          BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (factory_id, code)
);

CREATE TABLE IF NOT EXISTS tech_norm_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id     UUID NOT NULL REFERENCES factories(id),
  nam            INTEGER NOT NULL,
  code           TEXT NOT NULL,
  name           TEXT NOT NULL,
  decision_no    TEXT,
  decision_date  DATE,
  effective_from DATE NOT NULL,
  effective_to   DATE,
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','locked')),
  ghi_chu        TEXT,
  created_by     UUID REFERENCES auth.users(id),
  applied_by     UUID REFERENCES auth.users(id),
  applied_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (factory_id, code),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE IF NOT EXISTS tech_norm_version_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id UUID NOT NULL REFERENCES factories(id),
  version_id UUID NOT NULL REFERENCES tech_norm_versions(id) ON DELETE CASCADE,
  item_id    UUID NOT NULL REFERENCES tech_norm_items(id),
  basis      TEXT NOT NULL DEFAULT 'tan_tp' CHECK (basis IN ('tan_tp','tan_nl_kho','tan_nl_tuoi','km100')),
  unit       TEXT NOT NULL DEFAULT 'kg' CHECK (unit IN ('kg','lit','kwh','m3')),
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (version_id, item_id)
);

CREATE TABLE IF NOT EXISTS tech_norm_rows (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id  UUID NOT NULL REFERENCES factories(id),
  version_id  UUID NOT NULL REFERENCES tech_norm_versions(id) ON DELETE CASCADE,
  day_chuyen  TEXT NOT NULL,
  csr_codes   TEXT[] NOT NULL CHECK (cardinality(csr_codes) > 0),
  nguon_codes TEXT[] NOT NULL DEFAULT '{}'
              CHECK (nguon_codes <@ ARRAY['cong_ty','thu_mua','gia_cong','thanh_ly']::TEXT[]),
  label       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 100,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tech_norm_matrix_values (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id UUID NOT NULL REFERENCES factories(id),
  version_id UUID NOT NULL,
  item_id    UUID NOT NULL,
  row_id     UUID REFERENCES tech_norm_rows(id) ON DELETE CASCADE,
  value      NUMERIC(14,4) NOT NULL CHECK (value >= 0),
  merge_key  UUID,
  note       TEXT,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (version_id, item_id) REFERENCES tech_norm_version_items(version_id, item_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_tech_norm_values_cell
  ON tech_norm_matrix_values (row_id, item_id) WHERE row_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_tech_norm_values_km
  ON tech_norm_matrix_values (version_id, item_id) WHERE row_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_tech_norm_values_version ON tech_norm_matrix_values (version_id);
CREATE INDEX IF NOT EXISTS idx_tech_norm_rows_version ON tech_norm_rows (version_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_tech_norm_versions_factory ON tech_norm_versions (factory_id, effective_from);

COMMENT ON TABLE tech_norm_versions IS 'Khung định mức KTKT có ngày hiệu lực. Active/locked không chồng ngày trong 1 nhà máy.';
COMMENT ON COLUMN tech_norm_rows.nguon_codes IS 'cong_ty (NT) / thu_mua (TM) / gia_cong / thanh_ly — rỗng = mọi nguồn. Theo makeNguonResolver (src/lib/lot-source.ts).';
COMMENT ON COLUMN tech_norm_matrix_values.merge_key IS 'Các ô cùng cột, cùng merge_key = 1 ô gộp (hiển thị rowSpan, sửa 1 lần).';

-- ── 2. Trigger ──────────────────────────────────────────────────────────────

-- updated_at
CREATE OR REPLACE FUNCTION tech_norm_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_tech_norm_items_touch ON tech_norm_items;
CREATE TRIGGER trg_tech_norm_items_touch BEFORE UPDATE ON tech_norm_items
  FOR EACH ROW EXECUTE FUNCTION tech_norm_touch_updated_at();

-- Khung: quyền đổi trạng thái, cấm sửa khi đã áp dụng, chặn chồng ngày.
CREATE OR REPLACE FUNCTION tech_norm_versions_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user boolean := auth.uid() IS NOT NULL;
  v_conflict RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'NORM_VERSION_NOT_DRAFT: Chỉ xoá được khung đang Nháp. Hãy hủy áp dụng trước.';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.factory_id <> OLD.factory_id THEN
      RAISE EXCEPTION 'Không đổi được nhà máy của khung định mức.';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF OLD.status = 'locked' AND v_user THEN
        RAISE EXCEPTION 'NORM_VERSION_LOCKED: Khung đã khoá (đã có báo cáo ký), không đổi trạng thái được.';
      END IF;
      IF v_user AND NOT current_profile_has_permission('norms.approve') THEN
        RAISE EXCEPTION 'Bạn không có quyền áp dụng / hủy áp dụng khung định mức (norms.approve).';
      END IF;
      IF NEW.status = 'active' AND OLD.status = 'draft' THEN
        NEW.applied_by := auth.uid();
        NEW.applied_at := now();
      END IF;
      IF NEW.status = 'draft' THEN
        NEW.applied_by := NULL;
        NEW.applied_at := NULL;
      END IF;
    ELSE
      IF OLD.status <> 'draft' AND v_user THEN
        RAISE EXCEPTION 'NORM_VERSION_NOT_DRAFT: Khung đang áp dụng — hủy áp dụng về Nháp trước khi sửa.';
      END IF;
      IF v_user AND NOT current_profile_has_permission('norms.manage_config') THEN
        RAISE EXCEPTION 'Bạn không có quyền sửa khung định mức (norms.manage_config).';
      END IF;
    END IF;
    NEW.updated_at := now();
  END IF;

  IF TG_OP = 'INSERT' AND NEW.status <> 'draft' AND v_user THEN
    RAISE EXCEPTION 'Khung mới phải ở trạng thái Nháp.';
  END IF;

  IF NEW.status IN ('active','locked') THEN
    SELECT v.code, v.name, v.effective_from, v.effective_to INTO v_conflict
    FROM tech_norm_versions v
    WHERE v.factory_id = NEW.factory_id
      AND v.id <> NEW.id
      AND v.status IN ('active','locked')
      AND daterange(v.effective_from, coalesce(v.effective_to, 'infinity'::date), '[]')
          && daterange(NEW.effective_from, coalesce(NEW.effective_to, 'infinity'::date), '[]')
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'NORM_VERSION_OVERLAP: Hiệu lực chồng với khung "%" (từ % đến %). Đặt ngày kết thúc cho khung cũ hoặc hủy áp dụng khung đó trước.',
        v_conflict.name, to_char(v_conflict.effective_from, 'DD/MM/YYYY'),
        coalesce(to_char(v_conflict.effective_to, 'DD/MM/YYYY'), 'không thời hạn');
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tech_norm_versions_guard ON tech_norm_versions;
CREATE TRIGGER trg_tech_norm_versions_guard BEFORE INSERT OR UPDATE OR DELETE ON tech_norm_versions
  FOR EACH ROW EXECUTE FUNCTION tech_norm_versions_guard();

-- Bảng con: khung phải Nháp + cùng nhà máy. Khung không còn (xoá dây chuyền cascade) ⇒ cho qua.
CREATE OR REPLACE FUNCTION tech_norm_child_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vid UUID;
  v_factory UUID;
  v_status TEXT;
  r RECORD;
BEGIN
  v_vid := CASE WHEN TG_OP = 'DELETE' THEN OLD.version_id ELSE NEW.version_id END;
  SELECT factory_id, status INTO v_factory, v_status FROM tech_norm_versions WHERE id = v_vid;
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF v_status <> 'draft' AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'NORM_VERSION_NOT_DRAFT: Khung đang áp dụng — hủy áp dụng về Nháp trước khi sửa dòng / cột / số liệu.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.factory_id <> v_factory THEN
    RAISE EXCEPTION 'Dữ liệu định mức không cùng nhà máy với khung.';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.version_id <> OLD.version_id THEN
    RAISE EXCEPTION 'Không chuyển được dữ liệu sang khung khác.';
  END IF;

  IF TG_TABLE_NAME = 'tech_norm_version_items' THEN
    SELECT factory_id, norm_group INTO r FROM tech_norm_items WHERE id = NEW.item_id;
    IF r.factory_id <> v_factory THEN
      RAISE EXCEPTION 'Chỉ tiêu không thuộc nhà máy của khung.';
    END IF;
    IF (NEW.basis = 'km100') <> (r.norm_group = 'van_chuyen') THEN
      RAISE EXCEPTION 'Cơ sở tính "100 km" chỉ dùng cho chỉ tiêu nhóm Vận chuyển (và ngược lại).';
    END IF;
  ELSIF TG_TABLE_NAME = 'tech_norm_matrix_values' THEN
    SELECT basis INTO r FROM tech_norm_version_items WHERE version_id = NEW.version_id AND item_id = NEW.item_id;
    IF (r.basis = 'km100') <> (NEW.row_id IS NULL) THEN
      RAISE EXCEPTION 'Cột theo 100 km không gắn dòng; cột theo tấn phải gắn đúng 1 dòng.';
    END IF;
    IF NEW.row_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM tech_norm_rows WHERE id = NEW.row_id AND version_id = NEW.version_id
    ) THEN
      RAISE EXCEPTION 'Dòng không thuộc khung này.';
    END IF;
    NEW.updated_at := now();
    IF auth.uid() IS NOT NULL THEN NEW.updated_by := auth.uid(); END IF;
  ELSIF TG_TABLE_NAME = 'tech_norm_rows' THEN
    NEW.csr_codes := ARRAY(SELECT DISTINCT upper(btrim(x)) FROM unnest(NEW.csr_codes) x WHERE btrim(x) <> '' ORDER BY 1);
    NEW.nguon_codes := ARRAY(SELECT DISTINCT x FROM unnest(NEW.nguon_codes) x ORDER BY 1);
    IF cardinality(NEW.csr_codes) = 0 THEN
      RAISE EXCEPTION 'Dòng định mức phải có ít nhất 1 loại CSR.';
    END IF;
    SELECT label INTO r FROM tech_norm_rows o
    WHERE o.version_id = NEW.version_id
      AND o.id <> NEW.id
      AND o.day_chuyen = NEW.day_chuyen
      AND o.csr_codes && NEW.csr_codes
      AND (cardinality(o.nguon_codes) = 0 OR cardinality(NEW.nguon_codes) = 0 OR o.nguon_codes && NEW.nguon_codes)
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'NORM_ROW_OVERLAP: Trùng CSR + nguồn với dòng "%" trong cùng khung.', coalesce(r.label, '?');
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tech_norm_version_items_guard ON tech_norm_version_items;
CREATE TRIGGER trg_tech_norm_version_items_guard BEFORE INSERT OR UPDATE OR DELETE ON tech_norm_version_items
  FOR EACH ROW EXECUTE FUNCTION tech_norm_child_guard();
DROP TRIGGER IF EXISTS trg_tech_norm_rows_guard ON tech_norm_rows;
CREATE TRIGGER trg_tech_norm_rows_guard BEFORE INSERT OR UPDATE OR DELETE ON tech_norm_rows
  FOR EACH ROW EXECUTE FUNCTION tech_norm_child_guard();
DROP TRIGGER IF EXISTS trg_tech_norm_values_guard ON tech_norm_matrix_values;
CREATE TRIGGER trg_tech_norm_values_guard BEFORE INSERT OR UPDATE OR DELETE ON tech_norm_matrix_values
  FOR EACH ROW EXECUTE FUNCTION tech_norm_child_guard();

-- ── 3. RLS ──────────────────────────────────────────────────────────────────
-- Đọc: cùng nhà máy + norms.view. Ghi: cùng nhà máy + norms.manage_config (admin luôn qua).
-- Khung: UPDATE mở thêm cho norms.approve (trigger tách: đổi trạng thái cần approve, sửa nội dung cần manage_config).

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['tech_norm_items','tech_norm_versions','tech_norm_version_items','tech_norm_rows','tech_norm_matrix_values']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_select', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR SELECT TO authenticated
      USING (factory_id = current_profile_factory_id() AND current_profile_has_permission('norms.view'))$p$, t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_insert', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR INSERT TO authenticated
      WITH CHECK (factory_id = current_profile_factory_id() AND current_profile_has_permission('norms.manage_config'))$p$, t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_delete', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR DELETE TO authenticated
      USING (factory_id = current_profile_factory_id() AND current_profile_has_permission('norms.manage_config'))$p$, t || '_delete', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_update', t);
    IF t = 'tech_norm_versions' THEN
      EXECUTE format($p$CREATE POLICY %I ON %I FOR UPDATE TO authenticated
        USING (factory_id = current_profile_factory_id()
               AND (current_profile_has_permission('norms.manage_config') OR current_profile_has_permission('norms.approve')))
        WITH CHECK (factory_id = current_profile_factory_id())$p$, t || '_update', t);
    ELSE
      EXECUTE format($p$CREATE POLICY %I ON %I FOR UPDATE TO authenticated
        USING (factory_id = current_profile_factory_id() AND current_profile_has_permission('norms.manage_config'))
        WITH CHECK (factory_id = current_profile_factory_id())$p$, t || '_update', t);
    END IF;
  END LOOP;
END $$;

-- ── 4. Sao chép khung (1 giao dịch, chạy theo quyền người gọi — RLS áp dụng) ──
CREATE OR REPLACE FUNCTION tech_norm_copy_version(
  p_source_id UUID, p_code TEXT, p_name TEXT, p_nam INTEGER, p_effective_from DATE, p_effective_to DATE DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_src tech_norm_versions%ROWTYPE;
  v_new UUID;
  v_row RECORD;
  v_row_map JSONB := '{}'::jsonb;
  v_new_row UUID;
BEGIN
  SELECT * INTO v_src FROM tech_norm_versions WHERE id = p_source_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy khung nguồn.'; END IF;

  INSERT INTO tech_norm_versions (factory_id, nam, code, name, effective_from, effective_to, status, ghi_chu, created_by)
  VALUES (v_src.factory_id, p_nam, btrim(p_code), btrim(p_name), p_effective_from, p_effective_to, 'draft',
          'Sao chép từ khung ' || v_src.name, auth.uid())
  RETURNING id INTO v_new;

  INSERT INTO tech_norm_version_items (factory_id, version_id, item_id, basis, unit, sort_order)
  SELECT factory_id, v_new, item_id, basis, unit, sort_order FROM tech_norm_version_items WHERE version_id = p_source_id;

  FOR v_row IN SELECT * FROM tech_norm_rows WHERE version_id = p_source_id ORDER BY sort_order, created_at LOOP
    INSERT INTO tech_norm_rows (factory_id, version_id, day_chuyen, csr_codes, nguon_codes, label, sort_order)
    VALUES (v_row.factory_id, v_new, v_row.day_chuyen, v_row.csr_codes, v_row.nguon_codes, v_row.label, v_row.sort_order)
    RETURNING id INTO v_new_row;
    v_row_map := v_row_map || jsonb_build_object(v_row.id::text, v_new_row::text);
  END LOOP;

  INSERT INTO tech_norm_matrix_values (factory_id, version_id, item_id, row_id, value, merge_key, note)
  SELECT v.factory_id, v_new, v.item_id,
         CASE WHEN v.row_id IS NULL THEN NULL ELSE (v_row_map ->> v.row_id::text)::uuid END,
         v.value, mk.new_key, v.note
  FROM tech_norm_matrix_values v
  LEFT JOIN (
    SELECT k AS old_key, gen_random_uuid() AS new_key
    FROM (SELECT DISTINCT merge_key AS k FROM tech_norm_matrix_values WHERE version_id = p_source_id AND merge_key IS NOT NULL) d
  ) mk ON mk.old_key = v.merge_key
  WHERE v.version_id = p_source_id;

  RETURN v_new;
END $$;

GRANT EXECUTE ON FUNCTION tech_norm_copy_version(UUID, TEXT, TEXT, INTEGER, DATE, DATE) TO authenticated;

-- ── 5. Quyền ────────────────────────────────────────────────────────────────
INSERT INTO permissions (code, module_name, action_name) VALUES
  ('norms.view', 'norms', 'view'),
  ('norms.manage_config', 'norms', 'manage_config'),
  ('norms.approve', 'norms', 'approve'),
  ('norms.periodic_entry', 'norms', 'periodic_entry'),
  ('norms.report', 'norms', 'report')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role, permission_code)
SELECT 'admin', c FROM unnest(ARRAY['norms.view','norms.manage_config','norms.approve','norms.periodic_entry','norms.report']) c
ON CONFLICT DO NOTHING;

-- ── 6. Seed: danh mục chỉ tiêu + khung "Định mức KTKT 2026" (Nháp) cho mọi nhà máy ──
DO $$
DECLARE
  f RECORD;
  p TEXT;
  v_ver UUID;
  it RECORD;
  v_row UUID;
  rw RECORD;
  mk_nuoc JSONB := '{}'::jsonb;
  mk_tap JSONB := '{}'::jsonb;
  k TEXT;
BEGIN
  FOR f IN SELECT id, prefix FROM factories LOOP
    p := coalesce(nullif(upper(btrim(f.prefix)), ''), 'CSR');
    IF p NOT IN ('CSR','SVR') THEN p := 'CSR'; END IF;

    -- Danh mục chỉ tiêu (mã kho chỉ gắn khi tồn tại trong inventory_items của nhà máy).
    INSERT INTO tech_norm_items (factory_id, code, name, norm_group, actual_source, inventory_item_ids, vehicle_types, sort_order)
    SELECT f.id, s.code, s.name, s.grp, s.src,
           coalesce((SELECT array_agg(i.id ORDER BY i.code) FROM inventory_items i
                     WHERE i.factory_id = f.id
                       AND (i.code = ANY (s.inv) OR (s.inv_like IS NOT NULL AND i.code LIKE s.inv_like))), '{}'),
           s.veh, s.ord
    FROM (VALUES
      ('DAU_CS',        'Dầu cao su (Dầu CS)', 'hoa_chat',    'kho',     ARRAY['DCS'],    NULL, '{}'::TEXT[], 10),
      ('FORMIC',        'Axit Formic',         'hoa_chat',    'kho',     ARRAY['AF'],     NULL, '{}', 20),
      ('NH3',           'NH3 (Amoniac)',       'hoa_chat',    'kho',     ARRAY['AM'],     NULL, '{}', 30),
      ('HAS',           'HAS',                 'hoa_chat',    'kho',     ARRAY['HAS'],    NULL, '{}', 40),
      ('LP152',         'LP152',               'hoa_chat',    'kho',     ARRAY['LP152'],  NULL, '{}', 50),
      ('META',          'Meta',                'hoa_chat',    'kho',     ARRAY['MT'],     NULL, '{}', 60),
      ('SUT',           'Sút',                 'hoa_chat',    'kho',     ARRAY['NA'],     NULL, '{}', 70),
      ('THAM_TRONG',    'Thảm trong',          'vat_tu',      'kho',     ARRAY['TT'],     NULL, '{}', 80),
      ('BOC_004',       'Bọc 0,04',            'vat_tu',      'kho',     ARRAY[]::TEXT[], 'B004%', '{}', 90),
      ('BOC_013',       'Bọc 0,13',            'vat_tu',      'kho',     ARRAY[]::TEXT[], NULL, '{}', 100),
      ('XE_NANG',       'Dầu xe nâng',         'dau_nhot_mo', 'kho',     ARRAY['DON'],    NULL, '{}', 110),
      ('XE_XUC',        'Dầu xe xúc',          'dau_nhot_mo', 'kho',     ARRAY['DOXU12'], NULL, '{}', 120),
      ('NHOT_50',       'Nhớt 50',             'dau_nhot_mo', 'kho',     ARRAY['N50'],    NULL, '{}', 130),
      ('NHOT_68',       'Nhớt 68',             'dau_nhot_mo', 'kho',     ARRAY['N68'],    NULL, '{}', 140),
      ('NHOT_90',       'Nhớt 90',             'dau_nhot_mo', 'kho',     ARRAY['N90'],    NULL, '{}', 150),
      ('MO_THUONG',     'Mỡ thường',           'dau_nhot_mo', 'kho',     ARRAY['MOTH'],   NULL, '{}', 160),
      ('MO_CHIU_NHIET', 'Mỡ chịu nhiệt',       'dau_nhot_mo', 'kho',     ARRAY['MOCN'],   NULL, '{}', 170),
      ('DIEN',          'Điện',                'dien_nuoc',   'dong_ho', ARRAY[]::TEXT[], NULL, '{}', 180),
      ('NUOC',          'Nước',                'dien_nuoc',   'dong_ho', ARRAY[]::TEXT[], NULL, '{}', 190),
      ('DAU_COZON_VC',  'Dầu xe Cozon vận chuyển', 'van_chuyen', 'kho',  ARRAY['DOCZVC'], NULL, ARRAY['Cozon vận chuyển'], 200),
      ('DAU_ISUZU_VC',  'Dầu xe Isuzu vận chuyển', 'van_chuyen', 'kho',  ARRAY['DOX'],    NULL, ARRAY['Isuzu vận chuyển'], 210),
      ('DAU_COZON_NB',  'Dầu xe Cozon nội bộ',     'van_chuyen', 'kho',  ARRAY['DOCZNB'], NULL, ARRAY['Cozon nội bộ'], 220)
    ) AS s(code, name, grp, src, inv, inv_like, veh, ord)
    ON CONFLICT (factory_id, code) DO NOTHING;

    IF EXISTS (SELECT 1 FROM tech_norm_versions WHERE factory_id = f.id AND code = 'DM2026') THEN
      CONTINUE;
    END IF;

    INSERT INTO tech_norm_versions (factory_id, nam, code, name, effective_from, status, ghi_chu)
    VALUES (f.id, 2026, 'DM2026', 'Định mức KTKT 2026', DATE '2026-01-01', 'draft',
            'Nạp sẵn theo dinh_muc_2026.pdf (không tách nguồn — số chép vào cả NT và TM). Kiểm tra rồi bấm Áp dụng.')
    RETURNING id INTO v_ver;

    -- Cột của khung
    FOR it IN SELECT id, code, norm_group, sort_order FROM tech_norm_items WHERE factory_id = f.id LOOP
      INSERT INTO tech_norm_version_items (factory_id, version_id, item_id, basis, unit, sort_order)
      VALUES (f.id, v_ver, it.id,
              CASE WHEN it.norm_group = 'van_chuyen' THEN 'km100' ELSE 'tan_tp' END,
              CASE WHEN it.code IN ('XE_NANG','XE_XUC','NHOT_50','NHOT_68','NHOT_90','DAU_COZON_VC','DAU_ISUZU_VC','DAU_COZON_NB') THEN 'lit'
                   WHEN it.code = 'DIEN' THEN 'kwh'
                   WHEN it.code = 'NUOC' THEN 'm3'
                   ELSE 'kg' END,
              it.sort_order);
    END LOOP;

    -- Khoá gộp ô dùng chung theo dây chuyền
    mk_nuoc := jsonb_build_object('XE_NANG', gen_random_uuid(), 'DIEN', gen_random_uuid(), 'NUOC', gen_random_uuid());
    mk_tap := jsonb_build_object('XE_NANG', gen_random_uuid(), 'XE_XUC', gen_random_uuid(), 'NHOT_50', gen_random_uuid(),
      'NHOT_68', gen_random_uuid(), 'NHOT_90', gen_random_uuid(), 'MO_THUONG', gen_random_uuid(),
      'MO_CHIU_NHIET', gen_random_uuid(), 'DIEN', gen_random_uuid(), 'NUOC', gen_random_uuid());

    FOR rw IN SELECT * FROM (VALUES
      ('Mủ nước', ARRAY[p||'L', p||'3L', p||'5'], ARRAY['cong_ty','gia_cong'], 'L, 3L, 5 NT', 10, 'LL'),
      ('Mủ nước', ARRAY[p||'L', p||'3L', p||'5'], ARRAY['thu_mua'],            'L, 3L, 5 TM', 20, 'LL'),
      ('Mủ nước', ARRAY[p||'CV50'],              ARRAY['cong_ty','gia_cong'], 'CV50 NT',     30, 'CV50'),
      ('Mủ nước', ARRAY[p||'CV50'],              ARRAY['thu_mua'],            'CV50 TM',     40, 'CV50'),
      ('Mủ nước', ARRAY[p||'CV60'],              ARRAY['cong_ty','gia_cong'], 'CV60 NT',     50, 'CV60'),
      ('Mủ nước', ARRAY[p||'CV60'],              ARRAY['thu_mua'],            'CV60 TM',     60, 'CV60'),
      ('Mủ tạp',  ARRAY[p||'10', p||'20'],       ARRAY['cong_ty','gia_cong'], '10, 20 NT',   70, 'TAP'),
      ('Mủ tạp',  ARRAY[p||'10', p||'20'],       ARRAY['thu_mua'],            '10, 20 TM',   80, 'TAP')
    ) AS x(dc, csr, ng, lbl, ord, kind) LOOP
      INSERT INTO tech_norm_rows (factory_id, version_id, day_chuyen, csr_codes, nguon_codes, label, sort_order)
      VALUES (f.id, v_ver, rw.dc, rw.csr, rw.ng, rw.lbl, rw.ord)
      RETURNING id INTO v_row;

      INSERT INTO tech_norm_matrix_values (factory_id, version_id, item_id, row_id, value, merge_key)
      SELECT f.id, v_ver, i.id, v_row, s.val,
             CASE WHEN rw.dc = 'Mủ nước' THEN (mk_nuoc ->> s.code)::uuid ELSE (mk_tap ->> s.code)::uuid END
      FROM (
        SELECT * FROM (VALUES
          ('CV50','DAU_CS',0.1),('CV50','FORMIC',8.2),('CV50','NH3',9.5),('CV50','HAS',1.5),('CV50','LP152',0.18),
          ('CV50','META',0.1),('CV50','SUT',0.1),('CV50','THAM_TRONG',1.9),('CV50','BOC_004',1.9),('CV50','BOC_013',4.5),
          ('CV60','DAU_CS',0.1),('CV60','FORMIC',8.2),('CV60','NH3',9.5),('CV60','HAS',1.5),('CV60','LP152',0.1),
          ('CV60','META',0.1),('CV60','SUT',0.1),('CV60','THAM_TRONG',1.9),('CV60','BOC_004',1.9),('CV60','BOC_013',4.5),
          ('NUOC_LINE','XE_NANG',1.2),('NUOC_LINE','DIEN',95),('NUOC_LINE','NUOC',11),
          ('TAP','DAU_CS',0.1),('TAP','SUT',0.1),('TAP','THAM_TRONG',1.2),('TAP','BOC_004',2),('TAP','BOC_013',4.5),
          ('TAP','XE_NANG',0.45),('TAP','XE_XUC',1.3),('TAP','NHOT_50',0.2),('TAP','NHOT_68',0.2),('TAP','NHOT_90',0.2),
          ('TAP','MO_THUONG',0.01),('TAP','MO_CHIU_NHIET',0.003),('TAP','DIEN',160),('TAP','NUOC',16)
        ) AS v(kind, code, val)
      ) s
      JOIN tech_norm_items i ON i.factory_id = f.id AND i.code = s.code
      WHERE s.kind = rw.kind OR (s.kind = 'NUOC_LINE' AND rw.dc = 'Mủ nước');
    END LOOP;

    -- Định mức theo 100 km (không gắn dòng)
    INSERT INTO tech_norm_matrix_values (factory_id, version_id, item_id, row_id, value)
    SELECT f.id, v_ver, i.id, NULL, s.val
    FROM (VALUES ('DAU_COZON_VC', 26), ('DAU_ISUZU_VC', 28)) AS s(code, val)
    JOIN tech_norm_items i ON i.factory_id = f.id AND i.code = s.code;
  END LOOP;
END $$;

COMMIT;

-- Kiểm tra:
-- SELECT f.code, v.name, v.status, (SELECT count(*) FROM tech_norm_rows r WHERE r.version_id = v.id) AS so_dong,
--        (SELECT count(*) FROM tech_norm_matrix_values m WHERE m.version_id = v.id) AS so_o
-- FROM tech_norm_versions v JOIN factories f ON f.id = v.factory_id;
-- SELECT code, name, cardinality(inventory_item_ids) AS so_ma_kho FROM tech_norm_items ORDER BY factory_id, sort_order;
