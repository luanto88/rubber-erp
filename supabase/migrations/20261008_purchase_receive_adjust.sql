-- ============================================================
-- Module "Đề nghị mua vật tư hàng hóa" — Giai đoạn 2
--   • Ghi nhận mua thực tế + nhập kho NGUYÊN TỬ từ trang chi tiết phiếu
--   • Chặn mua vượt số lượng duyệt / lệch giá > 10% / đổi mã vật tư
--   • Phiếu điều chỉnh (loai = 'dieu_chinh', ký lại đủ 3 bước)
--   • Đóng phiếu khi mua thiếu, không mua tiếp
-- Chạy thủ công trên Supabase SQL Editor SAU 20261007_purchase_requests.sql. Idempotent.
--
-- Nguồn sự thật "đã mua" = tổng SỐ LƯỢNG các dòng phiếu nhập kho ĐÃ GHI SỔ (status = 'posted')
-- trỏ về dòng đề nghị gốc qua inventory_document_lines.purchase_request_line_id.
-- purchase_request_lines.sl_da_mua chỉ là bản chụp, luôn được tính lại từ nguồn này — huỷ phiếu
-- nhập kho ở module Kho sẽ tự hoàn lại (trigger ở mục 6).
-- ============================================================

-- ── 1. Cột liên kết phiếu nhập kho ↔ dòng đề nghị ──────────
ALTER TABLE inventory_document_lines ADD COLUMN IF NOT EXISTS don_gia NUMERIC;
ALTER TABLE inventory_document_lines ADD COLUMN IF NOT EXISTS loai_tien TEXT;
ALTER TABLE inventory_document_lines
  ADD COLUMN IF NOT EXISTS purchase_request_line_id UUID REFERENCES purchase_request_lines(id);
CREATE INDEX IF NOT EXISTS idx_inventory_document_lines_purchase_line
  ON inventory_document_lines(purchase_request_line_id) WHERE purchase_request_line_id IS NOT NULL;

-- ── 2. Snapshot "trước điều chỉnh" trên dòng phiếu điều chỉnh ──
ALTER TABLE purchase_request_lines ADD COLUMN IF NOT EXISTS truoc_item_id UUID;
ALTER TABLE purchase_request_lines ADD COLUMN IF NOT EXISTS truoc_item_code TEXT;
ALTER TABLE purchase_request_lines ADD COLUMN IF NOT EXISTS truoc_item_name TEXT;
ALTER TABLE purchase_request_lines ADD COLUMN IF NOT EXISTS truoc_so_luong NUMERIC;
ALTER TABLE purchase_request_lines ADD COLUMN IF NOT EXISTS truoc_don_gia NUMERIC;
CREATE INDEX IF NOT EXISTS idx_purchase_request_lines_parent ON purchase_request_lines(parent_line_id)
  WHERE parent_line_id IS NOT NULL;

ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS dong_boi UUID REFERENCES auth.users(id);
ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS dong_luc TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_purchase_requests_parent ON purchase_requests(parent_request_id)
  WHERE parent_request_id IS NOT NULL;

