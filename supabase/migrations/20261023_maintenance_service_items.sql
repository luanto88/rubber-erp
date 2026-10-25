-- ============================================================
-- 2026-10-23 — Bước 3: GIA CÔNG NGOÀI (dịch vụ) trên biên bản bảo trì
-- CHẠY TAY trên Supabase SQL Editor TRƯỚC khi deploy code (code mới đọc cột la_dich_vu,
-- gọi RPC purchase_complete_service). Idempotent — chạy lại an toàn.
--
-- 1. inventory_items.la_dich_vu — mã "dịch vụ gia công" (tiện trục, quấn motor...), KHÔNG tồn kho.
-- 2. Bảng purchase_service_completions — "Xác nhận hoàn thành" dịch vụ thay cho nhập kho.
-- 3. purchase_effective_lines: "đã mua" = nhập kho posted + đã xác nhận hoàn thành.
-- 4. Trigger chặn MỌI phiếu kho (Nhập/Xuất/Chuyển, kể cả purchase_receive) chứa mã dịch vụ.
-- 5. RPC purchase_complete_service (chỉ service_role).
-- ============================================================

-- ── 1. Cờ dịch vụ ──────────────────────────────────────────
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS la_dich_vu BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_inventory_items_la_dich_vu ON inventory_items(factory_id) WHERE la_dich_vu;

-- ── 2. Lịch sử xác nhận hoàn thành dịch vụ ─────────────────
CREATE TABLE IF NOT EXISTS purchase_service_completions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id  UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  request_id  UUID NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  line_id     UUID NOT NULL REFERENCES purchase_request_lines(id) ON DELETE CASCADE,
  item_id     UUID REFERENCES inventory_items(id),
  item_name   TEXT,
  unit        TEXT,
  so_luong    NUMERIC NOT NULL CHECK (so_luong > 0),
  don_gia     NUMERIC NOT NULL DEFAULT 0,
  loai_tien   TEXT,
  ngay        DATE NOT NULL,
  nha_cung_cap TEXT,
  ghi_chu     TEXT,
  image_urls  TEXT[] NOT NULL DEFAULT '{}',
  created_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_purchase_service_completions_request ON purchase_service_completions(request_id);
CREATE INDEX IF NOT EXISTS idx_purchase_service_completions_line ON purchase_service_completions(line_id);

ALTER TABLE purchase_service_completions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS purchase_service_completions_select ON purchase_service_completions;
CREATE POLICY purchase_service_completions_select ON purchase_service_completions FOR SELECT USING (
  factory_id = current_profile_factory_id()
  AND (
    current_profile_role() = 'admin'
    OR current_profile_has_permission('purchase.view_all')
    OR purchase_can_view(request_id, auth.uid())
  )
);
-- Không có policy ghi: chỉ RPC purchase_complete_service (service_role) được ghi.

