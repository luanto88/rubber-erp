-- Tối ưu round-trip cho luồng "Xác nhận sản xuất qua QR" (module Kiểm soát quá trình sản xuất,
-- xem yêu cầu cải tiến tốc độ trong .claude/rules/06-module-production.md mục 4.6 "Cập nhật
-- 2026-07-15"). Mỗi lần lưu 1 giao dịch thành phẩm (saveLotTransaction, product/actions.ts)
-- trước đây tốn 2 round-trip Supabase riêng biệt: gọi RPC sync_lot_master_snapshot (RETURNS
-- void) rồi phải SELECT lại bảng `lots` chỉ để lấy đúng snapshot vừa được RPC tính ra.
--
-- Đổi RPC sang RETURNS TABLE — trả thẳng snapshot ngay trong cùng lệnh gọi, loại bỏ hẳn round-
-- trip SELECT theo sau. Đây là hàm được gọi rất thường xuyên (mọi lần lưu/sửa/xóa giao dịch
-- thành phẩm, cả nhập tay lẫn quét QR liên tục) nên giảm 1 round-trip có ý nghĩa rõ rệt.
--
-- Đổi return type bắt buộc DROP trước khi CREATE (Postgres không cho CREATE OR REPLACE đổi kiểu
-- trả về). delete_lot_transaction() (20260714_fix_delete_lot_transaction_ambiguous_column.sql)
-- gọi hàm này qua `PERFORM sync_lot_master_snapshot(v_lot_id)` — PERFORM hợp lệ với cả hàm trả
-- về setof/table (chỉ đơn giản chạy và bỏ qua kết quả), nên không cần sửa gì ở đó.
DROP FUNCTION IF EXISTS sync_lot_master_snapshot(uuid);

CREATE FUNCTION sync_lot_master_snapshot(p_lot_id uuid)
RETURNS TABLE (
  kien_a numeric,
  kien_b numeric,
  kien_c numeric,
  kien_d numeric,
  tong_banh numeric,
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
