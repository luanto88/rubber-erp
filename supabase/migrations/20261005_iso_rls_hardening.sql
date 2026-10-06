-- =====================================================================================
-- Siết RLS module ISO (GĐ1 kế hoạch chuẩn hoá phân quyền ISO — 2026-10-02)
-- =====================================================================================
--
-- 1. iso_documents
--    Đang có DUY NHẤT policy "iso_documents_factory" (FOR ALL, chỉ so factory_id) từ
--    20260522_iso_vanban_module.sql ⇒ BẤT KỲ ai cùng nhà máy cũng UPDATE/DELETE được mọi tài
--    liệu ISO của người khác, kể cả tài liệu đã có hiệu lực — quy tắc "chỉ người tạo" chỉ nằm
--    ở giao diện. Tách 4 policy:
--      SELECT : cùng nhà máy (giữ nguyên phạm vi đọc cũ — danh sách, kho, việc của tôi dựa vào đây)
--      INSERT : cùng nhà máy (tạo tài liệu cha + hồ sơ con cùng lúc)
--      UPDATE : admin, HOẶC người tham gia luồng ký của chính tài liệu / tài liệu cha / tài
--               liệu cùng bộ (hồ sơ con cùng parent_doc_id), HOẶC người có `iso.phe_duyet` khi
--               hạ "có hiệu lực" → "hết hiệu lực" lúc phê duyệt soát xét (bản cũ do người khác
--               soạn, nên không thể yêu cầu là người tham gia).
--      DELETE : admin, hoặc đúng người tạo/người soạn và tài liệu còn ở trạng thái nháp
--               (mirror `canDeleteDoc` ở iso/documents/page.tsx).
--
--    Vì sao UPDATE xét "cả bộ" chứ không chỉ chính dòng đó: lúc phê duyệt/ký/đổi tuỳ chọn,
--    trang chi tiết tài liệu cha cập nhật luôn các hồ sơ con, và trang hồ sơ con cập nhật hồ
--    sơ anh em. Policy UPDATE lọc dòng mà KHÔNG báo lỗi (0 dòng bị ảnh hưởng), nên nếu chỉ xét
--    chính dòng, các cập nhật đó sẽ âm thầm không chạy.
--
--    Các route server (generate-pdf/office, restamp-pdf, convert-office, embed) dùng service
--    role nên không chịu ảnh hưởng.
--
-- 2. iso_form_instances — bổ sung người ký trong `thu_tu_ky_json` vào policy UPDATE.
--    20260908 chỉ cho nguoi_tao / xem_xet_user_id / phe_duyet_user_id, nhưng từ 20260918 hồ
--    sơ N bước ký lưu người ký trong thu_tu_ky_json ⇒ người ký bước 2+ bấm "Trả về" bị RLS lọc
--    mất, không báo lỗi.
--
-- ⚠️ BẮT BUỘC DROP policy cũ: policy PERMISSIVE cộng dồn bằng OR, quên drop thì phần siết chỉ
--    là trang trí và test vẫn "pass".
-- An toàn chạy lại nhiều lần.
-- =====================================================================================

-- ------------------------------------------------------------------------------------
-- Hàm hỗ trợ — SECURITY DEFINER để đọc lại iso_documents bên trong policy của chính bảng
-- đó mà không dính "infinite recursion detected in policy".
-- ------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.iso_doc_family_participant(
  p_doc_id UUID,
  p_parent_id UUID,
  p_user_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM iso_documents d
    WHERE (
        d.id = p_doc_id
        OR (p_parent_id IS NOT NULL AND d.id = p_parent_id)
        OR d.parent_doc_id = COALESCE(p_parent_id, p_doc_id)
      )
      AND p_user_id IN (d.created_by, d.soan_thao_user_id, d.xem_xet_user_id, d.phe_duyet_user_id)
  );
$$;

REVOKE ALL ON FUNCTION public.iso_doc_family_participant(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.iso_doc_family_participant(UUID, UUID, UUID) TO authenticated;

-- Người dùng có nằm trong mảng bước ký JSONB không. So sánh dạng TEXT (không ép ::uuid) và
-- guard jsonb_typeof — một dòng JSONB lỗi không được làm hỏng policy của cả bảng.
CREATE OR REPLACE FUNCTION public.iso_steps_include_user(
  p_steps JSONB,
  p_user_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_user_id IS NOT NULL
    AND jsonb_typeof(p_steps) = 'array'
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_steps) s
      WHERE jsonb_typeof(s) = 'object'
        AND (
          lower(s ->> 'user_id') = lower(p_user_id::text)
          OR lower(s ->> 'mat_recipient_user_id') = lower(p_user_id::text)
        )
    );
