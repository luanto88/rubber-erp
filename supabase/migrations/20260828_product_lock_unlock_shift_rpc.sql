-- 2 RPC "Duyệt & Khóa"/"Mở khóa" ca sản xuất — gọi TRỰC TIẾP từ client (browser, session thật
-- của người dùng), KHÔNG qua server action service-role, giống hệt cách
-- inventory_post_import_document đang được gọi từ receipts/page.tsx. Nhờ vậy auth.uid() có sẵn
-- ngay trong hàm, dùng thẳng current_profile_has_permission() để check quyền — không cần tham
-- số p_actor_id do client truyền vào (tham số đó sẽ luôn có thể bị giả mạo bởi bất kỳ ai có
-- quyền EXECUTE, vì không có gì ràng buộc nó với JWT thật; auth.uid() thì không giả mạo được).

CREATE OR REPLACE FUNCTION public.product_lock_shift(
  p_factory_id UUID, p_ngay_sx DATE, p_ca TEXT
) RETURNS product_shift_locks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row product_shift_locks;
BEGIN
  IF NOT public.current_profile_has_permission('product.approve_shift') THEN
    RAISE EXCEPTION 'Không có quyền duyệt & khóa ca sản xuất.';
  END IF;

  -- Khóa advisory theo (factory, ngày, ca) — tránh 2 người bấm "Khóa" gần như đồng thời cùng 1
  -- ca tạo lỗi 23505 lộ ra người dùng thay vì thông báo rõ ràng "đã được khóa từ trước".
  PERFORM pg_advisory_xact_lock(hashtext(p_factory_id::text || ':' || p_ngay_sx::text || ':' || p_ca));

  IF public.product_shift_is_locked(p_factory_id, p_ngay_sx, p_ca) THEN
    RAISE EXCEPTION 'Ca sản xuất % - Ca % đã được khóa từ trước.', p_ngay_sx, p_ca;
  END IF;

  INSERT INTO product_shift_locks (factory_id, ngay_sx, ca, locked_by)
  VALUES (p_factory_id, p_ngay_sx, p_ca, auth.uid())
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.product_lock_shift(UUID, DATE, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.product_unlock_shift(
  p_factory_id UUID, p_ngay_sx DATE, p_ca TEXT, p_reason TEXT
) RETURNS product_shift_locks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_row  product_shift_locks;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Vui lòng nhập lý do mở khóa.';
  END IF;

  SELECT role INTO v_role FROM profiles WHERE id = auth.uid() AND status = 'active';
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Chỉ quản trị viên (admin) mới được mở khóa ca sản xuất.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_factory_id::text || ':' || p_ngay_sx::text || ':' || p_ca));

  UPDATE product_shift_locks
  SET is_active = false, unlocked_by = auth.uid(), unlocked_at = now(), unlock_reason = trim(p_reason)
  WHERE factory_id = p_factory_id AND ngay_sx = p_ngay_sx AND ca = p_ca AND is_active
  RETURNING * INTO v_row;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'Ca sản xuất % - Ca % hiện không bị khóa.', p_ngay_sx, p_ca;
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.product_unlock_shift(UUID, DATE, TEXT, TEXT) TO authenticated;
