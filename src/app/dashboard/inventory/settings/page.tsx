"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import {
  AlertTriangle,
  Archive,
  Beaker,
  BellRing,
  Boxes,
  Database,
  FileBarChart2,
  PencilLine,
  Plus,
  Ruler,
  Settings2,
  ShieldCheck,
  Trash2,
  Warehouse,
  X,
} from "lucide-react"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId } from "@/lib/auth"
import { InventoryPageShell } from "../_components/inventory-shell"

type SettingsTab = "warehouses" | "categories" | "items" | "norms"
type ModalType = "warehouse" | "category" | "item" | null

type WarehouseRow = {
  id: string
  factory_id: string
  code: string
  name: string
  keeper_name: string | null
  warehouse_type: string | null
  is_active: boolean
}

type CategoryRow = {
  id: string
  factory_id: string
  code: string
  name: string
  sort_order: number
  is_active: boolean
  itemCount: number
}

type ItemCategoryRef = {
  category_id: string | null
}

type ItemRow = {
  id: string
  factory_id: string
  category_id: string | null
  code: string
  name: string
  unit: string
  specification: string | null
  default_warehouse_ids: string[] | null
  manages_lot: boolean
  manages_expiry: boolean
  min_stock: number
  max_stock: number
  opening_stock: number
  image_url: string | null
  equipment_name: string | null
  is_active: boolean
  categoryName: string
  warehouseCodes: string[]
}

type WarehouseForm = {
  code: string
  name: string
  keeper_name: string
  warehouse_type: string
  is_active: boolean
}

type CategoryForm = {
  code: string
  name: string
  sort_order: string
  is_active: boolean
}

type ItemForm = {
  category_id: string
  code: string
  name: string
  unit: string
  specification: string
  selected_warehouse_ids: string[]
  manages_lot: boolean
  manages_expiry: boolean
  min_stock: string
  max_stock: string
  opening_stock: string
  image_url: string
  equipment_name: string
  is_active: boolean
}

type NormPreviewRow = {
  productCode: string
  resources: string
  utilities: string
}

const tabs: { key: SettingsTab; label: string; icon: typeof Warehouse; note: string }[] = [
  { key: "warehouses", label: "Kho", icon: Warehouse, note: "Danh mục kho và thủ kho theo nhà máy" },
  { key: "categories", label: "Nhóm vật tư", icon: Boxes, note: "Phân loại vật tư để lọc báo cáo và cảnh báo" },
  { key: "items", label: "Vật tư / Hóa chất", icon: Beaker, note: "Cấu hình lô-hạn, min-max và kho chứa" },
  { key: "norms", label: "Định mức", icon: Ruler, note: "Định mức tiêu hao theo thành phẩm và nhà máy" },
]

const fallbackWarehouses: WarehouseRow[] = [
  { id: "ka", factory_id: "", code: "KA", name: "Kho vật tư", keeper_name: "Châu Nhỏ", warehouse_type: "Vật tư tổng hợp", is_active: true },
  { id: "kb", factory_id: "", code: "KB", name: "Kho hóa chất", keeper_name: "Nguyễn Hữu Thọ", warehouse_type: "Hóa chất", is_active: true },
  { id: "kddx", factory_id: "", code: "KDDX", name: "Kho dầu đội xe", keeper_name: "Nguyễn Hữu Thọ", warehouse_type: "Nhiên liệu", is_active: true },
]

const fallbackCategories: CategoryRow[] = [
  { id: "hc", factory_id: "", code: "HC", name: "Vật tư hóa chất", sort_order: 1, is_active: true, itemCount: 128 },
  { id: "nl", factory_id: "", code: "NL", name: "Nhiên liệu chế biến", sort_order: 2, is_active: true, itemCount: 26 },
  { id: "bh", factory_id: "", code: "BH", name: "Bảo hộ", sort_order: 3, is_active: true, itemCount: 34 },
]

const fallbackItems: ItemRow[] = [
  {
    id: "af",
    factory_id: "",
    category_id: "hc",
    code: "AF",
    name: "Acid Formic 85%",
    unit: "kg",
    specification: "Can 35",
    default_warehouse_ids: ["kb"],
    manages_lot: true,
    manages_expiry: true,
    min_stock: 1000,
    max_stock: 25000,
    opening_stock: 6685,
    image_url: null,
    equipment_name: null,
    is_active: true,
    categoryName: "Vật tư hóa chất",
    warehouseCodes: ["KB"],
  },
  {
    id: "aa",
    factory_id: "",
    category_id: "hc",
    code: "AA",
    name: "Acid acetic 99%",
    unit: "kg",
    specification: "Can 30",
    default_warehouse_ids: ["kb"],
    manages_lot: true,
    manages_expiry: true,
    min_stock: 1500,
    max_stock: 12000,
    opening_stock: 90,
    image_url: null,
    equipment_name: null,
    is_active: true,
    categoryName: "Vật tư hóa chất",
    warehouseCodes: ["KB"],
  },
  {
    id: "dox",
    factory_id: "",
    category_id: "nl",
    code: "DOX",
    name: "Dầu vận chuyển",
    unit: "lít",
    specification: "Bồn cố định",
    default_warehouse_ids: ["kddx"],
    manages_lot: false,
    manages_expiry: false,
    min_stock: 500,
    max_stock: 5000,
    opening_stock: 0,
    image_url: null,
    equipment_name: null,
    is_active: true,
    categoryName: "Nhiên liệu chế biến",
    warehouseCodes: ["KDDX", "KDMFL"],
  },
]

