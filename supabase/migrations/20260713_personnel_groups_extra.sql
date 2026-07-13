-- Bổ sung 3 nhóm nhân sự hệ thống cho module Bảo trì (Cơ khí, Trực ca, Bảo vệ),
-- tiếp nối 2 nhóm đã seed sẵn (Bảo trì, Cơ điện) trong 20260607_create_personnel_groups.sql.
-- Dùng để lọc danh sách "Nhân viên phụ trách" / "Người thực hiện" theo nhóm vận hành thay vì
-- so khớp chuỗi chuc_vu (tránh lọt nhân sự quản lý cấp cao như Phó Tổng Giám đốc vào danh sách).

INSERT INTO public.personnel_groups (factory_id, code, name, description, is_system, is_active, sort_order)
SELECT f.id, 'co-khi', 'Cơ khí', 'Nhóm hệ thống cho nhân sự cơ khí', true, true, 30
FROM public.factories f
ON CONFLICT DO NOTHING;

INSERT INTO public.personnel_groups (factory_id, code, name, description, is_system, is_active, sort_order)
SELECT f.id, 'truc-ca', 'Trực ca', 'Nhóm hệ thống cho nhân sự trực ca', true, true, 40
FROM public.factories f
ON CONFLICT DO NOTHING;

INSERT INTO public.personnel_groups (factory_id, code, name, description, is_system, is_active, sort_order)
SELECT f.id, 'bao-ve', 'Bảo vệ', 'Nhóm hệ thống cho nhân sự bảo vệ', true, true, 50
FROM public.factories f
ON CONFLICT DO NOTHING;

-- Backfill best-effort theo chuc_vu — chỉ mang tính gợi ý ban đầu, admin cần rà lại
-- trong Cài đặt → Bảo trì → Nhân sự bảo trì sau khi chạy migration này.
INSERT INTO public.personnel_group_members (factory_id, staff_id, group_id)
SELECT ms.factory_id, ms.id, pg.id
FROM public.maintenance_staff ms
JOIN public.personnel_groups pg ON pg.factory_id = ms.factory_id AND pg.code = 'co-khi'
WHERE ms.chuc_vu ILIKE '%cơ khí%'
ON CONFLICT (staff_id, group_id) DO NOTHING;

INSERT INTO public.personnel_group_members (factory_id, staff_id, group_id)
SELECT ms.factory_id, ms.id, pg.id
FROM public.maintenance_staff ms
JOIN public.personnel_groups pg ON pg.factory_id = ms.factory_id AND pg.code = 'truc-ca'
WHERE ms.chuc_vu ILIKE '%trực ca%'
ON CONFLICT (staff_id, group_id) DO NOTHING;

INSERT INTO public.personnel_group_members (factory_id, staff_id, group_id)
SELECT ms.factory_id, ms.id, pg.id
FROM public.maintenance_staff ms
JOIN public.personnel_groups pg ON pg.factory_id = ms.factory_id AND pg.code = 'bao-ve'
WHERE ms.chuc_vu ILIKE '%bảo vệ%'
ON CONFLICT (staff_id, group_id) DO NOTHING;
