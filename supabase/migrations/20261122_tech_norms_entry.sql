-- 2026-11-11 — Định mức KTKT GĐ2 "Nhập liệu theo ngày" (rule 30, plan dinh-muc-ktkt-2026-11-10.md).
--
--   tech_norm_meters            danh mục đồng hồ điện / nước / nước thải (ký hiệu ĐH-01…, hệ số nhân, khu vực in báo cáo).
--                               Tick "Dùng báo cáo định mức" (dung_dinh_muc) + gắn chỉ tiêu + dây chuyền + hiệu lực.
--   tech_norm_meter_readings    lần ghi chỉ số theo NGÀY (thường ngày 27 hằng tháng). Hệ số chụp vào từng lần ghi.
--                               Thay / reset đồng hồ: thay_dong_ho = true, chi_so_chot_cu = chỉ số cuối đồng hồ cũ,
--                               chi_so = chỉ số đầu (hoặc hiện tại) của đồng hồ mới.
--   tech_norm_floor_locations   danh mục vị trí kiểm kê tồn xưởng (bồn Formic, kho xưởng mủ tạp…).
--   tech_norm_floor_counts      kiểm kê tồn xưởng cuối NGÀY, chỉ cho chỉ tiêu tick kiem_ke_ton_xuong.
--   tech_norm_items.kiem_ke_ton_xuong  chỉ tiêu có kiểm kê ⇒ Thực tế = Tồn đầu + Xuất − Tồn cuối (GĐ3).
-- Khoá ngày: tech_norm_entry_locked() hiện là STUB (false). GĐ4 thay bằng kiểm báo cáo đã ký.
-- RLS: đọc = nhà máy + norms.view; lần ghi / kiểm kê ghi = norms.periodic_entry; danh mục ghi = norms.manage_config.
-- Chạy TAY trên Supabase SQL Editor, SAU 20261121. Idempotent.

BEGIN;

-- ── 1. Bảng ─────────────────────────────────────────────────────────────────

ALTER TABLE tech_norm_items ADD COLUMN IF NOT EXISTS kiem_ke_ton_xuong BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN tech_norm_items.kiem_ke_ton_xuong IS 'true ⇒ Thực tế = Tồn xưởng đầu kỳ + Xuất kho − Tồn xưởng cuối kỳ. false ⇒ Thực tế = Xuất kho.';

CREATE TABLE IF NOT EXISTS tech_norm_meters (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id     UUID NOT NULL REFERENCES factories(id),
  code           TEXT NOT NULL,
  name           TEXT NOT NULL,
  khu_vuc        TEXT NOT NULL DEFAULT '',
  loai           TEXT NOT NULL DEFAULT 'dien' CHECK (loai IN ('dien','nuoc','nuoc_thai')),
  he_so          NUMERIC(14,4) NOT NULL DEFAULT 1 CHECK (he_so > 0),
  dung_dinh_muc  BOOLEAN NOT NULL DEFAULT false,
  norm_item_id   UUID REFERENCES tech_norm_items(id),
  day_chuyen     TEXT,
  hieu_luc_tu    DATE,
  hieu_luc_den   DATE,
  sort_order     INTEGER NOT NULL DEFAULT 100,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  ghi_chu        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (factory_id, code),
  CHECK (NOT dung_dinh_muc OR norm_item_id IS NOT NULL),
  CHECK (hieu_luc_den IS NULL OR hieu_luc_tu IS NULL OR hieu_luc_den >= hieu_luc_tu)
);
COMMENT ON COLUMN tech_norm_meters.dung_dinh_muc IS 'Dùng báo cáo định mức: tiêu thụ đồng hồ này cộng vào Thực tế của norm_item_id × day_chuyen trong [hieu_luc_tu, hieu_luc_den].';

CREATE TABLE IF NOT EXISTS tech_norm_meter_readings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id      UUID NOT NULL REFERENCES factories(id),
  meter_id        UUID NOT NULL REFERENCES tech_norm_meters(id),  -- không CASCADE: đồng hồ đã có lần ghi chỉ được ngừng dùng
  ngay            DATE NOT NULL,
  chi_so          NUMERIC(16,3) NOT NULL CHECK (chi_so >= 0),
  he_so           NUMERIC(14,4) NOT NULL DEFAULT 1 CHECK (he_so > 0),
  thay_dong_ho    BOOLEAN NOT NULL DEFAULT false,
  chi_so_chot_cu  NUMERIC(16,3),
  image_urls      TEXT[] NOT NULL DEFAULT '{}',
  ghi_chu         TEXT,
  nhap_qua        TEXT NOT NULL DEFAULT 'tay' CHECK (nhap_qua IN ('tay','qr','offline')),
  client_id       UUID UNIQUE,
  created_by      UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      UUID REFERENCES auth.users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (meter_id, ngay),
  CHECK (NOT thay_dong_ho OR chi_so_chot_cu IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_tech_norm_readings_factory_ngay ON tech_norm_meter_readings (factory_id, ngay);

CREATE TABLE IF NOT EXISTS tech_norm_floor_locations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id  UUID NOT NULL REFERENCES factories(id),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 100,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (factory_id, code)
);

