"use client"

import type {
  InventoryItemOption,
  InventoryOilPoolBalanceRow,
  InventoryStockBalanceRow,
  InventoryWarehouseRule,
} from "./inventory-data"

export function isSharedOilItem(item: Pick<InventoryItemOption, "uses_shared_oil_stock"> | null | undefined): boolean {
  return Boolean(item?.uses_shared_oil_stock)
}

export function getSharedOilWarehouseId(
  item: Pick<InventoryItemOption, "uses_shared_oil_stock" | "default_warehouse_ids"> | null | undefined,
): string | null {
  if (!item?.uses_shared_oil_stock) return null
  return item.default_warehouse_ids[0] || null
}

export function buildEffectiveStockBalances(params: {
  items: InventoryItemOption[]
  stockBalances: InventoryStockBalanceRow[]
  oilPoolBalances: InventoryOilPoolBalanceRow[]
}): InventoryStockBalanceRow[] {
  const { items, stockBalances, oilPoolBalances } = params
  const itemMap = new Map(items.map((item) => [item.id, item]))
  const oilPoolMap = new Map(oilPoolBalances.map((row) => [row.warehouse_id, row]))

  const normalBalances = stockBalances.filter((balance) => !isSharedOilItem(itemMap.get(balance.item_id)))
  const sharedOilBalances = items
    .filter((item) => item.uses_shared_oil_stock)
    .flatMap((item) =>
      (item.default_warehouse_ids || []).map((warehouseId) => {
        const poolBalance = warehouseId ? oilPoolMap.get(warehouseId) : null

        return {
          warehouse_id: warehouseId || "",
          item_id: item.id,
          on_hand: Number(poolBalance?.on_hand || 0),
          updated_at: poolBalance?.updated_at || null,
        } satisfies InventoryStockBalanceRow
      }),
    )
    .filter((balance) => Boolean(balance.warehouse_id))

  return [...normalBalances, ...sharedOilBalances]
}

export function resolveStockThreshold(
  itemId: string,
  warehouseId: string,
  item: Pick<InventoryItemOption, "min_stock" | "max_stock"> | null | undefined,
  warehouseRules: InventoryWarehouseRule[],
): { minStock: number; maxStock: number } {
  const rule = warehouseRules.find((r) => r.item_id === itemId && r.warehouse_id === warehouseId)
  return {
    minStock: Number(rule?.min_stock ?? item?.min_stock ?? 0),
    maxStock: Number(rule?.max_stock ?? item?.max_stock ?? 0),
  }
}

export function getStockContextLabel(
  item: Pick<InventoryItemOption, "uses_shared_oil_stock"> | null | undefined,
  warehouseCode?: string | null,
): string {
  if (!isSharedOilItem(item)) return "Tồn"
  return warehouseCode ? `Tồn bồn ${warehouseCode}` : "Tồn bồn dầu"
}
