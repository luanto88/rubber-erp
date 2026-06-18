INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES (
  'eudr-files',
  'eudr-files',
  true,
  52428800
)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'EUDR files public read'
  ) THEN
    CREATE POLICY "EUDR files public read"
      ON storage.objects
      FOR SELECT
      USING (bucket_id = 'eudr-files');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'EUDR files public insert'
  ) THEN
    CREATE POLICY "EUDR files public insert"
      ON storage.objects
      FOR INSERT
      WITH CHECK (bucket_id = 'eudr-files');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'EUDR files public update'
  ) THEN
    CREATE POLICY "EUDR files public update"
      ON storage.objects
      FOR UPDATE
      USING (bucket_id = 'eudr-files')
      WITH CHECK (bucket_id = 'eudr-files');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'EUDR files public delete'
  ) THEN
    CREATE POLICY "EUDR files public delete"
      ON storage.objects
      FOR DELETE
      USING (bucket_id = 'eudr-files');
  END IF;
END $$;
