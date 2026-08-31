-- ============================================================
-- Khóa RLS "chỉ người tạo (hoặc admin) mới sửa/xóa được" — tầng DB, bổ sung
-- cho phần đã khóa ở UI (xem CLAUDE.md mục "Cập nhật (sau Giai đoạn 5 phần
-- 1)"). Trước đây UPDATE/DELETE của `dispatch_entries`/`qc_results` chỉ kiểm
-- tra `factory_id` (20260822_rls_lockdown_factories_and_write_protect.sql)
-- — bất kỳ user cùng nhà máy nào cũng sửa/xóa được bản ghi của người khác
-- qua API/devtools bất kể nút "Sửa" đã bị UI ẩn đi.
--
-- Dùng lại `public.current_profile_has_permission(p_code)` đã có sẵn từ
-- 20260721_production_records_permission_rls.sql (không định nghĩa lại).
--
-- Quy tắc: admin luôn qua; created_by = chính mình luôn qua; created_by IS
-- NULL (dữ liệu cũ trước migration 20260910, grandfather clause) luôn qua.
-- Áp dụng PER-ROW, không theo "nhóm ngày" như UI Chất lượng đang gom hiển
-- thị — chặt hơn UI 1 chút (UI cho mở modal cả ngày nếu đã đóng góp ít
-- nhất 1 phiếu, RLS vẫn chặn đúng từng dòng không phải của mình trong ngày
-- đó) — cố ý, tránh subquery join cùng bảng trong policy.
--
-- ⚠️ QUYẾT ĐỊNH QUAN TRỌNG — dispatch_entries.UPDATE KHÔNG bị khóa ở
-- migration này (chỉ khóa DELETE): đã grep toàn bộ src/ xác nhận
-- `writeBackToDispatch()` (src/app/dashboard/output/_components/output-types.ts,
-- gọi từ module Sản lượng sau mỗi lần import/lưu/xóa production_records)
-- UPDATE trực tiếp `dispatch_entries.rows` bằng browser client dưới session
-- của NGƯỜI ĐANG THAO TÁC Ở SẢN LƯỢNG — thường KHÔNG PHẢI người tạo phiếu
-- điều xe gốc, và lời gọi này chạy fire-and-forget
-- (`void writeBackToDispatch(...).catch(() => {})`) nên lỗi RLS sẽ bị NUỐT
-- ÂM THẦM, không hiện lỗi gì cho người dùng — nếu khóa UPDATE theo
-- created_by, đồng bộ KL Điều xe ↔ Sản lượng sẽ NGỪNG HOẠT ĐỘNG hoàn toàn
-- cho bất kỳ ai không phải người tạo phiếu, mà không ai biết vì không có
-- lỗi hiển thị. `qc_results` đã audit riêng, không có write cross-module
-- tương tự (chỉ quality/page.tsx tự ghi) nên khóa được cả UPDATE lẫn DELETE.
-- ============================================================

DROP POLICY IF EXISTS "dispatch_entries_delete" ON dispatch_entries;
CREATE POLICY "dispatch_entries_delete" ON dispatch_entries
  FOR DELETE TO authenticated
  USING (
    factory_id = public.current_profile_factory_id()
    AND public.current_profile_has_permission('dispatch.delete')
    AND (
      public.current_profile_role() = 'admin'
      OR created_by = auth.uid()
      OR created_by IS NULL
    )
  );

DROP POLICY IF EXISTS "qc_results_update" ON qc_results;
CREATE POLICY "qc_results_update" ON qc_results
  FOR UPDATE TO authenticated
  USING (
    factory_id = public.current_profile_factory_id()
    AND public.current_profile_has_permission('quality.edit')
    AND (
      public.current_profile_role() = 'admin'
      OR created_by = auth.uid()
      OR created_by IS NULL
    )
  )
  WITH CHECK (
    factory_id = public.current_profile_factory_id()
    AND public.current_profile_has_permission('quality.edit')
    AND (
      public.current_profile_role() = 'admin'
      OR created_by = auth.uid()
      OR created_by IS NULL
    )
  );

DROP POLICY IF EXISTS "qc_results_delete" ON qc_results;
CREATE POLICY "qc_results_delete" ON qc_results
  FOR DELETE TO authenticated
  USING (
    factory_id = public.current_profile_factory_id()
    AND public.current_profile_has_permission('quality.delete')
    AND (
      public.current_profile_role() = 'admin'
      OR created_by = auth.uid()
      OR created_by IS NULL
    )
  );
