-- Sửa race condition (lost update) đã phát hiện 2026-07-12: syncLotMasterSnapshot() phía JS
-- (src/app/dashboard/product/actions.ts) đọc toàn bộ lot_transactions, tính tổng ở JS, rồi ghi
-- đè lots — không có khóa nào giữa bước đọc và ghi. Khi 2 kiện của CÙNG 1 lô được xác nhận gần
-- như đồng thời (rất dễ xảy ra với tính năng "Xác nhận sản xuất qua QR" — quét liên tục, có thể
-- nhiều điện thoại quét song song), request nào tính tổng TRƯỚC (khi transaction kia chưa insert
-- xong) nhưng ghi đè SAU sẽ làm mất cập nhật của request kia — lots.tong_banh/kien_a-d bị lệch
-- so với thực tế dù mỗi request tự báo "thành công" đúng.
--
-- Chuyển toàn bộ phép tính SUM + ghi lots thành 1 hàm Postgres atomic, khóa dòng lots bằng
-- FOR UPDATE trước khi tính — mirror đúng pattern đã dùng cho perform_sang_kien_thay_boc
-- (20260619_sk_atomic_rpc.sql) và create_lot_prediction_batch (20260709_lot_predictions.sql).
CREATE OR REPLACE FUNCTION sync_lot_master_snapshot(p_lot_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_loai_banh    numeric;
  v_lo_tron      numeric;
  v_tong_banh    numeric;
  v_tong_kg      numeric;
  v_kien_a       numeric;
  v_kien_b       numeric;
  v_kien_c       numeric;
  v_kien_d       numeric;
  v_trang_thai   text;
  v_last_ca      text;
  v_last_ngan_id uuid;
  v_last_ngay    date;
  v_last_boc     text;
  v_last_pallet  text[];
  v_last_chi_thi text;
BEGIN
  -- Khóa dòng lots ngay từ đầu — mọi lệnh gọi khác cho CÙNG lô này phải chờ tới khi transaction
  -- hiện tại commit/rollback, loại bỏ hoàn toàn khoảng hở đọc-tính-ghi.
  PERFORM 1 FROM lots WHERE id = p_lot_id FOR UPDATE;

  SELECT loai_banh INTO v_loai_banh FROM lots WHERE id = p_lot_id;
  v_lo_tron := CASE WHEN v_loai_banh = 20 THEN 240 ELSE 144 END;

  SELECT
    COALESCE(SUM(kien_a), 0), COALESCE(SUM(kien_b), 0),
    COALESCE(SUM(kien_c), 0), COALESCE(SUM(kien_d), 0),
    COALESCE(SUM(so_banh), 0), COALESCE(SUM(so_kg), 0)
  INTO v_kien_a, v_kien_b, v_kien_c, v_kien_d, v_tong_banh, v_tong_kg
  FROM lot_transactions
  WHERE lot_id = p_lot_id;

  v_trang_thai := CASE WHEN v_tong_banh >= v_lo_tron THEN 'Hoàn thành' ELSE 'Dở dang' END;

  SELECT ca, ngan_id, ngay_nhap
  INTO v_last_ca, v_last_ngan_id, v_last_ngay
  FROM lot_transactions
  WHERE lot_id = p_lot_id
  ORDER BY ngay_nhap DESC, created_at DESC
  LIMIT 1;

  -- boc/pallet/chi_thi chỉ được set bởi luồng "Xác nhận sản xuất qua QR" — các dòng nhập tay cũ
  -- (product/page.tsx) để null, nên phải lọc IS NOT NULL rồi lấy giá trị MỚI NHẤT, không được
  -- coi null là "giá trị mới nhất" (sẽ vô tình xóa boc/pallet/chi_thi hiện có của lô).
  SELECT boc INTO v_last_boc FROM lot_transactions
  WHERE lot_id = p_lot_id AND boc IS NOT NULL
  ORDER BY ngay_nhap DESC, created_at DESC LIMIT 1;

  SELECT pallet INTO v_last_pallet FROM lot_transactions
  WHERE lot_id = p_lot_id AND pallet IS NOT NULL
  ORDER BY ngay_nhap DESC, created_at DESC LIMIT 1;

  SELECT chi_thi INTO v_last_chi_thi FROM lot_transactions
  WHERE lot_id = p_lot_id AND chi_thi IS NOT NULL
  ORDER BY ngay_nhap DESC, created_at DESC LIMIT 1;

  UPDATE lots SET
    kien_a     = v_kien_a,
    kien_b     = v_kien_b,
    kien_c     = v_kien_c,
    kien_d     = v_kien_d,
    tong_banh  = v_tong_banh,
    tong_kg    = v_tong_kg,
    trang_thai = v_trang_thai,
    ca         = v_last_ca,
    ngan_id    = v_last_ngan_id,
    ngay_ht    = CASE WHEN v_trang_thai = 'Hoàn thành' THEN v_last_ngay ELSE NULL END,
    boc        = COALESCE(v_last_boc, boc),
    pallet     = COALESCE(v_last_pallet, pallet),
    chi_thi    = COALESCE(v_last_chi_thi, chi_thi)
  WHERE id = p_lot_id;
END;
$$;

GRANT EXECUTE ON FUNCTION sync_lot_master_snapshot(uuid) TO authenticated, service_role;
