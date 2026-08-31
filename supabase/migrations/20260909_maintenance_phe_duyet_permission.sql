-- ============================================================
-- Hệ thống ký số dùng chung — Giai đoạn 5, module Bảo trì (su_co_nho).
--
-- Permission mới `maintenance.phe_duyet` — trước đây việc chọn "Giám đốc nhà
-- máy"/"BGĐ phụ trách" (Phó giám đốc) trên biên bản chỉ dựa vào CHỨC VỤ (chọn
-- tay từ dropdown lọc theo maintenance_staff.chuc_vu), không hề kiểm tra người
-- đó có được cấp quyền phê duyệt điện tử hay không. Permission này mirror đúng
-- quality.phe_duyet (20260903)/dispatch.phe_duyet (20260908) — mặc định chỉ
-- cấp cho admin, phải gán tay qua Cài đặt → Phân quyền cho đúng tài khoản
-- Giám đốc/Phó giám đốc thật. `maintenance.approve` (đã có sẵn từ trước, cấp
-- rộng cho cả role manager) KHÔNG dùng cho việc này — permission đó gate luồng
-- phê duyệt cho_duyet→da_duyet cũ, ngữ nghĩa khác (ai cũng phê duyệt được nếu
-- có quyền, không ràng buộc đúng người giữ chức Giám đốc/PGĐ).
-- ============================================================

INSERT INTO permissions (code, module_name, action_name)
VALUES ('maintenance.phe_duyet', 'maintenance', 'phe_duyet')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role, permission_code) VALUES
  ('admin', 'maintenance.phe_duyet')
ON CONFLICT DO NOTHING;
