-- ============================================================================
-- Phân bổ dòng đề nghị mua ĐÃ DUYỆT cho biên bản bảo trì (2026-11-17)
-- Chạy tay trên Supabase SQL Editor TRƯỚC khi deploy.
--
-- Bối cảnh: liên kết đề nghị ↔ biên bản chỉ có cột purchase_request_lines.maintenance_record_id,
-- chỉ ghi được khi phiếu Nháp/Bị trả về. Phiếu lập riêng (dự trữ kho / gia công chung) sau khi duyệt
-- không gắn được biên bản ⇒ biên bản Gia công ngoài báo thiếu mãi, khoá Gửi ký.
--
-- Bảng mới: 1 dòng GỐC (maintenance_record_id IS NULL, phiếu loai='goc' đã duyệt) → nhiều (biên bản, SL).
-- Dòng đã có cột liên kết KHÔNG nhận phân bổ.
-- ============================================================================

CREATE TABLE IF NOT EXISTS purchase_line_record_allocations (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id             UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  request_id             UUID NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  line_id                UUID NOT NULL REFERENCES purchase_request_lines(id) ON DELETE CASCADE,
  maintenance_record_id  UUID NOT NULL REFERENCES maintenance_records(id) ON DELETE CASCADE,
  so_luong               NUMERIC NOT NULL CHECK (so_luong > 0),
  created_by             UUID REFERENCES auth.users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (line_id, maintenance_record_id)
);
CREATE INDEX IF NOT EXISTS idx_purchase_line_alloc_record ON purchase_line_record_allocations(maintenance_record_id);
CREATE INDEX IF NOT EXISTS idx_purchase_line_alloc_line ON purchase_line_record_allocations(line_id);
CREATE INDEX IF NOT EXISTS idx_purchase_line_alloc_request ON purchase_line_record_allocations(request_id);

ALTER TABLE purchase_line_record_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS purchase_line_alloc_select ON purchase_line_record_allocations;
CREATE POLICY purchase_line_alloc_select ON purchase_line_record_allocations
  FOR SELECT USING (factory_id = current_profile_factory_id());
-- Không có policy ghi: mọi ghi qua RPC purchase_allocate_line (service role).