$$;

-- ------------------------------------------------------------------------------------
-- 1. iso_documents
-- ------------------------------------------------------------------------------------
ALTER TABLE iso_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "iso_documents_factory" ON iso_documents;
DROP POLICY IF EXISTS "iso_documents_select" ON iso_documents;
DROP POLICY IF EXISTS "iso_documents_insert" ON iso_documents;
DROP POLICY IF EXISTS "iso_documents_update" ON iso_documents;
DROP POLICY IF EXISTS "iso_documents_delete" ON iso_documents;

CREATE POLICY "iso_documents_select" ON iso_documents
  FOR SELECT
  USING (factory_id = public.current_profile_factory_id());

CREATE POLICY "iso_documents_insert" ON iso_documents
  FOR INSERT
  WITH CHECK (factory_id = public.current_profile_factory_id());

CREATE POLICY "iso_documents_update" ON iso_documents
  FOR UPDATE
  USING (
    factory_id = public.current_profile_factory_id()
    AND (
      public.current_profile_role() = 'admin'
      OR public.iso_doc_family_participant(id, parent_doc_id, auth.uid())
      OR (trang_thai = 'co_hieu_luc' AND public.current_profile_has_permission('iso.phe_duyet'))
    )
  )
  -- Cho phép đổi trạng thái/người ký sau khi đã qua USING; chỉ chặn chuyển sang nhà máy khác.
  WITH CHECK (factory_id = public.current_profile_factory_id());

CREATE POLICY "iso_documents_delete" ON iso_documents
  FOR DELETE
  USING (
    factory_id = public.current_profile_factory_id()
    AND (
      public.current_profile_role() = 'admin'
      OR (trang_thai = 'draft' AND auth.uid() IN (created_by, soan_thao_user_id))
    )
  );

-- ------------------------------------------------------------------------------------
-- 2. iso_form_instances — thêm người ký N bước vào UPDATE
-- ------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "iso_form_instances_update" ON iso_form_instances;

CREATE POLICY "iso_form_instances_update" ON iso_form_instances
  FOR UPDATE
  USING (
    factory_id = public.current_profile_factory_id()
    AND (
      nguoi_tao = auth.uid()
      OR xem_xet_user_id = auth.uid()
      OR phe_duyet_user_id = auth.uid()
      OR public.iso_steps_include_user(thu_tu_ky_json, auth.uid())
      OR public.current_profile_role() = 'admin'
    )
  )
  WITH CHECK (
    factory_id = public.current_profile_factory_id()
    AND (
      nguoi_tao = auth.uid()
      OR xem_xet_user_id = auth.uid()
      OR phe_duyet_user_id = auth.uid()
      OR public.iso_steps_include_user(thu_tu_ky_json, auth.uid())
      OR public.current_profile_role() = 'admin'
    )
  );

-- ------------------------------------------------------------------------------------
-- Kiểm chứng sau khi chạy:
--   SELECT policyname, cmd FROM pg_policies WHERE tablename = 'iso_documents' ORDER BY 1;
--     → đúng 4 dòng, KHÔNG còn iso_documents_factory
--   SELECT policyname, cmd FROM pg_policies WHERE tablename = 'iso_form_instances' ORDER BY 1;
--   SELECT proname, prosecdef FROM pg_proc WHERE proname = 'iso_doc_family_participant'; → true
--
-- Rollback (chỉ khi cần khẩn cấp):
--   DROP POLICY IF EXISTS "iso_documents_select" ON iso_documents;
--   DROP POLICY IF EXISTS "iso_documents_insert" ON iso_documents;
--   DROP POLICY IF EXISTS "iso_documents_update" ON iso_documents;
--   DROP POLICY IF EXISTS "iso_documents_delete" ON iso_documents;
--   CREATE POLICY "iso_documents_factory" ON iso_documents
--     USING (factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid()));
-- ------------------------------------------------------------------------------------
