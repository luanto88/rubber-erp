INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'inventory-files',
  'inventory-files',
  true,
  10485760,
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Inventory files public read'
  ) THEN
    CREATE POLICY "Inventory files public read"
      ON storage.objects
      FOR SELECT
      USING (bucket_id = 'inventory-files');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Inventory files public insert'
  ) THEN
    CREATE POLICY "Inventory files public insert"
      ON storage.objects
      FOR INSERT
      WITH CHECK (bucket_id = 'inventory-files');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Inventory files public update'
  ) THEN
    CREATE POLICY "Inventory files public update"
      ON storage.objects
      FOR UPDATE
      USING (bucket_id = 'inventory-files')
      WITH CHECK (bucket_id = 'inventory-files');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Inventory files public delete'
  ) THEN
    CREATE POLICY "Inventory files public delete"
      ON storage.objects
      FOR DELETE
      USING (bucket_id = 'inventory-files');
  END IF;
END $$;
