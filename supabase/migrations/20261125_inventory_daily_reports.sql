-- 2026-11-15 — Kho vật tư → Báo cáo → "Sử dụng theo ngày" (mẫu 55-BC VT HC, 46-BC Mẫu 12B dầu) + ký số 2 người
-- + bảng xuất kho lịch sử (file NXT cũ 01/01–25/07/2026). Rule 13, plan c-claude-md-rule-29-hazy-mitten.md.
--
--   inventory_daily_report_templates  mẫu theo nhà máy. kieu: vt_hc (55) | dau_12b (46). config JSON:
--       { tieuDe, maMau, nhanLap, chucVuLap, hideZero, columns: [{ label, subLabel, itemIds[] }] }
--       cột = 1 hoặc nhiều vật tư (theo inventory_items.id) — người dùng tick chọn trong Kho.
--   inventory_daily_reports           1 báo cáo / mẫu / kỳ: snapshot JSON (ngày × cột), hash, số BC-NMCB (chung dãy Văn bản
--                                     nội bộ + báo cáo định mức), trạng thái nhap|cho_ky|da_ky|tra_ve|huy, yeu_cau_ky_id.
--   inventory_legacy_movements        xuất/nhập kho LỊCH SỬ (trước khi dùng app) — CHỈ cho báo cáo, không đụng tồn/thẻ kho.
--   tech_norm_report_reserve_number / tech_norm_report_used_numbers  CREATE OR REPLACE: tính cả số của báo cáo kho.
--   inventory_daily_report_reserve_number()  cấp số cho báo cáo kho (service role).
-- Quyền mới: inventory.daily_report (xem / lập / gửi ký). Sửa mẫu: inventory.settings.
-- Chạy TAY trên Supabase SQL Editor, SAU 20261124. Idempotent.

BEGIN;

-- ── 1. Bảng ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inventory_daily_report_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id  UUID NOT NULL REFERENCES factories(id),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  kieu        TEXT NOT NULL CHECK (kieu IN ('vt_hc','dau_12b')),
  config      JSONB NOT NULL DEFAULT '{}'::jsonb,
  phien_ban   INTEGER NOT NULL DEFAULT 1,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (factory_id, code)
);

CREATE TABLE IF NOT EXISTS inventory_daily_reports (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id          UUID NOT NULL REFERENCES factories(id),
  template_id         UUID REFERENCES inventory_daily_report_templates(id) ON DELETE SET NULL,
  template_code       TEXT NOT NULL,
  template_name       TEXT NOT NULL,
  template_kieu       TEXT NOT NULL CHECK (template_kieu IN ('vt_hc','dau_12b')),
  template_phien_ban  INTEGER NOT NULL DEFAULT 1,
  config              JSONB NOT NULL DEFAULT '{}'::jsonb,
  tu_ngay             DATE NOT NULL,
  den_ngay            DATE NOT NULL,
  snapshot            JSONB NOT NULL DEFAULT '{}'::jsonb,
  du_lieu_hash        TEXT,
  phong_ban           TEXT NOT NULL DEFAULT 'NMCB',
  loai_van_ban        TEXT NOT NULL DEFAULT 'BC',
  nam                 INTEGER,
  so                  INTEGER,
  ma_bao_cao          TEXT,
  trang_thai          TEXT NOT NULL DEFAULT 'nhap' CHECK (trang_thai IN ('nhap','cho_ky','da_ky','tra_ve','huy')),
  nguoi_lap_id        UUID REFERENCES auth.users(id),
  bgd_id              UUID REFERENCES auth.users(id),
  yeu_cau_ky_id       UUID,
  gui_ky_luc          TIMESTAMPTZ,
  da_ky_luc           TIMESTAMPTZ,
  ly_do_huy           TEXT,
  created_by          UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (tu_ngay <= den_ngay)
);
CREATE INDEX IF NOT EXISTS idx_inventory_daily_reports_factory ON inventory_daily_reports (factory_id, trang_thai, tu_ngay);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_inventory_daily_reports_ma ON inventory_daily_reports (factory_id, ma_bao_cao)
  WHERE ma_bao_cao IS NOT NULL AND trang_thai <> 'huy';

