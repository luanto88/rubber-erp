-- ============================================================
-- Module ISO — GĐ2 chuẩn hoá bộ quyền (16 mã → 10 mã). Chạy tay trên Supabase SQL Editor.
-- Idempotent: chạy lại nhiều lần an toàn.
--
-- Kế hoạch: C:\Users\Software\.claude\plans\nh-gi-ph-n-quy-n-functional-seal.md (bảng B).
-- Đặc tả chép/gỡ PHẢI khớp tuyệt đối scripts/audit-iso-permissions.mjs (COPY_RULES, DEPRECATED)
-- — chạy script đó TRƯỚC để xem ai thay đổi gì, và SAU để xác nhận không còn gì cần chạm.
--
-- 1. Seed 2 mã mới: iso.view_library, iso.forms.view_all.
-- 2. Sửa action_name của iso.forms.* (đang lưu nhãn tiếng Việt) về chuẩn module+action.
-- 3. CHÉP QUYỀN TRƯỚC KHI GỠ — cả user_permissions (granted=true) lẫn role_permissions, vì
--    fetchPermissionCodesForUser: user có BẤT KỲ dòng user_permissions granted=true nào thì CHỈ
--    dùng tập đó, bỏ qua role_permissions.
--      iso.soat_xet  → iso.xem_xet (ghi đè cả dòng granted=false: trước đây người có soát xét
--                      THỰC SỰ xem xét được vì code chấp nhận soat_xet || xem_xet)
--      iso.soat_xet, iso.xem_xet, iso.phe_duyet → iso.forms.view_all (lãnh đạo)
--      iso.phe_duyet → iso.forms.approve
--      iso.view      → iso.view_library, iso.forms.create (đã chốt: user thường được xem tab
--                      Tài liệu ISO và lập hồ sơ thực hiện)
--      iso.create    → iso.forms.create
--    Các mã chép thêm (trừ xem_xet) KHÔNG ghi đè dòng granted=false — tôn trọng thu hồi tường minh.
-- 4. Gỡ khỏi role_permissions/user_permissions: iso.edit, iso.delete, iso.print, iso.soat_xet,
--    iso.signature, iso.forms.view, iso.forms.edit, iso.forms.delete.
--    KHÔNG xoá bản ghi trong bảng `permissions` ở đợt này (giữ 1 thời gian rồi xoá sau).
-- ============================================================

BEGIN;

-- 1 + 2 -------------------------------------------------------------------
INSERT INTO permissions (code, module_name, action_name) VALUES
  ('iso.view_library',   'iso', 'view_library'),
  ('iso.forms.view_all', 'iso', 'forms.view_all')
ON CONFLICT (code) DO NOTHING;

UPDATE permissions SET action_name = 'forms.view'    WHERE code = 'iso.forms.view';
UPDATE permissions SET action_name = 'forms.create'  WHERE code = 'iso.forms.create';
UPDATE permissions SET action_name = 'forms.edit'    WHERE code = 'iso.forms.edit';
UPDATE permissions SET action_name = 'forms.delete'  WHERE code = 'iso.forms.delete';
UPDATE permissions SET action_name = 'forms.approve' WHERE code = 'iso.forms.approve';

-- Bảo đảm các mã đích tồn tại (FK của user_permissions/role_permissions trỏ vào permissions).
INSERT INTO permissions (code, module_name, action_name) VALUES
  ('iso.xem_xet',       'iso', 'xem_xet'),
  ('iso.forms.create',  'iso', 'forms.create'),
  ('iso.forms.approve', 'iso', 'forms.approve')
ON CONFLICT (code) DO NOTHING;

-- 3a. user_permissions ----------------------------------------------------
-- soát xét → xem xét: ghi đè cả granted=false.
INSERT INTO user_permissions (user_id, permission_code, granted)
SELECT up.user_id, 'iso.xem_xet', true
FROM user_permissions up
WHERE up.permission_code = 'iso.soat_xet' AND up.granted = true
ON CONFLICT (user_id, permission_code) DO UPDATE SET granted = true;

-- Các quy tắc còn lại: chỉ thêm khi chưa có dòng nào.
INSERT INTO user_permissions (user_id, permission_code, granted)
SELECT DISTINCT up.user_id, m.target, true
FROM user_permissions up
JOIN (VALUES
  ('iso.soat_xet',  'iso.forms.view_all'),
  ('iso.xem_xet',   'iso.forms.view_all'),
  ('iso.phe_duyet', 'iso.forms.view_all'),
  ('iso.phe_duyet', 'iso.forms.approve'),
  ('iso.view',      'iso.view_library'),
  ('iso.view',      'iso.forms.create'),
  ('iso.create',    'iso.forms.create')
) AS m(source, target) ON m.source = up.permission_code
WHERE up.granted = true
ON CONFLICT (user_id, permission_code) DO NOTHING;

-- 3b. role_permissions ----------------------------------------------------
INSERT INTO role_permissions (role, permission_code)
SELECT DISTINCT rp.role, m.target
FROM role_permissions rp
JOIN (VALUES
  ('iso.soat_xet',  'iso.xem_xet'),
  ('iso.soat_xet',  'iso.forms.view_all'),
  ('iso.xem_xet',   'iso.forms.view_all'),
  ('iso.phe_duyet', 'iso.forms.view_all'),
  ('iso.phe_duyet', 'iso.forms.approve'),
  ('iso.view',      'iso.view_library'),
  ('iso.view',      'iso.forms.create'),
  ('iso.create',    'iso.forms.create')
) AS m(source, target) ON m.source = rp.permission_code
ON CONFLICT DO NOTHING;

-- Admin luôn có đủ bộ mới (hasPermission đã trả true cho admin, đây chỉ để Cài đặt hiện đúng).
INSERT INTO role_permissions (role, permission_code) VALUES
  ('admin', 'iso.view_library'),
  ('admin', 'iso.forms.view_all'),
  ('admin', 'iso.forms.create'),
  ('admin', 'iso.forms.approve')
ON CONFLICT DO NOTHING;

-- 4. Gỡ mã bỏ ----------------------------------------------------------------
DELETE FROM user_permissions WHERE permission_code IN (
  'iso.edit', 'iso.delete', 'iso.print', 'iso.soat_xet', 'iso.signature',
  'iso.forms.view', 'iso.forms.edit', 'iso.forms.delete'
);
DELETE FROM role_permissions WHERE permission_code IN (
  'iso.edit', 'iso.delete', 'iso.print', 'iso.soat_xet', 'iso.signature',
  'iso.forms.view', 'iso.forms.edit', 'iso.forms.delete'
);

COMMIT;

-- ============================================================
-- Kiểm chứng sau khi chạy:
--   SELECT permission_code, count(*) FROM user_permissions
--   WHERE permission_code LIKE 'iso.%' AND granted GROUP BY 1 ORDER BY 1;
--   -- không được còn iso.edit/delete/print/soat_xet/signature/forms.view/edit/delete
--
--   SELECT role, string_agg(permission_code, ', ' ORDER BY permission_code)
--   FROM role_permissions WHERE permission_code LIKE 'iso.%' GROUP BY role;
--
-- Rồi chạy: node --env-file=.env.local scripts/audit-iso-permissions.mjs
--   → "User còn cần migration chạm tới" phải = 0.
-- ============================================================
