-- Fix bug thật (2026-07-14): mọi lần xóa giao dịch/kiện qua delete_lot_transaction() đều thất
-- bại với lỗi Postgres "column reference "lot_id" is ambiguous" — lỗi này đã tồn tại từ khi RPC
-- được tạo (20260713_delete_lot_transaction_rpc.sql) nhưng chưa từng lộ ra vì UI phía client
-- (product/page.tsx, product/confirm) từng có 2 lỗ hổng riêng biệt nuốt mất mọi thông báo lỗi:
--   1) handleBulkDelete() không kiểm tra kết quả từng lần gọi, luôn "thành công giả" về UI.
--   2) Toast báo lỗi (saveError/syncMsg) chỉ được render trong nhánh view === "create", KHÔNG
--      tồn tại trong nhánh "LIST VIEW" nơi bảng xóa hàng loạt thực sự chạy — nên dù state lỗi có
--      được set đúng, không có gì hiển thị nó ra màn hình.
-- Sau khi vá cả 2 lỗ hổng trên ở tầng client, lỗi SQL thật mới lộ ra: "Lỗi 3 dòng — 1084cs/26:
-- Khong xoa duoc giao dich: column reference "lot_id" is ambiguous".
--
-- Nguyên nhân gốc: chữ ký hàm khai báo RETURNS TABLE(lot_id uuid, ngan_id uuid, ...) — trong
-- PL/pgSQL, mỗi cột trong RETURNS TABLE tự động trở thành 1 biến OUT có phạm vi trong toàn bộ
-- thân hàm, giống hệt một biến cục bộ. Dòng:
--   SELECT COUNT(*) INTO v_remaining FROM lot_transactions WHERE lot_id = v_lot_id;
-- có "lot_id" không được qualify bằng alias bảng — Postgres không phân biệt được đây là biến OUT
-- "lot_id" (từ RETURNS TABLE) hay cột "lot_transactions.lot_id", nên báo ambiguous và toàn bộ
-- transaction bị rollback. Vì dòng này chạy VÔ ĐIỀU KIỆN (trước cả nhánh IF v_remaining > 0),
-- lỗi xảy ra ở MỌI lần gọi delete_lot_transaction, bất kể lô còn giao dịch khác hay không.
--
-- Fix: thêm alias bảng và qualify rõ ràng lot_transactions.lot_id tại dòng gây lỗi. Không đổi
-- chữ ký hàm (RETURNS TABLE giữ nguyên tên cột lot_id) để không phải sửa code JS phía client
-- (product/actions.ts deleteLotTransaction() đang destructure result.lot_id).

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

  -- FIX: qualify lot_transactions.lot_id (alias lt2) — "lot_id" trần bị ambiguous với biến OUT
  -- "lot_id" của RETURNS TABLE ở trên.
  SELECT COUNT(*) INTO v_remaining FROM lot_transactions lt2 WHERE lt2.lot_id = v_lot_id;

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
