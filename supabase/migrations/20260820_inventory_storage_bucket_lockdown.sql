-- Thắt lại RLS của bucket "inventory-files" (ảnh chứng từ Nhập/Xuất/Chuyển kho vật tư).
--
-- Cùng lỗ hổng đã vá cho bucket "eudr-files" ở 20260819_eudr_storage_bucket_lockdown.sql:
-- 3 policy INSERT/UPDATE/DELETE gốc (20260501_inventory_storage_bucket.sql,
-- inventory_combined_migration.sql) chỉ có điều kiện `bucket_id = 'inventory-files'`,
-- KHÔNG có "TO authenticated" — Postgres áp dụng cho PUBLIC gồm cả role anon. Đã xác nhận
-- trực tiếp bằng script test: người dùng CHƯA đăng nhập tải được ảnh PNG lên bucket này,
-- ghi đè được ảnh cũ (path trùng, upsert), và xóa được bất kỳ ảnh nào của bất kỳ nhà máy nào.
--
-- 2 bucket còn lại tạo cùng migration gốc (product-files, order-files) đã xác nhận KHÔNG bị
-- lỗi này khi test trực tiếp (anon upload bị RLS chặn) — có thể đã được thắt lại thủ công qua
-- Supabase Dashboard ở thời điểm nào đó, không khớp với các policy "public" trong migration
-- file cũ. Không đụng 2 bucket đó ở migration này — chỉ vá đúng bucket còn hở.
--
-- SELECT giữ nguyên public — ảnh chứng từ kho vẫn cần xem được qua URL công khai (in phiếu,
-- xem lại chứng từ) không cần đăng nhập lại.
--
-- Path convention: {factory_id}/{documentType}/{timestamp}_{filename} — xem
-- uploadInventoryImage() (inventory-image-upload.tsx) và /api/storage/upload-image/route.ts.

DROP POLICY IF EXISTS "Inventory files public insert" ON storage.objects;
CREATE POLICY "Inventory files insert own factory"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'inventory-files'
    AND (storage.foldername(name))[1] = public.current_profile_factory_id()::text
  );

DROP POLICY IF EXISTS "Inventory files public update" ON storage.objects;
CREATE POLICY "Inventory files update own factory"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'inventory-files'
    AND (storage.foldername(name))[1] = public.current_profile_factory_id()::text
  )
  WITH CHECK (
    bucket_id = 'inventory-files'
    AND (storage.foldername(name))[1] = public.current_profile_factory_id()::text
  );

DROP POLICY IF EXISTS "Inventory files public delete" ON storage.objects;
CREATE POLICY "Inventory files delete own factory"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'inventory-files'
    AND (storage.foldername(name))[1] = public.current_profile_factory_id()::text
  );
