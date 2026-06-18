ALTER TABLE export_orders
  ADD COLUMN IF NOT EXISTS trang_thai TEXT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

UPDATE export_orders
SET trang_thai = COALESCE(trang_thai, 'da_phe_duyet')
WHERE trang_thai IS NULL;

ALTER TABLE export_orders
  ALTER COLUMN trang_thai SET DEFAULT 'cho_phe_duyet';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'export_orders_trang_thai_check'
  ) THEN
    ALTER TABLE export_orders
      ADD CONSTRAINT export_orders_trang_thai_check
      CHECK (trang_thai IN ('cho_phe_duyet', 'da_phe_duyet'));
  END IF;
END $$;
