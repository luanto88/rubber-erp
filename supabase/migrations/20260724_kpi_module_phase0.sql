-- Phase 0 — Module "Quản lý công việc & Đánh giá KPI nhân viên"
-- Xem đầy đủ kiến trúc/roadmap tại .claude/rules/27-kpi-module.md
--
-- Quyết định thiết kế quan trọng (phát hiện lúc code, khác 1 chi tiết so với thiết kế ban đầu):
-- "Nhóm nhân sự" dùng cho giao việc/KPI KHÔNG tạo bảng mới (kpi_groups/kpi_group_members) — tái
-- dùng nguyên `personnel_groups`/`personnel_group_members` đã có sẵn tại
-- Cài đặt → Hệ thống → Nhân sự (đúng vị trí người dùng yêu cầu), vì bảng này đã được thiết kế với
-- ghi chú "dùng chung cho Nhân sự, Bảo trì và các module sau này" và đã hỗ trợ 1 người thuộc nhiều
-- nhóm. Chỉ cần thêm cột `is_primary` để đánh dấu "nhóm chính" quyết định khung tiêu chí KPI khi
-- tính điểm tháng (Phase 3/4).

-- 1. Nhóm chính (KPI) trên personnel_group_members
ALTER TABLE public.personnel_group_members
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false;

-- Mỗi nhân sự chỉ có đúng 1 nhóm chính tại một thời điểm.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_personnel_group_members_primary_per_staff
  ON public.personnel_group_members(staff_id)
  WHERE is_primary;

-- 2. Permissions module KPI
INSERT INTO public.permissions (code, module_name, action_name) VALUES
  ('kpi.view', 'kpi', 'view'),
  ('kpi.assign', 'kpi', 'assign'),
  ('kpi.evaluate', 'kpi', 'evaluate'),
  ('kpi.view_all', 'kpi', 'view_all'),
  ('kpi.manage_config', 'kpi', 'manage_config')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_code) VALUES
  ('admin', 'kpi.view'),
  ('admin', 'kpi.assign'),
  ('admin', 'kpi.evaluate'),
  ('admin', 'kpi.view_all'),
  ('admin', 'kpi.manage_config'),
  ('manager', 'kpi.view'),
  ('manager', 'kpi.assign'),
  ('manager', 'kpi.evaluate'),
  ('manager', 'kpi.view_all'),
  ('user', 'kpi.view')
ON CONFLICT DO NOTHING;
