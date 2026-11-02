-- ============================================================
-- Đề nghị mua — GĐ4 A5: sửa GIÁ THỰC TẾ sau khi đã nhập kho / xác nhận gia công.
--   • purchase_update_actual_price: sửa giá 1 dòng phiếu nhập kho (inventory_document_lines) hoặc
--     1 lần xác nhận gia công (purchase_service_completions); kiểm lệch ≤ 10% so với giá duyệt hiệu lực.
--   • purchase_apply_line_price: phiếu điều chỉnh CHỈ ĐỔI GIÁ duyệt xong ⇒ áp giá mới cho MỌI lần nhập /
--     gia công của dòng gốc (bỏ kiểm 10% — giá mới đã được duyệt).
-- Không đụng số lượng, tồn kho (inventory_stock_movements không lưu giá), trạng thái phiếu.
-- Chỉ service_role (gọi từ API). Chạy thủ công trên Supabase SQL Editor. Idempotent.
-- ============================================================

CREATE OR REPLACE FUNCTION purchase_update_actual_price(
  p_factory_id UUID,
  p_request_id UUID,
  p_kind TEXT,            -- 'receipt' (id dòng phiếu nhập kho) | 'service' (id lần xác nhận gia công)
  p_target_id UUID,
  p_new_price NUMERIC,
  p_check_limit BOOLEAN DEFAULT true
)
RETURNS TABLE (out_old_price NUMERIC, out_line_id UUID, out_item_name TEXT, out_label TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req purchase_requests%ROWTYPE;
  v_eff RECORD;
  v_old NUMERIC;
  v_line UUID;
  v_doc UUID;
  v_label TEXT;
  v_name TEXT;
BEGIN
  SELECT * INTO v_req FROM purchase_requests
  WHERE id = p_request_id AND factory_id = p_factory_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy phiếu đề nghị.'; END IF;
  IF v_req.loai <> 'goc' THEN RAISE EXCEPTION 'Chỉ sửa giá trên phiếu đề nghị gốc.'; END IF;
  IF v_req.trang_thai = 'huy' THEN RAISE EXCEPTION 'Phiếu đã huỷ.'; END IF;
  IF p_new_price IS NULL OR p_new_price <= 0 THEN RAISE EXCEPTION 'Đơn giá mới phải lớn hơn 0.'; END IF;

  IF p_kind = 'receipt' THEN
    SELECT idl.don_gia, idl.purchase_request_line_id, idl.document_id, d.document_code, idl.item_name
      INTO v_old, v_line, v_doc, v_label, v_name
    FROM inventory_document_lines idl
    JOIN inventory_documents d ON d.id = idl.document_id
    JOIN purchase_request_lines prl ON prl.id = idl.purchase_request_line_id
    WHERE idl.id = p_target_id AND d.factory_id = p_factory_id AND prl.request_id = p_request_id
    FOR UPDATE OF idl;
    IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy dòng nhập kho thuộc phiếu này.'; END IF;
    IF (SELECT status FROM inventory_documents WHERE id = v_doc) <> 'posted' THEN
      RAISE EXCEPTION 'Phiếu nhập kho % không ở trạng thái đã ghi sổ.', v_label;
    END IF;
  ELSIF p_kind = 'service' THEN
    SELECT sc.don_gia, sc.line_id, sc.ngay::TEXT, sc.item_name
      INTO v_old, v_line, v_label, v_name
    FROM purchase_service_completions sc
    WHERE sc.id = p_target_id AND sc.request_id = p_request_id AND sc.factory_id = p_factory_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy lần xác nhận gia công thuộc phiếu này.'; END IF;
  ELSE
    RAISE EXCEPTION 'Loại không hợp lệ: %', p_kind;
  END IF;

  SELECT * INTO v_eff FROM purchase_effective_lines(p_request_id) e WHERE e.root_line_id = v_line;
  IF p_check_limit AND v_eff.don_gia > 0 AND abs(p_new_price - v_eff.don_gia) > v_eff.don_gia * 0.10 + 0.000001 THEN
    RAISE EXCEPTION '"%": đơn giá % lệch quá 10 phần trăm so với giá duyệt % — lập phiếu điều chỉnh giá.',
      v_name, p_new_price, v_eff.don_gia;
  END IF;

  IF p_kind = 'receipt' THEN
    UPDATE inventory_document_lines SET don_gia = p_new_price WHERE id = p_target_id;
    UPDATE purchase_receipts pr SET tong_tien = (
      SELECT round(COALESCE(SUM(l.quantity * COALESCE(l.don_gia, 0)), 0), 2)
      FROM inventory_document_lines l WHERE l.document_id = v_doc
    ) WHERE pr.inventory_document_id = v_doc AND pr.request_id = p_request_id;
  ELSE
    UPDATE purchase_service_completions SET don_gia = p_new_price WHERE id = p_target_id;
  END IF;

  RETURN QUERY SELECT v_old, v_line, v_name, v_label;
END;
$$;

REVOKE EXECUTE ON FUNCTION purchase_update_actual_price(UUID, UUID, TEXT, UUID, NUMERIC, BOOLEAN) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION purchase_update_actual_price(UUID, UUID, TEXT, UUID, NUMERIC, BOOLEAN) TO service_role;

-- Áp giá mới cho mọi lần nhập (đã ghi sổ) + xác nhận gia công của 1 dòng gốc. Trả số bản ghi đã đổi.
CREATE OR REPLACE FUNCTION purchase_apply_line_price(
  p_factory_id UUID,
  p_request_id UUID,
  p_line_id UUID,
  p_price NUMERIC
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_n INTEGER;
  v_doc UUID;
BEGIN
  PERFORM 1 FROM purchase_request_lines
  WHERE id = p_line_id AND request_id = p_request_id AND factory_id = p_factory_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dòng không thuộc phiếu này.'; END IF;
  IF p_price IS NULL OR p_price <= 0 THEN RAISE EXCEPTION 'Đơn giá mới phải lớn hơn 0.'; END IF;

  FOR v_doc IN
    SELECT DISTINCT idl.document_id
    FROM inventory_document_lines idl
    JOIN inventory_documents d ON d.id = idl.document_id
    WHERE idl.purchase_request_line_id = p_line_id AND d.status = 'posted'
      AND idl.don_gia IS DISTINCT FROM p_price
  LOOP
    UPDATE inventory_document_lines SET don_gia = p_price
    WHERE document_id = v_doc AND purchase_request_line_id = p_line_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_count := v_count + v_n;
    UPDATE purchase_receipts pr SET tong_tien = (
      SELECT round(COALESCE(SUM(l.quantity * COALESCE(l.don_gia, 0)), 0), 2)
      FROM inventory_document_lines l WHERE l.document_id = v_doc
    ) WHERE pr.inventory_document_id = v_doc AND pr.request_id = p_request_id;
  END LOOP;

  UPDATE purchase_service_completions SET don_gia = p_price
  WHERE line_id = p_line_id AND request_id = p_request_id AND don_gia IS DISTINCT FROM p_price;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_count + v_n;
END;
$$;

REVOKE EXECUTE ON FUNCTION purchase_apply_line_price(UUID, UUID, UUID, NUMERIC) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION purchase_apply_line_price(UUID, UUID, UUID, NUMERIC) TO service_role;

-- Kiểm chứng:
--   SELECT proname FROM pg_proc WHERE proname IN ('purchase_update_actual_price', 'purchase_apply_line_price');