CREATE TABLE IF NOT EXISTS tech_norm_floor_counts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id    UUID NOT NULL REFERENCES factories(id),
  ngay          DATE NOT NULL,
  location_id   UUID NOT NULL REFERENCES tech_norm_floor_locations(id),
  norm_item_id  UUID NOT NULL REFERENCES tech_norm_items(id),
  so_luong      NUMERIC(16,3) NOT NULL CHECK (so_luong >= 0),
  image_urls    TEXT[] NOT NULL DEFAULT '{}',
  ghi_chu       TEXT,
  created_by    UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID REFERENCES auth.users(id),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ngay, location_id, norm_item_id)
);
CREATE INDEX IF NOT EXISTS idx_tech_norm_floor_counts_factory_ngay ON tech_norm_floor_counts (factory_id, ngay);

-- ── 2. Trigger ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_tech_norm_meters_touch ON tech_norm_meters;
CREATE TRIGGER trg_tech_norm_meters_touch BEFORE UPDATE ON tech_norm_meters
  FOR EACH ROW EXECUTE FUNCTION tech_norm_touch_updated_at();
DROP TRIGGER IF EXISTS trg_tech_norm_floor_locations_touch ON tech_norm_floor_locations;
CREATE TRIGGER trg_tech_norm_floor_locations_touch BEFORE UPDATE ON tech_norm_floor_locations
  FOR EACH ROW EXECUTE FUNCTION tech_norm_touch_updated_at();

-- STUB khoá ngày. GĐ4: true khi ngày đó nằm trong kỳ của 1 báo cáo đã ký (hoặc đang ký) của nhà máy.
CREATE OR REPLACE FUNCTION tech_norm_entry_locked(p_factory_id UUID, p_ngay DATE) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT false $$;
GRANT EXECUTE ON FUNCTION tech_norm_entry_locked(UUID, DATE) TO authenticated;

-- Lần ghi / kiểm kê: khoá ngày + đồng bộ factory_id + updated_by/at + hệ số đồng hồ.
CREATE OR REPLACE FUNCTION tech_norm_entry_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_meter tech_norm_meters%ROWTYPE;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') AND tech_norm_entry_locked(OLD.factory_id, OLD.ngay) THEN
    RAISE EXCEPTION 'NORM_DAY_LOCKED: Ngày % đã nằm trong báo cáo định mức đã ký — không sửa / xoá được. Điều chỉnh ở kỳ sau.',
      to_char(OLD.ngay, 'DD/MM/YYYY');
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  IF tech_norm_entry_locked(NEW.factory_id, NEW.ngay) THEN
    RAISE EXCEPTION 'NORM_DAY_LOCKED: Ngày % đã nằm trong báo cáo định mức đã ký — không ghi được.',
      to_char(NEW.ngay, 'DD/MM/YYYY');
  END IF;

  IF TG_TABLE_NAME = 'tech_norm_meter_readings' THEN
    SELECT * INTO v_meter FROM tech_norm_meters WHERE id = NEW.meter_id;
    IF NOT FOUND OR v_meter.factory_id <> NEW.factory_id THEN
      RAISE EXCEPTION 'Đồng hồ không thuộc nhà máy này.';
    END IF;
    IF TG_OP = 'INSERT' AND (NEW.he_so IS NULL OR NEW.he_so <= 0) THEN NEW.he_so := v_meter.he_so; END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.factory_id <> OLD.factory_id THEN RAISE EXCEPTION 'Không đổi được nhà máy.'; END IF;
    NEW.updated_at := now();
    NEW.updated_by := coalesce(auth.uid(), NEW.updated_by);
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tech_norm_readings_guard ON tech_norm_meter_readings;
CREATE TRIGGER trg_tech_norm_readings_guard BEFORE INSERT OR UPDATE OR DELETE ON tech_norm_meter_readings
  FOR EACH ROW EXECUTE FUNCTION tech_norm_entry_guard();
DROP TRIGGER IF EXISTS trg_tech_norm_floor_counts_guard ON tech_norm_floor_counts;
CREATE TRIGGER trg_tech_norm_floor_counts_guard BEFORE INSERT OR UPDATE OR DELETE ON tech_norm_floor_counts
  FOR EACH ROW EXECUTE FUNCTION tech_norm_entry_guard();

-- ── 3. RLS ──────────────────────────────────────────────────────────────────

