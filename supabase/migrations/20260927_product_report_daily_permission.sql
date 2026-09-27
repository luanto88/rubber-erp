-- Quyền mới: Báo cáo ngày = Báo cáo lô sản xuất (F11) + Báo cáo sản xuất hằng ngày (F12).
-- Xem .claude/rules/06-module-production.md mục "4.9".
--
-- Chỉ cấp mặc định cho admin (đã chốt 2026-09-27): đây là việc của nhân viên văn phòng, admin tự
-- cấp tay từng người qua Cài đặt → Phân quyền. Lưu ý: mọi tài khoản đang có user_permissions tường
-- minh sẽ BỎ QUA role_permissions (xem fetchPermissionCodesForUser) — nên seed role chỉ có tác dụng
-- với tài khoản chưa từng được cấp quyền riêng.
--
-- Phiếu báo thành phẩm (F09) KHÔNG có quyền riêng: ai có product.create hoặc product.confirm_scan
-- là in được.

INSERT INTO permissions (code, module_name, action_name) VALUES
  ('product.report_daily', 'product', 'report_daily')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role, permission_code) VALUES
  ('admin', 'product.report_daily')
ON CONFLICT DO NOTHING;
