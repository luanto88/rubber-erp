-- 2026-11-12 — Định mức KTKT GĐ4 "Báo cáo kỳ + ký số" (rule 30, plan pasted-content-id-0e08…).
--
--   tech_norm_report_templates  sổ đăng ký mẫu: Mẫu 8A-NMCB (kết quả sản xuất tháng, mẫu 54-BC) và Mẫu 09-NMCB (điện nước,
--                               mẫu 51-BC). kieu: thang_8a | dong_ho. config JSON (8A: thanhPhan, xlntItemCodes).
--                               Báo cáo theo ngày VT HC / dầu (mẫu 55, 46) KHÔNG thuộc module này — tab Báo cáo của Kho vật tư.
--                               khoa_ngay = true ⇒ báo cáo Chờ ký / Đã ký khoá ngày nhập liệu của kỳ (chỉ 8A, 09 — đã chốt).
--   tech_norm_report_batches    1 "bộ báo cáo kỳ": kỳ [tu_ngay, den_ngay] + bộ lọc NL + kỳ đồng hồ + snapshot JSON dùng chung.
--   tech_norm_reports           1 chứng từ / mẫu tick: số báo cáo (chung dãy Văn bản nội bộ BC-NMCB theo năm), trạng thái,
--                               giải trình dòng vượt, kiến nghị, yeu_cau_ky_id hoặc van_ban_document_id (ký nhiều bước).
--   tech_norm_report_reserve_number()  cấp số (service role) = max(Văn bản BC-NMCB năm, báo cáo định mức) + 1, chặn trùng.
--   tech_norm_entry_locked()    thay STUB GĐ2: ngày nằm trong [khoa_tu, khoa_den] của báo cáo khoa_ngay đang Chờ ký / Đã ký.
-- Ghi: mẫu = norms.manage_config; bộ / báo cáo = norms.report (chỉ khi Nháp / Trả về). Chuyển trạng thái ký qua API service role.
-- Chạy TAY trên Supabase SQL Editor, SAU 20261123. Idempotent.

BEGIN;

-- ── 1. Bảng ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tech_norm_report_templates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id   UUID NOT NULL REFERENCES factories(id),
  code         TEXT NOT NULL,
  name         TEXT NOT NULL,
  kieu         TEXT NOT NULL CHECK (kieu IN ('thang_8a','dong_ho')),
  config       JSONB NOT NULL DEFAULT '{}'::jsonb,
  phong_ban    TEXT NOT NULL DEFAULT 'NMCB',
  loai_van_ban TEXT NOT NULL DEFAULT 'BC',
  khoa_ngay    BOOLEAN NOT NULL DEFAULT false,
  phien_ban    INTEGER NOT NULL DEFAULT 1,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  sort_order   INTEGER NOT NULL DEFAULT 100,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (factory_id, code)
);

CREATE TABLE IF NOT EXISTS tech_norm_report_batches (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id   UUID NOT NULL REFERENCES factories(id),
  tu_ngay      DATE NOT NULL,
  den_ngay     DATE NOT NULL,
  materials    TEXT[] NOT NULL DEFAULT '{}',
  notes        TEXT[] NOT NULL DEFAULT '{}',
  meter_from   DATE,
  meter_to     DATE,
  snapshot     JSONB NOT NULL DEFAULT '{}'::jsonb,
  du_lieu_hash TEXT,
  created_by   UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (den_ngay >= tu_ngay)
);
CREATE INDEX IF NOT EXISTS idx_tech_norm_report_batches_factory ON tech_norm_report_batches (factory_id, tu_ngay DESC);

