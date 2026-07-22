-- Permission mới cho trang Dashboard chính (/dashboard) — dữ liệu tổng hợp nhạy cảm
-- của nhà máy (tồn kho, sản lượng, chất lượng, xuất hàng...). Xem plan
-- "Cải tiến Dashboard" và .claude/rules/12-settings-permissions.md.
--
-- Cấp rộng cho cả admin/manager/user để không ai mất quyền truy cập ngay lúc deploy —
-- admin có thể thu hồi riêng theo từng tài khoản qua Cài đặt → Phân quyền sau đó.

INSERT INTO permissions (code, module_name, action_name) VALUES
  ('dashboard.view', 'dashboard', 'view')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role, permission_code) VALUES
  ('admin', 'dashboard.view'),
  ('manager', 'dashboard.view'),
  ('user', 'dashboard.view')
ON CONFLICT DO NOTHING;
