-- Permission mới cho tính năng "Khóa ca sản xuất Thành phẩm" (product_shift_locks).
-- Xem .claude/rules/06-module-production.md mục "Khóa ca sản xuất" và plan liên quan.
-- Chỉ cấp mặc định cho admin + manager — khác product.confirm_scan (cấp cả user vì đó là thao
-- tác quét hiện trường của công nhân) — đây là hành động phê duyệt/kiểm soát dữ liệu đã hoàn
-- tất ca, không nên cấp rộng cho mọi user. Cấp riêng cho user cụ thể qua Cài đặt → Phân quyền
-- nếu cần (ví dụ tổ trưởng/trực ca trưởng).

INSERT INTO permissions (code, module_name, action_name) VALUES
  ('product.approve_shift', 'product', 'approve_shift')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role, permission_code) VALUES
  ('admin', 'product.approve_shift'),
  ('manager', 'product.approve_shift')
ON CONFLICT DO NOTHING;
