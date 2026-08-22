-- Fix: ngăn có thành phẩm thật (đôi khi >100% lấp đầy) nhưng vẫn kẹt mãi ở "Chờ sản xuất" vì
-- sync_ngan_production_status() (20260808_sync_ngan_production_status.sql) chỉ đếm tổng kg từ
-- lot_transactions, trong khi UI (loadStorageLots() ở src/lib/storage-detail.ts, dùng để tính
-- tpKg/tpPct hiển thị trên card ngăn) còn cộng thêm cả các lô "mồ côi" — lots có ngan_id đúng
-- ngăn này nhưng KHÔNG có bất kỳ bản ghi lot_transactions nào (ghi trực tiếp/bulk-upload ngoài
-- luồng app, xem invariant ở .claude/rules/06-module-production.md mục "Invariant bắt buộc: mọi
-- lô có tong_banh > 0 phải có lot_transactions backing"). Khi sản lượng thật của 1 ngăn đến từ
-- (một phần) lô mồ côi, RPC cũ thấy tổng kg thấp hơn thực tế (có thể = 0) nên không bao giờ tự
-- chuyển "Chờ sản xuất" -> "Đang sản xuất", dù UI vẫn hiển thị đúng % lấp đầy.
--
-- Xem thêm .claude/rules/06-module-production.md mục "Cập nhật 2026-08-30" để biết bối cảnh đầy
-- đủ, và bug UI đi kèm (thiếu nút chuyển trạng thái tay cho ngăn "Chờ sản xuất") đã fix riêng ở
-- src/app/dashboard/storage/page.tsx (nút "Bắt đầu SX").

CREATE OR REPLACE FUNCTION sync_ngan_production_status(p_ngan_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_trang_thai TEXT;
  v_total_kg   NUMERIC;
BEGIN
  SELECT trang_thai INTO v_trang_thai FROM ngans WHERE id = p_ngan_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Chỉ đụng 2 trạng thái "sống" của vòng đời sản xuất; không chạm "Đang nhận"/"Đóng" (chưa
  -- vào sản xuất) hay "Đã sản xuất" (đã chốt tay, chỉ admin mới đổi lại). GIỮ NGUYÊN so với
  -- 20260808_sync_ngan_production_status.sql.
  IF v_trang_thai NOT IN ('Chờ sản xuất', 'Đang sản xuất') THEN
    RETURN;
  END IF;

  -- FIX: cộng thêm sản lượng của các lô "mồ côi" (lots.ngan_id đúng ngăn này nhưng KHÔNG có
  -- lot_transactions nào) — đúng công thức loadStorageLots() (UI) đã dùng để tính tpPct trên
  -- card ngăn. RPC trước đây chỉ đếm lot_transactions nên bị lệch với UI trong trường hợp này.
  -- Với ngăn không có lô mồ côi, NOT EXISTS luôn đúng cho tập rỗng nên v_total_kg tự rút gọn về
  -- đúng công thức cũ — không có regression cho trường hợp bình thường.
  SELECT
    COALESCE(SUM(lt.so_kg), 0) + COALESCE((
      SELECT SUM(l.tong_kg)
      FROM lots l
      WHERE l.ngan_id = p_ngan_id
        AND NOT EXISTS (SELECT 1 FROM lot_transactions x WHERE x.lot_id = l.id)
    ), 0)
  INTO v_total_kg
  FROM lot_transactions lt
  WHERE lt.ngan_id = p_ngan_id;

  IF v_total_kg > 0 AND v_trang_thai <> 'Đang sản xuất' THEN
    UPDATE ngans SET trang_thai = 'Đang sản xuất' WHERE id = p_ngan_id;
  ELSIF v_total_kg <= 0 AND v_trang_thai = 'Đang sản xuất' THEN
    -- Toàn bộ sản lượng của ngăn vừa bị xóa hết (vd xóa dòng cuối trong "Lịch sử ca") ->
    -- trả về Chờ sản xuất.
    UPDATE ngans SET trang_thai = 'Chờ sản xuất' WHERE id = p_ngan_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION sync_ngan_production_status(UUID) TO authenticated, service_role;

-- Backfill 1 lần: bù lại các ngăn bị lệch trạng thái do RPC cũ bỏ sót lô mồ côi. An toàn chạy lại
-- nhiều lần (idempotent — hàm chỉ UPDATE khi trạng thái thực sự cần đổi), không đụng ngăn
-- "Đang nhận"/"Đóng"/"Đã sản xuất".
DO $$
DECLARE
  v_ngan_id UUID;
BEGIN
  FOR v_ngan_id IN SELECT id FROM ngans WHERE trang_thai IN ('Chờ sản xuất', 'Đang sản xuất') LOOP
    PERFORM sync_ngan_production_status(v_ngan_id);
  END LOOP;
END;
$$;
