-- Data repair — hệ quả của bug type-mismatch ở sync_lot_master_snapshot() (xem migration
-- 20260715_fix_sync_lot_master_snapshot_kien_types.sql).
--
-- Trong lúc RPC còn lỗi, saveLotTransaction() vẫn INSERT thành công dòng lot_transactions (round-
-- trip độc lập, đã commit), nhưng lệnh gọi RPC ngay sau đó để đồng bộ lots.kien_a-d luôn ném lỗi
-- (throw ngay khi Postgres build tuple descriptor) — khiến `lots.kien_a-d`/`tong_banh` của lô đó
-- bị "kẹt" sai, không phản ánh đúng tổng thật trong lot_transactions. Hệ quả quan sát được: lô
-- "1117cs/26" đã có giao dịch Kiện B ghi nhận đủ 36 bành trong lot_transactions, nhưng
-- lots.kien_b vẫn = 0 → cảnh báo "Kết thúc ca" (checkIncompleteLotsForDay) báo nhầm CẢ 4 kiện
-- A/B/C/D còn thiếu, dù kiện B thực ra đã đủ.
--
-- QUAN TRỌNG: migration này CHỈ được chạy SAU migration
-- 20260715_fix_sync_lot_master_snapshot_kien_types.sql (RPC phải đã có chữ ký đúng), nếu không sẽ
-- gặp lại đúng lỗi "structure of query does not match function result type" cho mọi lô.
--
-- Phạm vi CHỈ giới hạn lô "Dở dang" (chấp nhận cả biến thể ASCII cũ "Do dang" — xem lịch sử trigger
-- ASCII trong .claude/rules/06-module-production.md). KHÔNG được resync lô "Hoàn thành"/"Xuất hàng":
-- sync_lot_master_snapshot() tự tính lại trang_thai chỉ giữa 'Hoàn thành'/'Dở dang' (không biết về
-- trạng thái 'Xuất hàng') — gọi trên lô đã Xuất hàng sẽ hạ nhầm về 'Hoàn thành', xóa mất trạng thái
-- đã xuất hàng. Lô 'Hoàn thành' không cần resync (checkLotCompleteness chỉ xét lô 'Dở dang').
DO $$
DECLARE
  r_lot_id uuid;
BEGIN
  FOR r_lot_id IN SELECT id FROM lots WHERE trang_thai IN ('Dở dang', 'Do dang') LOOP
    PERFORM sync_lot_master_snapshot(r_lot_id);
  END LOOP;
END $$;
