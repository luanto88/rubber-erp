-- ============================================================
-- Thêm cột audit cho inventory_documents và bảng alert_thresholds
-- Chạy file này TRƯỚC 20260504_fix_ambiguous_document_id.sql
-- (không chứa stored procedures — phần đó nằm trong file fix_ambiguous)
-- ============================================================

-- 1. Cột audit trên inventory_documents
ALTER TABLE inventory_documents
  ADD COLUMN IF NOT EXISTS posted_by    UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS posted_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

-- 2. Bảng cấu hình ngưỡng cảnh báo
CREATE TABLE IF NOT EXISTS inventory_alert_thresholds (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID        NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  code       TEXT        NOT NULL,
  label      TEXT        NOT NULL,
  value      NUMERIC     NOT NULL DEFAULT 50,
  unit       TEXT        NOT NULL DEFAULT '%',
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(factory_id, code)
);

ALTER TABLE inventory_alert_thresholds ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public'
      AND tablename = 'inventory_alert_thresholds' AND policyname = 'Allow all'
  ) THEN
    CREATE POLICY "Allow all" ON inventory_alert_thresholds FOR ALL USING (true);
  END IF;
END $$;

-- 3. Hàm hủy phiếu (inventory_cancel_document)
CREATE OR REPLACE FUNCTION inventory_cancel_document(
  p_factory_id   UUID,
  p_document_id  UUID,
  p_cancelled_by UUID DEFAULT NULL,
  p_cancel_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_document inventory_documents%ROWTYPE;
  v_movement RECORD;
BEGIN
  SELECT * INTO v_document FROM inventory_documents
  WHERE id = p_document_id AND factory_id = p_factory_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy phiếu cần hủy.'; END IF;
  IF v_document.status <> 'posted' THEN
    RAISE EXCEPTION 'Chỉ được hủy phiếu đã ghi sổ. Trạng thái hiện tại: %', v_document.status;
  END IF;

  -- Đảo ngược tất cả stock movements
  FOR v_movement IN
    SELECT * FROM inventory_stock_movements
    WHERE document_id = p_document_id AND factory_id = p_factory_id
  LOOP
    UPDATE inventory_stock_balances
    SET on_hand = on_hand - v_movement.quantity_in + v_movement.quantity_out,
        updated_at = now()
    WHERE factory_id = p_factory_id
      AND warehouse_id = v_movement.warehouse_id
      AND item_id = v_movement.item_id;

    IF v_movement.lot_no IS NOT NULL THEN
      UPDATE inventory_lot_balances
      SET on_hand = on_hand - v_movement.quantity_in + v_movement.quantity_out,
          updated_at = now()
      WHERE factory_id = p_factory_id
        AND warehouse_id = v_movement.warehouse_id
        AND item_id = v_movement.item_id
        AND lot_no = v_movement.lot_no
        AND (expiry_date IS NOT DISTINCT FROM v_movement.expiry_date);
    END IF;
  END LOOP;

  -- Xóa movements
  DELETE FROM inventory_stock_movements
  WHERE document_id = p_document_id AND factory_id = p_factory_id;

  -- Cập nhật trạng thái phiếu
  UPDATE inventory_documents
  SET status = 'cancelled',
      cancelled_by = p_cancelled_by,
      cancelled_at = now(),
      cancel_reason = p_cancel_reason,
      updated_at = now()
  WHERE id = p_document_id AND factory_id = p_factory_id;
END;
$$;
