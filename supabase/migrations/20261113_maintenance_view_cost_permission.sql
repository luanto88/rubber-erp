-- ============================================================
-- Quyền riêng "Xem giá / chi phí bảo trì trên trang QR thiết bị" (`maintenance.view_cost`).
--
-- Trang QR `/tb/<token>` (tab Lịch sử + Vật tư) trước đây mượn `maintenance.approve` để quyết định
-- có trả đơn giá / thành tiền / chi phí hay không ⇒ Cài đặt → Phân quyền không có ô tick "xem giá".
-- Nay tách quyền riêng (nhóm Bảo trì). Admin luôn xem được.
--
-- CẤP SẴN: role / tài khoản đang có `maintenance.approve` được cấp thêm quyền mới ⇒ ai đang thấy giá
-- vẫn thấy sau khi deploy. Admin bỏ tick tay nếu muốn.
--
-- CHẠY TAY trong Supabase SQL Editor TRƯỚC khi deploy code. Idempotent — chạy lại an toàn.
-- ============================================================

BEGIN;

INSERT INTO permissions (code, module_name, action_name)
VALUES ('maintenance.view_cost', 'maintenance', 'view_cost')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role, permission_code)
SELECT DISTINCT rp.role, 'maintenance.view_cost'
FROM role_permissions rp
WHERE rp.permission_code = 'maintenance.approve'
ON CONFLICT DO NOTHING;

INSERT INTO user_permissions (user_id, permission_code, granted)
SELECT DISTINCT up.user_id, 'maintenance.view_cost', true
FROM user_permissions up
WHERE up.permission_code = 'maintenance.approve' AND up.granted = true
ON CONFLICT (user_id, permission_code) DO NOTHING;

COMMIT;

-- Kiểm tra: 2 con số nên bằng nhau.
-- SELECT
--   (SELECT count(*) FROM user_permissions WHERE permission_code = 'maintenance.approve' AND granted) AS co_duyet,
--   (SELECT count(*) FROM user_permissions WHERE permission_code = 'maintenance.view_cost' AND granted) AS co_xem_gia;
