-- Định mức KTKT — "Xuất kho bù": thành phẩm xuất kho của LÔ NGOÀI HỆ THỐNG (lô sản xuất năm 2025, không có nhập
-- thành phẩm nên không gán được vào đơn ở module Xuất hàng). Mẫu 8A mục 3 = đơn xuất đã duyệt + các dòng bù có ngày
-- trong kỳ. KHÔNG đụng tồn kho thành phẩm, đơn xuất, EUDR. Rule 30.
--
-- Khoá ngày dùng chung tech_norm_entry_locked() (8A/09 Chờ ký / Đã ký ⇒ không ghi / sửa / xoá).
-- Quyền: xem = norms.view; ghi = norms.periodic_entry (giống chỉ số đồng hồ / kiểm kê tồn xưởng).

CREATE TABLE IF NOT EXISTS tech_norm_export_extra (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id  UUID NOT NULL REFERENCES factories(id),
  ngay        DATE NOT NULL,
  loai_csr    TEXT NOT NULL CHECK (btrim(loai_csr) <> ''),
  nguon       TEXT NOT NULL DEFAULT 'cong_ty' CHECK (nguon IN ('cong_ty','gia_cong','thu_mua')),
  kg          NUMERIC(14,3) NOT NULL CHECK (kg > 0),
  ghi_chu     TEXT,
  created_by  UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID REFERENCES auth.users(id),
  updated_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tech_norm_export_extra_factory_ngay ON tech_norm_export_extra (factory_id, ngay);

CREATE OR REPLACE FUNCTION tech_norm_export_extra_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') AND tech_norm_entry_locked(OLD.factory_id, OLD.ngay) THEN
    RAISE EXCEPTION 'NORM_DAY_LOCKED: Ngày % đã nằm trong báo cáo định mức đã ký — không sửa / xoá được.',
      to_char(OLD.ngay, 'DD/MM/YYYY');
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  IF tech_norm_entry_locked(NEW.factory_id, NEW.ngay) THEN
    RAISE EXCEPTION 'NORM_DAY_LOCKED: Ngày % đã nằm trong báo cáo định mức đã ký — không ghi được.',
      to_char(NEW.ngay, 'DD/MM/YYYY');
  END IF;

  NEW.loai_csr := btrim(NEW.loai_csr);
  IF TG_OP = 'UPDATE' THEN
    IF NEW.factory_id <> OLD.factory_id THEN RAISE EXCEPTION 'Không đổi được nhà máy.'; END IF;
    NEW.updated_at := now();
    NEW.updated_by := coalesce(auth.uid(), NEW.updated_by);
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tech_norm_export_extra_guard ON tech_norm_export_extra;
CREATE TRIGGER trg_tech_norm_export_extra_guard BEFORE INSERT OR UPDATE OR DELETE ON tech_norm_export_extra
  FOR EACH ROW EXECUTE FUNCTION tech_norm_export_extra_guard();

ALTER TABLE tech_norm_export_extra ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tech_norm_export_extra_select ON tech_norm_export_extra;
CREATE POLICY tech_norm_export_extra_select ON tech_norm_export_extra FOR SELECT TO authenticated
  USING (factory_id = current_profile_factory_id() AND current_profile_has_permission('norms.view'));

DROP POLICY IF EXISTS tech_norm_export_extra_insert ON tech_norm_export_extra;
CREATE POLICY tech_norm_export_extra_insert ON tech_norm_export_extra FOR INSERT TO authenticated
  WITH CHECK (factory_id = current_profile_factory_id() AND current_profile_has_permission('norms.periodic_entry'));

DROP POLICY IF EXISTS tech_norm_export_extra_update ON tech_norm_export_extra;
CREATE POLICY tech_norm_export_extra_update ON tech_norm_export_extra FOR UPDATE TO authenticated
  USING (factory_id = current_profile_factory_id() AND current_profile_has_permission('norms.periodic_entry'))
  WITH CHECK (factory_id = current_profile_factory_id());

DROP POLICY IF EXISTS tech_norm_export_extra_delete ON tech_norm_export_extra;
CREATE POLICY tech_norm_export_extra_delete ON tech_norm_export_extra FOR DELETE TO authenticated
  USING (factory_id = current_profile_factory_id() AND current_profile_has_permission('norms.periodic_entry'));

GRANT SELECT, INSERT, UPDATE, DELETE ON tech_norm_export_extra TO authenticated;
