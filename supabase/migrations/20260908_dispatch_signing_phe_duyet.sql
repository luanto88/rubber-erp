-- ============================================================
-- Hệ thống ký số dùng chung — Giai đoạn 4, module Điều xe (đầu tiên trong
-- nhóm "DỄ" — xem CLAUDE.md mục "Kế hoạch phiên sau — Giai đoạn 4").
--
-- Permission mới `dispatch.phe_duyet` — Điều xe trước đây KHÔNG có khái niệm
-- "người phê duyệt" (chỉ view/create/edit/delete/import). Mặc định chỉ cấp
-- cho admin (mirror đúng quality.phe_duyet ở migration 20260903 — không tự
-- động cấp cho manager, phải gán tay qua Cài đặt → Phân quyền cho đúng người
-- giữ vai trò "Giám đốc nhà máy").
--
-- Không cần migration nào khác: bucket `signing-documents`, 6 bảng lõi
-- (yeu_cau_ky/nguoi_ky/truong_ky/...) và unique index chống trùng yêu cầu ký
-- (`uniq_yeu_cau_ky_active_business_key`, migration 20260904) đã dùng chung
-- cho MỌI module (có `modun` trong khóa) — Điều xe tự động được bảo vệ, không
-- cần migration dedup riêng như Chất lượng đã từng cần.
-- ============================================================

INSERT INTO permissions (code, module_name, action_name)
VALUES ('dispatch.phe_duyet', 'dispatch', 'phe_duyet')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role, permission_code) VALUES
  ('admin', 'dispatch.phe_duyet')
ON CONFLICT DO NOTHING;
