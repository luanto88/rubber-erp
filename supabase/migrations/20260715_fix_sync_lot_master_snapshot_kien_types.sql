-- Fix bug thật: nút "GỬI DỮ LIỆU" (quét QR xác nhận sản xuất) và luồng xóa giao dịch còn dữ liệu
-- khác báo lỗi đỏ "Khong dong bo duoc lo: structure of query does not match function result type".
--
-- Nguyên nhân: migration 20260715_sync_lot_master_snapshot_returns_row.sql khai báo
-- RETURNS TABLE(kien_a numeric, kien_b numeric, kien_c numeric, kien_d numeric, tong_banh numeric, ...)
-- nhưng 5 cột này trong bảng `lots` thật là INTEGER (xem supabase/schema.sql). Thân hàm
-- `RETURN QUERY SELECT lots.kien_a, ...` select thẳng từ bảng nên trả về integer thật — PL/pgSQL
-- yêu cầu kiểu trả về phải binary-coercible với khai báo RETURNS TABLE, và int4 -> numeric chỉ là
-- assignment-cast (không binary-coercible) nên Postgres raise đúng lỗi trên. Lỗi này chặn cả
-- delete_lot_transaction() vì hàm đó gọi PERFORM sync_lot_master_snapshot(...) — exception xảy ra
-- ngay khi Postgres build tuple descriptor, trước khi PERFORM kịp bỏ qua kết quả.
--
-- Fix: giữ nguyên toàn bộ logic, chỉ sửa 5 cột kien_a/b/c/d/tong_banh trong RETURNS TABLE từ
-- numeric sang integer cho khớp đúng kiểu thật của `lots`. Đổi return type bắt buộc DROP trước
-- CREATE (Postgres không cho CREATE OR REPLACE đổi kiểu trả về).
DROP FUNCTION IF EXISTS sync_lot_master_snapshot(uuid);

CREATE FUNCTION sync_lot_master_snapshot(p_lot_id uuid)
RETURNS TABLE (
  kien_a integer,
  kien_b integer,
  kien_c integer,
  kien_d integer,
  tong_banh integer,
  tong_kg numeric,
  trang_thai text,
  ca text,
  ngan_id uuid,
  ngay_ht date,
  boc text,
  pallet text[],
  chi_thi text
)
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
    COALESCE(SUM(lt.kien_a), 0), COALESCE(SUM(lt.kien_b), 0),
    COALESCE(SUM(lt.kien_c), 0), COALESCE(SUM(lt.kien_d), 0),
    COALESCE(SUM(lt.so_banh), 0), COALESCE(SUM(lt.so_kg), 0)
  INTO v_kien_a, v_kien_b, v_kien_c, v_kien_d, v_tong_banh, v_tong_kg
  FROM lot_transactions lt
  WHERE lt.lot_id = p_lot_id;

  v_trang_thai := CASE WHEN v_tong_banh >= v_lo_tron THEN 'Hoàn thành' ELSE 'Dở dang' END;

  SELECT lt.ca, lt.ngan_id, lt.ngay_nhap
  INTO v_last_ca, v_last_ngan_id, v_last_ngay
  FROM lot_transactions lt
  WHERE lt.lot_id = p_lot_id
  ORDER BY lt.ngay_nhap DESC, lt.created_at DESC
  LIMIT 1;

  -- boc/pallet/chi_thi chỉ được set bởi luồng "Xác nhận sản xuất qua QR" — các dòng nhập tay cũ
  -- (product/page.tsx) để null, nên phải lọc IS NOT NULL rồi lấy giá trị MỚI NHẤT, không được
  -- coi null là "giá trị mới nhất" (sẽ vô tình xóa boc/pallet/chi_thi hiện có của lô).
  SELECT lt.boc INTO v_last_boc FROM lot_transactions lt
  WHERE lt.lot_id = p_lot_id AND lt.boc IS NOT NULL
  ORDER BY lt.ngay_nhap DESC, lt.created_at DESC LIMIT 1;

  SELECT lt.pallet INTO v_last_pallet FROM lot_transactions lt
  WHERE lt.lot_id = p_lot_id AND lt.pallet IS NOT NULL
  ORDER BY lt.ngay_nhap DESC, lt.created_at DESC LIMIT 1;

  SELECT lt.chi_thi INTO v_last_chi_thi FROM lot_transactions lt
  WHERE lt.lot_id = p_lot_id AND lt.chi_thi IS NOT NULL
  ORDER BY lt.ngay_nhap DESC, lt.created_at DESC LIMIT 1;

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
    boc        = COALESCE(v_last_boc, lots.boc),
    pallet     = COALESCE(v_last_pallet, lots.pallet),
    chi_thi    = COALESCE(v_last_chi_thi, lots.chi_thi)
  WHERE lots.id = p_lot_id;

  RETURN QUERY
    SELECT
      lots.kien_a, lots.kien_b, lots.kien_c, lots.kien_d,
      lots.tong_banh, lots.tong_kg, lots.trang_thai, lots.ca,
      lots.ngan_id, lots.ngay_ht, lots.boc, lots.pallet, lots.chi_thi
    FROM lots
    WHERE lots.id = p_lot_id;
END;
$$;

GRANT EXECUTE ON FUNCTION sync_lot_master_snapshot(uuid) TO authenticated, service_role;
