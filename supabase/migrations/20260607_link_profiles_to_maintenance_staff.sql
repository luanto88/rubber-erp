ALTER TABLE public.maintenance_staff
  ADD COLUMN IF NOT EXISTS profile_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_maintenance_staff_profile_id
  ON public.maintenance_staff(profile_id)
  WHERE profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_maintenance_staff_factory_profile
  ON public.maintenance_staff(factory_id, profile_id);

UPDATE public.maintenance_staff ms
SET profile_id = p.id
FROM public.profiles p
WHERE ms.profile_id IS NULL
  AND ms.factory_id = p.factory_id
  AND upper(trim(ms.ten)) = upper(trim(p.full_name));
