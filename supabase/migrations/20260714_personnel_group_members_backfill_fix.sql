-- Sửa lỗi backfill personnel_group_members của 2 migration trước
-- (20260607_create_personnel_groups.sql, 20260713_personnel_groups_extra.sql): cả 2 đều JOIN
-- personnel_groups theo `code` cố định (vd 'co-dien', 'bao-tri', 'co-khi') — nhưng đã xác nhận
-- qua truy vấn thực tế trên factory phuochoa_kt, các nhóm "Cơ điện"/"Bảo trì"/"Cơ khí" ở đó tồn
-- tại từ trước với code khác (co_dien/bao_tri/co_khi, dấu gạch dưới), khiến JOIN theo code không
-- khớp và backfill âm thầm chèn 0 dòng cho factory này dù nhiều nhân sự có chuc_vu khớp — đây là
-- nguyên nhân danh sách "Người thực hiện" (lọc theo group_names) hiển thị rỗng trên thực tế.
-- Fix: JOIN theo TÊN nhóm (lower(name), không phụ thuộc code) — mirror đúng cách migration gốc
-- đã làm đúng ở khối backfill từ maintenance_staff.nhom (cuối file 20260607).

INSERT INTO public.personnel_group_members (factory_id, staff_id, group_id)
SELECT ms.factory_id, ms.id, pg.id
FROM public.maintenance_staff ms
JOIN public.personnel_groups pg
  ON pg.factory_id = ms.factory_id
 AND lower(pg.name) = 'bảo trì'
WHERE ms.chuc_vu ILIKE '%bảo trì%'
ON CONFLICT (staff_id, group_id) DO NOTHING;

INSERT INTO public.personnel_group_members (factory_id, staff_id, group_id)
SELECT ms.factory_id, ms.id, pg.id
FROM public.maintenance_staff ms
JOIN public.personnel_groups pg
  ON pg.factory_id = ms.factory_id
 AND lower(pg.name) = 'cơ điện'
WHERE ms.chuc_vu ILIKE '%cơ điện%'
ON CONFLICT (staff_id, group_id) DO NOTHING;

INSERT INTO public.personnel_group_members (factory_id, staff_id, group_id)
SELECT ms.factory_id, ms.id, pg.id
FROM public.maintenance_staff ms
JOIN public.personnel_groups pg
  ON pg.factory_id = ms.factory_id
 AND lower(pg.name) = 'cơ khí'
WHERE ms.chuc_vu ILIKE '%cơ khí%'
ON CONFLICT (staff_id, group_id) DO NOTHING;
