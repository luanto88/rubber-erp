-- Migration: 20260928_swap_predicted_kien_ngan.sql
--
-- Cho phép trực ca ĐỔI NGĂN NGUỒN của 1 kiện ngay lúc quét QR (trước khi "Gửi tất cả").
--
-- Nguyên tắc: 1 kiện có 3 nơi ghi ngăn — kế hoạch (lot_prediction_lots.kien_X_ngan_id), nháp
-- (product_confirm_drafts.ngan_id), thật (lot_transactions.ngan_id). Đổi ngăn lúc quét = đổi KẾ
-- HOẠCH của đúng kiện đó (+ nháp nếu đang sửa nháp) — không tạo lô/kiện mới, nên ngăn cũ được giải
-- phóng đúng 1 kiện và ngăn mới nhận đúng 1 kiện, không bao giờ tính trùng.
--
-- Sức chứa ngăn mới (≤110%, tính theo real + dự kiến + giữ chỗ) được kiểm ở server action
-- (confirm/actions.ts → swapKienNgan) bằng CHÍNH hàm của màn Dự đoán, để 2 màn không lệch nhau.
-- RPC này chỉ làm phần cập nhật nguyên tử + các điều kiện chặn không phụ thuộc cấu hình bành.
--
-- Chạy thủ công trên Supabase SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS lot_prediction_ngan_changes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id          UUID NOT NULL,
  prediction_lot_id   UUID NOT NULL REFERENCES lot_prediction_lots(id) ON DELETE CASCADE,
  ma_lo               TEXT NOT NULL,
  kien                TEXT NOT NULL CHECK (kien IN ('A', 'B', 'C', 'D')),
  old_ngan_id         UUID,
  new_ngan_id         UUID NOT NULL,
  draft_id            UUID,
  actor_id            UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lot_prediction_ngan_changes_factory
  ON lot_prediction_ngan_changes (factory_id, created_at DESC);

ALTER TABLE lot_prediction_ngan_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lot_prediction_ngan_changes_select ON lot_prediction_ngan_changes;
CREATE POLICY lot_prediction_ngan_changes_select ON lot_prediction_ngan_changes
  FOR SELECT TO authenticated
  USING (factory_id = public.current_profile_factory_id());
-- Không có policy ghi: chỉ RPC dưới đây (service role) được ghi — nhật ký chỉ thêm, không sửa/xóa.