const normPreviewRows: NormPreviewRow[] = [
  { productCode: "L, 3L, 5", resources: "11 mục tài nguyên / 4 hóa chất", utilities: "Điện 95 / Nước 11" },
  { productCode: "CV50", resources: "16 mục tài nguyên / 5 hóa chất", utilities: "Điện 95 / Nước 11" },
  { productCode: "10, 20", resources: "18 mục tài nguyên / 2 hóa chất", utilities: "Điện 160 / Nước 16" },
]

function emptyWarehouseForm(): WarehouseForm {
  return {
    code: "",
    name: "",
    keeper_name: "",
    warehouse_type: "",
    is_active: true,
  }
}

function emptyCategoryForm(): CategoryForm {
  return {
    code: "",
    name: "",
    sort_order: "0",
    is_active: true,
  }
}

function emptyItemForm(): ItemForm {
  return {
    category_id: "",
    code: "",
    name: "",
    unit: "",
    specification: "",
    selected_warehouse_ids: [],
    manages_lot: false,
    manages_expiry: false,
    min_stock: "0",
    max_stock: "0",
    opening_stock: "0",
    image_url: "",
    equipment_name: "",
    is_active: true,
  }
}

function MetricCard({
  icon,
  label,
  value,
  note,
}: {
  icon: React.ReactNode
  label: string
  value: string
  note: string
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="rounded-2xl bg-slate-50 p-3">{icon}</div>
        <div className="text-right">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">{label}</div>
          <div className="mt-2 text-2xl font-black text-slate-800">{value}</div>
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-500">{note}</p>
    </div>
  )
}

function SectionTitle({
  title,
  description,
  icon,
  action,
}: {
  title: string
  description: string
  icon: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
      <div>
        <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">
          {icon}
          Admin scope
        </div>
        <h2 className="text-xl font-extrabold text-slate-800">{title}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{description}</p>
      </div>

      {action ? <div className="hidden shrink-0 gap-2 sm:flex">{action}</div> : null}
    </div>
  )
}

