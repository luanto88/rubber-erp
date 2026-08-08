-- Thắt lại RLS của bucket "eudr-files" (file DDS đính kèm: hợp đồng, invoice...).
--
-- Trước migration này, 3 policy INSERT/UPDATE/DELETE của storage.objects cho bucket này
-- chỉ có điều kiện `bucket_id = 'eudr-files'`, KHÔNG kèm role/auth/path nào (xem
-- 20260618_eudr_storage_bucket.sql) — nghĩa là BẤT KỲ AI, kể cả chưa đăng nhập (vì không
-- có "TO authenticated", Postgres áp dụng cho PUBLIC gồm cả role anon), đều có thể:
--   - upload file rác vào bất kỳ path nào
--   - GHI ĐÈ nội dung 1 file đã tồn tại (kể cả file DDS đã chia sẻ qua QR/link cho khách
--     hàng — URL không đổi, chỉ nội dung đổi, phá vỡ tính "không thể giả mạo" của tài
--     liệu tuân thủ EUDR)
--   - xóa bất kỳ file nào của bất kỳ nhà máy nào
--
-- SELECT giữ nguyên public — đúng mục đích thiết kế (QR/link chia sẻ file ra ngoài
-- không cần đăng nhập, xem eudr-order-public-client.tsx).
--
-- Path convention nhất quán ở cả 2 nơi ghi file (buildEudrStoragePath() trong
-- EudrClient.tsx, storagePath trong api/eudr/upload/route.ts): {factory_id}/{order_code}/
-- {timestamp}_{filename} — dùng storage.foldername(name)[1] để lấy đúng segment factory_id
-- đầu tiên, so với current_profile_factory_id() (hàm SECURITY DEFINER có sẵn từ
-- 20260429_auth_profiles_permissions.sql). Route /api/eudr/upload dùng service role nên
-- không bị ảnh hưởng bởi các policy này (bypass RLS); EudrClient.tsx thử upload thẳng từ
-- browser trước, nếu lỗi policy thì tự fallback sang route server — không phá vỡ luồng
-- upload hợp lệ của nhân viên đang đăng nhập đúng nhà máy.

DROP POLICY IF EXISTS "EUDR files public insert" ON storage.objects;
CREATE POLICY "EUDR files insert own factory"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'eudr-files'
    AND (storage.foldername(name))[1] = public.current_profile_factory_id()::text
  );

DROP POLICY IF EXISTS "EUDR files public update" ON storage.objects;
CREATE POLICY "EUDR files update own factory"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'eudr-files'
    AND (storage.foldername(name))[1] = public.current_profile_factory_id()::text
  )
  WITH CHECK (
    bucket_id = 'eudr-files'
    AND (storage.foldername(name))[1] = public.current_profile_factory_id()::text
  );

DROP POLICY IF EXISTS "EUDR files public delete" ON storage.objects;
CREATE POLICY "EUDR files delete own factory"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'eudr-files'
    AND (storage.foldername(name))[1] = public.current_profile_factory_id()::text
  );
