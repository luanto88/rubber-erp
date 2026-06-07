ALTER TABLE public.maintenance_staff
  ADD COLUMN IF NOT EXISTS gioi_tinh TEXT,
  ADD COLUMN IF NOT EXISTS chuc_vu_chinh_quyen TEXT,
  ADD COLUMN IF NOT EXISTS chuc_vu_kim_nhiem TEXT;