-- ── RPC gắn / sửa / gỡ phân bổ ─────────────────────────────────────────────
-- p_qty = 0 ⇒ gỡ. Trả về JSON { ok, so_luong_cu, so_luong_moi, ma_bb }.
CREATE OR REPLACE FUNCTION purchase_allocate_line(
  p_factory_id UUID,
  p_line_id    UUID,
  p_record_id  UUID,
  p_qty        NUMERIC,
  p_actor      UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line     RECORD;
  v_req      RECORD;
  v_rec      RECORD;
  v_eff      RECORD;
  v_is_dv    BOOLEAN;
  v_need     NUMERIC;
  v_other    NUMERIC;
  v_old      NUMERIC := 0;
  v_cap      NUMERIC;
  v_signing  BOOLEAN;
BEGIN
  IF p_qty IS NULL OR p_qty < 0 THEN
    RAISE EXCEPTION 'Số lượng phân bổ không hợp lệ';
  END IF;

  SELECT * INTO v_line FROM purchase_request_lines
   WHERE id = p_line_id AND factory_id = p_factory_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy dòng đề nghị'; END IF;
  IF v_line.maintenance_record_id IS NOT NULL THEN
    RAISE EXCEPTION 'Dòng này đã thuộc 1 biên bản từ lúc lập phiếu — không phân bổ thêm';
  END IF;

  SELECT * INTO v_req FROM purchase_requests WHERE id = v_line.request_id;
  IF v_req.loai <> 'goc' THEN
    RAISE EXCEPTION 'Chỉ phân bổ được dòng của phiếu đề nghị gốc';
  END IF;
  IF v_req.trang_thai NOT IN ('da_duyet', 'dang_mua', 'hoan_tat', 'dong') THEN
    RAISE EXCEPTION 'Phiếu %/ĐNMVT chưa được duyệt hoặc đã huỷ — chưa gắn được biên bản', lpad(v_req.so::text, 2, '0');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('purchase_alloc_record:' || p_record_id::text));

  SELECT id, ma_bb, trang_thai INTO v_rec FROM maintenance_records
   WHERE id = p_record_id AND factory_id = p_factory_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy biên bản'; END IF;
  IF v_rec.trang_thai IS DISTINCT FROM 'cho_duyet' THEN
    RAISE EXCEPTION 'Biên bản % đã duyệt hoặc đã huỷ — không đổi phân bổ được', v_rec.ma_bb;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM yeu_cau_ky y
     WHERE y.factory_id = p_factory_id AND y.modun = 'maintenance' AND y.ban_ghi_id = p_record_id
       AND y.trang_thai IN ('dang_luan_chuyen', 'hoan_tat')
  ) INTO v_signing;
  IF v_signing THEN
    RAISE EXCEPTION 'Biên bản % đang/đã gửi ký — huỷ yêu cầu ký trước khi đổi phân bổ', v_rec.ma_bb;
  END IF;

  SELECT so_luong INTO v_old FROM purchase_line_record_allocations
   WHERE line_id = p_line_id AND maintenance_record_id = p_record_id;
  v_old := COALESCE(v_old, 0);

  IF p_qty = 0 THEN
    DELETE FROM purchase_line_record_allocations
     WHERE line_id = p_line_id AND maintenance_record_id = p_record_id;
    IF v_old > 0 THEN
      INSERT INTO purchase_request_logs (request_id, factory_id, user_id, hanh_dong, noi_dung)
      VALUES (v_req.id, p_factory_id, p_actor, 'go_bien_ban',
              format('Gỡ phân bổ %s %s khỏi biên bản %s', v_old, COALESCE(v_line.item_name, ''), v_rec.ma_bb));
    END IF;
    RETURN jsonb_build_object('ok', true, 'so_luong_cu', v_old, 'so_luong_moi', 0, 'ma_bb', v_rec.ma_bb);
  END IF;

  SELECT * INTO v_eff FROM purchase_effective_lines(v_req.id) e WHERE e.root_line_id = p_line_id;
  IF v_eff.item_id IS NULL THEN RAISE EXCEPTION 'Dòng đề nghị chưa có mã vật tư'; END IF;
  IF v_eff.pending_adjust THEN
    RAISE EXCEPTION 'Dòng đang có phiếu điều chỉnh chờ duyệt — đợi duyệt xong rồi phân bổ';
  END IF;

  SELECT COALESCE(la_dich_vu, false) INTO v_is_dv FROM inventory_items WHERE id = v_eff.item_id;

  SELECT COALESCE(SUM(m.so_luong), 0) INTO v_need FROM maintenance_materials m
   WHERE m.record_id = p_record_id AND m.factory_id = p_factory_id
     AND m.inventory_item_id = v_eff.item_id
     AND m.nguon = CASE WHEN v_is_dv THEN 'gia_cong' ELSE 'ben_ngoai' END;
  IF v_need <= 0 THEN
    RAISE EXCEPTION 'Biên bản % không có dòng % "%"', v_rec.ma_bb,
      CASE WHEN v_is_dv THEN 'Gia công ngoài' ELSE 'Mua ngoài' END, v_eff.item_name;
  END IF;

  -- Phần biên bản đã nhận từ phân bổ khác (dòng khác) cùng vật tư.
  SELECT COALESCE(SUM(a.so_luong), 0) INTO v_other
    FROM purchase_line_record_allocations a
    JOIN purchase_requests r ON r.id = a.request_id
   WHERE a.maintenance_record_id = p_record_id AND a.line_id <> p_line_id AND r.trang_thai <> 'huy'
     AND EXISTS (
       SELECT 1 FROM purchase_effective_lines(a.request_id) e2
        WHERE e2.root_line_id = a.line_id AND e2.item_id = v_eff.item_id
     );
  IF p_qty + v_other > v_need THEN
    RAISE EXCEPTION 'Biên bản % chỉ cần % % (đã phân bổ từ phiếu khác %) — không gắn % được',
      v_rec.ma_bb, v_need, COALESCE(v_eff.unit, ''), v_other, p_qty;
  END IF;

  -- Sức chứa của dòng: SL hiệu lực (phiếu Đóng: SL đã nhận/hoàn thành).
  v_cap := CASE WHEN v_req.trang_thai = 'dong' THEN v_eff.received ELSE v_eff.so_luong END;
  -- Phân bổ cho biên bản đã HUỶ không chiếm SL (route huỷ biên bản cũng xoá luôn phân bổ).
  SELECT COALESCE(SUM(a.so_luong), 0) INTO v_other
    FROM purchase_line_record_allocations a
    JOIN maintenance_records mr ON mr.id = a.maintenance_record_id
   WHERE a.line_id = p_line_id AND a.maintenance_record_id <> p_record_id
     AND mr.trang_thai IS DISTINCT FROM 'huy';
  IF p_qty + v_other > v_cap THEN
    RAISE EXCEPTION 'Dòng "%" chỉ còn % % chưa phân bổ — không gắn % được',
      v_eff.item_name, GREATEST(v_cap - v_other, 0), COALESCE(v_eff.unit, ''), p_qty;
  END IF;

  INSERT INTO purchase_line_record_allocations (factory_id, request_id, line_id, maintenance_record_id, so_luong, created_by)
  VALUES (p_factory_id, v_req.id, p_line_id, p_record_id, p_qty, p_actor)
  ON CONFLICT (line_id, maintenance_record_id)
  DO UPDATE SET so_luong = EXCLUDED.so_luong, updated_at = now();

  INSERT INTO purchase_request_logs (request_id, factory_id, user_id, hanh_dong, noi_dung)
  VALUES (v_req.id, p_factory_id, p_actor, 'gan_bien_ban',
          CASE WHEN v_old > 0
            THEN format('Đổi phân bổ %s cho biên bản %s: %s → %s', COALESCE(v_eff.item_name, ''), v_rec.ma_bb, v_old, p_qty)
            ELSE format('Gắn %s %s cho biên bản %s', p_qty, COALESCE(v_eff.item_name, ''), v_rec.ma_bb)
          END);

  RETURN jsonb_build_object('ok', true, 'so_luong_cu', v_old, 'so_luong_moi', p_qty, 'ma_bb', v_rec.ma_bb);
END;
$$;
REVOKE EXECUTE ON FUNCTION purchase_allocate_line(UUID, UUID, UUID, NUMERIC, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION purchase_allocate_line(UUID, UUID, UUID, NUMERIC, UUID) TO service_role;

-- Kiểm sau khi chạy:
--   SELECT * FROM purchase_line_record_allocations LIMIT 5;
