-- Phần 2/2 của việc vá lỗ hổng RLS "Allow all" — xử lý `factories` (đọc public, ghi
-- admin-only) và 4 bảng còn lại (lots, ngans, qc_results, dispatch_entries) mà trang
-- public THẬT SỰ phụ thuộc đọc trực tiếp bằng anon key. Xem
-- 20260821_rls_lockdown_master_data_full.sql để biết bối cảnh đầy đủ + 8 bảng đã khóa
-- toàn bộ ở migration trước.
--
-- ĐÃ AUDIT KỸ (đọc trực tiếp src/lib/storage-detail.ts, src/lib/product-label.ts,
-- src/app/login/page.tsx) trước khi viết migration này — không đoán.

-- ══════════════════════════════════════════════════════════════════════════
-- 1) factories — SELECT public (cần cho /login chọn nhà máy trước khi đăng nhập),
--    UPDATE chỉ admin đúng nhà máy đó, KHÔNG có INSERT/DELETE policy (tạo/xóa nhà máy
--    chưa từng có luồng nào trong app — chỉ làm tay qua SQL Editor khi seed).
--
--    factories chỉ có id/code/name/prefix/location/created_at — không có dữ liệu nhạy
--    cảm nào (không PII, không số liệu kinh doanh chi tiết), nên cho đọc public toàn bộ
--    cột là chấp nhận được, khác hẳn với lots/ngans/qc_results/dispatch_entries bên dưới
--    (những bảng đó có thể chứa dữ liệu sản xuất/kinh doanh chi tiết hơn).
-- ══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Allow all" ON factories;

DROP POLICY IF EXISTS "factories_select_public" ON factories;
CREATE POLICY "factories_select_public" ON factories
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "factories_update_admin_own" ON factories;
CREATE POLICY "factories_update_admin_own" ON factories
  FOR UPDATE TO authenticated
  USING (
    public.current_profile_role() = 'admin'
    AND id = public.current_profile_factory_id()
  )
  WITH CHECK (
    public.current_profile_role() = 'admin'
    AND id = public.current_profile_factory_id()
  );

-- ══════════════════════════════════════════════════════════════════════════
-- 2) lots, ngans, qc_results, dispatch_entries — SELECT vẫn để mở cho anon (giữ nguyên
--    hiện trạng đọc, KHÔNG thắt thêm) vì 2 trang tra cứu công khai không đăng nhập phụ
--    thuộc trực tiếp vào việc đọc các bảng này bằng anon key:
--      - /storage (+ /dashboard/storage/[id], cùng bypass auth có chủ đích — xem
--        dashboard/layout.tsx's isPublicStorageLookup) — đọc ngans, lots, dispatch_entries
--        qua src/lib/storage-detail.ts
--      - /product-label — đọc lots, qc_results, ngans qua src/lib/product-label.ts
--
--    INSERT/UPDATE/DELETE bị khóa lại đúng theo factory + bắt buộc đăng nhập — đây là lỗ
--    hổng nghiêm trọng hơn đã xác nhận CÓ THẬT: storage-detail.ts's loadStorageDetail()
--    unconditionally UPDATE ngans (recompute tong_tuoi/tong_kho) mỗi khi có người xem
--    trang /storage, kể cả chưa đăng nhập — nghĩa là bất kỳ ai cũng ghi được vào DB. Đã
--    xác nhận qua đọc code: hàm này KHÔNG kiểm tra lỗi của lệnh UPDATE và vẫn trả về giá
--    trị tong_tuoi/tong_kho tính đúng từ dữ liệu nguồn để hiển thị — nên khóa UPDATE lại
--    cho anon KHÔNG làm hỏng hiển thị của trang public, chỉ ngăn ghi đè DB trái phép.
--
--    Đọc vẫn mở cho MỌI nhà máy (không factory-scope) — giữ đúng hiện trạng, vì hạn chế
--    triệt để (chỉ cho đọc đúng 1 factory_id/id cụ thể khớp QR) đòi hỏi refactor 2 trang
--    trên sang gọi qua API route dùng service role (như đã làm cho export_orders/EUDR) —
--    việc đó CHƯA làm ở migration này, xem ghi chú theo dõi trong memory.
-- ══════════════════════════════════════════════════════════════════════════

-- ── lots ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow all" ON lots;

DROP POLICY IF EXISTS "lots_select_public" ON lots;
CREATE POLICY "lots_select_public" ON lots
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "lots_insert" ON lots;
CREATE POLICY "lots_insert" ON lots
  FOR INSERT TO authenticated
  WITH CHECK (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS "lots_update" ON lots;
CREATE POLICY "lots_update" ON lots
  FOR UPDATE TO authenticated
  USING (factory_id = public.current_profile_factory_id())
  WITH CHECK (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS "lots_delete" ON lots;
CREATE POLICY "lots_delete" ON lots
  FOR DELETE TO authenticated
  USING (factory_id = public.current_profile_factory_id());

-- ── ngans ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow all" ON ngans;

DROP POLICY IF EXISTS "ngans_select_public" ON ngans;
CREATE POLICY "ngans_select_public" ON ngans
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "ngans_insert" ON ngans;
CREATE POLICY "ngans_insert" ON ngans
  FOR INSERT TO authenticated
  WITH CHECK (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS "ngans_update" ON ngans;
CREATE POLICY "ngans_update" ON ngans
  FOR UPDATE TO authenticated
  USING (factory_id = public.current_profile_factory_id())
  WITH CHECK (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS "ngans_delete" ON ngans;
CREATE POLICY "ngans_delete" ON ngans
  FOR DELETE TO authenticated
  USING (factory_id = public.current_profile_factory_id());

-- ── qc_results ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow all" ON qc_results;

DROP POLICY IF EXISTS "qc_results_select_public" ON qc_results;
CREATE POLICY "qc_results_select_public" ON qc_results
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "qc_results_insert" ON qc_results;
CREATE POLICY "qc_results_insert" ON qc_results
  FOR INSERT TO authenticated
  WITH CHECK (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS "qc_results_update" ON qc_results;
CREATE POLICY "qc_results_update" ON qc_results
  FOR UPDATE TO authenticated
  USING (factory_id = public.current_profile_factory_id())
  WITH CHECK (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS "qc_results_delete" ON qc_results;
CREATE POLICY "qc_results_delete" ON qc_results
  FOR DELETE TO authenticated
  USING (factory_id = public.current_profile_factory_id());

-- ── dispatch_entries ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow all" ON dispatch_entries;

DROP POLICY IF EXISTS "dispatch_entries_select_public" ON dispatch_entries;
CREATE POLICY "dispatch_entries_select_public" ON dispatch_entries
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "dispatch_entries_insert" ON dispatch_entries;
CREATE POLICY "dispatch_entries_insert" ON dispatch_entries
  FOR INSERT TO authenticated
  WITH CHECK (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS "dispatch_entries_update" ON dispatch_entries;
CREATE POLICY "dispatch_entries_update" ON dispatch_entries
  FOR UPDATE TO authenticated
  USING (factory_id = public.current_profile_factory_id())
  WITH CHECK (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS "dispatch_entries_delete" ON dispatch_entries;
CREATE POLICY "dispatch_entries_delete" ON dispatch_entries
  FOR DELETE TO authenticated
  USING (factory_id = public.current_profile_factory_id());
