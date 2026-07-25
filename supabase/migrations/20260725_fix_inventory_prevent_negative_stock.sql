-- Fix: inventory_prevent_negative_stock() (BEFORE INSERT trigger on
-- inventory_stock_movements) re-read inventory_stock_balances.on_hand to
-- validate quantity_out — but by the time this INSERT runs, the calling RPC
-- (inventory_post_export_document / inventory_post_transfer_document) has
-- ALREADY decremented on_hand for this exact line (correct order: SELECT
-- ... FOR UPDATE to check stock -> UPDATE on_hand -> INSERT movement row).
-- So the trigger was comparing quantity_out against the POST-decrement
-- balance instead of the pre-export balance, raising a false
-- "Không thể xuất kho vượt tồn" whenever quantity_out was more than half of
-- the true available stock, and ALWAYS when exporting the entire remaining
-- stock (on_hand becomes exactly 0 after decrement, so quantity_out > 0
-- always raised). This is what produced errors like "Số xuất: 1, tồn hiện
-- tại: 0" even when the pre-export stock was correctly 1.
--
-- Fix: check the RPC-computed NEW.balance_after (the true resulting on-hand
-- after this movement, already correctly populated by all 3 posting RPCs via
-- `RETURNING on_hand INTO v_balance_after` right before the INSERT) instead
-- of re-deriving it via a second, mistimed query.
--
-- The lot-level re-check (against inventory_lot_balances) had the identical
-- bug and is removed here for the same reason: inventory_post_export_document
-- and inventory_post_transfer_document already validate + decrement lot
-- stock correctly (SELECT ... FOR UPDATE strictly BEFORE the decrement) in
-- their own function bodies, and these are the only code paths in the schema
-- that ever INSERT into inventory_stock_movements — so this redundant,
-- buggy re-check adds no real protection.

CREATE OR REPLACE FUNCTION inventory_prevent_negative_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.movement_type NOT IN ('export', 'transfer_out') THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.balance_after, 0) < 0 THEN
    RAISE EXCEPTION 'Không thể xuất kho vượt tồn. Số xuất: %, tồn sau khi xuất: %',
      NEW.quantity_out, NEW.balance_after;
  END IF;

  RETURN NEW;
END;
$$;
