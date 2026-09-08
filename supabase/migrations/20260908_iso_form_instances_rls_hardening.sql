-- =====================================================================================
-- Siết RLS cho module "Thực hiện hồ sơ ISO" (Giai đoạn 1 — kế hoạch ký số ISO 2026-09-08)
-- =====================================================================================
--
-- LỖ HỔNG ĐANG CÓ (migration 20260607_iso_form_instances.sql):
--
--   CREATE POLICY "iso_form_instances_factory" ON iso_form_instances
--     USING (factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid()));
--
-- Không có mệnh đề `FOR` nên mặc định là `FOR ALL`, và không có `WITH CHECK` nên Postgres
-- dùng luôn biểu thức `USING` cho cả INSERT/UPDATE. Hệ quả: BẤT KỲ tài khoản nào cùng nhà
-- máy đều UPDATE/DELETE được MỌI hồ sơ của người khác — kể cả hồ sơ đã phê duyệt xong.
-- Đây không phải rủi ro lý thuyết: `forms/page.tsx` và `forms/[id]/page.tsx` gọi thẳng
-- `supabase.from("iso_form_instances").update(...)/.delete()` từ trình duyệt, nên chỉ cần
-- devtools là thao tác được. Bảng log `iso_form_instance_logs` cũng dính y hệt — nhật ký
-- kiểm toán hiện đang XOÁ ĐƯỢC bởi người dùng thường.
--
-- ⚠️ BẮT BUỘC `DROP POLICY` bản cũ, không được chỉ thêm policy mới: policy PERMISSIVE cộng
-- dồn với nhau bằng OR, nên nếu quên drop thì phần siết dưới đây chỉ là trang trí — và tệ
-- hơn, kịch bản test vẫn "pass" vì mọi thao tác hợp lệ vẫn chạy được.
--
-- Các route server (`clone`, `finalize`, `notify`) dùng service role nên KHÔNG chịu ảnh
-- hưởng của RLS — migration này chỉ siết đường ghi trực tiếp từ trình duyệt.
--
-- KHÁC BIỆT NHỎ CÓ CHỦ ĐÍCH: policy cũ so `factory_id` bằng subquery `profiles` thuần, còn
-- các policy dưới đây dùng `public.current_profile_factory_id()` / `current_profile_role()`
-- (SECURITY DEFINER, đã lọc sẵn `status = 'active'`). Nghĩa là tài khoản `pending`/`disabled`
-- từ nay không đọc/ghi được bảng này nữa — đúng mong muốn, và đồng nhất với các bảng đã siết
-- RLS trước đó trong repo.
--
-- An toàn chạy lại nhiều lần (idempotent).
-- =====================================================================================

-- ------------------------------------------------------------------------------------
-- 1. iso_form_instances
-- ------------------------------------------------------------------------------------

ALTER TABLE iso_form_instances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "iso_form_instances_factory" ON iso_form_instances;
DROP POLICY IF EXISTS "iso_form_instances_select" ON iso_form_instances;
DROP POLICY IF EXISTS "iso_form_instances_insert" ON iso_form_instances;
DROP POLICY IF EXISTS "iso_form_instances_update" ON iso_form_instances;
DROP POLICY IF EXISTS "iso_form_instances_delete" ON iso_form_instances;

-- Đọc: giữ nguyên phạm vi cũ (mọi người trong nhà máy). Danh sách hồ sơ, "Việc của tôi",
-- chuông thông báo đều dựa vào đây — siết thêm ở bước đọc sẽ làm hỏng các màn đó.
CREATE POLICY "iso_form_instances_select" ON iso_form_instances
  FOR SELECT
  USING (factory_id = public.current_profile_factory_id());

-- Tạo mới: hiện chỉ đi qua `/api/iso/forms/clone` (service role). Vẫn mở cho client với
-- ràng buộc người tạo phải là chính mình, để tính năng sau này không phải sửa lại RLS.
CREATE POLICY "iso_form_instances_insert" ON iso_form_instances
  FOR INSERT
  WITH CHECK (
    factory_id = public.current_profile_factory_id()
    AND nguoi_tao = auth.uid()
  );

