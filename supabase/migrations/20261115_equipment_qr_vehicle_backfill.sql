-- GĐ4a — Tem QR cho xe Đội xe (docs/qr-equipment-plan.md).
-- Bảng equipment_qr_tokens đã có cột dispatch_vehicle_id + unique index "1 token hiệu lực / xe"
-- từ migration 20261111. File này chỉ TẠO SẴN token cho mọi xe chưa có token còn hiệu lực.
-- Không chạy file này thì token vẫn tự tạo khi bấm nút QR / In tem lần đầu.
-- Idempotent — chạy lại an toàn. Chạy tay trong Supabase SQL Editor.

INSERT INTO public.equipment_qr_tokens (factory_id, dispatch_vehicle_id)
SELECT v.factory_id, v.id
FROM public.dispatch_vehicles v
WHERE v.factory_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.equipment_qr_tokens t
    WHERE t.dispatch_vehicle_id = v.id AND t.revoked_at IS NULL
  );

-- Kiểm tra:
-- SELECT v.code, t.token FROM equipment_qr_tokens t JOIN dispatch_vehicles v ON v.id = t.dispatch_vehicle_id
-- WHERE t.revoked_at IS NULL ORDER BY v.code;
