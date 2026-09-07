-- ============================================================================
-- Văn bản nội bộ: thay "Thường/Mật" bằng phạm vi hiển thị "Công khai / Giới hạn"
-- ----------------------------------------------------------------------------
-- BỐI CẢNH: `phan_loai = 'Mat'` CHƯA TỪNG lọc dữ liệu ở bất kỳ đâu — RLS cũ chỉ
-- lọc `factory_id`; danh sách/chi tiết/tìm kiếm không xét cột này. Khác biệt thật
-- duy nhất là định tuyến thông báo. Migration này tạo cơ chế giới hạn xem THẬT ở
-- tầng database.
--
-- THỨ TỰ TRIỂN KHAI BẮT BUỘC: chạy migration này TRƯỚC, deploy code SAU.
-- Migration là no-op về hành vi: mọi dòng hiện có = 'cong_khai' ⇒ nhánh chặn ngắn
-- `che_do_xem <> 'gioi_han'` luôn true ⇒ tương đương policy cũ. Code cũ không đọc
-- cột mới nên khoảng giữa 2 bước là an toàn.
--
-- ROLLBACK: drop 4 policy mới + tạo lại policy cũ:
--   DROP POLICY IF EXISTS "van_ban_documents_select" ON van_ban_documents;
--   DROP POLICY IF EXISTS "van_ban_documents_insert" ON van_ban_documents;
--   DROP POLICY IF EXISTS "van_ban_documents_update" ON van_ban_documents;
--   DROP POLICY IF EXISTS "van_ban_documents_delete" ON van_ban_documents;
--   CREATE POLICY "van_ban_documents_factory" ON van_ban_documents FOR ALL
--     USING (factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid()));
-- ============================================================================

-- ── 1. Cột phạm vi hiển thị ────────────────────────────────────────────────
-- NOT NULL DEFAULT trên PG11+ không rewrite bảng và tự điền 'cong_khai' cho mọi
-- dòng cũ ⇒ KHÔNG cần backfill (quyết định: dữ liệu cũ tất cả thành Công khai).
ALTER TABLE van_ban_documents
  ADD COLUMN IF NOT EXISTS che_do_xem TEXT NOT NULL DEFAULT 'cong_khai';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'van_ban_documents_che_do_xem_check'
  ) THEN
    ALTER TABLE van_ban_documents
      ADD CONSTRAINT van_ban_documents_che_do_xem_check
      CHECK (che_do_xem IN ('cong_khai', 'gioi_han'));
  END IF;
END $$;

COMMENT ON COLUMN van_ban_documents.che_do_xem IS 'cong_khai = mọi người trong nhà máy xem được; gioi_han = chỉ người soạn thảo, người trong các bước ký, người phê duyệt, người đã được Phân phối, và admin.';

COMMENT ON COLUMN van_ban_documents.phan_loai IS 'LEGACY (2026-09-06) — Thường/Mật đã bị thay bằng che_do_xem. Giữ lại để tra cứu lịch sử, code KHÔNG đọc/ghi nữa.';

COMMENT ON COLUMN van_ban_documents.cap_tl IS 'LEGACY (2026-09-05) — Cấp 1/Cấp 2 đã bỏ khỏi nghiệp vụ; so_buoc_tong là nguồn sự thật duy nhất cho việc có vòng ký hay không.';

-- ── 2. Hàm kiểm tra "người trong cuộc" ─────────────────────────────────────
-- BẮT BUỘC SECURITY DEFINER: policy của van_ban_documents phải đọc lại chính bảng
-- đó (quét thu_tu_ky_json). Không bọc hàm sẽ dính "infinite recursion detected in
-- policy" — đúng lỗi đã gặp ở operation_notes/operation_note_shares.
--
-- 3 chi tiết CỐ Ý, đừng "tối ưu" lại:
--   • So sánh dạng TEXT (lower(...)), KHÔNG ép ::uuid — một dòng JSONB rác sẽ throw
--     ngay trong policy và làm CẢ BẢNG không đọc được.
--   • Đọc luôn `mat_recipient_user_id` — văn bản "Mật" cũ tự nâng cấp thành đích
--     danh, khỏi phải migrate JSONB.
--   • Guard `jsonb_typeof(...) = 'array'` — vừa xử lý NULL (văn bản Upload ký tay
--     có thể để trống) vừa chặn giá trị JSONB không phải mảng.
CREATE OR REPLACE FUNCTION public.van_ban_is_participant(p_doc_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.van_ban_documents d
      WHERE d.id = p_doc_id
        AND (
          d.soan_thao_user_id = p_user_id
          OR d.created_by = p_user_id
          OR d.phe_duyet_user_id = p_user_id
          OR (
            -- Guard jsonb_typeof BẮT BUỘC: jsonb_array_elements() throw
            -- "cannot extract elements from an object" nếu gặp giá trị không phải mảng.
            -- Lỗi đó xảy ra BÊN TRONG policy ⇒ không chỉ hỏng 1 dòng mà làm CẢ BẢNG
            -- không đọc được, cho mọi người.
            jsonb_typeof(d.thu_tu_ky_json) = 'array'
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(d.thu_tu_ky_json) AS s
              WHERE lower(s ->> 'user_id') = lower(p_user_id::text)
                 OR lower(s ->> 'mat_recipient_user_id') = lower(p_user_id::text)
            )
          )
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.van_ban_distribution_recipients r
      WHERE r.van_ban_document_id = p_doc_id
        AND r.recipient_user_id = p_user_id
    );