-- Sửa: chỉ người trong luồng ký của chính hồ sơ đó (người tạo / người xem xét / người phê
-- duyệt), hoặc admin. Bao phủ đúng 3 chỗ client đang UPDATE: thay file nháp, lưu cấu hình
-- phê duyệt trước khi ký, và "Trả về".
-- `WITH CHECK` dùng lại đúng biểu thức của `USING` để không ai tự chuyển hồ sơ sang nhà máy
-- khác hoặc gán lại người tạo nhằm thoát khỏi phạm vi kiểm soát.
CREATE POLICY "iso_form_instances_update" ON iso_form_instances
  FOR UPDATE
  USING (
    factory_id = public.current_profile_factory_id()
    AND (
      nguoi_tao = auth.uid()
      OR xem_xet_user_id = auth.uid()
      OR phe_duyet_user_id = auth.uid()
      OR public.current_profile_role() = 'admin'
    )
  )
  WITH CHECK (
    factory_id = public.current_profile_factory_id()
    AND (
      nguoi_tao = auth.uid()
      OR xem_xet_user_id = auth.uid()
      OR phe_duyet_user_id = auth.uid()
      OR public.current_profile_role() = 'admin'
    )
  );

-- Xoá: mirror ĐÚNG điều kiện `canDeleteInst` của giao diện
-- (`(trang_thai === "draft" && isCreator) || isAdmin`) — không nới lỏng hơn.
CREATE POLICY "iso_form_instances_delete" ON iso_form_instances
  FOR DELETE
  USING (
    factory_id = public.current_profile_factory_id()
    AND (
      (trang_thai = 'draft' AND nguoi_tao = auth.uid())
      OR public.current_profile_role() = 'admin'
    )
  );

-- ------------------------------------------------------------------------------------
-- 2. iso_form_instance_logs — nhật ký chỉ được ghi thêm, không sửa/xoá
-- ------------------------------------------------------------------------------------

ALTER TABLE iso_form_instance_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "iso_form_instance_logs_factory" ON iso_form_instance_logs;
DROP POLICY IF EXISTS "iso_form_instance_logs_select" ON iso_form_instance_logs;
DROP POLICY IF EXISTS "iso_form_instance_logs_insert" ON iso_form_instance_logs;

CREATE POLICY "iso_form_instance_logs_select" ON iso_form_instance_logs
  FOR SELECT
  USING (factory_id = public.current_profile_factory_id());

CREATE POLICY "iso_form_instance_logs_insert" ON iso_form_instance_logs
  FOR INSERT
  WITH CHECK (
    factory_id = public.current_profile_factory_id()
    AND user_id = auth.uid()
  );

-- CỐ Ý không tạo policy UPDATE/DELETE: không có policy = mặc định từ chối. Nhật ký kiểm
-- toán phải bất biến với người dùng thường (service role của các route server vẫn ghi được).

-- =====================================================================================
-- KIỂM CHỨNG SAU KHI CHẠY (chạy tay trong SQL Editor, KHÔNG phải là một phần của migration)
-- =====================================================================================
--
-- 1) Phải ra đúng 4 dòng cho iso_form_instances (select/insert/update/delete) và KHÔNG còn
--    dòng nào tên "iso_form_instances_factory":
--
--    SELECT policyname, cmd FROM pg_policies
--    WHERE tablename = 'iso_form_instances' ORDER BY policyname;
--
-- 2) Phải ra đúng 2 dòng (select/insert), KHÔNG có UPDATE/DELETE:
--
--    SELECT policyname, cmd FROM pg_policies
--    WHERE tablename = 'iso_form_instance_logs' ORDER BY policyname;
--
-- 3) Hai hàm phụ trợ phải tồn tại và là SECURITY DEFINER (prosecdef = true):
--
--    SELECT proname, prosecdef FROM pg_proc
--    WHERE proname IN ('current_profile_factory_id', 'current_profile_role');
--
-- =====================================================================================
-- ROLLBACK (chỉ dùng nếu buộc phải quay lại hành vi cũ — LƯU Ý: mở lại lỗ hổng)
-- =====================================================================================
--
-- DROP POLICY IF EXISTS "iso_form_instances_select" ON iso_form_instances;
-- DROP POLICY IF EXISTS "iso_form_instances_insert" ON iso_form_instances;
-- DROP POLICY IF EXISTS "iso_form_instances_update" ON iso_form_instances;
-- DROP POLICY IF EXISTS "iso_form_instances_delete" ON iso_form_instances;
-- CREATE POLICY "iso_form_instances_factory" ON iso_form_instances
--   USING (factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid()));
--
-- DROP POLICY IF EXISTS "iso_form_instance_logs_select" ON iso_form_instance_logs;
-- DROP POLICY IF EXISTS "iso_form_instance_logs_insert" ON iso_form_instance_logs;
-- CREATE POLICY "iso_form_instance_logs_factory" ON iso_form_instance_logs
--   USING (factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid()));
