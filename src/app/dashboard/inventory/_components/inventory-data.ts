"use client"

import { supabase } from "@/lib/supabase"
import { getActiveFactoryId } from "@/lib/auth"

export type InventoryWarehouseOption = {
  id: string
  code: string
  name: string
  keeper_name: string | null
  warehouse_type: string | null
  is_active: boolean
}

export type InventoryCategoryOption = {
  id: string
  code: string
  name: string
}

export type InventoryItemOption = {
  id: string
  code: string
  name: string
  unit: string
  specification: string | null
  manages_lot: boolean
  manages_expiry: boolean
  min_stock: number
  max_stock: number
  opening_stock: number
  category_id: string | null
  category_name: string
  default_warehouse_ids: string[]
  warehouse_codes: string[]
}

export type InventoryWarehouseRule = {
  item_id: string
  warehouse_id: string
  min_stock: number
  max_stock: number
  reorder_point: number
  safety_stock: number
  is_primary: boolean
}

export type InventoryStockBalanceRow = {
  warehouse_id: string
  item_id: string
  on_hand: number
  updated_at?: string | null
}

export type InventoryLotBalanceRow = {
  warehouse_id: string
  item_id: string
  lot_no: string
  expiry_date: string | null
  on_hand: number
  updated_at?: string | null
}

export type InventoryStockMovementRow = {
  id: string
  document_id: string
  document_line_id: string
  movement_type: "import" | "export" | "transfer_in" | "transfer_out"
  warehouse_id: string
  item_id: string
  quantity_in: number
  quantity_out: number
  balance_after: number | null
  lot_no: string | null
  expiry_date: string | null
  movement_date: string
  created_at: string
}

export const fallbackWarehouses: InventoryWarehouseOption[] = [
  { id: "ka", code: "KA", name: "Kho vật tư", keeper_name: "Châu Nhỏ", warehouse_type: "Vật tư tổng hợp", is_active: true },
  { id: "kb", code: "KB", name: "Kho hóa chất", keeper_name: "Nguyễn Hữu Thọ", warehouse_type: "Hóa chất", is_active: true },
  { id: "kddx", code: "KDDX", name: "Kho dầu đội xe", keeper_name: "Nguyễn Hữu Thọ", warehouse_type: "Nhiên liệu", is_active: true },
]

export const fallbackCategories: InventoryCategoryOption[] = [
  { id: "hc", code: "HC", name: "Vật tư hóa chất" },
  { id: "nl", code: "NL", name: "Nhiên liệu chế biến" },
  { id: "bh", code: "BH", name: "Bảo hộ" },
]

export const fallbackItems: InventoryItemOption[] = [
  {
    id: "af",
    code: "AF",
    name: "Acid Formic 85%",
    unit: "kg",
    specification: "Can 35",
    manages_lot: true,
    manages_expiry: true,
    min_stock: 1000,
    max_stock: 25000,
    opening_stock: 6685,
    category_id: "hc",
    category_name: "Vật tư hóa chất",
    default_warehouse_ids: ["kb"],
    warehouse_codes: ["KB"],
  },
  {
    id: "aa",
    code: "AA",
    name: "Acid acetic 99%",
    unit: "kg",
    specification: "Can 30",
    manages_lot: true,
    manages_expiry: true,
    min_stock: 1500,
    max_stock: 12000,
    opening_stock: 90,
    category_id: "hc",
    category_name: "Vật tư hóa chất",
    default_warehouse_ids: ["kb"],
    warehouse_codes: ["KB"],
  },
  {
    id: "dox",
    code: "DOX",
    name: "Dầu vận chuyển",
    unit: "lít",
    specification: "Bồn cố định",
    manages_lot: false,
    manages_expiry: false,
    min_stock: 500,
    max_stock: 5000,
    opening_stock: 0,
    category_id: "nl",
    category_name: "Nhiên liệu chế biến",
    default_warehouse_ids: ["kddx"],
    warehouse_codes: ["KDDX"],
  },
]

export const fallbackWarehouseRules: InventoryWarehouseRule[] = [
  { item_id: "af", warehouse_id: "kb", min_stock: 1000, max_stock: 25000, reorder_point: 1000, safety_stock: 1000, is_primary: true },
  { item_id: "aa", warehouse_id: "kb", min_stock: 1500, max_stock: 12000, reorder_point: 1500, safety_stock: 1500, is_primary: true },
  { item_id: "dox", warehouse_id: "kddx", min_stock: 500, max_stock: 5000, reorder_point: 500, safety_stock: 500, is_primary: true },
]

export const fallbackStockBalances: InventoryStockBalanceRow[] = [
  { warehouse_id: "kb", item_id: "af", on_hand: 1500, updated_at: "2026-05-01T08:00:00.000Z" },
  { warehouse_id: "kb", item_id: "aa", on_hand: 90, updated_at: "2026-05-01T08:00:00.000Z" },
  { warehouse_id: "kddx", item_id: "dox", on_hand: 0, updated_at: "2026-05-01T08:00:00.000Z" },
]