-- ── 3. Thông số hiệu lực — cộng thêm phần đã xác nhận hoàn thành ──
-- Chép nguyên bản 20261008, chỉ đổi cột "received".
CREATE OR REPLACE FUNCTION purchase_effective_lines(p_request_id UUID)
RETURNS TABLE (
  root_line_id UUID, item_id UUID, item_code TEXT, item_name TEXT, unit TEXT,
  so_luong NUMERIC, don_gia NUMERIC, received NUMERIC, adjusted BOOLEAN, pending_adjust BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id,
    COALESCE(a.item_id, l.item_id),
    COALESCE(a.item_code, l.item_code),
    COALESCE(a.item_name, l.item_name),
    COALESCE(a.unit, l.unit),
    COALESCE(a.so_luong, l.so_luong),
    COALESCE(a.don_gia, l.don_gia),
    COALESCE((
      SELECT SUM(idl.quantity)
      FROM inventory_document_lines idl
      JOIN inventory_documents d ON d.id = idl.document_id
      WHERE idl.purchase_request_line_id = l.id AND d.status = 'posted'
    ), 0)
    + COALESCE((
      SELECT SUM(sc.so_luong) FROM purchase_service_completions sc WHERE sc.line_id = l.id
    ), 0),
    a.id IS NOT NULL,
    EXISTS (
      SELECT 1 FROM purchase_request_lines pl
      JOIN purchase_requests pr ON pr.id = pl.request_id
      WHERE pl.parent_line_id = l.id AND pr.loai = 'dieu_chinh'
        AND pr.trang_thai IN ('nhap', 'cho_ky', 'tra_ve')
    )
  FROM purchase_request_lines l
  LEFT JOIN LATERAL (
    SELECT al.id, al.item_id, al.item_code, al.item_name, al.unit, al.so_luong, al.don_gia
    FROM purchase_request_lines al
    JOIN purchase_requests ar ON ar.id = al.request_id
    WHERE al.parent_line_id = l.id AND ar.loai = 'dieu_chinh' AND ar.trang_thai = 'hoan_tat'
    ORDER BY ar.ngay_duyet DESC NULLS LAST, ar.created_at DESC
    LIMIT 1
  ) a ON true
  WHERE l.request_id = p_request_id
  ORDER BY l.sort_order
$$;

REVOKE EXECUTE ON FUNCTION purchase_effective_lines(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION purchase_effective_lines(UUID) TO service_role;

-- ── 4. Chặn mã dịch vụ đi vào phiếu kho ────────────────────
CREATE OR REPLACE FUNCTION inventory_block_service_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name TEXT;
BEGIN
  IF NEW.item_id IS NULL THEN RETURN NEW; END IF;
  SELECT name INTO v_name FROM inventory_items WHERE id = NEW.item_id AND la_dich_vu;
  IF FOUND THEN
    RAISE EXCEPTION '"%" là dịch vụ gia công — không nhập/xuất kho. Dùng "Xác nhận hoàn thành" trên phiếu đề nghị mua.', v_name;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_block_service_items ON inventory_document_lines;
CREATE TRIGGER trg_inventory_block_service_items
  BEFORE INSERT OR UPDATE OF item_id ON inventory_document_lines
  FOR EACH ROW EXECUTE FUNCTION inventory_block_service_items();

-- ── 5. Xác nhận hoàn thành dịch vụ ─────────────────────────
CREATE OR REPLACE FUNCTION purchase_complete_service(
  p_factory_id UUID,
  p_request_id UUID,
  p_actor_id UUID,
  p_ngay DATE,
  p_source_name TEXT,
  p_note TEXT,
  p_image_urls TEXT[],
  p_lines JSONB
)
RETURNS TABLE (out_count INTEGER, out_total NUMERIC, out_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req purchase_requests%ROWTYPE;
  v_eff RECORD;
  v_in JSONB;
  v_line_id UUID;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_is_service BOOLEAN;
  v_seen UUID[] := '{}';
  v_total NUMERIC := 0;
  v_count INTEGER := 0;
  v_status TEXT;
BEGIN
  SELECT * INTO v_req FROM purchase_requests
  WHERE id = p_request_id AND factory_id = p_factory_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy phiếu đề nghị.'; END IF;
  IF v_req.loai <> 'goc' THEN RAISE EXCEPTION 'Phiếu điều chỉnh không xác nhận trực tiếp — xác nhận theo phiếu gốc.'; END IF;
  IF v_req.trang_thai NOT IN ('da_duyet', 'dang_mua') THEN
    RAISE EXCEPTION 'Phiếu ở trạng thái "%" — chỉ phiếu đã duyệt / đang mua mới xác nhận hoàn thành được.', v_req.trang_thai;
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Chưa có dòng dịch vụ nào để xác nhận.';
  END IF;

  FOR v_in IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_line_id := (v_in ->> 'line_id')::UUID;
    v_qty := COALESCE((v_in ->> 'quantity')::NUMERIC, 0);
    v_price := COALESCE((v_in ->> 'don_gia')::NUMERIC, 0);

    IF v_line_id = ANY(v_seen) THEN RAISE EXCEPTION 'Một dòng dịch vụ bị gửi 2 lần.'; END IF;
    v_seen := v_seen || v_line_id;

    PERFORM 1 FROM purchase_request_lines WHERE id = v_line_id AND request_id = p_request_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Dòng không thuộc phiếu này.'; END IF;

    SELECT * INTO v_eff FROM purchase_effective_lines(p_request_id) e WHERE e.root_line_id = v_line_id;
    SELECT COALESCE(la_dich_vu, false) INTO v_is_service FROM inventory_items WHERE id = v_eff.item_id;
    IF NOT COALESCE(v_is_service, false) THEN
      RAISE EXCEPTION '"%" không phải dịch vụ gia công — dùng "Ghi nhận mua" để nhập kho.', v_eff.item_name;
    END IF;
    IF v_eff.pending_adjust THEN
      RAISE EXCEPTION '"%" đang có phiếu điều chỉnh chưa duyệt — chờ duyệt xong mới xác nhận.', v_eff.item_name;
    END IF;
    IF v_qty <= 0 THEN RAISE EXCEPTION '"%": số lượng phải lớn hơn 0.', v_eff.item_name; END IF;
    IF v_price < 0 THEN RAISE EXCEPTION '"%": đơn giá không hợp lệ.', v_eff.item_name; END IF;
    IF v_eff.received + v_qty > v_eff.so_luong THEN
      RAISE EXCEPTION '"%": xác nhận % vượt số lượng duyệt còn lại % (đã xong %/%).',
        v_eff.item_name, v_qty, v_eff.so_luong - v_eff.received, v_eff.received, v_eff.so_luong;
    END IF;
    IF v_eff.don_gia > 0 AND abs(v_price - v_eff.don_gia) > v_eff.don_gia * 0.10 + 0.000001 THEN
      RAISE EXCEPTION '"%": đơn giá % lệch quá 10 phần trăm so với giá duyệt % — cần lập phiếu điều chỉnh trước.',
        v_eff.item_name, v_price, v_eff.don_gia;
    END IF;

    INSERT INTO purchase_service_completions (
      factory_id, request_id, line_id, item_id, item_name, unit, so_luong, don_gia, loai_tien,
      ngay, nha_cung_cap, ghi_chu, image_urls, created_by
    ) VALUES (
      p_factory_id, p_request_id, v_line_id, v_eff.item_id, v_eff.item_name, v_eff.unit, v_qty, v_price, v_req.loai_tien,
      p_ngay, NULLIF(trim(COALESCE(p_source_name, '')), ''),
      NULLIF(trim(COALESCE(v_in ->> 'note', p_note, '')), ''),
      COALESCE(p_image_urls, '{}'), p_actor_id
    );
    v_total := v_total + v_qty * v_price;
    v_count := v_count + 1;
  END LOOP;

  v_status := purchase_recompute_request(p_request_id);
  RETURN QUERY SELECT v_count, round(v_total, 2), v_status;
END;
$$;

REVOKE EXECUTE ON FUNCTION purchase_complete_service(UUID, UUID, UUID, DATE, TEXT, TEXT, TEXT[], JSONB) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION purchase_complete_service(UUID, UUID, UUID, DATE, TEXT, TEXT, TEXT[], JSONB) TO service_role;

-- Kiểm chứng sau khi chạy:
-- SELECT column_name FROM information_schema.columns WHERE table_name='inventory_items' AND column_name='la_dich_vu';
-- SELECT tgname FROM pg_trigger WHERE tgname='trg_inventory_block_service_items';
-- SELECT proname FROM pg_proc WHERE proname IN ('purchase_complete_service','inventory_block_service_items');
