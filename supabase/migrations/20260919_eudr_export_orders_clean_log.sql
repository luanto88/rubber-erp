-- GĐ 4 EUDR: lưu nhật ký làm sạch hình học + hash JSON đã xuất mỗi khi trang/API tính lại
-- chuỗi truy xuất của đơn hàng (không phải lúc tải file) — cho phép đối chiếu về sau "dữ liệu
-- khách đã tải khớp với dữ liệu nào" mà không phải lưu lại toàn bộ GeoJSON.
--
-- eudr_clean_log là JSONB dạng { entries: PlotCleanEntry[], blockingIssueCount: number,
-- computedAt: string } (xem src/lib/eudr-export-gate.ts's EudrCleanLogPayload).
-- blockingIssueCount > 0 nghĩa là eudr_geometry_hash tại lần ghi đó đại diện cho 1 file SẼ bị
-- chặn nếu bật chặn thật (NEXT_PUBLIC_EUDR_EXPORT_BLOCK) — không dùng hash đó làm bằng chứng
-- "đã xuất sạch" trong hồ sơ Whisp/IMPACT.
--
-- Ghi bởi 3 nơi: 2 route API (src/app/api/customer-portal/orders/[id]/route.ts,
-- src/app/api/eudr/public-order/route.ts, service-role, sau after()) + trang admin
-- EudrClient.tsx (browser client, theo RLS export_orders_update hiện có). Best-effort,
-- idempotent (bỏ qua nếu hash không đổi) — xem src/lib/eudr-clean-log-write.ts.

ALTER TABLE export_orders ADD COLUMN IF NOT EXISTS eudr_clean_log JSONB;
ALTER TABLE export_orders ADD COLUMN IF NOT EXISTS eudr_geometry_hash TEXT;

COMMENT ON COLUMN export_orders.eudr_clean_log IS 'Nhật ký làm sạch/nở mảnh hình học theo lô + blockingIssueCount tại lần tính lại gần nhất (EudrCleanLogPayload, src/lib/eudr-export-gate.ts).';
COMMENT ON COLUMN export_orders.eudr_geometry_hash IS 'SHA-256 hex của chuỗi JSON GeoJSON đã serialize (eudr-export-gate.ts). blockingIssueCount>0 trong eudr_clean_log nghĩa là hash này đại diện cho file KHÔNG xuất được nếu bật chặn.';

-- Không cần policy RLS mới — export_orders_update (20260821_rls_lockdown_master_data_full.sql)
-- đã FOR UPDATE TO authenticated USING (factory_id = current_profile_factory_id()), bao trùm
-- mọi cột kể cả 2 cột mới này.