export const fallbackLotBalances: InventoryLotBalanceRow[] = [
  { warehouse_id: "kb", item_id: "af", lot_no: "TA02HE31", expiry_date: "2026-06-30", on_hand: 1000, updated_at: "2026-05-01T08:00:00.000Z" },
  { warehouse_id: "kb", item_id: "af", lot_no: "TP61HA31", expiry_date: "2026-08-30", on_hand: 500, updated_at: "2026-05-01T08:00:00.000Z" },
  { warehouse_id: "kb", item_id: "aa", lot_no: "AA31KB09", expiry_date: "2026-07-15", on_hand: 90, updated_at: "2026-05-01T08:00:00.000Z" },
]

export const fallbackStockMovements: InventoryStockMovementRow[] = [
  {
    id: "mv-1",
    document_id: "doc-1",
    document_line_id: "line-1",
    movement_type: "import",
    warehouse_id: "kb",
    item_id: "af",
    quantity_in: 1000,
    quantity_out: 0,
    balance_after: 1000,
    lot_no: "TA02HE31",
    expiry_date: "2026-06-30",
    movement_date: "2026-04-01",
    created_at: "2026-04-01T08:00:00.000Z",
  },
  {
    id: "mv-2",
    document_id: "doc-2",
    document_line_id: "line-2",
    movement_type: "import",
    warehouse_id: "kb",
    item_id: "af",
    quantity_in: 500,
    quantity_out: 0,
    balance_after: 1500,
    lot_no: "TP61HA31",
    expiry_date: "2026-08-30",
    movement_date: "2026-04-12",
    created_at: "2026-04-12T08:00:00.000Z",
  },
  {
    id: "mv-3",
    document_id: "doc-3",
    document_line_id: "line-3",
    movement_type: "import",
    warehouse_id: "kb",
    item_id: "aa",
    quantity_in: 90,
    quantity_out: 0,
    balance_after: 90,
    lot_no: "AA31KB09",
    expiry_date: "2026-07-15",
    movement_date: "2026-04-20",
    created_at: "2026-04-20T08:00:00.000Z",
  },
  {
    id: "mv-4",
    document_id: "doc-4",
    document_line_id: "line-4",
    movement_type: "export",
    warehouse_id: "kb",
    item_id: "af",
    quantity_in: 0,
    quantity_out: 120,
    balance_after: 1380,
    lot_no: "TA02HE31",
    expiry_date: "2026-06-30",
    movement_date: "2026-04-26",
    created_at: "2026-04-26T08:00:00.000Z",
  },
]

export async function loadInventoryAdminData() {
  const factoryId = await getActiveFactoryId()
  if (!factoryId) {
    return {
      factoryId: null,
      warning: "Không xác định được nhà máy đang đăng nhập. Đang dùng dữ liệu mẫu local.",
      warehouses: fallbackWarehouses,
      categories: fallbackCategories,
      items: fallbackItems,
      warehouseRules: fallbackWarehouseRules,
    }
  }

  const [warehouseResult, categoryResult, itemResult, ruleResult] = await Promise.all([
    supabase
      .from("inventory_warehouses")
      .select("id, code, name, keeper_name, warehouse_type, is_active")
      .eq("factory_id", factoryId)
      .eq("is_active", true)
      .order("code"),
    supabase
      .from("inventory_item_categories")
      .select("id, code, name")
      .eq("factory_id", factoryId)
      .eq("is_active", true)
      .order("sort_order")
      .order("code"),
    supabase
      .from("inventory_items")
      .select("id, code, name, unit, specification, manages_lot, manages_expiry, min_stock, max_stock, opening_stock, category_id, default_warehouse_ids, is_active")
      .eq("factory_id", factoryId)
      .eq("is_active", true)
      .order("code"),
    supabase
      .from("inventory_item_warehouse_rules")
      .select("item_id, warehouse_id, min_stock, max_stock, reorder_point, safety_stock, is_primary")
      .eq("factory_id", factoryId),
  ])

  if (warehouseResult.error || categoryResult.error || itemResult.error || ruleResult.error) {
    return {
      factoryId,
      warning: "Chưa tải được dữ liệu inventory từ Supabase. Đang dùng dữ liệu mẫu local để tiếp tục thao tác.",
      warehouses: fallbackWarehouses,
      categories: fallbackCategories,
      items: fallbackItems,
      warehouseRules: fallbackWarehouseRules,
    }
  }

  const warehouses = (warehouseResult.data || []) as InventoryWarehouseOption[]
  const categories = (categoryResult.data || []) as InventoryCategoryOption[]
  const categoryNameMap = new Map(categories.map((row) => [row.id, row.name]))
  const warehouseCodeMap = new Map(warehouses.map((row) => [row.id, row.code]))
  const items = ((itemResult.data || []) as Array<Omit<InventoryItemOption, "category_name" | "warehouse_codes">>).map((row) => ({
    ...row,
    category_name: categoryNameMap.get(row.category_id || "") || "Chưa phân loại",
    default_warehouse_ids: row.default_warehouse_ids || [],
    warehouse_codes: (row.default_warehouse_ids || []).map((id) => warehouseCodeMap.get(id) || id),
  }))
  const warehouseRules = (ruleResult.data || []) as InventoryWarehouseRule[]

  if (warehouses.length === 0 || items.length === 0) {
    return {
      factoryId,
      warning:
        "Danh mục kho hoặc vật tư trong Supabase đang chưa có dữ liệu. Đang dùng dữ liệu mẫu local để tiếp tục thao tác.",
      warehouses: fallbackWarehouses,
      categories: categories.length > 0 ? categories : fallbackCategories,
      items: fallbackItems,
      warehouseRules: fallbackWarehouseRules,
    }
  }

  return {
    factoryId,
    warning: null,
    warehouses,
    categories,
    items,
    warehouseRules,
  }
}

