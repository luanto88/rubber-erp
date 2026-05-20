-- Migration: Tạo bảng phòng ban, mở rộng vật tư ngoài, thêm FK phòng ban vào profiles

-- 1. Bảng phòng ban chuẩn
CREATE TABLE IF NOT EXISTS departments (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  is_active   BOOLEAN DEFAULT true,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read departments"
  ON departments FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage departments"
  ON departments FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'admin'
    )
  );

-- Seed data (từ ảnh phong_ban.png)
INSERT INTO departments (code, name, sort_order) VALUES
  ('PHK',  'Tên viết tắt của công ty',    1),
  ('KTNN', 'Kỹ thuật nông nghiệp',         2),
  ('QLCL', 'Quản lý chất lượng',            3),
  ('KHXD', 'Kế hoạch - xây dựng cơ bản',   4),
  ('TCKT', 'Tài chính kế toán',              5),
  ('TCHC', 'Tổ chức hành chính',             6),
  ('TTBV', 'Thanh tra bảo vệ',               7),
  ('NMCB', 'Nhà máy chế biến',               8),
  ('CS',   'Customer',                        9)
ON CONFLICT (code) DO NOTHING;

-- 2. Thêm department_id vào profiles (FK optional, backward-compat)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id);

-- 3. Mở rộng maintenance_external_materials — thêm fields tương tự inventory_items
ALTER TABLE maintenance_external_materials
  ADD COLUMN IF NOT EXISTS code          TEXT,
  ADD COLUMN IF NOT EXISTS specification TEXT,
  ADD COLUMN IF NOT EXISTS category_id   UUID REFERENCES inventory_item_categories(id),
  ADD COLUMN IF NOT EXISTS is_active     BOOLEAN DEFAULT true;

-- Unique index cho code per factory (chỉ khi code không null)
CREATE UNIQUE INDEX IF NOT EXISTS idx_mext_materials_code_factory
  ON maintenance_external_materials(factory_id, code)
  WHERE code IS NOT NULL;
