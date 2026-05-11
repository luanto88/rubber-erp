-- ============================================================
-- Seed inventory_stock_balances from inventory_items.opening_stock
-- Chạy một lần khi inventory_stock_balances còn rỗng.
-- Với mỗi vật tư có opening_stock > 0 và có ít nhất 1 kho mặc định,
-- tạo 1 bản ghi tồn kho trong kho mặc định đầu tiên.
-- Nếu bản ghi đã tồn tại với on_hand > 0 thì giữ nguyên (DO NOTHING).
-- ============================================================

INSERT INTO inventory_stock_balances (
  factory_id,
  warehouse_id,
  item_id,
  on_hand,
  created_at,
  updated_at
)
SELECT
  i.factory_id,
  i.default_warehouse_ids[1] AS warehouse_id,
  i.id AS item_id,
  i.opening_stock AS on_hand,
  now(),
  now()
FROM inventory_items i
WHERE
  COALESCE(i.uses_shared_oil_stock, false) = false
  AND i.opening_stock > 0
  AND i.default_warehouse_ids IS NOT NULL
  AND array_length(i.default_warehouse_ids, 1) > 0
ON CONFLICT (factory_id, warehouse_id, item_id)
DO UPDATE SET
  on_hand = EXCLUDED.on_hand,
  updated_at = now()
WHERE inventory_stock_balances.on_hand = 0;

INSERT INTO inventory_oil_stock_pools (
  factory_id,
  warehouse_id,
  on_hand,
  created_at,
  updated_at
)
SELECT
  i.factory_id,
  i.default_warehouse_ids[1] AS warehouse_id,
  i.opening_stock AS on_hand,
  now(),
  now()
FROM inventory_items i
WHERE
  COALESCE(i.uses_shared_oil_stock, false)
  AND i.opening_stock > 0
  AND i.default_warehouse_ids IS NOT NULL
  AND array_length(i.default_warehouse_ids, 1) > 0
ON CONFLICT (factory_id, warehouse_id)
DO UPDATE SET
  on_hand = EXCLUDED.on_hand,
  updated_at = now()
WHERE inventory_oil_stock_pools.on_hand = 0;
