CREATE TABLE IF NOT EXISTS public.personnel_groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  code TEXT,
  name TEXT NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_personnel_groups_factory_code
  ON public.personnel_groups(factory_id, code)
  WHERE code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_personnel_groups_factory_name_lower
  ON public.personnel_groups(factory_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_personnel_groups_factory_active
  ON public.personnel_groups(factory_id, is_active, sort_order, name);

CREATE TABLE IF NOT EXISTS public.personnel_group_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.maintenance_staff(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.personnel_groups(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(staff_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_personnel_group_members_factory
  ON public.personnel_group_members(factory_id);

CREATE INDEX IF NOT EXISTS idx_personnel_group_members_staff
  ON public.personnel_group_members(staff_id);

CREATE INDEX IF NOT EXISTS idx_personnel_group_members_group
  ON public.personnel_group_members(group_id);

INSERT INTO public.personnel_groups (factory_id, code, name, description, is_system, is_active, sort_order)
SELECT f.id, 'bao-tri', 'Bảo trì', 'Nhóm hệ thống cho module Bảo trì', true, true, 10
FROM public.factories f
ON CONFLICT DO NOTHING;

INSERT INTO public.personnel_groups (factory_id, code, name, description, is_system, is_active, sort_order)
SELECT f.id, 'co-dien', 'Cơ điện', 'Nhóm hệ thống cho nhân sự cơ điện', true, true, 20
FROM public.factories f
ON CONFLICT DO NOTHING;

INSERT INTO public.personnel_group_members (factory_id, staff_id, group_id)
SELECT ms.factory_id, ms.id, pg.id
FROM public.maintenance_staff ms
JOIN public.personnel_groups pg
  ON pg.factory_id = ms.factory_id
 AND pg.code = 'bao-tri'
WHERE ms.chuc_vu ILIKE '%bảo trì%'
ON CONFLICT (staff_id, group_id) DO NOTHING;

INSERT INTO public.personnel_group_members (factory_id, staff_id, group_id)
SELECT ms.factory_id, ms.id, pg.id
FROM public.maintenance_staff ms
JOIN public.personnel_groups pg
  ON pg.factory_id = ms.factory_id
 AND pg.code = 'co-dien'
WHERE ms.chuc_vu ILIKE '%cơ điện%'
ON CONFLICT (staff_id, group_id) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'maintenance_staff'
      AND column_name = 'nhom'
  ) THEN
    INSERT INTO public.personnel_groups (factory_id, code, name, description, is_system, is_active, sort_order)
    SELECT DISTINCT
      ms.factory_id,
      lower(regexp_replace(trim(group_name), '[^a-zA-Z0-9]+', '-', 'g')) AS code,
      trim(group_name) AS name,
      'Nhóm được backfill từ maintenance_staff.nhom',
      false,
      true,
      100
    FROM public.maintenance_staff ms
    CROSS JOIN LATERAL regexp_split_to_table(COALESCE(ms.nhom, ''), '\s*,\s*') AS group_name
    WHERE ms.factory_id IS NOT NULL
      AND trim(group_name) <> ''
    ON CONFLICT DO NOTHING;

    INSERT INTO public.personnel_group_members (factory_id, staff_id, group_id)
    SELECT DISTINCT
      ms.factory_id,
      ms.id,
      pg.id
    FROM public.maintenance_staff ms
    CROSS JOIN LATERAL regexp_split_to_table(COALESCE(ms.nhom, ''), '\s*,\s*') AS group_name
    JOIN public.personnel_groups pg
      ON pg.factory_id = ms.factory_id
     AND lower(pg.name) = lower(trim(group_name))
    WHERE ms.factory_id IS NOT NULL
      AND trim(group_name) <> ''
    ON CONFLICT (staff_id, group_id) DO NOTHING;
  END IF;
END $$;