export default function InventorySettingsPage() {
  const searchParams = useSearchParams()
  const requestedTab = searchParams.get("tab")
  const [tab, setTab] = useState<SettingsTab>("warehouses")
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dataWarning, setDataWarning] = useState<string | null>(null)
  const [modalType, setModalType] = useState<ModalType>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ type: Exclude<ModalType, null>; id: string; label: string } | null>(null)
  const [formError, setFormError] = useState<string>("")

  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([])
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [items, setItems] = useState<ItemRow[]>([])
  const [warehouseForm, setWarehouseForm] = useState<WarehouseForm>(emptyWarehouseForm())
  const [categoryForm, setCategoryForm] = useState<CategoryForm>(emptyCategoryForm())
  const [itemForm, setItemForm] = useState<ItemForm>(emptyItemForm())

  const loadData = useCallback(async () => {
    setLoading(true)
    setDataWarning(null)

    try {
      const fid = await getActiveFactoryId()
      if (!fid) {
        setDataWarning("Không xác định được nhà máy đang đăng nhập.")
        setWarehouses(fallbackWarehouses)
        setCategories(fallbackCategories)
        setItems(fallbackItems)
        return
      }

      setFactoryId(fid)

      const [warehouseResult, categoryResult, itemResult, itemsResult] = await Promise.all([
        supabase
          .from("inventory_warehouses")
          .select("id, factory_id, code, name, keeper_name, warehouse_type, is_active")
          .eq("factory_id", fid)
          .order("code"),
        supabase
          .from("inventory_item_categories")
          .select("id, factory_id, code, name, sort_order, is_active")
          .eq("factory_id", fid)
          .order("sort_order")
          .order("code"),
        supabase
          .from("inventory_items")
          .select("category_id")
          .eq("factory_id", fid),
        supabase
          .from("inventory_items")
          .select(
            "id, factory_id, category_id, code, name, unit, specification, default_warehouse_ids, manages_lot, manages_expiry, min_stock, max_stock, opening_stock, image_url, equipment_name, is_active",
          )
          .eq("factory_id", fid)
          .order("code"),
      ])

      if (warehouseResult.error || categoryResult.error || itemResult.error || itemsResult.error) {
        setDataWarning("Chưa đọc được dữ liệu thật từ Supabase. Đang hiển thị dữ liệu mẫu để tiếp tục thiết kế.")
        setWarehouses(fallbackWarehouses)
        setCategories(fallbackCategories)
        setItems(fallbackItems)
        return
      }

      const itemRefs = (itemResult.data || []) as ItemCategoryRef[]
      const counts = new Map<string, number>()
      for (const row of itemRefs) {
        if (!row.category_id) continue
        counts.set(row.category_id, (counts.get(row.category_id) || 0) + 1)
      }

      const nextWarehouses = (warehouseResult.data || []) as WarehouseRow[]
      const nextCategories = ((categoryResult.data || []) as Omit<CategoryRow, "itemCount">[]).map((row) => ({
        ...row,
        itemCount: counts.get(row.id) || 0,
      }))
      const warehouseCodeMap = new Map(nextWarehouses.map((row) => [row.id, row.code]))
      const categoryNameMap = new Map(nextCategories.map((row) => [row.id, row.name]))
      const nextItems = (((itemsResult.data || []) as Omit<ItemRow, "categoryName" | "warehouseCodes">[]).map((row) => ({
        ...row,
        categoryName: categoryNameMap.get(row.category_id || "") || "Chưa phân loại",
        warehouseCodes: (row.default_warehouse_ids || []).map((id) => warehouseCodeMap.get(id) || id),
      })))

      setWarehouses(nextWarehouses)
      setCategories(nextCategories)
      setItems(nextItems)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    if (
      requestedTab === "warehouses" ||
      requestedTab === "categories" ||
      requestedTab === "items" ||
      requestedTab === "norms"
    ) {
      setTab(requestedTab)
    }
  }, [requestedTab])

  const summary = useMemo(
    () => [
      {
        label: "Kho dang theo doi",
        value: `${warehouses.length}`,
        note: "Tat ca bang cua module kho deu phai chay theo pham vi nha may.",
        icon: <Warehouse size={18} className="text-emerald-600" />,
      },
      {
        label: "Nhóm vật tư",
        value: `${categories.length}`,
        note: "Phân loại là trục chính cho báo cáo nhập xuất tồn và thống kê.",
        icon: <Archive size={18} className="text-blue-600" />,
      },
      {
        label: "Vật tư cần lô-hạn",
        value: `${items.filter((item) => item.manages_lot || item.manages_expiry).length}`,
        note: "Hóa chất là nhóm ưu tiên quản lý lô và hạn sử dụng.",
        icon: <ShieldCheck size={18} className="text-violet-600" />,
      },
      {
        label: "Bảng định mức",
        value: `${normPreviewRows.length}`,
        note: "Dùng cho báo cáo tháng: thành phẩm trong kỳ nhân định mức.",
        icon: <FileBarChart2 size={18} className="text-amber-600" />,
      },
    ],
    [categories.length, items, warehouses.length],
  )

  const openWarehouseModal = (row?: WarehouseRow) => {
    setFormError("")
    setModalType("warehouse")
    setEditingId(row?.id || null)
    setWarehouseForm(
      row
        ? {
            code: row.code,
            name: row.name,
            keeper_name: row.keeper_name || "",
            warehouse_type: row.warehouse_type || "",
            is_active: row.is_active,
          }
        : emptyWarehouseForm(),
    )
  }

  const openCategoryModal = (row?: CategoryRow) => {
    setFormError("")
    setModalType("category")
    setEditingId(row?.id || null)
    setCategoryForm(
      row
        ? {
            code: row.code,
            name: row.name,
            sort_order: String(row.sort_order ?? 0),
            is_active: row.is_active,
          }
        : emptyCategoryForm(),
    )
  }

  const openItemModal = (row?: ItemRow) => {
    setFormError("")
    setModalType("item")
    setEditingId(row?.id || null)
    setItemForm(
      row
        ? {
            category_id: row.category_id || "",
            code: row.code,
            name: row.name,
            unit: row.unit,
            specification: row.specification || "",
            selected_warehouse_ids: row.default_warehouse_ids || [],
            manages_lot: row.manages_lot,
            manages_expiry: row.manages_expiry,
            min_stock: String(row.min_stock ?? 0),
            max_stock: String(row.max_stock ?? 0),
            opening_stock: String(row.opening_stock ?? 0),
            image_url: row.image_url || "",
            equipment_name: row.equipment_name || "",
            is_active: row.is_active,
          }
        : {
            ...emptyItemForm(),
            category_id: categories[0]?.id || "",
          },
    )
  }

  const closeModal = () => {
    setModalType(null)
    setEditingId(null)
    setFormError("")
    setWarehouseForm(emptyWarehouseForm())
    setCategoryForm(emptyCategoryForm())
    setItemForm(emptyItemForm())
  }

  const saveWarehouse = async () => {
    if (!factoryId) {
      setFormError("Chưa xác định được nhà máy.")
      return
    }
    if (!warehouseForm.code.trim()) {
      setFormError("Ma kho khong duoc de trong.")
      return
    }
    if (!warehouseForm.name.trim()) {
      setFormError("Tên kho không được để trống.")
      return
    }

    setSaving(true)
    setFormError("")

    const payload = {
      factory_id: factoryId,
      code: warehouseForm.code.trim().toUpperCase(),
      name: warehouseForm.name.trim(),
      keeper_name: warehouseForm.keeper_name.trim() || null,
      warehouse_type: warehouseForm.warehouse_type.trim() || null,
      is_active: warehouseForm.is_active,
    }

    const result = editingId
      ? await supabase.from("inventory_warehouses").update(payload).eq("id", editingId).eq("factory_id", factoryId)
      : await supabase.from("inventory_warehouses").insert(payload)

    if (result.error) {
      setFormError(result.error.message)
      setSaving(false)
      return
    }

    await loadData()
    setSaving(false)
    closeModal()
  }

  const saveCategory = async () => {
    if (!factoryId) {
      setFormError("Chưa xác định được nhà máy.")
      return
    }
    if (!categoryForm.code.trim()) {
      setFormError("Mã nhóm không được để trống.")
      return
    }
    if (!categoryForm.name.trim()) {
      setFormError("Tên nhóm không được để trống.")
      return
    }

    setSaving(true)
    setFormError("")

    const payload = {
      factory_id: factoryId,
      code: categoryForm.code.trim().toUpperCase(),
      name: categoryForm.name.trim(),
      sort_order: Number(categoryForm.sort_order) || 0,
      is_active: categoryForm.is_active,
    }

    const result = editingId
      ? await supabase.from("inventory_item_categories").update(payload).eq("id", editingId).eq("factory_id", factoryId)
      : await supabase.from("inventory_item_categories").insert(payload)

    if (result.error) {
      setFormError(result.error.message)
      setSaving(false)
      return
    }

    await loadData()
    setSaving(false)
    closeModal()
  }

  const saveItem = async () => {
    if (!factoryId) {
      setFormError("Chưa xác định được nhà máy.")
      return
    }
    if (!itemForm.category_id) {
      setFormError("Vui long chon nhom vat tu.")
      return
    }
    if (!itemForm.code.trim()) {
      setFormError("Mã vật tư không được để trống.")
      return
    }
    if (!itemForm.name.trim()) {
      setFormError("Tên vật tư không được để trống.")
      return
    }
    if (!itemForm.unit.trim()) {
      setFormError("Đơn vị tính không được để trống.")
      return
    }
    if (itemForm.selected_warehouse_ids.length === 0) {
      setFormError("Phai chon it nhat 1 kho chua.")
      return
    }

    setSaving(true)
    setFormError("")

    const payload = {
      factory_id: factoryId,
      category_id: itemForm.category_id,
      code: itemForm.code.trim().toUpperCase(),
      name: itemForm.name.trim(),
      unit: itemForm.unit.trim(),
      specification: itemForm.specification.trim() || null,
      default_warehouse_ids: itemForm.selected_warehouse_ids,
      manages_lot: itemForm.manages_lot,
      manages_expiry: itemForm.manages_expiry,
      min_stock: Number(itemForm.min_stock) || 0,
      max_stock: Number(itemForm.max_stock) || 0,
      opening_stock: Number(itemForm.opening_stock) || 0,
      image_url: itemForm.image_url.trim() || null,
      equipment_name: itemForm.equipment_name.trim() || null,
      is_active: itemForm.is_active,
    }

    const result = editingId
      ? await supabase.from("inventory_items").update(payload).eq("id", editingId).eq("factory_id", factoryId).select("id").single()
      : await supabase.from("inventory_items").insert(payload).select("id").single()

    if (result.error || !result.data?.id) {
      setFormError(result.error?.message || "Không lưu được vật tư.")
      setSaving(false)
      return
    }

    const itemId = result.data.id as string

    const deleteRulesResult = await supabase
      .from("inventory_item_warehouse_rules")
      .delete()
      .eq("item_id", itemId)
      .eq("factory_id", factoryId)

    if (deleteRulesResult.error) {
      setFormError(deleteRulesResult.error.message)
      setSaving(false)
      return
    }

    const rulesPayload = itemForm.selected_warehouse_ids.map((warehouseId, index) => ({
      factory_id: factoryId,
      item_id: itemId,
      warehouse_id: warehouseId,
      min_stock: Number(itemForm.min_stock) || 0,
      max_stock: Number(itemForm.max_stock) || 0,
      reorder_point: Number(itemForm.min_stock) || 0,
      safety_stock: Number(itemForm.min_stock) || 0,
      is_primary: index === 0,
    }))

    const rulesResult = await supabase.from("inventory_item_warehouse_rules").insert(rulesPayload)
    if (rulesResult.error) {
      setFormError(rulesResult.error.message)
      setSaving(false)
      return
    }

    await loadData()
    setSaving(false)
    closeModal()
  }

  const confirmDelete = async () => {
    if (!deleteTarget || !factoryId) return

    setSaving(true)
    const result =
      deleteTarget.type === "warehouse"
        ? await supabase.from("inventory_warehouses").delete().eq("id", deleteTarget.id).eq("factory_id", factoryId)
        : deleteTarget.type === "category"
          ? await supabase.from("inventory_item_categories").delete().eq("id", deleteTarget.id).eq("factory_id", factoryId)
          : await supabase.from("inventory_items").delete().eq("id", deleteTarget.id).eq("factory_id", factoryId)

    if (!result.error) {
      await loadData()
      setDeleteTarget(null)
    }
    setSaving(false)
  }

  return (
    <InventoryPageShell
      eyebrow="Cài đặt kho"
      title="Danh mục và cấu hình vận hành kho"
      description="Trang admin riêng của module kho để quản lý danh mục kho, nhóm vật tư, vật tư hóa chất, cấu hình lô-hạn, giới hạn tồn và bảng định mức theo nhà máy."
      action={
        <Link
          href="/dashboard/settings"
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
        >
          <Settings2 size={15} />
          Về Cấu hình nhà máy
        </Link>
      }
    >
      {dataWarning ? (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          <div className="flex items-center gap-2 font-bold">
            <AlertTriangle size={16} />
            Cảnh báo dữ liệu
          </div>
          <div className="mt-2 leading-6">{dataWarning}</div>
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {summary.map((card) => (
          <MetricCard key={card.label} {...card} />
        ))}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {tabs.map((item) => {
            const active = tab === item.key
            return (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                className={
                  "flex min-w-[220px] items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-all " +
                  (active
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-transparent bg-white text-slate-600 hover:bg-slate-50")
                }
              >
                <div className="rounded-xl bg-white/80 p-2 shadow-sm">
                  <item.icon size={16} />
                </div>
                <div>
                  <div className="text-sm font-extrabold">{item.label}</div>
                  <div className="mt-1 text-xs leading-5 text-slate-500">{item.note}</div>
                </div>
              </button>
            )
          })}
        </div>
      </section>

      {tab === "warehouses" && (
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <SectionTitle
            title="Danh mục kho"
            description="Quản lý mã kho, tên kho, thủ kho và loại kho. Đây là danh mục gốc cho nhập, xuất, chuyển và cảnh báo min-max theo kho."
            icon={<Settings2 size={14} />}
            action={
              <>
                <button
                  onClick={() => openWarehouseModal()}
                  className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-700"
                >
                  <Plus size={15} />
                  Thêm kho
                </button>
              </>
            }
          />

          <div className="grid gap-6 p-6 xl:grid-cols-[1.3fr_0.7fr]">
            <div className="overflow-hidden rounded-3xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    {["Mã kho", "Tên kho", "Thủ kho", "Loại kho", "Trạng thái", ""].map((head) => (
                      <th key={head} className="px-4 py-3 text-left font-bold">
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(loading ? [] : warehouses).map((row) => (
                    <tr key={row.id}>
                      <td className="px-4 py-3 font-mono font-bold text-emerald-700">{row.code}</td>
                      <td className="px-4 py-3 font-semibold text-slate-800">{row.name}</td>
                      <td className="px-4 py-3 text-slate-600">{row.keeper_name || "—"}</td>
                      <td className="px-4 py-3 text-slate-600">{row.warehouse_type || "—"}</td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            "rounded-full px-2 py-1 text-xs font-bold " +
                            (row.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600")
                          }
                        >
                          {row.is_active ? "Đang dùng" : "Tạm dừng"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openWarehouseModal(row)}
                            className="rounded-xl p-2 text-slate-500 transition-colors hover:bg-blue-50 hover:text-blue-600"
                          >
                            <PencilLine size={14} />
                          </button>
                          <button
                            onClick={() => setDeleteTarget({ type: "warehouse", id: row.id, label: row.name })}
                            className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">
                        Đang tải danh mục kho...
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="space-y-4">
              <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5">
                <div className="flex items-center gap-2 text-sm font-extrabold text-amber-700">
                  <BellRing size={16} />
                  Rule cảnh báo giao dịch
                </div>
                <div className="mt-3 space-y-2 text-sm leading-6 text-amber-800">
                  <p>Nhập kho phải xem tồn sau nhập của kho đích với giới hạn trên và dưới.</p>
                  <p>Chuyển kho phải xem cả kho nguồn sau xuất và kho đích sau nhập.</p>
                  <p>Xuất vượt tồn là chặn cứng ở backend, không chỉ dừng ở UI.</p>
                </div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                <div className="text-sm font-extrabold text-slate-700">Quy ước đã chốt</div>
                <div className="mt-3 space-y-2 text-sm text-slate-600">
                  <div className="flex items-center justify-between gap-3">
                    <span>Kho vật tư</span>
                    <span className="font-bold text-slate-800">KA</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Kho hóa chất</span>
                    <span className="font-bold text-slate-800">KB</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Phạm vi bảng</span>
                    <span className="font-bold text-slate-800">Theo factory_id</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {tab === "categories" && (
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <SectionTitle
            title="Danh mục nhóm vật tư"
            description="Nhóm vật tư là trục phân tích chính cho báo cáo, cảnh báo và các bộ lọc trên khu vực thống kê."
            icon={<Database size={14} />}
            action={
              <>
                <button
                  onClick={() => openCategoryModal()}
                  className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-700"
                >
                  <Plus size={15} />
                  Thêm nhóm
                </button>
              </>
            }
          />

          <div className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-3">
            {loading ? (
              <div className="col-span-full rounded-3xl border border-slate-200 px-5 py-8 text-center text-sm text-slate-400">
                        Đang tải danh mục nhóm vật tư...
              </div>
            ) : (
              categories.map((row) => (
                <div key={row.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">{row.code}</div>
                      <div className="mt-2 text-lg font-extrabold text-slate-800">{row.name}</div>
                    </div>
                    <div className="rounded-2xl bg-white px-3 py-2 text-sm font-black text-blue-700 shadow-sm">
                      {row.itemCount}
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-500">
                    <span>Thứ tự: {row.sort_order}</span>
                    <span className={row.is_active ? "font-bold text-emerald-700" : "font-bold text-slate-500"}>
                      {row.is_active ? "Đang dùng" : "Tạm dừng"}
                    </span>
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <button
                      onClick={() => openCategoryModal(row)}
                      className="inline-flex items-center gap-1 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-100"
                    >
                      <PencilLine size={13} />
                      Sửa
                    </button>
                    <button
                      onClick={() => setDeleteTarget({ type: "category", id: row.id, label: row.name })}
                      className="inline-flex items-center gap-1 rounded-2xl border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-600 transition-colors hover:bg-red-50"
                    >
                      <Trash2 size={13} />
                      Xóa
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {tab === "items" && (
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <SectionTitle
            title="Vật tư và hóa chất"
            description="Quản lý vật tư và hóa chất, cấu hình kho chứa, quy tắc lô-hạn, tồn đầu kỳ và giới hạn min-max. Đây là bảng dữ liệu chính để phiếu nhập kho sử dụng."
            icon={<Beaker size={14} />}
            action={
              <button
                onClick={() => openItemModal()}
                className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-700"
              >
                <Plus size={15} />
                Thêm vật tư
              </button>
            }
          />

          <div className="grid gap-6 p-6 xl:grid-cols-[1.45fr_0.55fr]">
            <div className="overflow-hidden rounded-3xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    {["Mã", "Tên vật tư", "Nhóm", "Kho chứa", "Lô / Hạn", "Min - Max", ""].map((head) => (
                      <th key={head} className="px-4 py-3 text-left font-bold">
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">
                        Đang tải vật tư / hóa chất...
                      </td>
                    </tr>
                  ) : (
                    items.map((row) => (
                    <tr key={row.id}>
                      <td className="px-4 py-3 font-mono font-bold text-emerald-700">{row.code}</td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-800">{row.name}</div>
                        <div className="mt-1 text-xs text-slate-400">{row.unit}{row.specification ? ` · ${row.specification}` : ""}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{row.categoryName}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          {row.warehouseCodes.map((warehouse) => (
                            <span key={warehouse} className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">
                              {warehouse}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          {row.manages_lot ? <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-bold text-blue-700">Lô</span> : null}
                          {row.manages_expiry ? <span className="rounded-full bg-violet-100 px-2 py-1 text-xs font-bold text-violet-700">Hạn</span> : null}
                          {!row.manages_lot && !row.manages_expiry ? (
                            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">Thường</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-semibold text-slate-700">
                        {Number(row.min_stock || 0).toLocaleString("vi-VN")} - {Number(row.max_stock || 0).toLocaleString("vi-VN")}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openItemModal(row)}
                            className="rounded-xl p-2 text-slate-500 transition-colors hover:bg-blue-50 hover:text-blue-600"
                          >
                            <PencilLine size={14} />
                          </button>
                          <button
                            onClick={() => setDeleteTarget({ type: "item", id: row.id, label: row.name })}
                            className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>

            <div className="space-y-4">
              <div className="rounded-3xl border border-rose-200 bg-rose-50 p-5">
                <div className="flex items-center gap-2 text-sm font-extrabold text-rose-700">
                  <AlertTriangle size={16} />
                  Rule bắt buộc với hóa chất
                </div>
                <div className="mt-3 space-y-2 text-sm leading-6 text-rose-800">
                  <p>Hóa chất phải ưu tiên cấu hình quản lý lô và hạn sử dụng.</p>
                  <p>Nếu một vật tư nằm ở nhiều kho, min-max cần theo từng cặp kho - vật tư.</p>
                  <p>Nhập kho và chuyển kho phải xem tồn sau giao dịch của kho đích so với giới hạn trên dưới.</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {tab === "norms" && (
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <SectionTitle
            title="Bảng định mức theo nhà máy"
            description="Khung giao diện đã sẵn sàng cho bước import và chỉnh sửa định mức thật từ file dinh_muc.xlsx và database inventory_consumption_norms."
            icon={<Ruler size={14} />}
            action={
              <button className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50">
                <PencilLine size={15} />
                Sắp kết nối
              </button>
            }
          />

          <div className="grid gap-6 p-6 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="overflow-hidden rounded-3xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    {["Thành phẩm", "Tài nguyên", "Điện / Nước"].map((head) => (
                      <th key={head} className="px-4 py-3 text-left font-bold">
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {normPreviewRows.map((row) => (
                    <tr key={row.productCode}>
                      <td className="px-4 py-3 font-bold text-slate-800">{row.productCode}</td>
                      <td className="px-4 py-3 text-slate-600">{row.resources}</td>
                      <td className="px-4 py-3 font-semibold text-slate-700">{row.utilities}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-4">
              <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
                <div className="text-sm font-extrabold text-emerald-700">Công thức báo cáo tháng</div>
                <div className="mt-3 rounded-2xl bg-white/80 p-4 text-sm leading-6 text-emerald-900 shadow-sm">
                  <div>Định mức kế hoạch = Thành phẩm trong kỳ x Định mức</div>
                  <div className="mt-2">Chênh lệch = Tiêu hao thực tế - Định mức kế hoạch</div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {modalType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-xl rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h2 className="text-lg font-extrabold text-slate-800">
                  {modalType === "warehouse"
                    ? editingId
                      ? "Cập nhật kho"
                      : "Thêm kho mới"
                    : modalType === "item"
                      ? editingId
                        ? "Cập nhật vật tư / hóa chất"
                        : "Thêm vật tư / hóa chất"
                      : editingId
                        ? "Cập nhật nhóm vật tư"
                        : "Thêm nhóm vật tư"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {modalType === "warehouse"
                    ? "Lưu danh mục kho theo nhà máy đang đăng nhập."
                    : modalType === "item"
                      ? "Lưu danh mục vật tư, kho chứa, lô-hạn và giới hạn min-max."
                      : "Lưu danh mục nhóm vật tư để dùng cho báo cáo và cảnh báo."}
                </p>
              </div>
              <button onClick={closeModal} className="rounded-2xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 px-6 py-5">
              {formError ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {formError}
                </div>
              ) : null}

              {modalType === "warehouse" ? (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-xs font-bold text-slate-600">Mã kho *</label>
                      <input
                        value={warehouseForm.code}
                        onChange={(e) => setWarehouseForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
                        className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-bold text-slate-600">Loại kho</label>
                      <input
                        value={warehouseForm.warehouse_type}
                        onChange={(e) => setWarehouseForm((prev) => ({ ...prev, warehouse_type: e.target.value }))}
                        className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-emerald-500"
                      />
                    </div>
                  </div>
                  <div>
                      <label className="mb-1.5 block text-xs font-bold text-slate-600">Tên kho *</label>
                    <input
                      value={warehouseForm.name}
                      onChange={(e) => setWarehouseForm((prev) => ({ ...prev, name: e.target.value }))}
                      className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-600">Thủ kho</label>
                    <input
                      value={warehouseForm.keeper_name}
                      onChange={(e) => setWarehouseForm((prev) => ({ ...prev, keeper_name: e.target.value }))}
                      className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-emerald-500"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={warehouseForm.is_active}
                      onChange={(e) => setWarehouseForm((prev) => ({ ...prev, is_active: e.target.checked }))}
                    />
                    Đang hoạt động
                  </label>
                </>
              ) : modalType === "item" ? (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-xs font-bold text-slate-600">Mã vật tư *</label>
                      <input
                        value={itemForm.code}
                        onChange={(e) => setItemForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
                        className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-bold text-slate-600">Nhóm vật tư *</label>
                      <select
                        value={itemForm.category_id}
                        onChange={(e) => setItemForm((prev) => ({ ...prev, category_id: e.target.value }))}
                        className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-emerald-500"
                      >
                        <option value="">Chọn nhóm</option>
                        {categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.code} - {category.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-xs font-bold text-slate-600">Tên vật tư *</label>
                      <input
                        value={itemForm.name}
                        onChange={(e) => setItemForm((prev) => ({ ...prev, name: e.target.value }))}
                        className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-bold text-slate-600">Đơn vị tính *</label>
                      <input
                        value={itemForm.unit}
                        onChange={(e) => setItemForm((prev) => ({ ...prev, unit: e.target.value }))}
                        className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-emerald-500"
                      />
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-xs font-bold text-slate-600">Quy cách</label>
                      <input
                        value={itemForm.specification}
                        onChange={(e) => setItemForm((prev) => ({ ...prev, specification: e.target.value }))}
                        className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-bold text-slate-600">Thu?c thi?t b?</label>
                      <input
                        value={itemForm.equipment_name}
                        onChange={(e) => setItemForm((prev) => ({ ...prev, equipment_name: e.target.value }))}
                        className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-emerald-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-600">Kho chứa *</label>
                    <div className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-2">
                      {warehouses.map((warehouse) => (
                        <label key={warehouse.id} className="flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={itemForm.selected_warehouse_ids.includes(warehouse.id)}
                            onChange={(e) =>
                              setItemForm((prev) => ({
                                ...prev,
                                selected_warehouse_ids: e.target.checked
                                  ? [...prev.selected_warehouse_ids, warehouse.id]
                                  : prev.selected_warehouse_ids.filter((id) => id !== warehouse.id),
                              }))
                            }
                          />
                          <span>
                            {warehouse.code} - {warehouse.name}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <label className="mb-1.5 block text-xs font-bold text-slate-600">Tồn tối thiểu</label>
                      <input
                        value={itemForm.min_stock}
                        onChange={(e) => setItemForm((prev) => ({ ...prev, min_stock: e.target.value }))}
                        className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-bold text-slate-600">Tồn tối đa</label>
                      <input
                        value={itemForm.max_stock}
                        onChange={(e) => setItemForm((prev) => ({ ...prev, max_stock: e.target.value }))}
                        className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-bold text-slate-600">Tồn đầu kỳ</label>
                      <input
                        value={itemForm.opening_stock}
                        onChange={(e) => setItemForm((prev) => ({ ...prev, opening_stock: e.target.value }))}
                        className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-emerald-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-600">Hình ảnh URL</label>
                    <input
                      value={itemForm.image_url}
                      onChange={(e) => setItemForm((prev) => ({ ...prev, image_url: e.target.value }))}
                      className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-emerald-500"
                    />
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={itemForm.manages_lot}
                        onChange={(e) => setItemForm((prev) => ({ ...prev, manages_lot: e.target.checked }))}
                      />
                      Quản lý lô
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={itemForm.manages_expiry}
                        onChange={(e) => setItemForm((prev) => ({ ...prev, manages_expiry: e.target.checked }))}
                      />
                      Quản lý hạn
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={itemForm.is_active}
                        onChange={(e) => setItemForm((prev) => ({ ...prev, is_active: e.target.checked }))}
                      />
                      Đang hoạt động
                    </label>
                  </div>
                </>
              ) : (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-xs font-bold text-slate-600">Mã nhóm *</label>
                      <input
                        value={categoryForm.code}
                        onChange={(e) => setCategoryForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
                        className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-bold text-slate-600">Thứ tự</label>
                      <input
                        value={categoryForm.sort_order}
                        onChange={(e) => setCategoryForm((prev) => ({ ...prev, sort_order: e.target.value }))}
                        className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-emerald-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-600">Tên nhóm *</label>
                    <input
                      value={categoryForm.name}
                      onChange={(e) => setCategoryForm((prev) => ({ ...prev, name: e.target.value }))}
                      className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none transition-colors focus:border-emerald-500"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={categoryForm.is_active}
                      onChange={(e) => setCategoryForm((prev) => ({ ...prev, is_active: e.target.checked }))}
                    />
                    Đang hoạt động
                  </label>
                </>
              )}
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <button onClick={closeModal} className="rounded-2xl px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100">
                Hủy
              </button>
              <button
                onClick={modalType === "warehouse" ? saveWarehouse : modalType === "item" ? saveItem : saveCategory}
                disabled={saving}
                className="rounded-2xl bg-emerald-600 px-5 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? "Đang lưu..." : "Lưu"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-red-100 p-3 text-red-600">
                <AlertTriangle size={18} />
              </div>
              <div>
                <h3 className="text-lg font-extrabold text-slate-800">Xóa danh mục?</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Bạn sắp xóa <span className="font-bold text-slate-700">{deleteTarget.label}</span>. Hành động này không thể hoàn tác.
                </p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-2xl px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
              >
                Hủy
              </button>
              <button
                onClick={() => void confirmDelete()}
                disabled={saving}
                className="rounded-2xl bg-red-600 px-5 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {saving ? "Đang xóa..." : "Xóa"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </InventoryPageShell>
  )
}

