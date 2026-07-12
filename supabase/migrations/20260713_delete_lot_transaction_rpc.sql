-- Fix bug thật (2026-07-13): xóa 1 giao dịch (kiện) qua QR/"Sửa lô" để lại "lô ma" (ghost lot) —
-- lô vẫn hiện trong danh sách Thành phẩm với "SL thực tế ca này" = 0 nhưng cột "Kiện (A/B/C/D)"
-- vẫn giữ số liệu CŨ (vd 0/0/0/36), trạng thái "Dở dang", và KHÔNG THỂ xóa được nữa dù bấm lại
-- nút Xóa (luôn báo nhầm "đã có phiếu kiểm nghiệm liên quan").
--
-- Nguyên nhân gốc đã xác nhận trực tiếp trên dữ liệu thật (lô "1074cs/26", factory phuochoa_kt):
-- deleteLotTransaction() (product/actions.ts) làm 3 bước RIÊNG BIỆT không atomic:
--   1) DELETE lot_transactions (xóa giao dịch cuối cùng của lô)
--   2) đếm lại số giao dịch còn lại -> 0
--   3) DELETE lots (vì không còn giao dịch nào)
-- Bước 1 xóa thành công VÀ tự kích hoạt trigger cũ `trigger_update_lot_master`
-- (20260515_refactor_lots_master_detail.sql, đã vá literal dấu ở 20260708_fix_lot_status_trigger.sql)
-- — trigger này CHỈ recompute tong_banh/tong_kg/trang_thai từ SUM(lot_transactions) còn lại,
-- KHÔNG đụng tới kien_a/b/c/d — nên sau bước 1, lots.tong_banh đã về đúng 0 nhưng kien_a-d vẫn
-- giữ nguyên giá trị CŨ (vd kien_d=36) từ trước khi xóa.
-- Bước 3 sau đó THẤT BẠI với lỗi vi phạm khóa ngoại `lot_prediction_lots.real_lot_id REFERENCES
-- lots(id)` (không có ON DELETE CASCADE/SET NULL) — vì lô này được tạo qua tính năng "Dự đoán số
-- lô" (create_lot_prediction_batch) rồi markLotPredictionRealized() đã gán real_lot_id trỏ vào
-- đúng lô này. deleteLotTransaction() báo lỗi (Postgres code 23503) NHƯNG bước 1 (xóa giao dịch)
-- ĐÃ COMMIT TRƯỚC ĐÓ (không nằm trong cùng 1 transaction với bước 3) — để lại đúng trạng thái nửa
-- vời quan sát được: giao dịch đã mất, lô rác vẫn còn, kien_a-d stale, và mọi lần thử xóa lại sau
-- đó đều lặp lại đúng lỗi 23503 y hệt (vì lot_prediction_lots vẫn còn trỏ vào lô này).
-- product/page.tsx's handleDelete() còn hiển thị SAI thông báo lỗi cho case 23503 này ("đã có
-- phiếu kiểm nghiệm liên quan") — luôn đúng khi lỗi đến từ qc_results, nhưng SAI khi lỗi thực ra
-- đến từ lot_prediction_lots như trường hợp này, khiến người dùng bị hướng dẫn nhầm hướng xử lý.
--
-- Fix: gộp toàn bộ luồng xóa giao dịch + dọn lô rỗng thành RPC atomic (khóa lots FOR UPDATE, mọi
-- bước nằm trong 1 transaction — hoặc thành công toàn bộ, hoặc rollback toàn bộ, không còn trạng
-- thái nửa vời), đồng thời chủ động gỡ liên kết lot_prediction_lots.real_lot_id trước khi xóa lots
-- để không còn vi phạm khóa ngoại nêu trên.

CREATE OR REPLACE FUNCTION delete_lot_transaction(p_transaction_id uuid)
RETURNS TABLE(lot_id uuid, ngan_id uuid, remaining_count integer, lot_deleted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_lot_id   uuid;
  v_ngan_id  uuid;
  v_remaining integer;
BEGIN
  SELECT lt.lot_id, lt.ngan_id INTO v_lot_id, v_ngan_id
  FROM lot_transactions lt
  WHERE lt.id = p_transaction_id;

  IF v_lot_id IS NULL THEN
    RAISE EXCEPTION 'Khong tim thay giao dich can xoa: %', p_transaction_id;
  END IF;

  -- Khóa dòng lots ngay từ đầu — cùng nguyên tắc atomic đã dùng cho sync_lot_master_snapshot.
  PERFORM 1 FROM lots WHERE id = v_lot_id FOR UPDATE;

  DELETE FROM lot_transactions WHERE id = p_transaction_id;

  SELECT COUNT(*) INTO v_remaining FROM lot_transactions WHERE lot_id = v_lot_id;

  IF v_remaining > 0 THEN
    -- Vẫn còn giao dịch khác — tính lại snapshot đầy đủ (kể cả kien_a-d) từ dữ liệu còn lại,
    -- ghi đè bất kỳ giá trị nào trigger cũ đã set thiếu.
    PERFORM sync_lot_master_snapshot(v_lot_id);
    RETURN QUERY SELECT v_lot_id, v_ngan_id, v_remaining, false;
  ELSE
    -- Đây là giao dịch cuối cùng của lô — gỡ liên kết dự đoán (nếu có) trước khi xóa lô, tránh
    -- vi phạm FK lot_prediction_lots.real_lot_id. Trả lô dự kiến về trạng thái "Dự kiến" để có
    -- thể dự đoán/xác nhận lại sau này (đảo ngược đúng markLotPredictionRealized()).
    UPDATE lot_prediction_lots
    SET real_lot_id = NULL, trang_thai = 'Dự kiến'
    WHERE real_lot_id = v_lot_id;

    DELETE FROM lots WHERE id = v_lot_id;
    RETURN QUERY SELECT v_lot_id, v_ngan_id, 0, true;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_lot_transaction(uuid) TO authenticated, service_role;

-- Dọn "lô rác" đã tồn tại từ trước (0 giao dịch nhưng lots.tong_banh > 0 do CSV import trực tiếp
-- — xem mục "Invariant bắt buộc" trong .claude/rules/06-module-production.md — hoặc lô rỗng phát
-- sinh từ đúng bug trên trước khi có fix này). Trước đây product/page.tsx gọi thẳng
-- `.from("lots").delete()` từ browser, cũng dính đúng lỗi FK 23503 nếu lô có liên kết dự đoán.
CREATE OR REPLACE FUNCTION delete_orphan_lot(p_lot_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM 1 FROM lots WHERE id = p_lot_id FOR UPDATE;

  UPDATE lot_prediction_lots
  SET real_lot_id = NULL, trang_thai = 'Dự kiến'
  WHERE real_lot_id = p_lot_id;

  -- An toàn dọn luôn giao dịch còn sót (thường là 0 dòng — hàm này chỉ dành cho lô đã xác định
  -- không còn giao dịch nào từ phía client).
  DELETE FROM lot_transactions WHERE lot_id = p_lot_id;

  DELETE FROM lots WHERE id = p_lot_id;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_orphan_lot(uuid) TO authenticated, service_role;