CREATE TABLE IF NOT EXISTS inventory_legacy_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id      UUID NOT NULL REFERENCES factories(id),
  legacy_id       TEXT NOT NULL,
  ngay            DATE NOT NULL,
  item_id         UUID NOT NULL REFERENCES inventory_items(id),
  item_code       TEXT NOT NULL,
  movement_type   TEXT NOT NULL CHECK (movement_type IN ('import','export')),
  quantity        NUMERIC NOT NULL,
  ma_nx           TEXT,
  warehouse_name  TEXT,
  nguoi_nx        TEXT,
  ghi_chu         TEXT,
  source_file     TEXT,
  imported_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (factory_id, legacy_id)
);
CREATE INDEX IF NOT EXISTS idx_inventory_legacy_movements_day ON inventory_legacy_movements (factory_id, movement_type, ngay);

-- ── 2. Trigger ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION inventory_daily_report_touch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_inventory_daily_report_templates_touch ON inventory_daily_report_templates;
CREATE TRIGGER trg_inventory_daily_report_templates_touch BEFORE UPDATE ON inventory_daily_report_templates
  FOR EACH ROW EXECUTE FUNCTION inventory_daily_report_touch();
DROP TRIGGER IF EXISTS trg_inventory_daily_reports_touch ON inventory_daily_reports;
CREATE TRIGGER trg_inventory_daily_reports_touch BEFORE UPDATE ON inventory_daily_reports
  FOR EACH ROW EXECUTE FUNCTION inventory_daily_report_touch();

-- Đổi cấu hình mẫu ⇒ tăng phiên bản (báo cáo đã lập giữ bản chụp config).
CREATE OR REPLACE FUNCTION inventory_daily_report_template_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.config IS DISTINCT FROM OLD.config OR NEW.kieu IS DISTINCT FROM OLD.kieu THEN
    NEW.phien_ban := OLD.phien_ban + 1;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_inventory_daily_report_template_version ON inventory_daily_report_templates;
CREATE TRIGGER trg_inventory_daily_report_template_version BEFORE UPDATE ON inventory_daily_report_templates
  FOR EACH ROW EXECUTE FUNCTION inventory_daily_report_template_version();

-- ── 3. Số báo cáo: chung dãy BC-NMCB (Văn bản nội bộ + báo cáo định mức + báo cáo kho) ─────────

-- Max số đã dùng theo (nhà máy, loại, phòng ban, năm) trên CẢ 3 nguồn, trừ 1 bản ghi đang cấp số.
CREATE OR REPLACE FUNCTION report_number_max_used(p_factory UUID, p_loai TEXT, p_phong_ban TEXT, p_nam INTEGER, p_except UUID)
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT greatest(
    (SELECT coalesce(max((substring(d.so_van_ban FROM '^(\d+)'))::int), 0) FROM van_ban_documents d
      WHERE d.factory_id = p_factory AND d.loai_van_ban = p_loai AND d.phong_ban = p_phong_ban AND d.nam = p_nam AND d.so_van_ban ~ '^\d+'),
    (SELECT coalesce(max(r.so), 0) FROM tech_norm_reports r
      WHERE r.factory_id = p_factory AND r.loai_van_ban = p_loai AND r.phong_ban = p_phong_ban AND r.nam = p_nam
        AND r.trang_thai <> 'huy' AND r.id IS DISTINCT FROM p_except),
    (SELECT coalesce(max(i.so), 0) FROM inventory_daily_reports i
      WHERE i.factory_id = p_factory AND i.loai_van_ban = p_loai AND i.phong_ban = p_phong_ban AND i.nam = p_nam
        AND i.trang_thai <> 'huy' AND i.id IS DISTINCT FROM p_except)
  )
