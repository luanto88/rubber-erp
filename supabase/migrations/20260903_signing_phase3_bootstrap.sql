-- ============================================================
-- Hệ thống ký số dùng chung — Giai đoạn 3, phần bootstrap hạ tầng dùng chung
-- (thí điểm module Chất lượng — Phiếu KQKN, xem CLAUDE.md/lịch sử phiên
--  "tiếp tục giai đoạn 3" và cung_cap_dl/du_an_ky_so_dung_chung - new.docx)
--
-- 4 việc độc lập, gộp 1 migration vì đều là bootstrap 1 lần:
--   1. Bucket Storage `signing-documents` — nơi lưu file_goc/file_hien_tai của
--      MỌI yeu_cauA_ky (6 module), không riêng Chất lượng. Public giống
--      `iso-documents`/`eudr-files` — mọi ghi/xoá thực tế đi qua service role
--      ở server route (bỏ qua RLS), object policy dưới đây chỉ để không chặn
--      các thao tác khác (vd sau này nếu cần) và để nhất quán với các bucket
--      public khác trong app.
--   2. Permission mới `quality.phe_duyet` — Chất lượng trước đây KHÔNG có khái
--      niệm "người phê duyệt" nào cả (chỉ có view/create/edit/delete/print/
--      import), khác Bảo trì/Xuất hàng đã có sẵn nguoi_duyet/approver. Mặc
--      định chỉ cấp cho admin (mirror đúng iso.phe_duyet — không tự động cấp
--      cho manager, phải gán tay qua Cài đặt → Phân quyền).
--   3. Seed 1 dòng `cau_hinh_tai_lieu` cho loai_tai_lieu='quality_kqkn' ở MỌI
--      factory hiện có — chỉ mang tính mô tả/hiển thị (breadcrumb SignScreen),
--      KHÔNG được đọc để tự động ánh xạ người ký (quyết định đã chốt: "tái
--      dùng logic đã có riêng từng module" — Chất lượng tự chọn người phê
--      duyệt qua UI mới, không qua dinh_tuyen).
--   4. Nới policy SELECT của `nguoi_ky` — bản gốc (20260902) chỉ cho xem ĐÚNG
--      dòng của chính mình (`user_id = auth.uid()`) ngoài owner/admin, nên 1
--      người tham gia ký (không phải owner) KHÔNG đọc được danh sách những
--      người ký khác cùng hồ sơ — chặn đứng khối "Luồng ký hồ sơ" của
--      SignScreen (ai đã ký, ai đang chờ). Đổi sang: bất kỳ participant nào
--      của ĐÚNG yeu_cau_id đó được xem toàn bộ nguoi_ky cùng hồ sơ (tên/vai
--      trò/trạng thái đồng nghiệp cùng ký 1 tài liệu — không phải dữ liệu
--      riêng tư). `truong_ky`/`nhat_ky_ky` đã đúng theo kiểu này từ đầu, chỉ
--      `nguoi_ky` bị sót khi viết migration gốc.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('signing-documents', 'signing-documents', true, 20971520)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Signing documents public read'
  ) THEN
    CREATE POLICY "Signing documents public read"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'signing-documents');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Signing documents public insert'
  ) THEN
    CREATE POLICY "Signing documents public insert"
      ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'signing-documents');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Signing documents public update'
  ) THEN
    CREATE POLICY "Signing documents public update"
      ON storage.objects FOR UPDATE
      USING (bucket_id = 'signing-documents')
      WITH CHECK (bucket_id = 'signing-documents');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Signing documents public delete'
  ) THEN
    CREATE POLICY "Signing documents public delete"
      ON storage.objects FOR DELETE
      USING (bucket_id = 'signing-documents');
  END IF;
END $$;

-- ── 2. Permission quality.phe_duyet ──────────────────────────────────────────
INSERT INTO permissions (code, module_name, action_name)
VALUES ('quality.phe_duyet', 'quality', 'phe_duyet')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role, permission_code) VALUES
  ('admin', 'quality.phe_duyet')
ON CONFLICT DO NOTHING;

-- ── 3. Seed cau_hinh_tai_lieu cho Phiếu KQKN, mọi factory hiện có ────────────
INSERT INTO cau_hinh_tai_lieu (factory_id, loai_tai_lieu, modun, ten_hien_thi, muc_xac_thuc, yeu_cau_chu_ky_so, can_dat_truong)
SELECT id, 'quality_kqkn', 'quality', 'Phiếu kết quả kiểm nghiệm', 'pin', 'khong', true
FROM factories
ON CONFLICT (factory_id, loai_tai_lieu) DO NOTHING;

-- ── 4. Nới policy SELECT của nguoi_ky cho mọi participant cùng hồ sơ ─────────
DROP POLICY IF EXISTS "nguoi_ky_select" ON public.nguoi_ky;
CREATE POLICY "nguoi_ky_select" ON public.nguoi_ky
  FOR SELECT USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      public.signing_is_yeu_cau_owner(yeu_cau_id, auth.uid())
      OR public.signing_is_participant(yeu_cau_id, auth.uid())
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );
