-- Thắt lại RLS ghi (INSERT/UPDATE/DELETE) của bucket "iso-documents" — chứa file của CẢ 3
-- module dùng chung bucket này: Tài liệu ISO, Hồ sơ thực hiện ISO, Văn bản nội bộ.
--
-- Đây là BƯỚC 1 trong 2 bước — bước này AN TOÀN CHẠY NGAY, không phụ thuộc gì khác, không đổi
-- hành vi đọc file (bucket vẫn public cho tới khi chạy
-- 20260921_iso_documents_bucket_private.sql ở BƯỚC 2). Chỉ siết lại quyền GHI để không còn
-- phụ thuộc vào trạng thái policy cũ không rõ ràng (bucket này KHÔNG có migration tạo trong
-- repo — tạo tay qua Supabase Dashboard trước đây, nên không biết chắc policy hiện tại có kèm
-- "TO authenticated" hay không, cùng loại lỗ hổng đã xác nhận và vá cho eudr-files/
-- inventory-files ở 20260819/20260820 — nơi đó anon chưa đăng nhập vẫn tải/ghi đè/xoá được).
--
-- Vì KHÔNG biết trước tên các policy hiện có (khác EUDR/Inventory, nơi biết chính xác tên cũ để
-- DROP POLICY IF EXISTS đích danh), dùng 1 khối PL/pgSQL tự tìm và xoá MỌI policy hiện có của
-- storage.objects có nhắc tới 'iso-documents' trong biểu thức USING/WITH CHECK, bất kể tên gì —
-- an toàn chạy lại nhiều lần (idempotent).
--
-- Đã audit toàn bộ .upload() call site trong src/ (không đoán) — bucket này có đúng 2 kiểu
-- đường dẫn:
--   1. {factory_id}/...  (iso/..., vanban/...)                    -> segment [1] = factory_id
--   2. signatures/{factory_id}/{user_id}/chu_ky.png                -> segment [2] = factory_id,
--      segment [3] = user_id — chỉ chính chủ được ghi/ghi đè/xoá chữ ký của mình (trước đây có
--      thể bất kỳ ai cùng nhà máy cũng ghi được, tuỳ policy cũ không rõ ràng — nay siết đúng).
--
-- KHÔNG tạo policy SELECT nào cho anon/authenticated ở đây — xem lý do đầy đủ ở
-- 20260921_iso_documents_bucket_private.sql (bước 2): mọi lượt đọc sau này đi qua route server
-- dùng service role để mint Signed URL ngắn hạn, service role tự bypass RLS nên không cần
-- policy SELECT nào cho vai trò khác.

DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND (
        COALESCE(qual, '') ILIKE '%iso-documents%'
        OR COALESCE(with_check, '') ILIKE '%iso-documents%'
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "ISO documents insert own factory"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'iso-documents'
    AND (
      (storage.foldername(name))[1] = public.current_profile_factory_id()::text
      OR (
        (storage.foldername(name))[1] = 'signatures'
        AND (storage.foldername(name))[2] = public.current_profile_factory_id()::text
        AND (storage.foldername(name))[3] = auth.uid()::text
      )
    )
  );

CREATE POLICY "ISO documents update own factory"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'iso-documents'
    AND (
      (storage.foldername(name))[1] = public.current_profile_factory_id()::text
      OR (
        (storage.foldername(name))[1] = 'signatures'
        AND (storage.foldername(name))[2] = public.current_profile_factory_id()::text
        AND (storage.foldername(name))[3] = auth.uid()::text
      )
    )
  )
  WITH CHECK (
    bucket_id = 'iso-documents'
    AND (
      (storage.foldername(name))[1] = public.current_profile_factory_id()::text
      OR (
        (storage.foldername(name))[1] = 'signatures'
        AND (storage.foldername(name))[2] = public.current_profile_factory_id()::text
        AND (storage.foldername(name))[3] = auth.uid()::text
      )
    )
  );

CREATE POLICY "ISO documents delete own factory"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'iso-documents'
    AND (
      (storage.foldername(name))[1] = public.current_profile_factory_id()::text
      OR (
        (storage.foldername(name))[1] = 'signatures'
        AND (storage.foldername(name))[2] = public.current_profile_factory_id()::text
        AND (storage.foldername(name))[3] = auth.uid()::text
      )
    )
  );

-- Kiểm chứng sau khi chạy (chạy tay, không phải phần migration):
--   SELECT policyname, cmd, roles FROM pg_policies
--   WHERE schemaname='storage' AND tablename='objects' AND qual ILIKE '%iso-documents%'
--      OR with_check ILIKE '%iso-documents%';
-- Kỳ vọng: đúng 3 dòng trên (insert/update/delete), roles = {authenticated}.