$$;

REVOKE ALL ON FUNCTION public.van_ban_is_participant(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.van_ban_is_participant(UUID, UUID) TO authenticated;

-- ── 3. Policy: TÁCH 4, KHÔNG giữ FOR ALL ───────────────────────────────────
-- FOR ALL sinh WITH CHECK = USING ⇒ văn bản mới đặt 'gioi_han' mà chưa khớp điều
-- kiện sẽ bị từ chối ngay lúc INSERT.
--
-- ⚠️ DROP dưới đây là SỐNG CÒN: policy PERMISSIVE cộng dồn bằng OR. Quên drop thì
-- phần siết bên dưới chỉ là trang trí VÀ TEST VẪN "PASS" (vì mọi người vẫn xem được).
DROP POLICY IF EXISTS "van_ban_documents_factory" ON van_ban_documents;

DROP POLICY IF EXISTS "van_ban_documents_select" ON van_ban_documents;
CREATE POLICY "van_ban_documents_select" ON van_ban_documents
  FOR SELECT USING (
    factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid())
    AND (
      che_do_xem <> 'gioi_han'                    -- chặn ngắn, rẻ nhất, chạy trước
      OR soan_thao_user_id = auth.uid()
      OR phe_duyet_user_id = auth.uid()
      OR created_by = auth.uid()
      OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      -- PHẢI qualify tên bảng, nếu không: "column reference id is ambiguous"
      OR van_ban_is_participant(van_ban_documents.id, auth.uid())
    )
  );

-- INSERT giữ nguyên độ lỏng hiện tại: siết thêm sẽ chặn luồng admin tạo hộ và
-- luồng Upload ký tay (ngoài phạm vi đợt này).
DROP POLICY IF EXISTS "van_ban_documents_insert" ON van_ban_documents;
CREATE POLICY "van_ban_documents_insert" ON van_ban_documents
  FOR INSERT WITH CHECK (
    factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid())
  );

-- UPDATE: USING chặt (không thì người ngoài cuộc vẫn UPDATE mù được),
-- WITH CHECK lỏng để người soạn thảo đổi gioi_han → cong_khai mà không tự khoá mình.
DROP POLICY IF EXISTS "van_ban_documents_update" ON van_ban_documents;
CREATE POLICY "van_ban_documents_update" ON van_ban_documents
  FOR UPDATE
  USING (
    factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid())
    AND (
      che_do_xem <> 'gioi_han'
      OR soan_thao_user_id = auth.uid()
      OR phe_duyet_user_id = auth.uid()
      OR created_by = auth.uid()
      OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR van_ban_is_participant(van_ban_documents.id, auth.uid())
    )
  )
  WITH CHECK (
    factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "van_ban_documents_delete" ON van_ban_documents;
CREATE POLICY "van_ban_documents_delete" ON van_ban_documents
  FOR DELETE USING (
    factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid())
    AND (
      che_do_xem <> 'gioi_han'
      OR soan_thao_user_id = auth.uid()
      OR phe_duyet_user_id = auth.uid()
      OR created_by = auth.uid()
      OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR van_ban_is_participant(van_ban_documents.id, auth.uid())
    )
  );

-- ── 4. Index hỗ trợ ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_van_ban_documents_factory_che_do_xem
  ON van_ban_documents(factory_id, che_do_xem);

-- KHÔNG tạo UNIQUE index trên bảng recipients: bảng chưa từng có ràng buộc duy
-- nhất, rất có thể đã có dòng trùng và sẽ làm rollback CẢ migration này.
CREATE INDEX IF NOT EXISTS idx_vb_dist_recipients_doc_user
  ON van_ban_distribution_recipients(van_ban_document_id, recipient_user_id);

-- ── 5. Kiểm chứng sau khi chạy (chạy tay, không nằm trong migration) ───────
-- SELECT che_do_xem, count(*) FROM van_ban_documents GROUP BY 1;
--   → 100% 'cong_khai'
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'van_ban_documents';
--   → đúng 4 dòng (SELECT/INSERT/UPDATE/DELETE), KHÔNG còn "van_ban_documents_factory"
-- SELECT proname, proowner::regrole, prosecdef FROM pg_proc
--   WHERE proname = 'van_ban_is_participant';
--   → prosecdef = true, proowner phải là chủ bảng van_ban_documents
