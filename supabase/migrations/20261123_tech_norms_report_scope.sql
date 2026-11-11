-- 2026-11-11 — Định mức KTKT GĐ3b: "mọi số đều hiển thị, chỉ số được tick mới so sánh định mức" (rule 30).
--
--   tech_norm_report_categories   nhóm vật tư thuộc báo cáo định mức (Hóa chất, Dầu nhớt mỡ, Bao bì…). Mọi xuất kho của các
--                                 nhóm này đều hiện trong báo cáo; mã chưa gắn chỉ tiêu ⇒ mục "Phát sinh ngoài định mức".
--   tech_norm_export_exclusions   1 dòng xuất kho (inventory_stock_movements, export) KHÔNG tính định mức, kèm lý do
--                                 (vd Bọc 0,13 xuất đóng gói việc khác). Số bị loại chuyển sang mục ngoài định mức.
--                                 Phiếu xuất bị huỷ ⇒ movement bị xoá ⇒ dòng loại trừ tự xoá theo (CASCADE).
-- Ghi: nhóm vật tư = norms.manage_config; loại trừ = norms.report. Ngày đã khoá (tech_norm_entry_locked) không đổi được.
-- Chạy TAY trên Supabase SQL Editor, SAU 20261122. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS tech_norm_report_categories (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id   UUID NOT NULL REFERENCES factories(id),
  category_id  UUID NOT NULL REFERENCES inventory_item_categories(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (factory_id, category_id)
);

CREATE TABLE IF NOT EXISTS tech_norm_export_exclusions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id   UUID NOT NULL REFERENCES factories(id),
  movement_id  UUID NOT NULL UNIQUE REFERENCES inventory_stock_movements(id) ON DELETE CASCADE,
  ngay         DATE,
  ly_do        TEXT NOT NULL CHECK (btrim(ly_do) <> ''),
  created_by   UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tech_norm_export_excl_factory_ngay ON tech_norm_export_exclusions (factory_id, ngay);

CREATE OR REPLACE FUNCTION tech_norm_export_exclusion_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mv inventory_stock_movements%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.ngay IS NOT NULL AND tech_norm_entry_locked(OLD.factory_id, OLD.ngay) THEN
      RAISE EXCEPTION 'NORM_DAY_LOCKED: Ngày % đã nằm trong báo cáo định mức đã ký — không đổi được.', to_char(OLD.ngay, 'DD/MM/YYYY');
    END IF;
    RETURN OLD;
  END IF;
  SELECT * INTO v_mv FROM inventory_stock_movements WHERE id = NEW.movement_id;
  IF NOT FOUND OR v_mv.factory_id <> NEW.factory_id THEN
    RAISE EXCEPTION 'Dòng xuất kho không thuộc nhà máy này.';
  END IF;
  IF v_mv.movement_type <> 'export' THEN
    RAISE EXCEPTION 'Chỉ loại trừ được dòng xuất kho.';
  END IF;
  NEW.ngay := v_mv.movement_date;
  IF tech_norm_entry_locked(NEW.factory_id, NEW.ngay) THEN
    RAISE EXCEPTION 'NORM_DAY_LOCKED: Ngày % đã nằm trong báo cáo định mức đã ký — không đổi được.', to_char(NEW.ngay, 'DD/MM/YYYY');
  END IF;
  NEW.ly_do := btrim(NEW.ly_do);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tech_norm_export_excl_guard ON tech_norm_export_exclusions;
CREATE TRIGGER trg_tech_norm_export_excl_guard BEFORE INSERT OR UPDATE OR DELETE ON tech_norm_export_exclusions
  FOR EACH ROW EXECUTE FUNCTION tech_norm_export_exclusion_guard();

DO $$
DECLARE t TEXT; perm TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['tech_norm_report_categories','tech_norm_export_exclusions']
  LOOP
    perm := CASE WHEN t = 'tech_norm_export_exclusions' THEN 'norms.report' ELSE 'norms.manage_config' END;
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

-- Seed: nhóm vật tư của các mã đã gắn chỉ tiêu định mức (người dùng chỉnh thêm/bớt ở Nhập liệu → Danh mục).
INSERT INTO tech_norm_report_categories (factory_id, category_id)
SELECT DISTINCT it.factory_id, ii.category_id
FROM tech_norm_items it
CROSS JOIN LATERAL unnest(it.inventory_item_ids) AS x(inv_id)
JOIN inventory_items ii ON ii.id = x.inv_id
WHERE ii.category_id IS NOT NULL
  -- chỉ seed lần đầu: chạy lại migration không thêm lại nhóm người dùng đã bỏ
  AND NOT EXISTS (SELECT 1 FROM tech_norm_report_categories rc WHERE rc.factory_id = it.factory_id)
ON CONFLICT (factory_id, category_id) DO NOTHING;

COMMIT;