DO $$
DECLARE t TEXT; perm TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['tech_norm_meters','tech_norm_meter_readings','tech_norm_floor_locations','tech_norm_floor_counts']
  LOOP
    perm := CASE WHEN t IN ('tech_norm_meter_readings','tech_norm_floor_counts') THEN 'norms.periodic_entry' ELSE 'norms.manage_config' END;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_select', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR SELECT TO authenticated
      USING (factory_id = current_profile_factory_id() AND current_profile_has_permission('norms.view'))$p$, t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_insert', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR INSERT TO authenticated
      WITH CHECK (factory_id = current_profile_factory_id() AND current_profile_has_permission(%L))$p$, t || '_insert', t, perm);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_update', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR UPDATE TO authenticated
      USING (factory_id = current_profile_factory_id() AND current_profile_has_permission(%L))
      WITH CHECK (factory_id = current_profile_factory_id())$p$, t || '_update', t, perm);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_delete', t);
    EXECUTE format($p$CREATE POLICY %I ON %I FOR DELETE TO authenticated
      USING (factory_id = current_profile_factory_id() AND current_profile_has_permission(%L))$p$, t || '_delete', t, perm);
  END LOOP;
END $$;

-- ── 4. Seed đồng hồ theo Mẫu 09-NMCB (chỉ nhà máy phuochoa_kt, chỉ khi chưa có đồng hồ) ──

DO $$
DECLARE
  f RECORD;
  v_dien UUID;
  v_nuoc UUID;
BEGIN
  FOR f IN SELECT id FROM factories WHERE code = 'phuochoa_kt' LOOP
    IF EXISTS (SELECT 1 FROM tech_norm_meters WHERE factory_id = f.id) THEN CONTINUE; END IF;
    SELECT id INTO v_dien FROM tech_norm_items WHERE factory_id = f.id AND code = 'DIEN';
    SELECT id INTO v_nuoc FROM tech_norm_items WHERE factory_id = f.id AND code = 'NUOC';

    INSERT INTO tech_norm_meters (factory_id, code, name, khu_vuc, loai, he_so, dung_dinh_muc, norm_item_id, day_chuyen, hieu_luc_tu, sort_order)
    SELECT f.id, s.code, s.name, s.kv, s.loai, s.hs,
           s.item IS NOT NULL AND (CASE s.item WHEN 'DIEN' THEN v_dien WHEN 'NUOC' THEN v_nuoc END) IS NOT NULL,
           CASE s.item WHEN 'DIEN' THEN v_dien WHEN 'NUOC' THEN v_nuoc END,
           s.dc,
           CASE WHEN s.item IS NOT NULL THEN DATE '2026-01-01' END,
           s.ord
    FROM (VALUES
      ('ĐH-01',     'Điện khu vực DCMT',        'Dây chuyền sản xuất CSR10,20', 'dien',      200::numeric, 'DIEN', 'Mủ tạp',  10),
      ('ĐH-02',     'Điện trạm bơm DCMT',       'Dây chuyền sản xuất CSR10,20', 'dien',      1,            'DIEN', 'Mủ tạp',  20),
      ('ĐHN-01',    'Nước DCMT',                'Dây chuyền sản xuất CSR10,20', 'nuoc',      1,            'NUOC', 'Mủ tạp',  30),
      ('ĐH-03',     'Điện khu vực DCMN',        'Dây chuyền sản xuất mủ nước',  'dien',      200,          'DIEN', 'Mủ nước', 40),
      ('ĐH-04',     'Điện trạm bơm DCMN',       'Dây chuyền sản xuất mủ nước',  'dien',      1,            'DIEN', 'Mủ nước', 50),
      ('ĐHN-02',    'Nước DCMN',                'Dây chuyền sản xuất mủ nước',  'nuoc',      1,            'NUOC', 'Mủ nước', 60),
      ('ĐH-05',     'Điện trạm bơm nước suối',  'Điện trạm bơm nước suối',      'dien',      1,            'DIEN', 'Mủ tạp',  70),
      ('ĐH-06',     'Điện hệ thống XLNT',       'Khu vực hệ thống XLNT',        'dien',      1,            NULL,   NULL,      80),
      ('ĐHNXL-03',  'Nước thải sau xử lý',      'Khu vực hệ thống XLNT',        'nuoc_thai', 1,            NULL,   NULL,      90),
      ('ĐH-07',     'Điện văn phòng nhà máy',   'Khu vực chung',                'dien',      1,            NULL,   NULL,      100),
      ('ĐH-08',     'Điện căn tin',             'Khu vực chung',                'dien',      1,            NULL,   NULL,      110),
      ('ĐH-09',     'Điện sinh hoạt tập thể',   'Khu vực chung',                'dien',      1,            NULL,   NULL,      120),
      ('ĐH-10',     'Điện phòng QLCL',          'Khu vực chung',                'dien',      1,            NULL,   NULL,      130),
      ('ĐH-11',     'Điện lò hơi biomass',      'Khu vực Biomass',              'dien',      1,            NULL,   NULL,      140),
      ('ĐH-12',     'Điện máy băm gỗ',          'Khu vực Biomass',              'dien',      1,            NULL,   NULL,      150)
    ) AS s(code, name, kv, loai, hs, item, dc, ord);
  END LOOP;
END $$;

COMMIT;
