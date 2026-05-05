-- Thêm cột ảnh cho bảng lots (thành phẩm)
ALTER TABLE lots ADD COLUMN IF NOT EXISTS image_url_1 TEXT;
ALTER TABLE lots ADD COLUMN IF NOT EXISTS image_url_2 TEXT;

-- Bucket product-files (ảnh lô thành phẩm)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-files',
  'product-files',
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
      AND policyname = 'Product files public read'
  ) THEN
    CREATE POLICY "Product files public read"
      ON storage.objects
      FOR SELECT
      USING (bucket_id = 'product-files');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Product files public insert'
  ) THEN
    CREATE POLICY "Product files public insert"
      ON storage.objects
      FOR INSERT
      WITH CHECK (bucket_id = 'product-files');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Product files public update'
  ) THEN
    CREATE POLICY "Product files public update"
      ON storage.objects
      FOR UPDATE
      USING (bucket_id = 'product-files')
      WITH CHECK (bucket_id = 'product-files');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Product files public delete'
  ) THEN
    CREATE POLICY "Product files public delete"
      ON storage.objects
      FOR DELETE
      USING (bucket_id = 'product-files');
  END IF;
END $$;

-- Bucket order-files (ảnh xe xuất hàng)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'order-files',
  'order-files',
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
      AND policyname = 'Order files public read'
  ) THEN
    CREATE POLICY "Order files public read"
      ON storage.objects
      FOR SELECT
      USING (bucket_id = 'order-files');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Order files public insert'
  ) THEN
    CREATE POLICY "Order files public insert"
      ON storage.objects
      FOR INSERT
      WITH CHECK (bucket_id = 'order-files');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Order files public update'
  ) THEN
    CREATE POLICY "Order files public update"
      ON storage.objects
      FOR UPDATE
      USING (bucket_id = 'order-files')
      WITH CHECK (bucket_id = 'order-files');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Order files public delete'
  ) THEN
    CREATE POLICY "Order files public delete"
      ON storage.objects
      FOR DELETE
      USING (bucket_id = 'order-files');
  END IF;
END $$;
