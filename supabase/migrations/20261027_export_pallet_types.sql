-- Loại pallet xuất theo nhà máy (2026-10-27) — thay mảng hard-code PALLET_XUAT_BASE ở export/page.tsx.
-- Chạy tay trên Supabase SQL Editor TRƯỚC khi deploy code (màn Xuất hàng + tab Tồn kho đọc bảng này;
-- bảng chưa có thì code tự dùng danh sách mặc định, không gãy).
--
-- hinh_thuc quyết định pallet đi đâu khi xuất (dùng cho tính tồn pallet ở Kho vật tư → Tồn):
--   'roi'      : Xuất rời — pallet của kiện TRẢ VỀ kho.
--   'kien'     : Xuất khẩu dạng kiện — MẤT toàn bộ pallet của kiện (theo loại pallet ghi trên kiện).
--   'boc_mang' : Bọc màng PE — pallet của kiện TRẢ VỀ kho, chỉ MẤT các thành phần trong mat_thanh_phan
--                (mỗi kiện 1 cái, vd PE đế gỗ → mất 1 đế gỗ).
-- mat_thanh_phan dùng mã thành phần của src/lib/pallet-usage.ts:
--   sat_day | sat_mong | de_go | de_nhua | mb5 | mb4 | pallet_go

CREATE TABLE IF NOT EXISTS export_pallet_types (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id      UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  ten             TEXT NOT NULL,
  hinh_thuc       TEXT NOT NULL CHECK (hinh_thuc IN ('roi', 'kien', 'boc_mang')),
  mat_thanh_phan  TEXT[] NOT NULL DEFAULT '{}',
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_export_pallet_types_factory_ten
  ON export_pallet_types (factory_id, lower(btrim(ten)));

ALTER TABLE export_pallet_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS export_pallet_types_select ON export_pallet_types;
CREATE POLICY export_pallet_types_select ON export_pallet_types
  FOR SELECT TO authenticated
  USING (factory_id = current_profile_factory_id());

-- Ghi: admin / cấu hình nhà máy, hoặc người tạo đơn xuất (nút "+" thêm nhanh ở màn Xuất hàng).
DROP POLICY IF EXISTS export_pallet_types_insert ON export_pallet_types;
CREATE POLICY export_pallet_types_insert ON export_pallet_types
  FOR INSERT TO authenticated
  WITH CHECK (
    factory_id = current_profile_factory_id()
    AND (
      current_profile_role() = 'admin'
      OR current_profile_has_permission('settings.manage_config')
      OR current_profile_has_permission('export.create')
    )
  );

DROP POLICY IF EXISTS export_pallet_types_update ON export_pallet_types;
CREATE POLICY export_pallet_types_update ON export_pallet_types
  FOR UPDATE TO authenticated
  USING (
    factory_id = current_profile_factory_id()
    AND (current_profile_role() = 'admin' OR current_profile_has_permission('settings.manage_config'))
  )
  WITH CHECK (factory_id = current_profile_factory_id());

DROP POLICY IF EXISTS export_pallet_types_delete ON export_pallet_types;
CREATE POLICY export_pallet_types_delete ON export_pallet_types
  FOR DELETE TO authenticated
  USING (
    factory_id = current_profile_factory_id()
    AND (current_profile_role() = 'admin' OR current_profile_has_permission('settings.manage_config'))
  );

-- Seed danh sách mặc định cho mọi nhà máy (đúng mảng cũ + "Pallet sắt đế gỗ" theo rule 08).
-- Admin tự tắt loại không dùng ở Cài đặt → Cấu hình nhà máy → Loại pallet xuất.
INSERT INTO export_pallet_types (factory_id, ten, hinh_thuc, mat_thanh_phan, sort_order)
SELECT f.id, v.ten, v.hinh_thuc, v.mat, v.ord
FROM factories f
CROSS JOIN (VALUES
  ('Rời',              'roi',      ARRAY[]::TEXT[],          10),
  ('Pallet sắt đế gỗ', 'kien',     ARRAY[]::TEXT[],          20),
  ('PE đế gỗ',         'boc_mang', ARRAY['de_go']::TEXT[],   30),
  ('PE đế nhựa',       'boc_mang', ARRAY['de_nhua']::TEXT[], 40),
  ('Gỗ',               'kien',     ARRAY[]::TEXT[],          50),
  ('MB4',              'kien',     ARRAY[]::TEXT[],          60),
  ('MB5',              'kien',     ARRAY[]::TEXT[],          70)
) AS v(ten, hinh_thuc, mat, ord)
ON CONFLICT (factory_id, lower(btrim(ten))) DO NOTHING;

-- Loại pallet đã dùng trên đơn cũ nhưng không có trong danh sách mặc định ⇒ thêm, mặc định 'kien'
-- (kiểm tra lại trong Cài đặt).
INSERT INTO export_pallet_types (factory_id, ten, hinh_thuc, sort_order)
SELECT DISTINCT eo.factory_id, btrim(eo.loai_pallet), 'kien', 100
FROM export_orders eo
WHERE eo.loai_pallet IS NOT NULL AND btrim(eo.loai_pallet) <> ''
ON CONFLICT (factory_id, lower(btrim(ten))) DO NOTHING;

-- Kiểm chứng:
-- SELECT f.code, t.ten, t.hinh_thuc, t.mat_thanh_phan FROM export_pallet_types t
--   JOIN factories f ON f.id = t.factory_id ORDER BY f.code, t.sort_order;
