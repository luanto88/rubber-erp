-- Permission mới cho tính năng quét QR nhãn kiện -> xác nhận sản xuất thật
-- Xem .claude/rules/06-module-production.md mục "4.6" và plan liên quan.
-- Cấp rộng cho cả admin/manager/user vì đây là thao tác của công nhân xưởng ngoài hiện
-- trường, không nên yêu cầu quyền product.create/edit đầy đủ.

INSERT INTO permissions (code, module_name, action_name) VALUES
  ('product.confirm_scan', 'product', 'confirm_scan')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role, permission_code) VALUES
  ('admin', 'product.confirm_scan'),
  ('manager', 'product.confirm_scan'),
  ('user', 'product.confirm_scan')
ON CONFLICT DO NOTHING;
