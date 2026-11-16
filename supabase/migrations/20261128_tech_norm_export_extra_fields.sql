-- Xuất bù kho thành phẩm — chuyển từ Định mức → Nhập liệu sang Cài đặt → Cấu hình nhà máy → Thành phẩm (2026-11-16).
-- Bảng nhập theo NGÀY, nhiều dòng một lần, đủ trường như Tồn đầu kỳ thành phẩm: Loại CSR · Nguồn gốc · Bọc · Loại bành ·
-- Số lượng (kg) · Ghi chú. Vẫn CHỈ cộng vào Mẫu 8A mục 3 — KHÔNG trừ tồn F12, đơn xuất, EUDR (người dùng chốt).
--
-- 1) Thêm cột boc ('' = không bọc, giống product_opening_stock) + loai_banh (NULL cho dòng cũ nhập trước khi có cột).
-- 2) Ghi: norms.periodic_entry HOẶC settings.manage_config (màn mới nằm ở Cài đặt). Xem: thêm settings.manage_config.
-- Khoá ngày (trigger tech_norm_export_extra_guard) giữ nguyên.

ALTER TABLE tech_norm_export_extra ADD COLUMN IF NOT EXISTS boc TEXT NOT NULL DEFAULT '';
ALTER TABLE tech_norm_export_extra ADD COLUMN IF NOT EXISTS loai_banh NUMERIC(8,2);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tech_norm_export_extra_loai_banh_check') THEN
    ALTER TABLE tech_norm_export_extra ADD CONSTRAINT tech_norm_export_extra_loai_banh_check CHECK (loai_banh IS NULL OR loai_banh > 0);
  END IF;
END $$;

DROP POLICY IF EXISTS tech_norm_export_extra_select ON tech_norm_export_extra;
CREATE POLICY tech_norm_export_extra_select ON tech_norm_export_extra FOR SELECT TO authenticated
  USING (factory_id = current_profile_factory_id()
         AND (current_profile_has_permission('norms.view') OR current_profile_has_permission('settings.manage_config')));

DROP POLICY IF EXISTS tech_norm_export_extra_insert ON tech_norm_export_extra;
CREATE POLICY tech_norm_export_extra_insert ON tech_norm_export_extra FOR INSERT TO authenticated
  WITH CHECK (factory_id = current_profile_factory_id()
              AND (current_profile_has_permission('norms.periodic_entry') OR current_profile_has_permission('settings.manage_config')));

DROP POLICY IF EXISTS tech_norm_export_extra_update ON tech_norm_export_extra;
CREATE POLICY tech_norm_export_extra_update ON tech_norm_export_extra FOR UPDATE TO authenticated
  USING (factory_id = current_profile_factory_id()
         AND (current_profile_has_permission('norms.periodic_entry') OR current_profile_has_permission('settings.manage_config')))
  WITH CHECK (factory_id = current_profile_factory_id());

DROP POLICY IF EXISTS tech_norm_export_extra_delete ON tech_norm_export_extra;
CREATE POLICY tech_norm_export_extra_delete ON tech_norm_export_extra FOR DELETE TO authenticated
  USING (factory_id = current_profile_factory_id()
         AND (current_profile_has_permission('norms.periodic_entry') OR current_profile_has_permission('settings.manage_config')));

NOTIFY pgrst, 'reload schema';
