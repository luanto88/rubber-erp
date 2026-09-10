-- ============================================================================
-- FIX: "new row violates row-level security policy for table van_ban_documents"
--      khi tài khoản KHÔNG PHẢI admin bấm Lưu ở màn Soạn thảo văn bản.
-- Ngày: 2026-09-16
--
-- ── TRIỆU CHỨNG ────────────────────────────────────────────────────────────
-- Tài khoản `luanto` (role=manager) đã được cấp ĐỦ 9 quyền `documents.*`
-- (documents.view granted=true) nhưng bấm Lưu vẫn báo lỗi RLS; admin thì không.
--
-- ── NGUYÊN NHÂN (đã tái hiện bằng phiên đăng nhập thật của luanto) ─────────
-- KHÔNG phải policy INSERT. Đã chứng minh: cùng payload đó, nếu bỏ `.select()`
-- (tức bỏ RETURNING) thì INSERT THÀNH CÔNG.
--
--   A: phong_ban=NMCB + cong_khai + RETURNING  → OK
--   B: phong_ban=NMCB + gioi_han  + RETURNING  → ❌ lỗi RLS
--   C: phong_ban=QLCL + cong_khai + RETURNING  → ❌ lỗi RLS
--   D: phong_ban=QLCL + cong_khai KHÔNG RETURNING → OK
--   E: phong_ban=NMCB + gioi_han  KHÔNG RETURNING → OK
--
-- Client (`documents/new/page.tsx`) dùng `.insert(payload).select("id").single()`.
-- Với PostgreSQL, INSERT có RETURNING ⇒ các SELECT policy được áp THÊM dưới dạng
-- WITH CHECK trên dòng vừa ghi (rewrite/rowsecurity.c: ACL_SELECT ⇒
-- add_with_check_options(..., WCO_RLS_INSERT_CHECK, select_rowsec_policies)).
-- Vi phạm sẽ báo ĐÚNG câu "new row violates row-level security policy for table".
--
-- Policy SELECT ở `20260915_van_ban_phan_quyen_xem.sql` đã BỎ 3 nhánh đọc trực
-- tiếp cột mà `20260914` từng có (soan_thao_user_id / created_by /
-- phe_duyet_user_id = auth.uid()), gom hết vào hàm `van_ban_is_participant()`.
-- Hàm đó SELECT LẠI chính bảng `van_ban_documents` — trong lúc đánh giá WITH CHECK
-- của chính lệnh INSERT, dòng mới CHƯA nhìn thấy được (snapshot của một lệnh không
-- bao gồm thay đổi do chính lệnh đó tạo ra) ⇒ hàm LUÔN trả false cho dòng đang ghi.
--
-- Kết quả: người soạn thảo chỉ lọt qua nhờ nhánh còn lại đọc trực tiếp cột
-- (`che_do_xem <> 'gioi_han' AND phong_ban = dept_code`) — nên chỉ soạn được văn
-- bản Công khai của ĐÚNG phòng ban mình. Admin luôn qua nhờ nhánh role='admin'
-- (không phụ thuộc dòng mới) ⇒ đúng hiện tượng "admin thì không lỗi".
--
-- ── CÁCH SỬA ───────────────────────────────────────────────────────────────
-- Thêm lại 3 nhánh đọc TRỰC TIẾP cột vào SELECT policy, đặt TRƯỚC lời gọi hàm.
-- KHÔNG nới lỏng phân quyền: cả 3 điều kiện này vốn đã nằm bên trong
-- `van_ban_is_participant()`, nên tập dòng đọc được không đổi một dòng nào —
-- chỉ khác ở chỗ chúng được đánh giá trên chính tuple thay vì phải truy vấn lại
-- bảng (đồng thời rẻ hơn: short-circuit trước khi gọi 2 hàm SECURITY DEFINER).
--
-- Sửa luôn cho UPDATE ... RETURNING (EditDocModal) — cùng cơ chế WCO.
--
-- ⚠️ QUY TẮC CHO CÁC POLICY SAU NÀY: nếu một bảng có SELECT policy dựa vào hàm
-- truy vấn lại CHÍNH bảng đó, thì mọi INSERT/UPDATE ... RETURNING trên bảng ấy sẽ
-- bị chặn. Luôn giữ ít nhất một nhánh đọc trực tiếp cột của dòng cho người tạo.
--
-- ROLLBACK: chạy lại nguyên mục 3 của 20260915_van_ban_phan_quyen_xem.sql.
-- ============================================================================

DROP POLICY IF EXISTS "van_ban_documents_select" ON van_ban_documents;
CREATE POLICY "van_ban_documents_select" ON van_ban_documents
  FOR SELECT USING (
    -- 1. Cùng nhà máy
    factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid())
    -- 2. Bắt buộc có quyền documents.view trong Cài đặt → Phân quyền
    AND public.current_profile_has_permission('documents.view')
    AND (
      -- 3. Admin xem được tất cả
      EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      -- 4. Người liên quan trực tiếp — đọc THẲNG cột của dòng.
      --    BẮT BUỘC giữ 3 nhánh này: van_ban_is_participant() không thấy được dòng
      --    đang được INSERT/UPDATE trong cùng lệnh, nên nếu thiếu, người soạn thảo
      --    sẽ không lưu được văn bản Giới hạn / văn bản của phòng ban khác.
      OR soan_thao_user_id = auth.uid()
      OR created_by = auth.uid()
      OR phe_duyet_user_id = auth.uid()
      -- 5. Người trong các bước ký / được phân phối (xem cả công khai lẫn giới hạn)
      OR public.van_ban_is_participant(van_ban_documents.id, auth.uid())
      -- 6. Văn bản công khai: người cùng phòng ban
      OR (
        che_do_xem <> 'gioi_han'
        AND phong_ban IS NOT NULL
        AND phong_ban = public.van_ban_user_dept_code(auth.uid())
      )
    )
  );

-- UPDATE ... RETURNING cũng bị áp SELECT policy (WCO_RLS_UPDATE_CHECK). USING ở đây
-- vốn đã có 3 nhánh trực tiếp; giữ nguyên, chỉ tạo lại cho đủ bộ sau khi drop ở trên
-- không cần thiết — nên KHÔNG đụng tới van_ban_documents_update/_delete.

-- ── Kiểm chứng sau khi chạy (chạy tay) ─────────────────────────────────────
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'van_ban_documents';
--   → đúng 4 dòng SELECT/INSERT/UPDATE/DELETE
-- Đăng nhập bằng tài khoản KHÔNG phải admin (vd luanto) → Soạn thảo văn bản
-- chọn phòng ban KHÁC phòng ban của mình, và/hoặc phạm vi "Giới hạn" → bấm Lưu
--   → phải lưu được, không còn lỗi RLS.
