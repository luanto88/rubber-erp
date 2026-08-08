-- Khóa nốt SELECT (đọc) của các bảng đã bị "Allow all"/`USING (true)` mà 2 trang tra cứu công
-- khai (/storage, /product-label) từng phụ thuộc đọc trực tiếp bằng anon key — phần việc còn
-- lại đã ghi rõ trong `20260822_rls_lockdown_factories_and_write_protect.sql` (mục 2) và trong
-- memory `security_rls_allow_all_gap`.
--
-- Điều kiện tiên quyết để migration này AN TOÀN: `src/lib/storage-detail.ts` và
-- `src/lib/product-label.ts` đã được refactor (2026-08-08) — 2 trang public giờ đọc dữ liệu
-- qua 3 route service-role mới (`/api/storage/public-lookup`, `/api/storage/geojson`,
-- `/api/product-label/lookup`) thay vì query trực tiếp bằng anon Supabase client. KHÔNG chạy
-- migration này trước khi code đó đã deploy — nếu không, 2 trang public sẽ vỡ ngay lập tức.
--
-- 6 bảng xử lý ở đây:
--   lots, ngans, qc_results, dispatch_entries        — SELECT "Allow all" (20260822 mới chỉ
--                                                        khóa write, cố ý giữ SELECT mở)
--   lot_prediction_lots, lot_prediction_batches       — SELECT `FOR SELECT USING (true)` không
--                                                        có `TO` clause (áp dụng cho `public`,
--                                                        tức cả anon) — cùng lỗ hổng, tạo ở
--                                                        20260709_lot_predictions.sql với đúng
--                                                        lý do "mirror /storage hiện tại".
--
-- Write (INSERT/UPDATE/DELETE) của cả 6 bảng đã factory-scoped từ trước — không đổi ở đây.

-- ── lots ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "lots_select_public" ON lots;
DROP POLICY IF EXISTS "lots_select" ON lots;
CREATE POLICY "lots_select" ON lots
  FOR SELECT TO authenticated
  USING (factory_id = public.current_profile_factory_id());

-- ── ngans ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "ngans_select_public" ON ngans;
DROP POLICY IF EXISTS "ngans_select" ON ngans;
CREATE POLICY "ngans_select" ON ngans
  FOR SELECT TO authenticated
  USING (factory_id = public.current_profile_factory_id());

-- ── qc_results ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "qc_results_select_public" ON qc_results;
DROP POLICY IF EXISTS "qc_results_select" ON qc_results;
CREATE POLICY "qc_results_select" ON qc_results
  FOR SELECT TO authenticated
  USING (factory_id = public.current_profile_factory_id());

-- ── dispatch_entries ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "dispatch_entries_select_public" ON dispatch_entries;
DROP POLICY IF EXISTS "dispatch_entries_select" ON dispatch_entries;
CREATE POLICY "dispatch_entries_select" ON dispatch_entries
  FOR SELECT TO authenticated
  USING (factory_id = public.current_profile_factory_id());

-- ── lot_prediction_lots ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "lot_prediction_lots_read" ON lot_prediction_lots;
DROP POLICY IF EXISTS "lot_prediction_lots_select" ON lot_prediction_lots;
CREATE POLICY "lot_prediction_lots_select" ON lot_prediction_lots
  FOR SELECT TO authenticated
  USING (factory_id = public.current_profile_factory_id());

-- ── lot_prediction_batches ───────────────────────────────────────────────
DROP POLICY IF EXISTS "lot_prediction_batches_read" ON lot_prediction_batches;
DROP POLICY IF EXISTS "lot_prediction_batches_select" ON lot_prediction_batches;
CREATE POLICY "lot_prediction_batches_select" ON lot_prediction_batches
  FOR SELECT TO authenticated
  USING (factory_id = public.current_profile_factory_id());
