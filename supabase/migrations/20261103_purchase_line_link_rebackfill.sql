-- ============================================================
-- 2026-11-03 — Chạy lại backfill liên kết biên bản theo dòng (GĐ3). CHẠY TAY, idempotent.
-- PHẢI chạy SAU KHI deploy code GĐ3: migration 20261102 chạy trước deploy ⇒ phiếu lập từ biên bản
-- trong khoảng "đã chạy migration nhưng code cũ còn chạy" có dòng maintenance_record_id = NULL ⇒ hàng
-- nhập không được giữ cho biên bản (lỗi gặp khi test localhost 2026-11-01, phiếu 68/69).
-- Chỉ điền dòng còn NULL của phiếu có biên bản; dòng "Dự trữ kho" trên phiếu thường không bị đụng.
-- Lưu ý: phiếu lập từ biên bản mà người dùng CHỦ ĐỘNG chọn "Dự trữ kho" ở 1 dòng cũng sẽ bị gắn lại
-- biên bản của phiếu — chấp nhận được vì chỉ chạy 1 lần ngay sau deploy (chưa ai kịp chọn).
-- ============================================================

UPDATE purchase_request_lines l
SET maintenance_record_id = r.maintenance_record_id
FROM purchase_requests r
WHERE l.request_id = r.id
  AND r.maintenance_record_id IS NOT NULL
  AND l.maintenance_record_id IS NULL;

UPDATE purchase_request_lines l
SET maintenance_record_id = p.maintenance_record_id
FROM purchase_request_lines p
WHERE l.parent_line_id = p.id
  AND p.maintenance_record_id IS NOT NULL
  AND l.maintenance_record_id IS NULL;

-- Kiểm chứng (phải ra 0):
-- SELECT count(*) FROM purchase_request_lines l JOIN purchase_requests r ON r.id = l.request_id
-- WHERE r.maintenance_record_id IS NOT NULL AND l.maintenance_record_id IS NULL;
