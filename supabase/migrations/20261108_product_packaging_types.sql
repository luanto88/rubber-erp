-- Quy cách đóng gói thành phẩm theo nhà máy (2026-11-08) — GĐ1: Bọc / Pallet sản xuất / Thảm.
-- Thay các mảng hard-code getBocsForLoaiCSR, PALLET_OPTS, THAM_OPTS (product-lot-config.ts, product/page.tsx,
-- product/confirm/page.tsx, export/page.tsx, predict/page.tsx).
-- Chạy tay trên Supabase SQL Editor TRƯỚC khi deploy code. Bảng chưa có ⇒ code tự dùng danh sách mặc định
-- (đúng hành vi cũ), không gãy.
--
-- QUY TẮC: bảng này chỉ quyết định LỰA CHỌN cho phiếu MỚI. Không bao giờ sửa chuỗi đã lưu trên lots /
-- lot_transactions / export_orders. Đổi tên = tạo mục mới + tắt mục cũ.
--
-- kind:
--   'boc'       : loại bọc. `ten` có thể chứa token {CSR} (thay bằng chủng loại khi hiển thị).
--   'pallet_sx' : pallet đóng kiện khi sản xuất. thanh_phan = mã thành phần của src/lib/pallet-usage.ts
--                 (sat_day | sat_mong | de_go | de_nhua | mb5 | mb4 | pallet_go) — quy đổi tồn pallet kho.
--   'tham'      : loại thảm.
-- day_chuyen / loai_csr: rỗng = áp cho mọi dây chuyền / mọi chủng loại.
-- inventory_item_ids: mã vật tư kho tương ứng (tuỳ chọn, GĐ1 chỉ lưu để tham chiếu).

CREATE TABLE IF NOT EXISTS product_packaging_types (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id          UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL CHECK (kind IN ('boc', 'pallet_sx', 'tham')),
  ten                 TEXT NOT NULL CHECK (btrim(ten) <> ''),
  day_chuyen          TEXT[] NOT NULL DEFAULT '{}',
  loai_csr            TEXT[] NOT NULL DEFAULT '{}',
  inventory_item_ids  UUID[] NOT NULL DEFAULT '{}',
  thanh_phan          TEXT[] NOT NULL DEFAULT '{}',
  is_default          BOOLEAN NOT NULL DEFAULT false,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_product_packaging_types_factory_kind_ten
  ON product_packaging_types (factory_id, kind, lower(btrim(ten)));

CREATE INDEX IF NOT EXISTS idx_product_packaging_types_factory
  ON product_packaging_types (factory_id, kind, sort_order);

ALTER TABLE product_packaging_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_packaging_types_select ON product_packaging_types;
CREATE POLICY product_packaging_types_select ON product_packaging_types
  FOR SELECT TO authenticated
  USING (factory_id = current_profile_factory_id());

DROP POLICY IF EXISTS product_packaging_types_insert ON product_packaging_types;
CREATE POLICY product_packaging_types_insert ON product_packaging_types
  FOR INSERT TO authenticated
  WITH CHECK (
    factory_id = current_profile_factory_id()
    AND (current_profile_role() = 'admin' OR current_profile_has_permission('settings.manage_config'))
  );

DROP POLICY IF EXISTS product_packaging_types_update ON product_packaging_types;
CREATE POLICY product_packaging_types_update ON product_packaging_types
  FOR UPDATE TO authenticated
  USING (
    factory_id = current_profile_factory_id()
    AND (current_profile_role() = 'admin' OR current_profile_has_permission('settings.manage_config'))
  )
  WITH CHECK (factory_id = current_profile_factory_id());

DROP POLICY IF EXISTS product_packaging_types_delete ON product_packaging_types;
CREATE POLICY product_packaging_types_delete ON product_packaging_types
  FOR DELETE TO authenticated
  USING (
    factory_id = current_profile_factory_id()
    AND (current_profile_role() = 'admin' OR current_profile_has_permission('settings.manage_config'))
  );

-- Seed đúng danh sách đang hard-code (mọi nhà máy). Phải khớp DEFAULT_PACKAGING ở
-- src/lib/product-packaging.ts.
INSERT INTO product_packaging_types (factory_id, kind, ten, day_chuyen, thanh_phan, is_default, sort_order, is_active)
SELECT f.id, v.kind, v.ten, v.dc, v.tp, v.def, v.ord, v.act
FROM factories f
CROSS JOIN (VALUES
  ('boc',       'Bọc trơn 0,04',          ARRAY[]::TEXT[],          ARRAY[]::TEXT[],                    false, 10, true),
  ('boc',       'Bọc nhãn 0,04 VRG {CSR}', ARRAY[]::TEXT[],          ARRAY[]::TEXT[],                    true,  20, true),
  ('boc',       'Bọc trơn 0,13',          ARRAY['Mủ nước']::TEXT[], ARRAY[]::TEXT[],                    false, 30, true),
  ('boc',       'Bọc nhãn 0,13 VRG {CSR}', ARRAY['Mủ nước']::TEXT[], ARRAY[]::TEXT[],                    false, 40, true),
  ('pallet_sx', 'Sắt đế gỗ',              ARRAY[]::TEXT[],          ARRAY['sat_day','de_go']::TEXT[],   true,  10, true),
  ('pallet_sx', 'Sắt đế nhựa',            ARRAY[]::TEXT[],          ARRAY['sat_day','de_nhua']::TEXT[], false, 20, true),
  ('pallet_sx', 'Sắt mỏng',               ARRAY[]::TEXT[],          ARRAY['sat_mong']::TEXT[],          false, 30, true),
  ('pallet_sx', 'MB5',                    ARRAY[]::TEXT[],          ARRAY['mb5']::TEXT[],               false, 40, true),
  ('pallet_sx', 'Gỗ',                     ARRAY[]::TEXT[],          ARRAY['pallet_go']::TEXT[],         false, 50, true),
  ('pallet_sx', 'MB4',                    ARRAY[]::TEXT[],          ARRAY['mb4']::TEXT[],               false, 60, false),
  ('tham',      'Cũ',                     ARRAY[]::TEXT[],          ARRAY[]::TEXT[],                    true,  10, true),
  ('tham',      'Mới',                    ARRAY[]::TEXT[],          ARRAY[]::TEXT[],                    false, 20, true)
) AS v(kind, ten, dc, tp, def, ord, act)
ON CONFLICT (factory_id, kind, lower(btrim(ten))) DO NOTHING;

-- Kiểm chứng:
-- SELECT f.code, t.kind, t.ten, t.day_chuyen, t.loai_csr, t.thanh_phan, t.is_default, t.is_active
--   FROM product_packaging_types t JOIN factories f ON f.id = t.factory_id
--   ORDER BY f.code, t.kind, t.sort_order;