export async function loadInventorySnapshotData() {
  const adminData = await loadInventoryAdminData()

  if (!adminData.factoryId || adminData.warning) {
    return {
      ...adminData,
      stockBalances: fallbackStockBalances,
      lotBalances: fallbackLotBalances,
    }
  }

  const [stockBalanceResult, lotBalanceResult] = await Promise.all([
    supabase
      .from("inventory_stock_balances")
      .select("warehouse_id, item_id, on_hand, updated_at")
      .eq("factory_id", adminData.factoryId),
    supabase
      .from("inventory_lot_balances")
      .select("warehouse_id, item_id, lot_no, expiry_date, on_hand, updated_at")
      .eq("factory_id", adminData.factoryId),
  ])

  if (stockBalanceResult.error || lotBalanceResult.error) {
    return {
      ...adminData,
      warning:
        adminData.warning ||
        "Chưa tải được dữ liệu tồn kho từ Supabase. Đang dùng dữ liệu mẫu local để tiếp tục thao tác.",
      stockBalances: fallbackStockBalances,
      lotBalances: fallbackLotBalances,
    }
  }

  const stockBalances = ((stockBalanceResult.data || []) as InventoryStockBalanceRow[]).map((row) => ({
    ...row,
    on_hand: Number(row.on_hand || 0),
  }))
  const lotBalances = ((lotBalanceResult.data || []) as InventoryLotBalanceRow[]).map((row) => ({
    ...row,
    on_hand: Number(row.on_hand || 0),
  }))

  if (stockBalances.length === 0) {
    return {
      ...adminData,
      warning:
        "Bảng tồn kho hiện chưa có dữ liệu. Đang dùng dữ liệu mẫu local để tiếp tục thao tác.",
      stockBalances: fallbackStockBalances,
      lotBalances: lotBalances.length > 0 ? lotBalances : fallbackLotBalances,
    }
  }

  return {
    ...adminData,
    warning: null,
    stockBalances,
    lotBalances,
  }
}

export async function loadInventoryMovementData() {
  const snapshotData = await loadInventorySnapshotData()

  if (!snapshotData.factoryId || snapshotData.warning) {
    return {
      ...snapshotData,
      movements: fallbackStockMovements,
    }
  }

  const movementResult = await supabase
    .from("inventory_stock_movements")
    .select(
      "id, document_id, document_line_id, movement_type, warehouse_id, item_id, quantity_in, quantity_out, balance_after, lot_no, expiry_date, movement_date, created_at",
    )
    .eq("factory_id", snapshotData.factoryId)
    .order("movement_date", { ascending: false })
    .order("created_at", { ascending: false })

  if (movementResult.error) {
    return {
      ...snapshotData,
      warning:
        snapshotData.warning ||
        "Chưa tải được lịch sử thẻ kho từ Supabase. Đang dùng dữ liệu mẫu local để tiếp tục thao tác.",
      movements: fallbackStockMovements,
    }
  }

  const movements = ((movementResult.data || []) as InventoryStockMovementRow[]).map((row) => ({
    ...row,
    quantity_in: Number(row.quantity_in || 0),
    quantity_out: Number(row.quantity_out || 0),
    balance_after: row.balance_after === null ? null : Number(row.balance_after),
  }))

  if (movements.length === 0) {
    return {
      ...snapshotData,
      warning:
        "Lịch sử phát sinh kho hiện chưa có dữ liệu. Đang dùng dữ liệu mẫu local để tiếp tục thao tác.",
      movements: fallbackStockMovements,
    }
  }

  return {
    ...snapshotData,
    warning: null,
    movements,
  }
}
