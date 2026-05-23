-- Thêm field phan_loai_tl cho tài liệu PL và HD (cả Cha lẫn Con)
ALTER TABLE iso_documents ADD COLUMN IF NOT EXISTS phan_loai_tl TEXT DEFAULT 'cha';

-- Seed thêm permissions: settings tab riêng + iso.signature cho mọi user active
-- (safe: ON CONFLICT DO NOTHING nếu đã tồn tại)

-- settings.master_data: tab Danh mục trong Cài đặt
INSERT INTO public.permissions (code, module_name, action_name)
VALUES
  ('settings.master_data',       'settings', 'master_data'),
  ('settings.maintenance_config','settings', 'maintenance_config'),
  ('iso.signature',               'iso',      'signature')
ON CONFLICT (code) DO NOTHING;

-- admin: tất cả permissions mới
INSERT INTO public.role_permissions (role, permission_code) VALUES
  ('admin', 'settings.master_data'),
  ('admin', 'settings.maintenance_config'),
  ('admin', 'iso.signature')
ON CONFLICT DO NOTHING;

-- manager: settings tabs + iso.signature
INSERT INTO public.role_permissions (role, permission_code) VALUES
  ('manager', 'settings.master_data'),
  ('manager', 'settings.maintenance_config'),
  ('manager', 'iso.signature')
ON CONFLICT DO NOTHING;

-- user: chỉ iso.signature (tự set chữ ký và PIN)
INSERT INTO public.role_permissions (role, permission_code) VALUES
  ('user', 'iso.signature')
ON CONFLICT DO NOTHING;
