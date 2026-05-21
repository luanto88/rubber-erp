-- Tạo bảng departments nếu chưa có và thêm Đội sản xuất (DSX)

CREATE TABLE IF NOT EXISTS departments (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  is_active   BOOLEAN DEFAULT true,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'departments'
      AND policyname = 'Authenticated users can read departments'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Authenticated users can read departments"
        ON departments FOR SELECT TO authenticated USING (true)
    $policy$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'departments'
      AND policyname = 'Admins can manage departments'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Admins can manage departments"
        ON departments FOR ALL TO authenticated
        USING (
          EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role = 'admin'
          )
        )
    $policy$;
  END IF;
END
$$;

-- Seed 9 phòng ban gốc + ĐSX
INSERT INTO departments (code, name, sort_order) VALUES
  ('PHK',  'Tên viết tắt của công ty',    1),
  ('KTNN', 'Kỹ thuật nông nghiệp',         2),
  ('QLCL', 'Quản lý chất lượng',            3),
  ('KHXD', 'Kế hoạch - xây dựng cơ bản',   4),
  ('TCKT', 'Tài chính kế toán',              5),
  ('TCHC', 'Tổ chức hành chính',             6),
  ('TTBV', 'Thanh tra bảo vệ',               7),
  ('NMCB', 'Nhà máy chế biến',               8),
  ('CS',   'Customer',                        9),
  ('DSX',  'Đội sản xuất',                   10)
ON CONFLICT (code) DO NOTHING;