CREATE TABLE IF NOT EXISTS tech_norm_reports (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id          UUID NOT NULL REFERENCES factories(id),
  batch_id            UUID NOT NULL REFERENCES tech_norm_report_batches(id) ON DELETE CASCADE,
  template_id         UUID REFERENCES tech_norm_report_templates(id) ON DELETE SET NULL,
  template_code       TEXT NOT NULL,
  template_name       TEXT NOT NULL,
  template_kieu       TEXT NOT NULL CHECK (template_kieu IN ('thang_8a','dong_ho')),
  template_phien_ban  INTEGER NOT NULL DEFAULT 1,
  config              JSONB NOT NULL DEFAULT '{}'::jsonb,
  khoa_ngay           BOOLEAN NOT NULL DEFAULT false,
  phong_ban           TEXT NOT NULL DEFAULT 'NMCB',
  loai_van_ban        TEXT NOT NULL DEFAULT 'BC',
  nam                 INTEGER,
  so                  INTEGER,
  ma_bao_cao          TEXT,
  trang_thai          TEXT NOT NULL DEFAULT 'nhap' CHECK (trang_thai IN ('nhap','cho_ky','da_ky','tra_ve','huy')),
  giai_trinh          JSONB NOT NULL DEFAULT '{}'::jsonb,
  kien_nghi           TEXT,
  nguoi_lap_id        UUID REFERENCES auth.users(id),
  bgd_id              UUID REFERENCES auth.users(id),
  yeu_cau_ky_id       UUID,
  van_ban_document_id UUID,
  du_lieu_hash        TEXT,
  khoa_tu             DATE,
  khoa_den            DATE,
  gui_ky_luc          TIMESTAMPTZ,
  da_ky_luc           TIMESTAMPTZ,
  ly_do_huy           TEXT,
  created_by          UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tech_norm_reports_factory ON tech_norm_reports (factory_id, trang_thai);
CREATE INDEX IF NOT EXISTS idx_tech_norm_reports_batch ON tech_norm_reports (batch_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_tech_norm_reports_ma ON tech_norm_reports (factory_id, ma_bao_cao)
  WHERE ma_bao_cao IS NOT NULL AND trang_thai <> 'huy';

-- ── 2. Trigger ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_tech_norm_report_templates_touch ON tech_norm_report_templates;
CREATE TRIGGER trg_tech_norm_report_templates_touch BEFORE UPDATE ON tech_norm_report_templates
  FOR EACH ROW EXECUTE FUNCTION tech_norm_touch_updated_at();
DROP TRIGGER IF EXISTS trg_tech_norm_report_batches_touch ON tech_norm_report_batches;
CREATE TRIGGER trg_tech_norm_report_batches_touch BEFORE UPDATE ON tech_norm_report_batches
  FOR EACH ROW EXECUTE FUNCTION tech_norm_touch_updated_at();
DROP TRIGGER IF EXISTS trg_tech_norm_reports_touch ON tech_norm_reports;
CREATE TRIGGER trg_tech_norm_reports_touch BEFORE UPDATE ON tech_norm_reports
  FOR EACH ROW EXECUTE FUNCTION tech_norm_touch_updated_at();

-- Đổi cấu hình mẫu ⇒ tăng phiên bản (báo cáo đã lập giữ bản chụp config + phien_ban cũ).
CREATE OR REPLACE FUNCTION tech_norm_report_template_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.config IS DISTINCT FROM OLD.config OR NEW.kieu IS DISTINCT FROM OLD.kieu THEN
    NEW.phien_ban := OLD.phien_ban + 1;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tech_norm_report_template_version ON tech_norm_report_templates;
CREATE TRIGGER trg_tech_norm_report_template_version BEFORE UPDATE ON tech_norm_report_templates
  FOR EACH ROW EXECUTE FUNCTION tech_norm_report_template_version();

-- Khoá ngày nhập liệu theo báo cáo đang ký / đã ký (giữ chữ ký hàm ⇒ trigger GĐ2 / GĐ3b tự dùng).
CREATE OR REPLACE FUNCTION tech_norm_entry_locked(p_factory_id UUID, p_ngay DATE) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM tech_norm_reports r
    WHERE r.factory_id = p_factory_id
      AND r.khoa_ngay
      AND r.trang_thai IN ('cho_ky','da_ky')
      AND r.khoa_tu IS NOT NULL AND r.khoa_den IS NOT NULL
      AND p_ngay BETWEEN r.khoa_tu AND r.khoa_den
  )
$$;
GRANT EXECUTE ON FUNCTION tech_norm_entry_locked(UUID, DATE) TO authenticated;

-- Cấp số báo cáo theo dãy Văn bản nội bộ (loại, phòng ban, năm). p_so ≠ NULL ⇒ số nhập tay (chặn trùng).
CREATE OR REPLACE FUNCTION tech_norm_report_reserve_number(p_report_id UUID, p_so INTEGER DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_r tech_norm_reports%ROWTYPE;
  v_nam INTEGER;
  v_ky_hieu TEXT;
  v_max INTEGER := 0;
  v_so INTEGER;
  v_ma TEXT;
BEGIN
  SELECT * INTO v_r FROM tech_norm_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy báo cáo.'; END IF;
  -- Đã có số và không yêu cầu đổi ⇒ giữ nguyên (gửi lại sau Trả về).
  IF v_r.ma_bao_cao IS NOT NULL AND (p_so IS NULL OR p_so = v_r.so) THEN RETURN v_r.ma_bao_cao; END IF;

  v_nam := extract(year FROM (now() AT TIME ZONE 'Asia/Ho_Chi_Minh'))::int;
  PERFORM pg_advisory_xact_lock(hashtext('vanban-so|' || v_r.factory_id::text || '|' || v_r.loai_van_ban || '|' || v_r.phong_ban || '|' || v_nam));

  SELECT coalesce(nullif(t.ky_hieu, ''), v_r.loai_van_ban) INTO v_ky_hieu FROM van_ban_document_types t WHERE t.code = v_r.loai_van_ban;
  v_ky_hieu := coalesce(v_ky_hieu, v_r.loai_van_ban);

  SELECT coalesce(max((substring(d.so_van_ban FROM '^(\d+)'))::int), 0) INTO v_max
  FROM van_ban_documents d
  WHERE d.factory_id = v_r.factory_id AND d.loai_van_ban = v_r.loai_van_ban AND d.phong_ban = v_r.phong_ban AND d.nam = v_nam
    AND d.so_van_ban ~ '^\d+';
  SELECT greatest(v_max, coalesce(max(r.so), 0)) INTO v_max
  FROM tech_norm_reports r
  WHERE r.factory_id = v_r.factory_id AND r.loai_van_ban = v_r.loai_van_ban AND r.phong_ban = v_r.phong_ban AND r.nam = v_nam
    AND r.trang_thai <> 'huy' AND r.id <> v_r.id;

  v_so := coalesce(p_so, v_max + 1);
  IF v_so < 1 THEN RAISE EXCEPTION 'Số báo cáo không hợp lệ.'; END IF;
  v_ma := lpad(v_so::text, 2, '0') || '/' || v_ky_hieu || '-' || v_r.phong_ban;

  IF EXISTS (SELECT 1 FROM van_ban_documents d WHERE d.factory_id = v_r.factory_id AND d.ma_van_ban = v_ma AND d.nam = v_nam
             AND (v_r.van_ban_document_id IS NULL OR d.id <> v_r.van_ban_document_id))
     OR EXISTS (SELECT 1 FROM tech_norm_reports r WHERE r.factory_id = v_r.factory_id AND r.ma_bao_cao = v_ma AND r.nam = v_nam
                AND r.trang_thai <> 'huy' AND r.id <> v_r.id) THEN
    RAISE EXCEPTION 'NORM_REPORT_NUMBER_TAKEN: Số % đã được dùng (Văn bản nội bộ hoặc báo cáo định mức khác).', v_ma;
  END IF;

  UPDATE tech_norm_reports SET nam = v_nam, so = v_so, ma_bao_cao = v_ma WHERE id = v_r.id;
  RETURN v_ma;
END $$;
REVOKE EXECUTE ON FUNCTION tech_norm_report_reserve_number(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tech_norm_report_reserve_number(UUID, INTEGER) TO service_role;

-- Số đã dùng bởi báo cáo định mức (cho module Văn bản nội bộ gợi ý số / chặn trùng — người không có norms.view
-- cũng phải thấy, nên SECURITY DEFINER; chỉ trả số, không lộ nội dung). Nhà máy lấy theo người gọi.
CREATE OR REPLACE FUNCTION tech_norm_report_used_numbers(p_loai TEXT, p_phong_ban TEXT, p_nam INTEGER)
RETURNS TABLE (so INTEGER, ma_bao_cao TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.so, r.ma_bao_cao FROM tech_norm_reports r
  WHERE r.factory_id = current_profile_factory_id()
    AND (p_loai IS NULL OR r.loai_van_ban = p_loai) AND r.phong_ban = p_phong_ban AND r.nam = p_nam
    AND r.so IS NOT NULL AND r.trang_thai <> 'huy'
    -- Báo cáo ký qua Văn bản nội bộ đã có dòng van_ban_documents cùng số — không đếm 2 lần.
$$;
GRANT EXECUTE ON FUNCTION tech_norm_report_used_numbers(TEXT, TEXT, INTEGER) TO authenticated;

-- ── 3. RLS (không FOR ALL) ──────────────────────────────────────────────────

ALTER TABLE tech_norm_report_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE tech_norm_report_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE tech_norm_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tech_norm_report_templates_select ON tech_norm_report_templates;
CREATE POLICY tech_norm_report_templates_select ON tech_norm_report_templates FOR SELECT TO authenticated
  USING (factory_id = current_profile_factory_id() AND current_profile_has_permission('norms.view'));
DROP POLICY IF EXISTS tech_norm_report_templates_insert ON tech_norm_report_templates;
CREATE POLICY tech_norm_report_templates_insert ON tech_norm_report_templates FOR INSERT TO authenticated
  WITH CHECK (factory_id = current_profile_factory_id() AND current_profile_has_permission('norms.manage_config'));
DROP POLICY IF EXISTS tech_norm_report_templates_update ON tech_norm_report_templates;
CREATE POLICY tech_norm_report_templates_update ON tech_norm_report_templates FOR UPDATE TO authenticated
  USING (factory_id = current_profile_factory_id() AND current_profile_has_permission('norms.manage_config'))
  WITH CHECK (factory_id = current_profile_factory_id());
DROP POLICY IF EXISTS tech_norm_report_templates_delete ON tech_norm_report_templates;
CREATE POLICY tech_norm_report_templates_delete ON tech_norm_report_templates FOR DELETE TO authenticated
  USING (factory_id = current_profile_factory_id() AND current_profile_has_permission('norms.manage_config'));

DROP POLICY IF EXISTS tech_norm_report_batches_select ON tech_norm_report_batches;
CREATE POLICY tech_norm_report_batches_select ON tech_norm_report_batches FOR SELECT TO authenticated
  USING (factory_id = current_profile_factory_id() AND current_profile_has_permission('norms.view'));
DROP POLICY IF EXISTS tech_norm_report_batches_insert ON tech_norm_report_batches;
CREATE POLICY tech_norm_report_batches_insert ON tech_norm_report_batches FOR INSERT TO authenticated
  WITH CHECK (factory_id = current_profile_factory_id() AND current_profile_has_permission('norms.report'));
DROP POLICY IF EXISTS tech_norm_report_batches_update ON tech_norm_report_batches;
CREATE POLICY tech_norm_report_batches_update ON tech_norm_report_batches FOR UPDATE TO authenticated
  USING (factory_id = current_profile_factory_id() AND current_profile_has_permission('norms.report')
         AND NOT EXISTS (SELECT 1 FROM tech_norm_reports r WHERE r.batch_id = tech_norm_report_batches.id AND r.trang_thai IN ('cho_ky','da_ky')))
  WITH CHECK (factory_id = current_profile_factory_id());
DROP POLICY IF EXISTS tech_norm_report_batches_delete ON tech_norm_report_batches;
CREATE POLICY tech_norm_report_batches_delete ON tech_norm_report_batches FOR DELETE TO authenticated
  USING (factory_id = current_profile_factory_id() AND current_profile_has_permission('norms.report')
         AND NOT EXISTS (SELECT 1 FROM tech_norm_reports r WHERE r.batch_id = tech_norm_report_batches.id AND r.trang_thai <> 'nhap'));

DROP POLICY IF EXISTS tech_norm_reports_select ON tech_norm_reports;
CREATE POLICY tech_norm_reports_select ON tech_norm_reports FOR SELECT TO authenticated
  USING (factory_id = current_profile_factory_id() AND current_profile_has_permission('norms.view'));
DROP POLICY IF EXISTS tech_norm_reports_insert ON tech_norm_reports;
CREATE POLICY tech_norm_reports_insert ON tech_norm_reports FOR INSERT TO authenticated
  WITH CHECK (factory_id = current_profile_factory_id() AND current_profile_has_permission('norms.report') AND trang_thai = 'nhap');
DROP POLICY IF EXISTS tech_norm_reports_update ON tech_norm_reports;
CREATE POLICY tech_norm_reports_update ON tech_norm_reports FOR UPDATE TO authenticated
  USING (factory_id = current_profile_factory_id() AND current_profile_has_permission('norms.report') AND trang_thai IN ('nhap','tra_ve'))
  WITH CHECK (factory_id = current_profile_factory_id() AND trang_thai IN ('nhap','tra_ve'));
DROP POLICY IF EXISTS tech_norm_reports_delete ON tech_norm_reports;
CREATE POLICY tech_norm_reports_delete ON tech_norm_reports FOR DELETE TO authenticated
  USING (factory_id = current_profile_factory_id() AND current_profile_has_permission('norms.report') AND trang_thai = 'nhap');

-- ── 4. Seed 2 mẫu (nhà máy phuochoa_kt, chỉ khi chưa có mẫu nào) ──────────────

DO $$
DECLARE f RECORD;
BEGIN
  FOR f IN SELECT id FROM factories WHERE code = 'phuochoa_kt' LOOP
    IF EXISTS (SELECT 1 FROM tech_norm_report_templates WHERE factory_id = f.id) THEN CONTINUE; END IF;
    INSERT INTO tech_norm_report_templates (factory_id, code, name, kieu, khoa_ngay, sort_order, config) VALUES
      (f.id, 'Mẫu 8A-NMCB', 'Báo cáo kết quả sản xuất tháng', 'thang_8a', true, 10, '{"thanhPhan":"","xlntItemCodes":[]}'::jsonb),
      (f.id, 'Mẫu 09-NMCB', 'Báo cáo tổng hợp điện - nước tiêu thụ', 'dong_ho', true, 20, '{}'::jsonb);
  END LOOP;
END $$;

COMMIT;
