-- ============================================================
-- Quyền riêng "Tra cứu lý lịch thiết bị bằng QR" (`maintenance.qr_lookup`).
--
-- Trang QR `/tb/<token>` (docs/qr-equipment-plan.md) trước đây mượn `maintenance.view` để mở
-- lịch sử bảo trì. Nay tách quyền riêng để admin tick/bỏ tick ở Cài đặt → Phân quyền (nhóm Bảo trì)
-- — vd cho công nhân vận hành tra cứu tại máy mà không vào được module Bảo trì.
--
-- CẤP SẴN (đã chốt với người dùng 2026-11-06): mọi role / tài khoản đang có `maintenance.view`
-- được cấp thêm quyền mới ⇒ không ai mất khả năng xem sau khi deploy. Admin bỏ tick tay sau.
--
-- CHẠY TAY trong Supabase SQL Editor TRƯỚC khi deploy code (code mới kiểm `maintenance.qr_lookup`).
-- Idempotent — chạy lại an toàn.
-- ============================================================

BEGIN;

INSERT INTO permissions (code, module_name, action_name)
VALUES ('maintenance.qr_lookup', 'maintenance', 'qr_lookup')
ON CONFLICT (code) DO NOTHING;

-- Role đang có maintenance.view ⇒ có thêm quyền mới.
INSERT INTO role_permissions (role, permission_code)
SELECT DISTINCT rp.role, 'maintenance.qr_lookup'
FROM role_permissions rp
WHERE rp.permission_code = 'maintenance.view'
ON CONFLICT DO NOTHING;

-- Tài khoản có cấp quyền tường minh (đa số tài khoản active) ⇒ chỉ thêm khi chưa có dòng nào,
-- không đè lên quyết định granted=false admin đã đặt trước (nếu có).
INSERT INTO user_permissions (user_id, permission_code, granted)
SELECT DISTINCT up.user_id, 'maintenance.qr_lookup', true
FROM user_permissions up
WHERE up.permission_code = 'maintenance.view' AND up.granted = true
ON CONFLICT (user_id, permission_code) DO NOTHING;

COMMIT;

-- Kiểm tra sau khi chạy: 2 con số nên bằng nhau.
-- SELECT
--   (SELECT count(*) FROM user_permissions WHERE permission_code = 'maintenance.view' AND granted) AS co_xem,
--   (SELECT count(*) FROM user_permissions WHERE permission_code = 'maintenance.qr_lookup' AND granted) AS co_qr;