$$;
REVOKE EXECUTE ON FUNCTION report_number_max_used(UUID, TEXT, TEXT, INTEGER, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION report_number_max_used(UUID, TEXT, TEXT, INTEGER, UUID) TO service_role;

-- Số mã đã bị dùng ở 1 trong 3 nguồn?
CREATE OR REPLACE FUNCTION report_number_taken(p_factory UUID, p_ma TEXT, p_nam INTEGER, p_except UUID, p_except_van_ban UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM van_ban_documents d WHERE d.factory_id = p_factory AND d.ma_van_ban = p_ma AND d.nam = p_nam
                   AND d.id IS DISTINCT FROM p_except_van_ban)
      OR EXISTS (SELECT 1 FROM tech_norm_reports r WHERE r.factory_id = p_factory AND r.ma_bao_cao = p_ma AND r.nam = p_nam
                   AND r.trang_thai <> 'huy' AND r.id IS DISTINCT FROM p_except)
      OR EXISTS (SELECT 1 FROM inventory_daily_reports i WHERE i.factory_id = p_factory AND i.ma_bao_cao = p_ma AND i.nam = p_nam
                   AND i.trang_thai <> 'huy' AND i.id IS DISTINCT FROM p_except)
$$;
REVOKE EXECUTE ON FUNCTION report_number_taken(UUID, TEXT, INTEGER, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION report_number_taken(UUID, TEXT, INTEGER, UUID, UUID) TO service_role;

-- Báo cáo định mức (thay bản 20261124 — cùng chữ ký, nay tính cả báo cáo kho).
CREATE OR REPLACE FUNCTION tech_norm_report_reserve_number(p_report_id UUID, p_so INTEGER DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_r tech_norm_reports%ROWTYPE;
  v_nam INTEGER;
  v_ky_hieu TEXT;
  v_so INTEGER;
  v_ma TEXT;
BEGIN
  SELECT * INTO v_r FROM tech_norm_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy báo cáo.'; END IF;
  IF v_r.ma_bao_cao IS NOT NULL AND (p_so IS NULL OR p_so = v_r.so) THEN RETURN v_r.ma_bao_cao; END IF;

  v_nam := extract(year FROM (now() AT TIME ZONE 'Asia/Ho_Chi_Minh'))::int;
  PERFORM pg_advisory_xact_lock(hashtext('vanban-so|' || v_r.factory_id::text || '|' || v_r.loai_van_ban || '|' || v_r.phong_ban || '|' || v_nam));
  SELECT coalesce(nullif(t.ky_hieu, ''), v_r.loai_van_ban) INTO v_ky_hieu FROM van_ban_document_types t WHERE t.code = v_r.loai_van_ban;
  v_ky_hieu := coalesce(v_ky_hieu, v_r.loai_van_ban);

  v_so := coalesce(p_so, report_number_max_used(v_r.factory_id, v_r.loai_van_ban, v_r.phong_ban, v_nam, v_r.id) + 1);
  IF v_so < 1 THEN RAISE EXCEPTION 'Số báo cáo không hợp lệ.'; END IF;
  v_ma := lpad(v_so::text, 2, '0') || '/' || v_ky_hieu || '-' || v_r.phong_ban;
  IF report_number_taken(v_r.factory_id, v_ma, v_nam, v_r.id, v_r.van_ban_document_id) THEN
    RAISE EXCEPTION 'NORM_REPORT_NUMBER_TAKEN: Số % đã được dùng (Văn bản nội bộ hoặc báo cáo khác).', v_ma;
  END IF;
  UPDATE tech_norm_reports SET nam = v_nam, so = v_so, ma_bao_cao = v_ma WHERE id = v_r.id;
  RETURN v_ma;
END $$;
REVOKE EXECUTE ON FUNCTION tech_norm_report_reserve_number(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tech_norm_report_reserve_number(UUID, INTEGER) TO service_role;

-- Báo cáo kho.
CREATE OR REPLACE FUNCTION inventory_daily_report_reserve_number(p_report_id UUID, p_so INTEGER DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_r inventory_daily_reports%ROWTYPE;
  v_nam INTEGER;
  v_ky_hieu TEXT;
  v_so INTEGER;
  v_ma TEXT;
BEGIN
  SELECT * INTO v_r FROM inventory_daily_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy báo cáo.'; END IF;
  IF v_r.ma_bao_cao IS NOT NULL AND (p_so IS NULL OR p_so = v_r.so) THEN RETURN v_r.ma_bao_cao; END IF;

  v_nam := extract(year FROM (now() AT TIME ZONE 'Asia/Ho_Chi_Minh'))::int;
  PERFORM pg_advisory_xact_lock(hashtext('vanban-so|' || v_r.factory_id::text || '|' || v_r.loai_van_ban || '|' || v_r.phong_ban || '|' || v_nam));
  SELECT coalesce(nullif(t.ky_hieu, ''), v_r.loai_van_ban) INTO v_ky_hieu FROM van_ban_document_types t WHERE t.code = v_r.loai_van_ban;
  v_ky_hieu := coalesce(v_ky_hieu, v_r.loai_van_ban);

  v_so := coalesce(p_so, report_number_max_used(v_r.factory_id, v_r.loai_van_ban, v_r.phong_ban, v_nam, v_r.id) + 1);
  IF v_so < 1 THEN RAISE EXCEPTION 'Số báo cáo không hợp lệ.'; END IF;
  v_ma := lpad(v_so::text, 2, '0') || '/' || v_ky_hieu || '-' || v_r.phong_ban;
  IF report_number_taken(v_r.factory_id, v_ma, v_nam, v_r.id, NULL) THEN
    RAISE EXCEPTION 'INV_REPORT_NUMBER_TAKEN: Số % đã được dùng (Văn bản nội bộ hoặc báo cáo khác).', v_ma;
  END IF;
  UPDATE inventory_daily_reports SET nam = v_nam, so = v_so, ma_bao_cao = v_ma WHERE id = v_r.id;
  RETURN v_ma;
END $$;
REVOKE EXECUTE ON FUNCTION inventory_daily_report_reserve_number(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inventory_daily_report_reserve_number(UUID, INTEGER) TO service_role;

-- Số đã dùng cho module Văn bản nội bộ gợi ý / chặn trùng (cùng chữ ký bản 20261124, nay gộp cả báo cáo kho).
CREATE OR REPLACE FUNCTION tech_norm_report_used_numbers(p_loai TEXT, p_phong_ban TEXT, p_nam INTEGER)
RETURNS TABLE (so INTEGER, ma_bao_cao TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.so, r.ma_bao_cao FROM tech_norm_reports r
  WHERE r.factory_id = current_profile_factory_id()
    AND (p_loai IS NULL OR r.loai_van_ban = p_loai) AND r.phong_ban = p_phong_ban AND r.nam = p_nam
    AND r.so IS NOT NULL AND r.trang_thai <> 'huy'
  UNION ALL
  SELECT i.so, i.ma_bao_cao FROM inventory_daily_reports i
  WHERE i.factory_id = current_profile_factory_id()
    AND (p_loai IS NULL OR i.loai_van_ban = p_loai) AND i.phong_ban = p_phong_ban AND i.nam = p_nam
    AND i.so IS NOT NULL AND i.trang_thai <> 'huy'
$$;
GRANT EXECUTE ON FUNCTION tech_norm_report_used_numbers(TEXT, TEXT, INTEGER) TO authenticated;

-- ── 4. Quyền ────────────────────────────────────────────────────────────────

INSERT INTO permissions (code, module_name, action_name) VALUES
  ('inventory.daily_report', 'inventory', 'daily_report')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role, permission_code) VALUES ('admin', 'inventory.daily_report')
ON CONFLICT DO NOTHING;

-- ── 5. RLS (không FOR ALL) ──────────────────────────────────────────────────

ALTER TABLE inventory_daily_report_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_daily_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_legacy_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_daily_report_templates_select ON inventory_daily_report_templates;
CREATE POLICY inventory_daily_report_templates_select ON inventory_daily_report_templates FOR SELECT TO authenticated
  USING (factory_id = current_profile_factory_id() AND current_profile_has_permission('inventory.daily_report'));
DROP POLICY IF EXISTS inventory_daily_report_templates_insert ON inventory_daily_report_templates;
CREATE POLICY inventory_daily_report_templates_insert ON inventory_daily_report_templates FOR INSERT TO authenticated
  WITH CHECK (factory_id = current_profile_factory_id() AND current_profile_has_permission('inventory.settings'));
DROP POLICY IF EXISTS inventory_daily_report_templates_update ON inventory_daily_report_templates;
CREATE POLICY inventory_daily_report_templates_update ON inventory_daily_report_templates FOR UPDATE TO authenticated
  USING (factory_id = current_profile_factory_id() AND current_profile_has_permission('inventory.settings'))
  WITH CHECK (factory_id = current_profile_factory_id());
DROP POLICY IF EXISTS inventory_daily_report_templates_delete ON inventory_daily_report_templates;
CREATE POLICY inventory_daily_report_templates_delete ON inventory_daily_report_templates FOR DELETE TO authenticated
  USING (factory_id = current_profile_factory_id() AND current_profile_has_permission('inventory.settings')
         AND NOT EXISTS (SELECT 1 FROM inventory_daily_reports r WHERE r.template_id = inventory_daily_report_templates.id));

DROP POLICY IF EXISTS inventory_daily_reports_select ON inventory_daily_reports;
CREATE POLICY inventory_daily_reports_select ON inventory_daily_reports FOR SELECT TO authenticated
  USING (factory_id = current_profile_factory_id() AND current_profile_has_permission('inventory.daily_report'));
DROP POLICY IF EXISTS inventory_daily_reports_insert ON inventory_daily_reports;
CREATE POLICY inventory_daily_reports_insert ON inventory_daily_reports FOR INSERT TO authenticated
  WITH CHECK (factory_id = current_profile_factory_id() AND current_profile_has_permission('inventory.daily_report') AND trang_thai = 'nhap');
DROP POLICY IF EXISTS inventory_daily_reports_update ON inventory_daily_reports;
CREATE POLICY inventory_daily_reports_update ON inventory_daily_reports FOR UPDATE TO authenticated
  USING (factory_id = current_profile_factory_id() AND current_profile_has_permission('inventory.daily_report') AND trang_thai IN ('nhap','tra_ve'))
  WITH CHECK (factory_id = current_profile_factory_id() AND trang_thai IN ('nhap','tra_ve'));
DROP POLICY IF EXISTS inventory_daily_reports_delete ON inventory_daily_reports;
CREATE POLICY inventory_daily_reports_delete ON inventory_daily_reports FOR DELETE TO authenticated
  USING (factory_id = current_profile_factory_id() AND current_profile_has_permission('inventory.daily_report') AND trang_thai = 'nhap');

-- Lịch sử: chỉ đọc (ghi bằng script service role).
DROP POLICY IF EXISTS inventory_legacy_movements_select ON inventory_legacy_movements;
CREATE POLICY inventory_legacy_movements_select ON inventory_legacy_movements FOR SELECT TO authenticated
  USING (factory_id = current_profile_factory_id() AND current_profile_has_permission('inventory.view'));

-- ── 6. Seed 2 mẫu (nhà máy phuochoa_kt, chỉ khi chưa có mẫu nào). Cột = mã vật tư theo giấy tháng 10/2026. ──

DO $$
DECLARE
  f RECORD;
  v_cols JSONB; -- cột: mã không tồn tại thì bỏ (itemIds rỗng, người dùng tick lại)
BEGIN
  FOR f IN SELECT id FROM factories WHERE code = 'phuochoa_kt' LOOP
    IF EXISTS (SELECT 1 FROM inventory_daily_report_templates WHERE factory_id = f.id) THEN CONTINUE; END IF;

    SELECT jsonb_agg(jsonb_build_object('label', c.label, 'subLabel', c.sub, 'itemIds',
             coalesce((SELECT jsonb_agg(i.id ORDER BY i.code) FROM inventory_items i WHERE i.factory_id = f.id AND i.code = ANY(c.codes)), '[]'::jsonb))
             ORDER BY c.ord)
      INTO v_cols
    FROM (VALUES
      (1,  'Bọc PE 0.04mm', 'VRG CSR10', ARRAY['B004VC10']),
      (2,  'Thảm trong', '', ARRAY['TT']),
      (3,  'Acid Formic', '85%', ARRAY['AF']),
      (4,  'Dầu cao su', '', ARRAY['DCS']),
      (5,  'NaOH', '(sút vảy)', ARRAY['NA']),
      (6,  'Nhớt 50', '', ARRAY['N50']),
      (7,  'Nhớt PA 50', '', ARRAY['Nhớt Petro Appolo 50']),
      (8,  'Nhớt 68', '', ARRAY['N68']),
      (9,  'Nhớt 90', '', ARRAY['N90']),
      (10, 'Nhớt 140', '', ARRAY['N140']),
      (11, 'Nhớt 15W-40', '', ARRAY['N15W-40']),
      (12, 'Mỡ đa năng EP', 'Grease NLGI3', ARRAY['MONLGI3']),
      (13, 'Mỡ chịu nhiệt SKF', '', ARRAY['MOCN']),
      (14, 'Mỡ thường', '', ARRAY['MOTH'])
    ) AS c(ord, label, sub, codes);
    INSERT INTO inventory_daily_report_templates (factory_id, code, name, kieu, sort_order, config) VALUES
      (f.id, 'BC-VTHC', 'Báo cáo sử dụng vật tư hóa chất', 'vt_hc', 10,
       jsonb_build_object('tieuDe', 'BÁO CÁO SỬ DỤNG VẬT TƯ HÓA CHẤT TRONG SẢN XUẤT CHẾ BIẾN', 'maMau', '',
                          'nhanLap', 'LẬP BẢNG', 'chucVuLap', 'Nhân viên kỹ thuật', 'hideZero', false, 'columns', coalesce(v_cols, '[]'::jsonb)));

    SELECT jsonb_agg(jsonb_build_object('label', c.label, 'subLabel', c.sub, 'itemIds',
             coalesce((SELECT jsonb_agg(i.id ORDER BY i.code) FROM inventory_items i WHERE i.factory_id = f.id AND i.code = ANY(c.codes)), '[]'::jsonb))
             ORDER BY c.ord)
      INTO v_cols
    FROM (VALUES
      (1, 'Cấp xe vận chuyển', '(ISU và CZVC)', ARRAY['DOX','DOCZVC']),
      (2, 'Cấp xe xúc', '', ARRAY['DOXU12','DOXUNL']),
      (3, 'Cấp xe nâng', '', ARRAY['DON']),
      (4, 'Cấp xe Cozon nội bộ', '', ARRAY['DOCZNB']),
      (5, 'Cấp xe xúc Biomass', '', ARRAY['DOXU3']),
      (6, 'Xe văn phòng', '', ARRAY['DOFORD']),
      (7, 'Máy phát điện sinh hoạt', '', ARRAY['DOFAT']),
      (8, 'Vệ sinh trục cán', '', ARRAY['DOVS']),
      (9, 'Máy phát điện sản xuất', '', ARRAY['DO750K'])
    ) AS c(ord, label, sub, codes);
    INSERT INTO inventory_daily_report_templates (factory_id, code, name, kieu, sort_order, config) VALUES
      (f.id, 'BC-DAU-12B', 'Báo cáo sử dụng dầu', 'dau_12b', 20,
       jsonb_build_object('tieuDe', 'BÁO CÁO SỬ DỤNG DẦU TRONG SẢN XUẤT CHẾ BIẾN', 'maMau', 'Mẫu 12B-NMCB',
                          'nhanLap', 'LẬP BẢNG', 'chucVuLap', 'Nhân viên kỹ thuật', 'hideZero', false, 'columns', coalesce(v_cols, '[]'::jsonb)));
  END LOOP;
END $$;

COMMIT;
