-- Bổ sung SELECT policy cho bucket "iso-documents" trên bảng storage.objects.
--
-- Vấn đề đã xác định và giải quyết:
-- Migration 20260921_iso_documents_bucket_write_lockdown.sql đã DROP mọi policy cũ của
-- iso-documents trên storage.objects và chỉ tạo lại INSERT/UPDATE/DELETE.
-- Tuy nhiên, trong cơ chế của PostgreSQL RLS và Supabase Storage API:
--   1. Lệnh INSERT khi upload file luôn có mệnh đề RETURNING * để trả metadata file về cho client.
--      PostgreSQL bắt buộc phải kiểm tra quyền SELECT (dưới dạng WCO_RLS_INSERT_CHECK) trên dòng
--      vừa chèn. Nếu không có policy SELECT nào cho phép dòng này, PostgreSQL sẽ từ chối và ném
--      ra lỗi: "new row violates row-level security policy for table objects".
--   2. Client upload với tuỳ chọn { upsert: true } còn cần SELECT để kiểm tra sự tồn tại của file.
--
-- Policy này cho phép người dùng đã xác thực (authenticated) SELECT các file thuộc factory của mình
-- (và các file chữ ký thuộc factory của mình), khớp hoàn toàn với quy tắc của INSERT/UPDATE/DELETE.

DROP POLICY IF EXISTS "ISO documents select own factory" ON storage.objects;
CREATE POLICY "ISO documents select own factory"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'iso-documents'
    AND (
      (storage.foldername(name))[1] = public.current_profile_factory_id()::text
      OR (
        (storage.foldername(name))[1] = 'signatures'
        AND (storage.foldername(name))[2] = public.current_profile_factory_id()::text
      )
    )
  );