-- ── 3. Lịch sử ghi nhận mua (1 dòng = 1 lần nhập kho) ──────
CREATE TABLE IF NOT EXISTS purchase_receipts (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id             UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  request_id             UUID NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  inventory_document_id  UUID REFERENCES inventory_documents(id),
  document_code          TEXT,
  ngay                   DATE NOT NULL,
  warehouse_id           UUID REFERENCES inventory_warehouses(id),
  nha_cung_cap           TEXT,
  ghi_chu                TEXT,
  image_urls             TEXT[] NOT NULL DEFAULT '{}',
  tong_tien              NUMERIC NOT NULL DEFAULT 0,
  loai_tien              TEXT,
  created_by             UUID REFERENCES auth.users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_purchase_receipts_request ON purchase_receipts(request_id);

ALTER TABLE purchase_receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS purchase_receipts_select ON purchase_receipts;
CREATE POLICY purchase_receipts_select ON purchase_receipts FOR SELECT USING (
  factory_id = current_profile_factory_id()
  AND (
    current_profile_role() = 'admin'
    OR current_profile_has_permission('purchase.view_all')
    OR purchase_can_view(request_id, auth.uid())
  )
);

-- ── 4. Thông số HIỆU LỰC của từng dòng gốc ─────────────────
-- = dòng của phiếu điều chỉnh ĐÃ DUYỆT mới nhất trỏ về dòng gốc, không có thì chính dòng gốc.
-- pending_adjust = đang có phiếu điều chỉnh chưa duyệt (nháp / đang ký / bị trả về) cho dòng này.
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

-- ── 5. Tính lại "đã mua" + trạng thái phiếu gốc ────────────
-- Chỉ đụng phiếu gốc đang ở da_duyet / dang_mua / hoan_tat (không đụng nháp, đang ký, đóng, huỷ).
CREATE OR REPLACE FUNCTION purchase_recompute_request(p_request_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_next TEXT;
  v_all_full BOOLEAN := true;
  v_any BOOLEAN := false;
  v_has_line BOOLEAN := false;
  r RECORD;
BEGIN
  SELECT trang_thai INTO v_status FROM purchase_requests
  WHERE id = p_request_id AND loai = 'goc' FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  FOR r IN SELECT * FROM purchase_effective_lines(p_request_id) LOOP
    v_has_line := true;
    UPDATE purchase_request_lines SET sl_da_mua = r.received WHERE id = r.root_line_id;
    IF r.received > 0 THEN v_any := true; END IF;
    IF r.received < r.so_luong THEN v_all_full := false; END IF;
  END LOOP;

  IF v_status NOT IN ('da_duyet', 'dang_mua', 'hoan_tat') OR NOT v_has_line THEN
    RETURN v_status;
  END IF;

  v_next := CASE WHEN v_all_full THEN 'hoan_tat' WHEN v_any THEN 'dang_mua' ELSE 'da_duyet' END;
  IF v_next <> v_status THEN
    UPDATE purchase_requests SET trang_thai = v_next, updated_at = now() WHERE id = p_request_id;
  END IF;
  RETURN v_next;
END;
$$;

REVOKE EXECUTE ON FUNCTION purchase_recompute_request(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION purchase_recompute_request(UUID) TO service_role;

-- ── 6. Huỷ / ghi sổ phiếu nhập kho ở module Kho → tự tính lại ──
-- SECURITY DEFINER: người huỷ phiếu kho là user thường, RLS purchase_* chỉ cho SELECT.
CREATE OR REPLACE FUNCTION purchase_on_inventory_doc_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.document_type = 'import' THEN
    FOR r IN
      SELECT DISTINCT prl.request_id
      FROM inventory_document_lines idl
      JOIN purchase_request_lines prl ON prl.id = idl.purchase_request_line_id
      WHERE idl.document_id = NEW.id
    LOOP
      PERFORM purchase_recompute_request(r.request_id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_on_inventory_doc_status ON inventory_documents;
CREATE TRIGGER trg_purchase_on_inventory_doc_status
  AFTER UPDATE OF status ON inventory_documents
  FOR EACH ROW EXECUTE FUNCTION purchase_on_inventory_doc_status();

-- ── 7. Ghi nhận mua + nhập kho trong MỘT giao dịch ─────────
-- p_lines: [{ "line_id": uuid, "quantity": n, "don_gia": n, "lot_no": text|null,
--             "expiry_date": "YYYY-MM-DD"|null, "note": text|null }]
-- Khoá phiếu + từng dòng gốc (FOR UPDATE) nên 2 người bấm cùng lúc không thể nhập vượt SL duyệt.
CREATE OR REPLACE FUNCTION purchase_receive(
  p_factory_id UUID,
  p_request_id UUID,
  p_actor_id UUID,
  p_actor_name TEXT,
  p_warehouse_id UUID,
  p_document_date DATE,
  p_source_name TEXT,
  p_note TEXT,
  p_image_urls TEXT[],
  p_lines JSONB
)
RETURNS TABLE (out_document_id UUID, out_document_code TEXT, out_status TEXT)
LANGUAGE plpgsql
AS $$
DECLARE
  v_req purchase_requests%ROWTYPE;
  v_wh inventory_warehouses%ROWTYPE;
  v_item inventory_items%ROWTYPE;
  v_eff RECORD;
  v_in JSONB;
  v_line_id UUID;
  v_qty NUMERIC;
  v_price NUMERIC;
  v_lot TEXT;
  v_exp DATE;
  v_doc_id UUID;
  v_code TEXT;
  v_seq INTEGER;
  v_total NUMERIC := 0;
  v_seen UUID[] := '{}';
  v_status TEXT;
  v_url TEXT;
  v_i INTEGER := 0;
BEGIN
  SELECT * INTO v_req FROM purchase_requests
  WHERE id = p_request_id AND factory_id = p_factory_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy phiếu đề nghị.'; END IF;
  IF v_req.loai <> 'goc' THEN RAISE EXCEPTION 'Phiếu điều chỉnh không nhập kho trực tiếp — nhập theo phiếu gốc.'; END IF;
  IF v_req.trang_thai NOT IN ('da_duyet', 'dang_mua') THEN
    RAISE EXCEPTION 'Phiếu ở trạng thái "%" — chỉ phiếu đã duyệt / đang mua mới ghi nhận mua được.', v_req.trang_thai;
  END IF;

  SELECT * INTO v_wh FROM inventory_warehouses WHERE id = p_warehouse_id AND factory_id = p_factory_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Kho nhập không hợp lệ.'; END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Chưa có dòng vật tư nào để nhập.';
  END IF;

  -- Mã phiếu nhập N-<KHO>-DDMMYY/XXX (cùng quy ước màn Nhập kho). Khoá theo kho+ngày để 2 lượt
  -- song song không cấp trùng số; vẫn dò tiếp nếu số đã bị màn Nhập kho dùng.
  PERFORM pg_advisory_xact_lock(hashtext('inv_import_code:' || p_factory_id::text || ':' || p_warehouse_id::text || ':' || p_document_date::text));
  SELECT COUNT(*) + 1 INTO v_seq FROM inventory_documents
  WHERE factory_id = p_factory_id AND document_type = 'import'
    AND target_warehouse_id = p_warehouse_id AND document_date = p_document_date;
  LOOP
    v_code := 'N-' || v_wh.code || '-' || to_char(p_document_date, 'DDMMYY') || '/' || lpad(v_seq::text, 3, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM inventory_documents WHERE factory_id = p_factory_id AND document_code = v_code);
    v_seq := v_seq + 1;
  END LOOP;

  INSERT INTO inventory_documents (
    factory_id, document_code, document_type, document_date, target_warehouse_id,
    source_name, requester_name, created_by, status, qr_value, notes
  ) VALUES (
    p_factory_id, v_code, 'import', p_document_date, p_warehouse_id,
    NULLIF(trim(COALESCE(p_source_name, '')), ''), p_actor_name, p_actor_id, 'draft',
    '/dashboard/inventory/print?type=import&code=' || replace(v_code, '/', '%2F'),
    trim('Nhập theo đề nghị mua số ' || lpad(v_req.so::text, 2, '0') || '/ĐNMVT (' || v_req.nam || ')'
      || COALESCE('. ' || NULLIF(trim(COALESCE(p_note, '')), ''), ''))
  ) RETURNING id INTO v_doc_id;

  FOR v_in IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_line_id := (v_in ->> 'line_id')::UUID;
    v_qty := COALESCE((v_in ->> 'quantity')::NUMERIC, 0);
    v_price := COALESCE((v_in ->> 'don_gia')::NUMERIC, 0);
    v_lot := NULLIF(trim(COALESCE(v_in ->> 'lot_no', '')), '');
    v_exp := NULLIF(v_in ->> 'expiry_date', '')::DATE;

    IF v_line_id = ANY(v_seen) THEN RAISE EXCEPTION 'Một dòng vật tư bị gửi 2 lần.'; END IF;
    v_seen := v_seen || v_line_id;

    PERFORM 1 FROM purchase_request_lines WHERE id = v_line_id AND request_id = p_request_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Dòng vật tư không thuộc phiếu này.'; END IF;

    SELECT * INTO v_eff FROM purchase_effective_lines(p_request_id) e WHERE e.root_line_id = v_line_id;

    IF v_eff.pending_adjust THEN
      RAISE EXCEPTION 'Vật tư "%" đang có phiếu điều chỉnh chưa duyệt — chờ duyệt xong mới nhập.', v_eff.item_name;
    END IF;
    IF v_qty <= 0 THEN RAISE EXCEPTION 'Vật tư "%": số lượng phải lớn hơn 0.', v_eff.item_name; END IF;
    IF v_price < 0 THEN RAISE EXCEPTION 'Vật tư "%": đơn giá không hợp lệ.', v_eff.item_name; END IF;
    IF v_eff.received + v_qty > v_eff.so_luong THEN
      RAISE EXCEPTION 'Vật tư "%": nhập % vượt số lượng duyệt còn lại % (đã nhập %/%). Phần mua thêm phải lập phiếu đề nghị mới.',
        v_eff.item_name, v_qty, v_eff.so_luong - v_eff.received, v_eff.received, v_eff.so_luong;
    END IF;
    IF v_eff.don_gia > 0 AND abs(v_price - v_eff.don_gia) > v_eff.don_gia * 0.10 + 0.000001 THEN
      RAISE EXCEPTION 'Vật tư "%": đơn giá % lệch % so với giá duyệt % — cần lập phiếu điều chỉnh trước khi nhập.',
        v_eff.item_name, v_price,
        round(((v_price - v_eff.don_gia) / v_eff.don_gia * 100)::NUMERIC, 1)::TEXT || ' phần trăm',
        v_eff.don_gia;
    END IF;

    SELECT * INTO v_item FROM inventory_items WHERE id = v_eff.item_id AND factory_id = p_factory_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Vật tư "%" không còn trong danh mục kho.', v_eff.item_name; END IF;
    IF COALESCE(v_item.manages_lot, false) AND v_lot IS NULL THEN
      RAISE EXCEPTION 'Vật tư "%" quản lý theo lô — bắt buộc nhập số lô.', v_item.name;
    END IF;

    INSERT INTO inventory_document_lines (
      factory_id, document_id, item_id, item_code, item_name, unit, specification, quantity,
      lot_no, expiry_date, location_code, line_notes, image_urls, don_gia, loai_tien, purchase_request_line_id
    ) VALUES (
      p_factory_id, v_doc_id, v_item.id, v_item.code, v_item.name, COALESCE(v_item.unit, v_eff.unit, ''),
      v_item.specification, v_qty, v_lot, v_exp, v_wh.code,
      NULLIF(trim(COALESCE(v_in ->> 'note', '')), ''), '{}', v_price, v_req.loai_tien, v_line_id
    );
    v_total := v_total + v_qty * v_price;
  END LOOP;

  PERFORM * FROM inventory_post_import_document(p_factory_id, v_doc_id, p_actor_id);

  IF p_image_urls IS NOT NULL THEN
    FOREACH v_url IN ARRAY p_image_urls LOOP
      INSERT INTO inventory_document_attachments (factory_id, document_id, file_path, sort_order)
      VALUES (p_factory_id, v_doc_id, v_url, v_i);
      v_i := v_i + 1;
    END LOOP;
  END IF;

  INSERT INTO purchase_receipts (
    factory_id, request_id, inventory_document_id, document_code, ngay, warehouse_id,
    nha_cung_cap, ghi_chu, image_urls, tong_tien, loai_tien, created_by
  ) VALUES (
    p_factory_id, p_request_id, v_doc_id, v_code, p_document_date, p_warehouse_id,
    NULLIF(trim(COALESCE(p_source_name, '')), ''), NULLIF(trim(COALESCE(p_note, '')), ''),
    COALESCE(p_image_urls, '{}'), round(v_total, 2), v_req.loai_tien, p_actor_id
  );

  v_status := purchase_recompute_request(p_request_id);
  RETURN QUERY SELECT v_doc_id, v_code, v_status;
END;
$$;

REVOKE EXECUTE ON FUNCTION purchase_receive(UUID, UUID, UUID, TEXT, UUID, DATE, TEXT, TEXT, TEXT[], JSONB) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION purchase_receive(UUID, UUID, UUID, TEXT, UUID, DATE, TEXT, TEXT, TEXT[], JSONB) TO service_role;

-- Kiểm chứng:
--   SELECT * FROM purchase_effective_lines('<request_id>');
--   SELECT tgname FROM pg_trigger WHERE tgname = 'trg_purchase_on_inventory_doc_status';
