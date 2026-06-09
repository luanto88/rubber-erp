ALTER TABLE public.maintenance_staff
  ADD COLUMN IF NOT EXISTS email TEXT;

CREATE INDEX IF NOT EXISTS idx_maintenance_staff_factory_email
  ON public.maintenance_staff(factory_id, email);
