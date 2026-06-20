-- Server-side validation cho export_orders assignments
-- Ngăn chặn over-commit khi nhiều đơn cùng assign một lô

CREATE OR REPLACE FUNCTION validate_export_assignments(
  p_factory_id      UUID,
  p_exclude_order_id UUID,    -- đơn đang edit (truyền NULL nếu tạo mới)
  p_assignments     JSONB     -- array assignments muốn lưu
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  asgn              JSONB;
  v_lot             RECORD;
  v_assigned_a      INT;
  v_assigned_b      INT;
  v_assigned_c      INT;
  v_assigned_d      INT;
  v_new_a           INT;
  v_new_b           INT;
  v_new_c           INT;
  v_new_d           INT;
  v_lot_id_text     TEXT;
BEGIN
  FOR asgn IN SELECT value FROM jsonb_array_elements(p_assignments) LOOP

    v_lot_id_text := asgn->>'lot_id';
    IF v_lot_id_text IS NULL OR v_lot_id_text = '' THEN
      CONTINUE;  -- skip bản ghi không có lot_id
    END IF;

    -- Lấy số kiện hiện tại của lô từ DB
    SELECT kien_a, kien_b, kien_c, kien_d, ma_lo INTO v_lot
      FROM lots
      WHERE id = v_lot_id_text::UUID
        AND factory_id = p_factory_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Lô % không tồn tại trong nhà máy này', COALESCE(asgn->>'ma_lo', v_lot_id_text);
    END IF;

    -- Tổng kiện đã assign trong TẤT CẢ đơn khác (kể cả pending, không chỉ approved)
    SELECT
      COALESCE(SUM((a.val->>'kien_a')::INT), 0),
      COALESCE(SUM((a.val->>'kien_b')::INT), 0),
      COALESCE(SUM((a.val->>'kien_c')::INT), 0),
      COALESCE(SUM((a.val->>'kien_d')::INT), 0)
    INTO v_assigned_a, v_assigned_b, v_assigned_c, v_assigned_d
    FROM export_orders eo
    CROSS JOIN LATERAL jsonb_array_elements(eo.assignments) AS a(val)
    WHERE eo.factory_id = p_factory_id
      AND (p_exclude_order_id IS NULL OR eo.id != p_exclude_order_id)
      AND (a.val->>'lot_id') = v_lot_id_text;

    -- Số kiện đơn hiện tại muốn assign
    v_new_a := COALESCE((asgn->>'kien_a')::INT, 0);
    v_new_b := COALESCE((asgn->>'kien_b')::INT, 0);
    v_new_c := COALESCE((asgn->>'kien_c')::INT, 0);
    v_new_d := COALESCE((asgn->>'kien_d')::INT, 0);

    -- Kiểm tra tổng không vượt kien_X của lô
    IF v_assigned_a + v_new_a > v_lot.kien_a THEN
      RAISE EXCEPTION 'Lô % vượt số kiện A khả dụng (tồn: %, đã assign: %, thêm: %)',
        v_lot.ma_lo, v_lot.kien_a, v_assigned_a, v_new_a;
    END IF;
    IF v_assigned_b + v_new_b > v_lot.kien_b THEN
      RAISE EXCEPTION 'Lô % vượt số kiện B khả dụng (tồn: %, đã assign: %, thêm: %)',
        v_lot.ma_lo, v_lot.kien_b, v_assigned_b, v_new_b;
    END IF;
    IF v_assigned_c + v_new_c > v_lot.kien_c THEN
      RAISE EXCEPTION 'Lô % vượt số kiện C khả dụng (tồn: %, đã assign: %, thêm: %)',
        v_lot.ma_lo, v_lot.kien_c, v_assigned_c, v_new_c;
    END IF;
    IF v_assigned_d + v_new_d > v_lot.kien_d THEN
      RAISE EXCEPTION 'Lô % vượt số kiện D khả dụng (tồn: %, đã assign: %, thêm: %)',
        v_lot.ma_lo, v_lot.kien_d, v_assigned_d, v_new_d;
    END IF;

  END LOOP;

  RETURN jsonb_build_object('valid', true);
END;
$$;

GRANT EXECUTE ON FUNCTION validate_export_assignments(UUID, UUID, JSONB)
  TO authenticated;
