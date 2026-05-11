-- Bật logic tồn chung theo kho cho các mã Dầu đã chốt.
-- Chạy sau migration 20260511_shared_oil_stock_pools.sql

WITH oil_mapping AS (
  SELECT *
  FROM (
    VALUES
      ('DOX',    ARRAY['KDDX', 'KDMT']::TEXT[]),
      ('DOSXN',  ARRAY['KDDX', 'KDMT']::TEXT[]),
      ('DON',    ARRAY['KDDX', 'KDMT']::TEXT[]),
      ('DOXU12', ARRAY['KDDX', 'KDMT']::TEXT[]),
      ('DOFORD', ARRAY['KDDX', 'KDMT']::TEXT[]),
      ('DOFAT',  ARRAY['KDDX', 'KDMT']::TEXT[]),
      ('DOCZNB', ARRAY['KDDX', 'KDMT']::TEXT[]),
      ('DOCZVC', ARRAY['KDDX', 'KDMT']::TEXT[]),
      ('DOXU3',  ARRAY['KDDX', 'KDMT', 'KBO']::TEXT[]),
      ('DOSXMN', ARRAY['KDMN']::TEXT[]),
      ('DOSXT',  ARRAY['KDMT']::TEXT[]),
      ('DO750K', ARRAY['KDMT', 'KDMFL']::TEXT[])
  ) AS t(item_code, warehouse_codes)
),
warehouse_lookup AS (
  SELECT
    m.item_code,
    w.factory_id,
    array_agg(w.id ORDER BY w.code) AS warehouse_ids
  FROM oil_mapping m
  CROSS JOIN LATERAL unnest(m.warehouse_codes) AS wc(code)
  JOIN inventory_warehouses w
    ON w.code = wc.code
  GROUP BY m.item_code, w.factory_id
),
matched_items AS (
  SELECT
    i.id,
    i.factory_id,
    i.code,
    wl.warehouse_ids
  FROM inventory_items i
  JOIN warehouse_lookup wl
    ON wl.item_code = i.code
   AND wl.factory_id = i.factory_id
)
UPDATE inventory_items i
SET
  uses_shared_oil_stock = true,
  default_warehouse_ids = mi.warehouse_ids,
  updated_at = now()
FROM matched_items mi
WHERE i.id = mi.id;

-- Nếu có mã Dầu đã seed opening_stock trước đây trong inventory_stock_balances,
-- gom tồn đầu kỳ về pool dầu của từng kho tương ứng.
INSERT INTO inventory_oil_stock_pools (
  factory_id,
  warehouse_id,
  on_hand,
  created_at,
  updated_at
)
SELECT
  sb.factory_id,
  sb.warehouse_id,
  SUM(sb.on_hand) AS on_hand,
  now(),
  now()
FROM inventory_stock_balances sb
JOIN inventory_items i
  ON i.id = sb.item_id
 AND i.factory_id = sb.factory_id
WHERE COALESCE(i.uses_shared_oil_stock, false)
GROUP BY sb.factory_id, sb.warehouse_id
ON CONFLICT (factory_id, warehouse_id)
DO UPDATE SET
  on_hand = GREATEST(inventory_oil_stock_pools.on_hand, EXCLUDED.on_hand),
  updated_at = now();
