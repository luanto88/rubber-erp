-- ============================================================================
-- Migration: Cải tiến phân quyền xem Văn bản nội bộ
-- Ngày: 2026-09-15
--
-- Mục tiêu:
-- 1. Bắt buộc phải được phân quyền xem module trong Cài đặt (documents.view)
--    thông qua hàm public.current_profile_has_permission('documents.view').
-- 2. Đối với văn bản Công khai (che_do_xem <> 'gioi_han'):
--    Chỉ xem được văn bản thuộc phòng ban mình HOẶC có mình tham gia ký.
-- 3. Đối với văn bản Hạn chế (che_do_xem = 'gioi_han'):
--    Chỉ xem được văn bản mình tham gia ký (dù cùng phòng ban nhưng không
--    tham gia ký thì không được xem).
-- 4. Admin (role = 'admin') luôn xem được tất cả văn bản.
-- ============================================================================

-- ── 1. Hàm xác định mã phòng ban của User (3-way match) ─────────────────────
CREATE OR REPLACE FUNCTION public.van_ban_user_dept_code(p_user_id UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(
    -- 1. profile.department_id -> departments.id
    (SELECT d.code FROM public.departments d JOIN public.profiles p ON p.department_id = d.id WHERE p.id = p_user_id LIMIT 1),
    -- 2. profile.department (tên đầy đủ) -> departments.name
    (SELECT d.code FROM public.departments d JOIN public.profiles p ON p.department = d.name WHERE p.id = p_user_id LIMIT 1),
    -- 3. profile.department (chính là mã code viết hoa/thường) -> departments.code
    (SELECT d.code FROM public.departments d JOIN public.profiles p ON upper(p.department) = d.code WHERE p.id = p_user_id LIMIT 1)
  );
$$;

REVOKE ALL ON FUNCTION public.van_ban_user_dept_code(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.van_ban_user_dept_code(UUID) TO authenticated;

-- ── 2. Cập nhật hàm kiểm tra Người trong cuộc (Participant) ──────────────────
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
            jsonb_typeof(d.thu_tu_ky_json) = 'array'
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(d.thu_tu_ky_json) AS s
              WHERE lower(s ->> 'user_id') = lower(p_user_id::text)
                 OR lower(s ->> 'mat_recipient_user_id') = lower(p_user_id::text)
                 -- Hỗ trợ văn bản legacy gán theo phòng ban nhưng chưa có user_id đích danh
                 OR (
                   (s ->> 'user_id' IS NULL OR s ->> 'user_id' = '')
                   AND s ->> 'phong_ban_code' IS NOT NULL
                   AND s ->> 'phong_ban_code' = public.van_ban_user_dept_code(p_user_id)
                 )
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

-- ── 3. Cập nhật RLS Policy SELECT cho van_ban_documents ─────────────────────
DROP POLICY IF EXISTS "van_ban_documents_select" ON van_ban_documents;
CREATE POLICY "van_ban_documents_select" ON van_ban_documents
  FOR SELECT USING (
    -- 1. Cùng nhà máy
    factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid())
    -- 2. Bắt buộc có quyền documents.view trong cài đặt phân quyền
    AND public.current_profile_has_permission('documents.view')
    AND (
      -- 3. Admin xem được tất cả
      EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      -- 4. Người tham gia ký / được phân phối (xem được cả công khai lẫn hạn chế)
      OR public.van_ban_is_participant(van_ban_documents.id, auth.uid())
      -- 5. Văn bản công khai: chỉ người thuộc cùng phòng ban mới xem được
      OR (
        che_do_xem <> 'gioi_han'
        AND phong_ban IS NOT NULL
        AND phong_ban = public.van_ban_user_dept_code(auth.uid())
      )
    )
  );

-- ── 4. Cập nhật RLS Policy UPDATE cho van_ban_documents ─────────────────────
DROP POLICY IF EXISTS "van_ban_documents_update" ON van_ban_documents;
CREATE POLICY "van_ban_documents_update" ON van_ban_documents
  FOR UPDATE
  USING (
    factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid())
    AND public.current_profile_has_permission('documents.view')
    AND (
      EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR soan_thao_user_id = auth.uid()
      OR phe_duyet_user_id = auth.uid()
      OR created_by = auth.uid()
      OR public.van_ban_is_participant(van_ban_documents.id, auth.uid())
    )
  )
  WITH CHECK (
    factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid())
  );

-- ── 5. Cập nhật RLS Policy DELETE cho van_ban_documents ─────────────────────
DROP POLICY IF EXISTS "van_ban_documents_delete" ON van_ban_documents;
CREATE POLICY "van_ban_documents_delete" ON van_ban_documents
  FOR DELETE USING (
    factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid())
    AND (
      EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR (
        public.current_profile_has_permission('documents.delete')
        AND (soan_thao_user_id = auth.uid() OR created_by = auth.uid())
        AND trang_thai IN ('draft', 'tra_ve')
      )
    )
  );

-- ── 6. Index tối ưu ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_van_ban_documents_factory_phong_ban
  ON van_ban_documents(factory_id, phong_ban);
