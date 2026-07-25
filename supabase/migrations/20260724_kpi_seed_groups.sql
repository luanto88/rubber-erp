-- Seed 5 nhóm nhân sự khởi điểm cho module Quản lý công việc & KPI (theo yêu cầu người dùng
-- 2026-07-24), tiếp nối các nhóm hệ thống Bảo trì đã seed trong 20260607_create_personnel_groups.sql
-- và 20260713_personnel_groups_extra.sql. Không tự backfill personnel_group_members — admin tự
-- gán từng nhân sự vào nhóm phù hợp qua Cài đặt → Hệ thống → Nhân sự (không có chuỗi chuc_vu nào
-- đáng tin cậy để tự đoán, tránh gán sai như case Phó Tổng Giám đốc từng gặp).
--
-- is_system = false (khác 5 nhóm Bảo trì) — admin được sửa/xóa tự do các nhóm này qua UI.

INSERT INTO public.personnel_groups (factory_id, code, name, description, is_system, is_active, sort_order)
SELECT f.id, 'san-luong', 'Nhóm sản lượng', 'Nhóm KPI — sản lượng', false, true, 60
FROM public.factories f
ON CONFLICT DO NOTHING;

INSERT INTO public.personnel_groups (factory_id, code, name, description, is_system, is_active, sort_order)
SELECT f.id, 'chat-luong', 'Nhóm chất lượng', 'Nhóm KPI — chất lượng', false, true, 70
FROM public.factories f
ON CONFLICT DO NOTHING;

INSERT INTO public.personnel_groups (factory_id, code, name, description, is_system, is_active, sort_order)
SELECT f.id, 'nuoc-thai', 'Nhóm nước thải', 'Nhóm KPI — nước thải', false, true, 80
FROM public.factories f
ON CONFLICT DO NOTHING;

INSERT INTO public.personnel_groups (factory_id, code, name, description, is_system, is_active, sort_order)
SELECT f.id, 'ky-thuat', 'Nhóm kỹ thuật', 'Nhóm KPI — kỹ thuật', false, true, 90
FROM public.factories f
ON CONFLICT DO NOTHING;

INSERT INTO public.personnel_groups (factory_id, code, name, description, is_system, is_active, sort_order)
SELECT f.id, 'to-chuc', 'Nhóm tổ chức', 'Nhóm KPI — tổ chức', false, true, 100
FROM public.factories f
ON CONFLICT DO NOTHING;
