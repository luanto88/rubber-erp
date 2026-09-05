-- Migration: Bổ sung phòng ban cho nhân sự bảo trì và chuẩn hóa dữ liệu phòng ban
-- 1. Bổ sung phong_ban và department_id vào public.maintenance_staff
ALTER TABLE public.maintenance_staff
  ADD COLUMN IF NOT EXISTS phong_ban TEXT,
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.departments(id);

CREATE INDEX IF NOT EXISTS idx_maintenance_staff_department_id
  ON public.maintenance_staff(department_id);

-- 2. Chuẩn hóa profiles: gán department_id chuẩn và thống nhất tên phòng ban
-- Nhánh đặc biệt: NMCB & Nhà máy chế biến
UPDATE public.profiles
SET department_id = d.id,
    department = d.name
FROM public.departments d
WHERE d.code = 'NMCB'
  AND (public.profiles.department = 'NMCB' OR public.profiles.department = 'Nhà máy chế biến');

-- Các phòng ban khác: backfill department_id theo code hoặc name tương ứng
UPDATE public.profiles p
SET department_id = d.id,
    department = d.name
FROM public.departments d
WHERE (p.department = d.code OR p.department = d.name)
  AND (p.department_id IS NULL OR p.department_id != d.id);

-- 3. Backfill phòng ban cho maintenance_staff từ profiles thông qua profile_id
UPDATE public.maintenance_staff ms
SET department_id = p.department_id,
    phong_ban = p.department
FROM public.profiles p
WHERE ms.profile_id = p.id
  AND p.department IS NOT NULL
  AND (ms.department_id IS NULL OR ms.phong_ban IS NULL);
