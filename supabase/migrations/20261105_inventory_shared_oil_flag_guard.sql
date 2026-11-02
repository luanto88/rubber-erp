-- ============================================================
-- Kho vật tư — chặn đổi cờ "Dùng chung bồn dầu" (inventory_items.uses_shared_oil_stock) khi mã đã có
-- phát sinh kho (inventory_stock_movements).
-- Lý do: cờ quyết định tồn nằm ở bồn của kho (inventory_oil_stock_pools) hay tồn riêng của mã
-- (inventory_stock_balances). Đổi sau khi đã nhập/xuất ⇒ tồn cũ nằm sai chỗ và inventory_cancel_document
-- huỷ phiếu cũ sẽ cộng/trừ nhầm nơi. Mã chưa có phát sinh (vd mã dầu vừa tạo) vẫn đổi được.
-- Form Cài đặt → Vật tư cũng chặn trước; trigger là lớp cuối (trang cũ inventory/settings, ghi thẳng DB).
-- Chạy thủ công trên Supabase SQL Editor. Idempotent.
-- ============================================================

CREATE OR REPLACE FUNCTION inventory_items_guard_shared_oil_flag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.uses_shared_oil_stock, false) IS DISTINCT FROM COALESCE(OLD.uses_shared_oil_stock, false)
     AND EXISTS (SELECT 1 FROM inventory_stock_movements m WHERE m.item_id = OLD.id) THEN
    RAISE EXCEPTION 'INV_SHARED_OIL_LOCKED: Vật tư % đã có phát sinh kho — không thể đổi "Dùng chung bồn dầu".', OLD.code
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_items_guard_shared_oil_flag ON inventory_items;
CREATE TRIGGER trg_inventory_items_guard_shared_oil_flag
  BEFORE UPDATE OF uses_shared_oil_stock ON inventory_items
  FOR EACH ROW
  EXECUTE FUNCTION inventory_items_guard_shared_oil_flag();

-- Kiểm chứng:
--   SELECT tgname FROM pg_trigger WHERE tgname = 'trg_inventory_items_guard_shared_oil_flag';