CREATE OR REPLACE FUNCTION swap_predicted_kien_ngan(
  p_factory_id   UUID,
  p_ma_lo        TEXT,
  p_kien         TEXT,
  p_old_ngan_id  UUID,
  p_new_ngan_id  UUID,
  p_actor_id     UUID,
  p_draft_id     UUID DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pred          RECORD;
  v_current_ngan  UUID;
  v_lot_id        UUID;
  v_real_banh     NUMERIC := 0;
  v_other_drafts  INTEGER := 0;
  v_new_status    TEXT;
BEGIN
  IF p_kien NOT IN ('A', 'B', 'C', 'D') THEN
    RAISE EXCEPTION 'Kiện không hợp lệ.';
  END IF;
  IF p_new_ngan_id IS NULL THEN
    RAISE EXCEPTION 'Chưa chọn ngăn mới.';
  END IF;
  IF p_new_ngan_id = p_old_ngan_id THEN
    RAISE EXCEPTION 'Ngăn mới trùng ngăn hiện tại.';
  END IF;

  -- Cùng khóa với submit_confirm_draft_batch → đổi ngăn và gửi nháp của cùng lô không chen nhau.
  PERFORM pg_advisory_xact_lock(hashtext(p_factory_id::text || ':' || p_ma_lo));

  SELECT * INTO v_pred FROM lot_prediction_lots
    WHERE factory_id = p_factory_id AND ma_lo = p_ma_lo AND trang_thai <> 'Hủy'
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lô % không có dự đoán — không thể đổi ngăn theo kế hoạch.', p_ma_lo;
  END IF;

  v_current_ngan := CASE p_kien
    WHEN 'A' THEN v_pred.kien_a_ngan_id WHEN 'B' THEN v_pred.kien_b_ngan_id
    WHEN 'C' THEN v_pred.kien_c_ngan_id WHEN 'D' THEN v_pred.kien_d_ngan_id END;
  IF v_current_ngan IS DISTINCT FROM p_old_ngan_id THEN
    RAISE EXCEPTION 'Ngăn dự kiến của kiện % lô % vừa bị người khác thay đổi — vui lòng quét lại.', p_kien, p_ma_lo;
  END IF;

  IF lower(p_kien) = ANY (SELECT lower(x) FROM unnest(COALESCE(v_pred.unassignable_kien, '{}'::text[])) x) THEN
    RAISE EXCEPTION 'Kiện % lô % đã có sản lượng thật từ trước, không đổi ngăn được.', p_kien, p_ma_lo;
  END IF;

  -- 1 kiện chỉ lấy nguyên liệu từ 1 ngăn: kiện đã có bành thật thì không đổi.
  SELECT id INTO v_lot_id FROM lots WHERE factory_id = p_factory_id AND ma_lo = p_ma_lo LIMIT 1;
  IF v_lot_id IS NOT NULL THEN
    SELECT COALESCE(SUM(CASE p_kien
      WHEN 'A' THEN kien_a WHEN 'B' THEN kien_b WHEN 'C' THEN kien_c WHEN 'D' THEN kien_d END), 0)
      INTO v_real_banh FROM lot_transactions WHERE lot_id = v_lot_id;
    IF v_real_banh > 0 THEN
      RAISE EXCEPTION 'Kiện % lô % đã gửi % bành ở ngăn cũ — một kiện không được lấy từ 2 ngăn.', p_kien, p_ma_lo, v_real_banh;
    END IF;
  END IF;

  -- Nháp của kiện này: chỉ cho phép đúng nháp đang sửa (nếu có), nháp khác → chặn.
  SELECT COUNT(*) INTO v_other_drafts FROM product_confirm_drafts
    WHERE factory_id = p_factory_id AND ma_lo = p_ma_lo AND kien = p_kien
      AND (p_draft_id IS NULL OR id <> p_draft_id);
  IF v_other_drafts > 0 THEN
    RAISE EXCEPTION 'Kiện % lô % đã có nháp chưa gửi ở ngăn cũ — gửi hoặc xóa nháp đó trước.', p_kien, p_ma_lo;
  END IF;

  SELECT trang_thai INTO v_new_status FROM ngans
    WHERE id = p_new_ngan_id AND factory_id = p_factory_id FOR UPDATE;
  IF v_new_status IS NULL THEN
    RAISE EXCEPTION 'Không tìm thấy ngăn mới.';
  END IF;
  IF v_new_status NOT IN ('Chờ sản xuất', 'Đang sản xuất') THEN
    RAISE EXCEPTION 'Ngăn mới đang ở trạng thái "%", không nhận thành phẩm.', v_new_status;
  END IF;

  UPDATE lot_prediction_lots SET
    kien_a_ngan_id = CASE WHEN p_kien = 'A' THEN p_new_ngan_id ELSE kien_a_ngan_id END,
    kien_b_ngan_id = CASE WHEN p_kien = 'B' THEN p_new_ngan_id ELSE kien_b_ngan_id END,
    kien_c_ngan_id = CASE WHEN p_kien = 'C' THEN p_new_ngan_id ELSE kien_c_ngan_id END,
    kien_d_ngan_id = CASE WHEN p_kien = 'D' THEN p_new_ngan_id ELSE kien_d_ngan_id END
  WHERE id = v_pred.id;

  IF p_draft_id IS NOT NULL THEN
    UPDATE product_confirm_drafts SET ngan_id = p_new_ngan_id
      WHERE id = p_draft_id AND factory_id = p_factory_id AND ma_lo = p_ma_lo AND kien = p_kien;
  END IF;

  INSERT INTO lot_prediction_ngan_changes
    (factory_id, prediction_lot_id, ma_lo, kien, old_ngan_id, new_ngan_id, draft_id, actor_id)
  VALUES
    (p_factory_id, v_pred.id, p_ma_lo, p_kien, p_old_ngan_id, p_new_ngan_id, p_draft_id, p_actor_id);
END;
$$;

REVOKE ALL ON FUNCTION swap_predicted_kien_ngan(UUID, TEXT, TEXT, UUID, UUID, UUID, UUID) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION swap_predicted_kien_ngan(UUID, TEXT, TEXT, UUID, UUID, UUID, UUID) TO service_role;
