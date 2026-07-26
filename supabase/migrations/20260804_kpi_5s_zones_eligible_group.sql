-- Module KPI — nhóm khu vực 5S theo khu vực vật lý (Văn phòng, Kho 1, Kho 2, Ca SX mủ
-- tạp, Ca SX mủ nước...), dùng để giới hạn pool ứng viên khi "Phân công thông minh" random
-- chỉ trong nội bộ nhóm, không random xuyên suốt cả nhà máy.
--
-- Tái dùng nguyên personnel_groups đã có sẵn (đúng quyết định gốc Phase 0 của module KPI —
-- không tạo bảng nhóm mới). Admin tự tạo các nhóm MỚI thuần túy cho mục đích 5S qua UI
-- Cài đặt → Hệ thống → Nhân sự đã có sẵn — migration này không seed dữ liệu.
-- Xem đầy đủ .claude/rules/27-kpi-module.md.

ALTER TABLE public.kpi_5s_zones
  ADD COLUMN IF NOT EXISTS eligible_group_id UUID REFERENCES public.personnel_groups(id) ON DELETE SET NULL;

-- NULL = hành vi cũ (pool toàn nhà máy) — backward-compatible với khu vực đã tạo trước đó.
