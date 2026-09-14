-- ============================================================
-- Module ISO — permission mới `iso.view_het_hieu_luc`.
--
-- Trước đây bất kỳ ai có `iso.view` đều mở/tải được file của tài liệu ĐÃ HẾT
-- HIỆU LỰC, trong khi nghiệp vụ ISO yêu cầu ngược lại: bản hết hiệu lực không
-- được dùng cho công việc, chỉ người được giao nhiệm vụ đối chiếu/lưu trữ mới
-- cần mở nội dung. Từ nay người chỉ có `iso.view` vẫn xem được toàn bộ THÔNG
-- TIN chi tiết của bản hết hiệu lực (mã, tên, ngày hiệu lực/hết hiệu lực,
-- lịch sử ký) nhưng nút mở file và tải file bị ẩn.
--
-- Mirror đúng cách quality.phe_duyet (20260903) / dispatch.phe_duyet (20260908)
-- / maintenance.phe_duyet (20260909) đang làm: chỉ seed cho admin, còn lại admin
-- tự cấp tay qua Cài đặt → Phân quyền cho đúng người (Trưởng ban ISO, QLCL...).
--
-- Lưu ý: `hasPermission()` (src/lib/auth.ts) cho role='admin' đi qua mọi quyền,
-- nên dòng seed role_permissions dưới đây chủ yếu để checkbox trong Cài đặt →
-- Phân quyền hiển thị đúng trạng thái, không phải điều kiện để admin dùng được.
-- ============================================================

INSERT INTO permissions (code, module_name, action_name)
VALUES ('iso.view_het_hieu_luc', 'iso', 'view_het_hieu_luc')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role, permission_code) VALUES
  ('admin', 'iso.view_het_hieu_luc')
ON CONFLICT DO NOTHING;
