"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"

const PolygonDrawMap = dynamic(
  () => import("./_components/PolygonDrawMap"),
  {
    ssr: false,
    loading: () => (
      <div className="h-80 bg-slate-100 rounded-xl flex items-center justify-center text-slate-400 text-sm">
        Đang tải bản đồ...
      </div>
    ),
  }
)
import { supabase } from "@/lib/supabase"
import {
  DEFAULT_PERMISSION_CODES,
  ROLE_DEFAULTS,
  getActiveFactoryId,
  hasPermission,
  hydrateActiveSession,
  type AppRole,
  type SessionUser,
} from "@/lib/auth"
import {
  Plus,
  Edit2,
  Trash2,
  X,
  Tag,
  AlertTriangle,
  Building2,
  Save,
  Users,
  ShieldCheck,
  Lock,
  CheckCircle2,
  UserCheck,
  SlidersHorizontal,
  Database,
  Download,
  Upload,
  Wrench,
  Car,
  Calendar,
  UserCog,
  ShoppingBag,
} from "lucide-react"

type Suffix = {
  code: string
  name: string
  nguon: string
  chung_nhan: string
  factory_id: string
}

type SuffixForm = {
  code: string
  name: string
  nguon: string
  chung_nhan: string
}

type FactoryInfo = {
  full_name_en: string
  address_en: string
  contact_person: string
  contact_email: string
  website: string
  country_en: string
}

type FactoryOption = {
  id: string
  name: string
}

type ProfileRow = {
  id: string
  username: string
  full_name: string
  factory_id: string | null
  department: string | null
  role: AppRole
  status: "pending" | "active" | "disabled"
  approved_by: string | null
  approved_at: string | null
  disabled_by: string | null
  disabled_at: string | null
}

type PermissionOption = {
  code: string
  label: string
  module_name: string
  action_name: string
}

type UserEditor = {
  userId: string
  username: string
  fullName: string
  factoryId: string
  role: AppRole
  permissions: string[]
  mode: "approve" | "edit"
}

type SettingsTab = "system" | "factory-config" | "master-data" | "maintenance"

type SystemTab = "users" | "permissions"

type MasterDataTab = "suffixes" | "company" | "customers"

type FactoryConfigTab = "warehouses" | "categories" | "items" | "delivery-points" | "forest-plots"

type MaintenanceTab = "assets" | "staff" | "vehicles" | "ext-materials"

type MaintenanceAssetRow = {
  id: string
  factory_id: string
  ma_tb: string
  ten_tb: string
  bo_phan: string
  loai: string
  nam_sd: string | null
  bien_so: string | null
  mo_ta: string | null
  trang_thai: string
}

type MaintenanceStaffRow = {
  id: string
  factory_id: string
  ten: string
  chuc_vu: string | null
  active: boolean
}

type MaintenanceExtMaterialRow = {
  id: string
  factory_id: string
  ten_vat_tu: string
  dvt: string | null
  code: string | null
  specification: string | null
  category_id: string | null
  is_active: boolean
}

type CustomerRow = {
  id: string
  factory_id: string
  ma_kh: string | null
  ten_kh_en: string | null
  email: string | null
  dia_chi: string | null
}

type CustomerForm = {
  ma_kh: string
  ten_kh_en: string
  email: string
  dia_chi: string
}

const BO_PHAN_OPTIONS = ["Mủ tạp", "Mủ nước", "Nước thải", "Biomass", "Đội xe", "Văn phòng", "Khác"] as const

type InvWarehouseRow = {
  id: string
  factory_id: string
  code: string
  name: string
  keeper_name: string | null
  warehouse_type: string | null
  is_active: boolean
}

type InvCategoryRow = {
  id: string
  factory_id: string
  code: string
  name: string
  sort_order: number
  is_active: boolean
  itemCount: number
}

type InvItemRow = {
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
  is_active: boolean
  categoryName: string
  warehouseCodes: string[]
}

type InvWarehouseForm = { code: string; name: string; keeper_name: string; warehouse_type: string; is_active: boolean }
type InvCategoryForm = { code: string; name: string; sort_order: string; is_active: boolean }
type InvItemForm = {
  category_id: string; code: string; name: string; unit: string; specification: string
  selected_warehouse_ids: string[]; manages_lot: boolean; manages_expiry: boolean
  min_stock: string; max_stock: string; is_active: boolean
}

type DispatchDeliveryPointRow = {
  id: string
  factory_id: string
  ma_lo: string
  doi: number
  lat: number
  lng: number
  phien_a: string[]
  phien_b: string[]
  phien_c: string[]
  phien_d: string[]
  sort_order: number
  is_active: boolean
}

type DispatchDeliveryPointForm = {
  ma_lo: string
  doi: string
  lat: string
  lng: string
  phien_a: string
  phien_b: string
  phien_c: string
  phien_d: string
  sort_order: string
  is_active: boolean
}

type ForestPlotRow = {
  id: string
  factory_id: string
  ten: string
  ma_lo_full: string | null
  nong_truong: string | null
  doi: number | null
  giong: string | null
  dien_tich_ha: number | null
  nam_trong: number | null
  nam_cao_up: number | null
  is_active: boolean
}

type ForestPlotForm = {
  ten: string
  ma_lo_full: string
  nong_truong: string
  doi: string
  giong: string
  dien_tich_ha: string
  nam_trong: string
  nam_cao_up: string
  is_active: boolean
}

type DispatchDriverRow = {
  id: string
  factory_id: string
  code: string | null
  name: string
  phone: string | null
  is_active: boolean
}

type DispatchVehicleAssignmentRow = {
  id: string
  factory_id: string
  vehicle_id: string
  driver_id: string
  effective_from: string
  effective_to: string | null
  is_current: boolean
  note: string | null
}

type DispatchVehicleRow = {
  id: string
  factory_id: string
  code: string
  name: string
  vehicle_type: string | null
  plate_number: string | null
  sort_order: number
  is_active: boolean
  current_driver_id: string | null
  current_driver_name: string
  current_assignment_from: string | null
}

type DispatchDriverForm = {
  code: string
  name: string
  phone: string
  is_active: boolean
}

type DispatchVehicleForm = {
  code: string
  name: string
  vehicle_type: string
  plate_number: string
  sort_order: string
  primary_driver_id: string
  effective_from: string
  note: string
  is_active: boolean
}

const SYSTEM_CODES = ["cs", "m"]

function emptyForm(): SuffixForm {
  return { code: "", name: "", nguon: "", chung_nhan: "" }
}

function emptyFactoryInfo(): FactoryInfo {
  return {
    full_name_en: "",
    address_en: "",
    contact_person: "",
    contact_email: "",
    website: "",
    country_en: "",
  }
}

function emptyDeliveryPointForm(sortOrder = "0"): DispatchDeliveryPointForm {
  return {
    ma_lo: "",
    doi: "",
    lat: "",
    lng: "",
    phien_a: "",
    phien_b: "",
    phien_c: "",
    phien_d: "",
    sort_order: sortOrder,
    is_active: true,
  }
}

function emptyForestPlotForm(): ForestPlotForm {
  return {
    ten: "", ma_lo_full: "", nong_truong: "",
    doi: "", giong: "", dien_tich_ha: "",
    nam_trong: "", nam_cao_up: "", is_active: true,
  }
}

function emptyDispatchDriverForm(): DispatchDriverForm {
  return {
    code: "",
    name: "",
    phone: "",
    is_active: true,
  }
}

function emptyDispatchVehicleForm(sortOrder = "0"): DispatchVehicleForm {
  return {
    code: "",
    name: "",
    vehicle_type: "",
    plate_number: "",
    sort_order: sortOrder,
    primary_driver_id: "",
    effective_from: new Date().toISOString().slice(0, 10),
    note: "",
    is_active: true,
  }
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function parsePointPhaseList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function labelPermission(code: string) {
  const [moduleName = "", actionName = ""] = code.split(".")
  return {
    code,
    module_name: moduleName,
    action_name: actionName,
    label: `${moduleName} · ${actionName}`,
  }
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') { inQuotes = !inQuotes }
    else if (char === "," && !inQuotes) { result.push(current.trim()); current = "" }
    else { current += char }
  }
  result.push(current.trim())
  return result
}

function downloadConfigTemplate(tab: FactoryConfigTab) {
  const cfgs: Record<FactoryConfigTab, { filename: string; rows: string[] }> = {
    warehouses: {
      filename: "mau_nhap_kho.csv",
      rows: [
        "ma_kho,ten_kho,thu_kho,loai_kho,trang_thai",
        "KA,Kho vật tư,Nguyễn Văn A,Vật tư,true",
        "KB,Kho hóa chất,,Hóa chất,true",
      ],
    },
    categories: {
      filename: "mau_nhap_nhom_vat_tu.csv",
      rows: [
        "ma_nhom,ten_nhom,thu_tu,trang_thai",
        "VT,Vật tư cơ khí,1,true",
        "HC,Hóa chất,2,true",
      ],
    },
    items: {
      filename: "mau_nhap_vat_tu.csv",
      rows: [
        "ma_nhom,ma_vat_tu,ten_vat_tu,don_vi,quy_cach,ma_kho,quan_ly_lo,quan_ly_han,ton_min,ton_max",
        "VT,VT001,Dầu nhớt máy,Lít,SAE 40,KA,false,false,50,500",
        "HC,HC001,Acid sulfuric,Kg,H2SO4 98%,KB,true,true,20,200",
        "# Ghi chú: ma_kho hỗ trợ nhiều kho ngăn cách dấu chấm phẩy vd: KA;KB",
      ],
    },
    "delivery-points": {
      filename: "mau_diem_giao_nhan.csv",
      rows: [
        "ma_lo,doi,lat,lng,phien_a,phien_b,phien_c,phien_d,sort_order,is_active",
        "B5,2,12.632736,105.495549,\"A3,A4,A5\",\"B4,C4,D4,E4\",\"E5,D5D,C5D,C5T\",\"A3,A4,A5\",1,true",
      ],
    },
    "forest-plots": {
      filename: "lo_vuon.csv",
      rows: [],
    },
  }
  const cfg = cfgs[tab]
  const blob = new Blob(["﻿" + cfg.rows.join("\r\n")], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = cfg.filename
  link.click()
  URL.revokeObjectURL(url)
}

export default function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>("system")
  const [systemTab, setSystemTab] = useState<SystemTab>("users")
  const [masterDataTab, setMasterDataTab] = useState<MasterDataTab>("suffixes")
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [suffixes, setSuffixes] = useState<Suffix[]>([])
  const [loading, setLoading] = useState(true)
  const [profiles, setProfiles] = useState<ProfileRow[]>([])
  const [permissionOptions, setPermissionOptions] = useState<PermissionOption[]>([])
  const [factories, setFactories] = useState<FactoryOption[]>([])

  const [factoryInfo, setFactoryInfo] = useState<FactoryInfo>(emptyFactoryInfo())
  const [savingFactory, setSavingFactory] = useState(false)
  const [factoryMsg, setFactoryMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [modal, setModal] = useState<"add" | "edit" | null>(null)
  const [form, setForm] = useState<SuffixForm>(emptyForm())
  const [editCode, setEditCode] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [delConfirm, setDelConfirm] = useState<string | null>(null)
  const [error, setError] = useState("")

  const [userEditor, setUserEditor] = useState<UserEditor | null>(null)
  const [savingUser, setSavingUser] = useState(false)
  const [userError, setUserError] = useState("")

  const canManageSettings = hasPermission(user, "settings.manage_config")
  const canViewUsers = hasPermission(user, "users.view")
  const canApproveUsers = hasPermission(user, "users.approve")
  const canEditPermissions = hasPermission(user, "users.edit_permission")

  const [configTab, setConfigTab] = useState<FactoryConfigTab>("warehouses")
  const [invWarehouses, setInvWarehouses] = useState<InvWarehouseRow[]>([])
  const [invCategories, setInvCategories] = useState<InvCategoryRow[]>([])
  const [invItems, setInvItems] = useState<InvItemRow[]>([])
  const [deliveryPoints, setDeliveryPoints] = useState<DispatchDeliveryPointRow[]>([])
  const [dispatchDrivers, setDispatchDrivers] = useState<DispatchDriverRow[]>([])
  const [dispatchVehicles, setDispatchVehicles] = useState<DispatchVehicleRow[]>([])
  const [dispatchVehicleAssignments, setDispatchVehicleAssignments] = useState<DispatchVehicleAssignmentRow[]>([])
  const [forestPlots, setForestPlots] = useState<ForestPlotRow[]>([])
  const [forestPlotForm, setForestPlotForm] = useState<ForestPlotForm>(emptyForestPlotForm())
  const [forestPlotGeometry, setForestPlotGeometry] = useState<unknown>(null)
  const [forestPlotGeoImporting, setForestPlotGeoImporting] = useState(false)
  const forestPlotGeoImportRef = useRef<HTMLInputElement>(null)
  const [configLoading, setConfigLoading] = useState(false)
  const [configLoaded, setConfigLoaded] = useState(false)

  const [configModal, setConfigModal] = useState<"warehouse" | "category" | "item" | "delivery-point" | "driver" | "vehicle" | "forest-plot" | null>(null)
  const [configEditId, setConfigEditId] = useState<string | null>(null)
  const [invWarehouseForm, setInvWarehouseForm] = useState<InvWarehouseForm>({ code: "", name: "", keeper_name: "", warehouse_type: "", is_active: true })
  const [invCategoryForm, setInvCategoryForm] = useState<InvCategoryForm>({ code: "", name: "", sort_order: "0", is_active: true })
  const [invItemForm, setInvItemForm] = useState<InvItemForm>({ category_id: "", code: "", name: "", unit: "", specification: "", selected_warehouse_ids: [], manages_lot: false, manages_expiry: false, min_stock: "0", max_stock: "0", is_active: true })
  const [deliveryPointForm, setDeliveryPointForm] = useState<DispatchDeliveryPointForm>(emptyDeliveryPointForm())
  const [dispatchDriverForm, setDispatchDriverForm] = useState<DispatchDriverForm>(emptyDispatchDriverForm())
  const [dispatchVehicleForm, setDispatchVehicleForm] = useState<DispatchVehicleForm>(emptyDispatchVehicleForm())
  const [assignmentHistoryVehicleId, setAssignmentHistoryVehicleId] = useState<string | null>(null)
  const [configSaving, setConfigSaving] = useState(false)
  const [configError, setConfigError] = useState("")
  const [configDelConfirm, setConfigDelConfirm] = useState<{ type: "warehouse" | "category" | "item" | "delivery-point" | "driver" | "vehicle" | "forest-plot"; id: string; label: string } | null>(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ success: number; errors: string[] } | null>(null)
  const importFileRef = useRef<HTMLInputElement>(null)

  // Maintenance tab state
  const [maintTab, setMaintTab] = useState<MaintenanceTab>("assets")
  const [maintAssets, setMaintAssets] = useState<MaintenanceAssetRow[]>([])
  const [maintStaff, setMaintStaff] = useState<MaintenanceStaffRow[]>([])
  const [maintExtMats, setMaintExtMats] = useState<MaintenanceExtMaterialRow[]>([])
  const [maintLoading, setMaintLoading] = useState(false)
  const [maintLoaded, setMaintLoaded] = useState(false)
  const [maintModal, setMaintModal] = useState<"asset" | "staff" | "ext-mat" | null>(null)
  const [maintEditId, setMaintEditId] = useState<string | null>(null)
  const [maintSaving, setMaintSaving] = useState(false)
  const [maintError, setMaintError] = useState("")
  const [maintDelConfirm, setMaintDelConfirm] = useState<{ type: "asset" | "staff" | "ext-mat"; id: string; label: string } | null>(null)
  const [assetForm, setAssetForm] = useState({ ma_tb: "", ten_tb: "", bo_phan: "Mủ tạp", loai: "may_moc", nam_sd: "", bien_so: "", mo_ta: "", trang_thai: "active" })
  const [staffForm, setStaffForm] = useState({ ten: "", chuc_vu: "", email: "", active: true })
  const [extMatForm, setExtMatForm] = useState({ ten_vat_tu: "", dvt: "", code: "", specification: "", category_id: "", is_active: true })

  // Customers state
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [customerLoading, setCustomerLoading] = useState(false)
  const [customerLoaded, setCustomerLoaded] = useState(false)
  const [customerModal, setCustomerModal] = useState<"add" | "edit" | null>(null)
  const [customerEditId, setCustomerEditId] = useState<string | null>(null)
  const [customerForm, setCustomerForm] = useState<CustomerForm>({ ma_kh: "", ten_kh_en: "", email: "", dia_chi: "" })
  const [customerSaving, setCustomerSaving] = useState(false)
  const [customerError, setCustomerError] = useState("")
  const [customerDelConfirm, setCustomerDelConfirm] = useState<{ id: string; label: string } | null>(null)
  const [expandedCustomerId, setExpandedCustomerId] = useState<string | null>(null)

  const loadSuffixes = useCallback(async (fid: string) => {
    const { data } = await supabase.from("suffixes").select("*").eq("factory_id", fid).order("code")
    setSuffixes(data || [])
  }, [])

  const loadProfiles = useCallback(async (fid: string) => {
    const { data } = await supabase
      .from("profiles")
      .select(
        "id, username, full_name, factory_id, department, role, status, approved_by, approved_at, disabled_by, disabled_at",
      )
      .eq("factory_id", fid)
      .order("status")
      .order("username")

    setProfiles((data || []) as ProfileRow[])
  }, [])

  const loadPermissions = useCallback(async () => {
    const { data, error } = await supabase
      .from("permissions")
      .select("code, module_name, action_name")
      .order("module_name")
      .order("action_name")

    if (error || !data?.length) {
      setPermissionOptions(DEFAULT_PERMISSION_CODES.map(labelPermission))
      return
    }

    setPermissionOptions(
      data.map((item) => ({
        code: item.code,
        module_name: item.module_name,
        action_name: item.action_name,
        label: `${item.module_name} · ${item.action_name}`,
      })),
    )
  }, [])

  const loadConfigData = useCallback(async (fid: string) => {
    setConfigLoading(true)
    try {
      const [wRes, cRes, iItemsRes, iCatCountRes, dRes] = await Promise.all([
        supabase.from("inventory_warehouses").select("id, factory_id, code, name, keeper_name, warehouse_type, is_active").eq("factory_id", fid).order("code"),
        supabase.from("inventory_item_categories").select("id, factory_id, code, name, sort_order, is_active").eq("factory_id", fid).order("sort_order").order("code"),
        supabase.from("inventory_items").select("id, factory_id, category_id, code, name, unit, specification, default_warehouse_ids, manages_lot, manages_expiry, min_stock, max_stock, is_active").eq("factory_id", fid).order("code"),
        supabase.from("inventory_items").select("category_id").eq("factory_id", fid),
        supabase.from("dispatch_delivery_points").select("id, factory_id, ma_lo, doi, lat, lng, phien_a, phien_b, phien_c, phien_d, sort_order, is_active").eq("factory_id", fid).order("sort_order").order("ma_lo"),
      ])

      const nextWarehouses = (wRes.data || []) as InvWarehouseRow[]
      const rawCategories = (cRes.data || []) as Omit<InvCategoryRow, "itemCount">[]
      const countMap = new Map<string, number>()
      for (const row of (iCatCountRes.data || [])) {
        if (row.category_id) countMap.set(row.category_id, (countMap.get(row.category_id) || 0) + 1)
      }
      const nextCategories = rawCategories.map((row) => ({ ...row, itemCount: countMap.get(row.id) || 0 }))
      const warehouseCodeMap = new Map(nextWarehouses.map((w) => [w.id, w.code]))
      const categoryNameMap = new Map(nextCategories.map((c) => [c.id, c.name]))
      const nextItems = ((iItemsRes.data || []) as Omit<InvItemRow, "categoryName" | "warehouseCodes">[]).map((row) => ({
        ...row,
        categoryName: categoryNameMap.get(row.category_id || "") || "Chưa phân loại",
        warehouseCodes: (row.default_warehouse_ids || []).map((id) => warehouseCodeMap.get(id) || id),
      }))

      const nextDeliveryPoints = (dRes.data || []) as DispatchDeliveryPointRow[]

      const { data: forestPlotsData } = await supabase
        .from("forest_plots")
        .select("id, factory_id, ten, ma_lo_full, nong_truong, doi, giong, dien_tich_ha, nam_trong, nam_cao_up, is_active")
        .eq("factory_id", fid)
        .order("doi", { ascending: true, nullsFirst: false })
        .order("ten")

      setInvWarehouses(nextWarehouses)
      setInvCategories(nextCategories)
      setInvItems(nextItems)
      setDeliveryPoints(nextDeliveryPoints)
      setForestPlots(forestPlotsData || [])
      setConfigLoaded(true)
    } finally {
      setConfigLoading(false)
    }
  }, [])

  const loadMaintenanceData = useCallback(async (fid: string) => {
    setMaintLoading(true)
    try {
      const [aRes, sRes, mRes, driverRes, vehicleRes, assignmentRes] = await Promise.all([
        supabase.from("maintenance_assets").select("*").eq("factory_id", fid).order("bo_phan").order("ma_tb"),
        supabase.from("maintenance_staff").select("*").eq("factory_id", fid).order("ten"),
        supabase.from("maintenance_external_materials").select("*").eq("factory_id", fid).order("ten_vat_tu"),
        supabase.from("dispatch_drivers").select("id, factory_id, code, name, phone, is_active").eq("factory_id", fid).order("name"),
        supabase.from("dispatch_vehicles").select("id, factory_id, code, name, vehicle_type, plate_number, sort_order, is_active").eq("factory_id", fid).order("sort_order").order("code"),
        supabase.from("dispatch_vehicle_driver_assignments").select("id, factory_id, vehicle_id, driver_id, effective_from, effective_to, is_current, note").eq("factory_id", fid).order("is_current", { ascending: false }).order("effective_from", { ascending: false }),
      ])
      setMaintAssets((aRes.data || []) as MaintenanceAssetRow[])
      setMaintStaff((sRes.data || []) as MaintenanceStaffRow[])
      setMaintExtMats((mRes.data || []) as MaintenanceExtMaterialRow[])

      const nextDrivers = (driverRes.data || []) as DispatchDriverRow[]
      const nextAssignments = (assignmentRes.data || []) as DispatchVehicleAssignmentRow[]
      const driverNameMap = new Map(nextDrivers.map((r) => [r.id, r.name]))
      const currentAssignmentMap = new Map<string, DispatchVehicleAssignmentRow>()
      for (const a of nextAssignments) {
        const existing = currentAssignmentMap.get(a.vehicle_id)
        if (!existing && a.is_current) { currentAssignmentMap.set(a.vehicle_id, a); continue }
        if (!existing) { currentAssignmentMap.set(a.vehicle_id, a); continue }
        if (!existing.is_current && a.is_current) currentAssignmentMap.set(a.vehicle_id, a)
      }
      const nextVehicles = ((vehicleRes.data || []) as Omit<DispatchVehicleRow, "current_driver_id" | "current_driver_name" | "current_assignment_from">[]).map((row) => {
        const ca = currentAssignmentMap.get(row.id)
        return { ...row, current_driver_id: ca?.driver_id || null, current_driver_name: ca ? driverNameMap.get(ca.driver_id) || "Không xác định" : "", current_assignment_from: ca?.effective_from || null }
      })
      setDispatchDrivers(nextDrivers)
      setDispatchVehicles(nextVehicles)
      setDispatchVehicleAssignments(nextAssignments)
      setMaintLoaded(true)
    } finally {
      setMaintLoading(false)
    }
  }, [])

  const loadCustomers = useCallback(async (fid: string) => {
    setCustomerLoading(true)
    try {
      const { data } = await supabase.from("customers").select("id, factory_id, ma_kh, ten_kh_en, email, dia_chi").eq("factory_id", fid).order("ten_kh_en")
      setCustomers((data || []) as CustomerRow[])
      setCustomerLoaded(true)
    } finally {
      setCustomerLoading(false)
    }
  }, [])

  const saveMaintAsset = async () => {
    if (!factoryId) return
    if (!assetForm.ma_tb.trim()) { setMaintError("Mã thiết bị không được để trống"); return }
    if (!assetForm.ten_tb.trim()) { setMaintError("Tên thiết bị không được để trống"); return }
    setMaintSaving(true); setMaintError("")
    try {
      const payload = { factory_id: factoryId, ma_tb: assetForm.ma_tb.trim(), ten_tb: assetForm.ten_tb.trim(), bo_phan: assetForm.bo_phan, loai: assetForm.loai, nam_sd: assetForm.nam_sd.trim() || null, bien_so: assetForm.bien_so.trim() || null, mo_ta: assetForm.mo_ta.trim() || null, trang_thai: assetForm.trang_thai }
      const result = maintEditId
        ? await supabase.from("maintenance_assets").update(payload).eq("id", maintEditId).eq("factory_id", factoryId)
        : await supabase.from("maintenance_assets").insert(payload)
      if (result.error) { setMaintError(result.error.message); return }
      setMaintModal(null)
      void loadMaintenanceData(factoryId)
    } catch (e) { setMaintError(e instanceof Error ? e.message : "Lỗi") } finally { setMaintSaving(false) }
  }

  const saveMaintStaff = async () => {
    if (!factoryId) return
    if (!staffForm.ten.trim()) { setMaintError("Tên không được để trống"); return }
    setMaintSaving(true); setMaintError("")
    try {
      const payload = { factory_id: factoryId, ten: staffForm.ten.trim(), chuc_vu: staffForm.chuc_vu.trim() || null, email: staffForm.email.trim() || null, active: staffForm.active }
      const result = maintEditId
        ? await supabase.from("maintenance_staff").update(payload).eq("id", maintEditId).eq("factory_id", factoryId)
        : await supabase.from("maintenance_staff").insert(payload)
      if (result.error) { setMaintError(result.error.message); return }
      setMaintModal(null)
      void loadMaintenanceData(factoryId)
    } catch (e) { setMaintError(e instanceof Error ? e.message : "Lỗi") } finally { setMaintSaving(false) }
  }

  const saveMaintExtMat = async () => {
    if (!factoryId) return
    if (!extMatForm.ten_vat_tu.trim()) { setMaintError("Tên vật tư không được để trống"); return }
    setMaintSaving(true); setMaintError("")
    try {
      const payload = {
        factory_id: factoryId,
        ten_vat_tu: extMatForm.ten_vat_tu.trim(),
        dvt: extMatForm.dvt.trim() || null,
        code: extMatForm.code.trim() || null,
        specification: extMatForm.specification.trim() || null,
        category_id: extMatForm.category_id || null,
        is_active: extMatForm.is_active,
      }
      const result = maintEditId
        ? await supabase.from("maintenance_external_materials").update(payload).eq("id", maintEditId).eq("factory_id", factoryId)
        : await supabase.from("maintenance_external_materials").insert(payload)
      if (result.error) { setMaintError(result.error.message); return }
      setMaintModal(null)
      void loadMaintenanceData(factoryId)
    } catch (e) { setMaintError(e instanceof Error ? e.message : "Lỗi") } finally { setMaintSaving(false) }
  }

  const deleteMaintItem = async () => {
    if (!factoryId || !maintDelConfirm) return
    const table = maintDelConfirm.type === "asset" ? "maintenance_assets" : maintDelConfirm.type === "staff" ? "maintenance_staff" : "maintenance_external_materials"
    await supabase.from(table).delete().eq("id", maintDelConfirm.id).eq("factory_id", factoryId)
    setMaintDelConfirm(null)
    void loadMaintenanceData(factoryId)
  }

  const saveConfigWarehouse = async () => {
    if (!factoryId) return
    if (!invWarehouseForm.code.trim()) { setConfigError("Mã kho không được để trống"); return }
    if (!invWarehouseForm.name.trim()) { setConfigError("Tên kho không được để trống"); return }
    setConfigSaving(true)
    setConfigError("")
    try {
      const payload = { factory_id: factoryId, code: invWarehouseForm.code.trim().toUpperCase(), name: invWarehouseForm.name.trim(), keeper_name: invWarehouseForm.keeper_name.trim() || null, warehouse_type: invWarehouseForm.warehouse_type.trim() || null, is_active: invWarehouseForm.is_active }
      const result = configEditId
        ? await supabase.from("inventory_warehouses").update(payload).eq("id", configEditId).eq("factory_id", factoryId)
        : await supabase.from("inventory_warehouses").insert(payload)
      if (result.error) { setConfigError(result.error.message); return }
      setConfigModal(null)
      void loadConfigData(factoryId)
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : "Lỗi không xác định")
    } finally {
      setConfigSaving(false)
    }
  }

  const saveConfigCategory = async () => {
    if (!factoryId) return
    if (!invCategoryForm.code.trim()) { setConfigError("Mã nhóm không được để trống"); return }
    if (!invCategoryForm.name.trim()) { setConfigError("Tên nhóm không được để trống"); return }
    setConfigSaving(true)
    setConfigError("")
    try {
      const payload = { factory_id: factoryId, code: invCategoryForm.code.trim().toUpperCase(), name: invCategoryForm.name.trim(), sort_order: Number(invCategoryForm.sort_order) || 0, is_active: invCategoryForm.is_active }
      const result = configEditId
        ? await supabase.from("inventory_item_categories").update(payload).eq("id", configEditId).eq("factory_id", factoryId)
        : await supabase.from("inventory_item_categories").insert(payload)
      if (result.error) { setConfigError(result.error.message); return }
      setConfigModal(null)
      void loadConfigData(factoryId)
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : "Lỗi không xác định")
    } finally {
      setConfigSaving(false)
    }
  }

  const saveConfigItem = async () => {
    if (!factoryId) return
    if (!invItemForm.category_id) { setConfigError("Vui lòng chọn nhóm vật tư"); return }
    if (!invItemForm.code.trim()) { setConfigError("Mã vật tư không được để trống"); return }
    if (!invItemForm.name.trim()) { setConfigError("Tên vật tư không được để trống"); return }
    if (!invItemForm.unit.trim()) { setConfigError("Đơn vị tính không được để trống"); return }
    if (invItemForm.selected_warehouse_ids.length === 0) { setConfigError("Phải chọn ít nhất 1 kho chứa"); return }
    setConfigSaving(true)
    setConfigError("")
    try {
      const payload = { factory_id: factoryId, category_id: invItemForm.category_id, code: invItemForm.code.trim().toUpperCase(), name: invItemForm.name.trim(), unit: invItemForm.unit.trim(), specification: invItemForm.specification.trim() || null, default_warehouse_ids: invItemForm.selected_warehouse_ids, manages_lot: invItemForm.manages_lot, manages_expiry: invItemForm.manages_expiry, min_stock: Number(invItemForm.min_stock) || 0, max_stock: Number(invItemForm.max_stock) || 0, is_active: invItemForm.is_active }
      const result = configEditId
        ? await supabase.from("inventory_items").update(payload).eq("id", configEditId).eq("factory_id", factoryId).select("id").single()
        : await supabase.from("inventory_items").insert(payload).select("id").single()
      if (result.error || !result.data?.id) { setConfigError(result.error?.message || "Không lưu được vật tư"); return }
      const itemId = result.data.id as string
      await supabase.from("inventory_item_warehouse_rules").delete().eq("item_id", itemId).eq("factory_id", factoryId)
      const rulesPayload = invItemForm.selected_warehouse_ids.map((wId, idx) => ({ factory_id: factoryId, item_id: itemId, warehouse_id: wId, min_stock: Number(invItemForm.min_stock) || 0, max_stock: Number(invItemForm.max_stock) || 0, reorder_point: Number(invItemForm.min_stock) || 0, safety_stock: Number(invItemForm.min_stock) || 0, is_primary: idx === 0 }))
      const rulesResult = await supabase.from("inventory_item_warehouse_rules").insert(rulesPayload)
      if (rulesResult.error) { setConfigError(rulesResult.error.message); return }
      setConfigModal(null)
      void loadConfigData(factoryId)
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : "Lỗi không xác định")
    } finally {
      setConfigSaving(false)
    }
  }

  const saveDeliveryPoint = async () => {
    if (!factoryId) return
    if (!deliveryPointForm.ma_lo.trim()) { setConfigError("Mã điểm không được để trống"); return }
    if (!deliveryPointForm.doi.trim()) { setConfigError("Đội không được để trống"); return }
    if (!deliveryPointForm.lat.trim() || Number.isNaN(Number(deliveryPointForm.lat))) { setConfigError("Vĩ độ không hợp lệ"); return }
    if (!deliveryPointForm.lng.trim() || Number.isNaN(Number(deliveryPointForm.lng))) { setConfigError("Kinh độ không hợp lệ"); return }
    setConfigSaving(true)
    setConfigError("")
    try {
      const payload = {
        factory_id: factoryId,
        ma_lo: deliveryPointForm.ma_lo.trim().toUpperCase(),
        doi: Number(deliveryPointForm.doi),
        lat: Number(deliveryPointForm.lat),
        lng: Number(deliveryPointForm.lng),
        phien_a: parsePointPhaseList(deliveryPointForm.phien_a),
        phien_b: parsePointPhaseList(deliveryPointForm.phien_b),
        phien_c: parsePointPhaseList(deliveryPointForm.phien_c),
        phien_d: parsePointPhaseList(deliveryPointForm.phien_d),
        sort_order: Number(deliveryPointForm.sort_order) || 0,
        is_active: deliveryPointForm.is_active,
      }
      const result = configEditId
        ? await supabase.from("dispatch_delivery_points").update(payload).eq("id", configEditId).eq("factory_id", factoryId)
        : await supabase.from("dispatch_delivery_points").insert(payload)
      if (result.error) { setConfigError(result.error.message); return }
      setConfigModal(null)
      void loadConfigData(factoryId)
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : "Lỗi không xác định")
    } finally {
      setConfigSaving(false)
    }
  }

  const saveDispatchDriver = async () => {
    if (!factoryId) return
    if (!dispatchDriverForm.name.trim()) { setConfigError("Tên tài xế không được để trống"); return }
    setConfigSaving(true)
    setConfigError("")
    try {
      const payload = {
        factory_id: factoryId,
        code: dispatchDriverForm.code.trim().toUpperCase() || null,
        name: dispatchDriverForm.name.trim(),
        phone: dispatchDriverForm.phone.trim() || null,
        is_active: dispatchDriverForm.is_active,
      }
      const result = configEditId
        ? await supabase.from("dispatch_drivers").update(payload).eq("id", configEditId).eq("factory_id", factoryId)
        : await supabase.from("dispatch_drivers").insert(payload)
      if (result.error) { setConfigError(result.error.message); return }
      setConfigModal(null)
      void loadConfigData(factoryId)
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : "Lỗi không xác định")
    } finally {
      setConfigSaving(false)
    }
  }

  const saveDispatchVehicle = async () => {
    if (!factoryId) return
    if (!dispatchVehicleForm.code.trim()) { setConfigError("Mã xe không được để trống"); return }
    if (!dispatchVehicleForm.name.trim()) { setConfigError("Tên xe không được để trống"); return }
    if (!dispatchVehicleForm.primary_driver_id) { setConfigError("Vui lòng chọn tài xế chính"); return }
    if (!dispatchVehicleForm.effective_from) { setConfigError("Ngày hiệu lực không được để trống"); return }
    setConfigSaving(true)
    setConfigError("")
    try {
      const vehiclePayload = {
        factory_id: factoryId,
        code: dispatchVehicleForm.code.trim().toUpperCase(),
        name: dispatchVehicleForm.name.trim(),
        vehicle_type: dispatchVehicleForm.vehicle_type.trim() || null,
        plate_number: dispatchVehicleForm.plate_number.trim() || null,
        sort_order: Number(dispatchVehicleForm.sort_order) || 0,
        is_active: dispatchVehicleForm.is_active,
      }
      const vehicleResult = configEditId
        ? await supabase.from("dispatch_vehicles").update(vehiclePayload).eq("id", configEditId).eq("factory_id", factoryId).select("id").single()
        : await supabase.from("dispatch_vehicles").insert(vehiclePayload).select("id").single()
      if (vehicleResult.error || !vehicleResult.data?.id) {
        setConfigError(vehicleResult.error?.message || "Không lưu được xe")
        return
      }

      const vehicleId = vehicleResult.data.id as string
      const currentAssignment = dispatchVehicleAssignments.find((row) => row.vehicle_id === vehicleId && row.is_current) || null
      const driverChanged = currentAssignment?.driver_id !== dispatchVehicleForm.primary_driver_id

      if (driverChanged && currentAssignment) {
        const closeResult = await supabase
          .from("dispatch_vehicle_driver_assignments")
          .update({
            effective_to: addDays(dispatchVehicleForm.effective_from, -1),
            is_current: false,
          })
          .eq("id", currentAssignment.id)
          .eq("factory_id", factoryId)
        if (closeResult.error) {
          setConfigError(closeResult.error.message)
          return
        }
      }

      if (driverChanged || !currentAssignment) {
        const assignmentResult = await supabase.from("dispatch_vehicle_driver_assignments").insert({
          factory_id: factoryId,
          vehicle_id: vehicleId,
          driver_id: dispatchVehicleForm.primary_driver_id,
          effective_from: dispatchVehicleForm.effective_from,
          effective_to: null,
          is_current: true,
          note: dispatchVehicleForm.note.trim() || null,
        })
        if (assignmentResult.error) {
          setConfigError(assignmentResult.error.message)
          return
        }
      }

      setConfigModal(null)
      void loadConfigData(factoryId)
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : "Lỗi không xác định")
    } finally {
      setConfigSaving(false)
    }
  }

  const saveForestPlot = async () => {
    if (!factoryId) return
    if (!forestPlotForm.ten.trim()) { setConfigError("Mã ngắn (Ten) không được để trống"); return }
    setConfigSaving(true)
    setConfigError("")
    try {
      const payload = {
        factory_id: factoryId,
        ten: forestPlotForm.ten.trim().toUpperCase(),
        ma_lo_full: forestPlotForm.ma_lo_full.trim() || null,
        nong_truong: forestPlotForm.nong_truong.trim() || null,
        doi: forestPlotForm.doi ? (parseInt(forestPlotForm.doi) || null) : null,
        giong: forestPlotForm.giong.trim() || null,
        dien_tich_ha: forestPlotForm.dien_tich_ha ? (parseFloat(forestPlotForm.dien_tich_ha) || null) : null,
        nam_trong: forestPlotForm.nam_trong ? (parseInt(forestPlotForm.nam_trong) || null) : null,
        nam_cao_up: forestPlotForm.nam_cao_up ? (parseInt(forestPlotForm.nam_cao_up) || null) : null,
        geometry: forestPlotGeometry || null,
        is_active: forestPlotForm.is_active,
      }
      const { error } = configEditId
        ? await supabase.from("forest_plots").update(payload).eq("id", configEditId)
        : await supabase.from("forest_plots").insert(payload)
      if (error) { setConfigError(error.message); return }
      setConfigModal(null)
      void loadConfigData(factoryId)
    } finally {
      setConfigSaving(false)
    }
  }

  const handleImportForestPlotGeoJSON = async (file: File) => {
    if (!factoryId) return
    setForestPlotGeoImporting(true)
    setConfigError("")
    try {
      const geojson = JSON.parse(await file.text())
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const features: any[] = geojson?.features ?? []
      if (!features.length) { setConfigError("File GeoJSON không có features"); return }
      const seen = new Set<string>()
      const rows = features.flatMap((f: any) => {
        const p = f?.properties || {}
        const ten = String(p.Ten || "").trim()
        if (!ten || seen.has(ten)) return []
        seen.add(ten)
        return [{
          factory_id: factoryId,
          ten,
          ma_lo_full: p.Ma_lo_2026 ? String(p.Ma_lo_2026).trim() : null,
          nong_truong: p.Nong_truong ? String(p.Nong_truong).trim() : null,
          doi: p.Doi_2026 != null ? (parseInt(p.Doi_2026) || null) : null,
          giong: p.Giong ? String(p.Giong).trim() : null,
          dien_tich_ha: p.Dtich2026_ha != null ? (parseFloat(p.Dtich2026_ha) || null) : null,
          nam_trong: p.Nam_trong != null ? (parseInt(p.Nam_trong) || null) : null,
          nam_cao_up: p.Nam_cao_up != null ? (parseInt(p.Nam_cao_up) || null) : null,
          geometry: f.geometry || null,
          is_active: true,
        }]
      })
      let errBatches = 0
      for (let i = 0; i < rows.length; i += 50) {
        const { error } = await supabase
          .from("forest_plots")
          .upsert(rows.slice(i, i + 50), { onConflict: "factory_id,ten" })
        if (error) errBatches++
      }
      void loadConfigData(factoryId)
      setImportResult({ success: rows.length - errBatches * 50, errors: errBatches > 0 ? [`${errBatches} batch lỗi khi upsert`] : [] })
    } catch (e: unknown) {
      setConfigError("Không đọc được file: " + (e instanceof Error ? e.message : String(e)))
    } finally {
      setForestPlotGeoImporting(false)
      if (forestPlotGeoImportRef.current) forestPlotGeoImportRef.current.value = ""
    }
  }

  const deleteConfigItem = async () => {
    if (!configDelConfirm || !factoryId) return
    setConfigSaving(true)
    try {
      const table =
        configDelConfirm.type === "warehouse"
          ? "inventory_warehouses"
          : configDelConfirm.type === "category"
            ? "inventory_item_categories"
            : configDelConfirm.type === "item"
              ? "inventory_items"
              : configDelConfirm.type === "delivery-point"
                ? "dispatch_delivery_points"
                : configDelConfirm.type === "driver"
                  ? "dispatch_drivers"
                  : configDelConfirm.type === "forest-plot"
                    ? "forest_plots"
                    : "dispatch_vehicles"
      await supabase.from(table).delete().eq("id", configDelConfirm.id).eq("factory_id", factoryId)
      setConfigDelConfirm(null)
      void loadConfigData(factoryId)
    } finally {
      setConfigSaving(false)
    }
  }

  const handleImportFile = async (file: File) => {
    if (!factoryId) return
    setImporting(true)
    setImportResult(null)
    const errors: string[] = []
    let success = 0
    try {
      const text = await file.text()
      const lines = text
        .replace(/^﻿/, "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"))
      if (lines.length < 2) {
        setImportResult({ success: 0, errors: ["File không có dữ liệu (cần ít nhất 1 dòng header + 1 dòng dữ liệu)"] })
        return
      }
      const dataLines = lines.slice(1)
      for (let i = 0; i < dataLines.length; i++) {
        const row = parseCSVLine(dataLines[i])
        const rowNum = i + 2
        if (configTab === "warehouses") {
          const [code, name, keeper_name, warehouse_type, is_active_str] = row
          if (!code || !name) { errors.push(`Dòng ${rowNum}: mã kho và tên kho là bắt buộc`); continue }
          const { error } = await supabase.from("inventory_warehouses").upsert(
            { factory_id: factoryId, code: code.toUpperCase(), name, keeper_name: keeper_name || null, warehouse_type: warehouse_type || null, is_active: is_active_str?.toLowerCase() !== "false" },
            { onConflict: "factory_id,code" },
          )
          if (error) { errors.push(`Dòng ${rowNum} (${code}): ${error.message}`); continue }
          success++
        } else if (configTab === "categories") {
          const [code, name, sort_order_str, is_active_str] = row
          if (!code || !name) { errors.push(`Dòng ${rowNum}: mã nhóm và tên nhóm là bắt buộc`); continue }
          const { error } = await supabase.from("inventory_item_categories").upsert(
            { factory_id: factoryId, code: code.toUpperCase(), name, sort_order: Number(sort_order_str) || 0, is_active: is_active_str?.toLowerCase() !== "false" },
            { onConflict: "factory_id,code" },
          )
          if (error) { errors.push(`Dòng ${rowNum} (${code}): ${error.message}`); continue }
          success++
        } else if (configTab === "items") {
          const [cat_code, code, name, unit, specification, wh_codes_str, manages_lot_str, manages_expiry_str, min_stock_str, max_stock_str] = row
          if (!cat_code || !code || !name || !unit || !wh_codes_str) { errors.push(`Dòng ${rowNum}: thiếu trường bắt buộc (mã nhóm, mã vật tư, tên, đơn vị, mã kho)`); continue }
          const cat = invCategories.find((c) => c.code === cat_code.trim().toUpperCase())
          if (!cat) { errors.push(`Dòng ${rowNum} (${code}): không tìm thấy nhóm "${cat_code}" — hãy nhập Nhóm vật tư trước`); continue }
          const whCodes = wh_codes_str.split(";").map((w) => w.trim().toUpperCase())
          const whs = whCodes.map((wc) => invWarehouses.find((w) => w.code === wc)).filter(Boolean) as InvWarehouseRow[]
          if (whs.length === 0) { errors.push(`Dòng ${rowNum} (${code}): không tìm thấy kho "${wh_codes_str}" — hãy nhập Kho trước`); continue }
          const { data: itemData, error: itemErr } = await supabase
            .from("inventory_items")
            .upsert(
              { factory_id: factoryId, category_id: cat.id, code: code.toUpperCase(), name, unit, specification: specification || null, default_warehouse_ids: whs.map((w) => w.id), manages_lot: manages_lot_str?.toLowerCase() === "true", manages_expiry: manages_expiry_str?.toLowerCase() === "true", min_stock: Number(min_stock_str) || 0, max_stock: Number(max_stock_str) || 0, is_active: true },
              { onConflict: "factory_id,code" },
            )
            .select("id")
            .single()
          if (itemErr || !itemData?.id) { errors.push(`Dòng ${rowNum} (${code}): ${itemErr?.message || "lỗi lưu vật tư"}`); continue }
          await supabase.from("inventory_item_warehouse_rules").delete().eq("item_id", itemData.id).eq("factory_id", factoryId)
          const rulesPayload = whs.map((w, idx) => ({ factory_id: factoryId, item_id: itemData.id, warehouse_id: w.id, min_stock: Number(min_stock_str) || 0, max_stock: Number(max_stock_str) || 0, reorder_point: Number(min_stock_str) || 0, safety_stock: Number(min_stock_str) || 0, is_primary: idx === 0 }))
          const { error: rErr } = await supabase.from("inventory_item_warehouse_rules").insert(rulesPayload)
          if (rErr) { errors.push(`Dòng ${rowNum} (${code}): lỗi kho — ${rErr.message}`); continue }
          success++
        }
      }
      setImportResult({ success, errors })
      if (success > 0) void loadConfigData(factoryId)
    } catch (err) {
      setImportResult({ success: 0, errors: [err instanceof Error ? err.message : "Lỗi không xác định"] })
    } finally {
      setImporting(false)
    }
  }

  const bootstrap = useCallback(async () => {
    const fid = await getActiveFactoryId()
    if (!fid) {
      setLoading(false)
      return
    }

    const { user: sessionUser } = await hydrateActiveSession()
    if (!sessionUser) {
      setLoading(false)
      return
    }

    setFactoryId(fid)
    setUser(sessionUser)

    await Promise.all([
      loadSuffixes(fid),
      loadProfiles(fid),
      loadPermissions(),
      supabase
        .from("factories")
        .select("id, name, full_name_en, address_en, contact_person, contact_email, website, country_en")
        .order("name")
        .then(({ data }) => {
          const rows = data || []
          setFactories(rows.map((item) => ({ id: item.id, name: item.name })))
          const ownFactory = rows.find((item) => item.id === fid)
          if (ownFactory) {
            setFactoryInfo({
              full_name_en: ownFactory.full_name_en || "",
              address_en: ownFactory.address_en || "",
              contact_person: ownFactory.contact_person || "",
              contact_email: ownFactory.contact_email || "",
              website: ownFactory.website || "",
              country_en: ownFactory.country_en || "",
            })
          }
        }),
    ])

    setLoading(false)
  }, [loadPermissions, loadProfiles, loadSuffixes])

  useEffect(() => {
    bootstrap()
  }, [bootstrap])

  useEffect(() => {
    if (tab === "factory-config" && factoryId && !configLoaded && !configLoading) {
      void loadConfigData(factoryId)
    }
  }, [tab, factoryId, configLoaded, configLoading, loadConfigData])

  useEffect(() => {
    if (tab === "maintenance" && factoryId && !maintLoaded && !maintLoading) {
      void loadMaintenanceData(factoryId)
    }
  }, [tab, factoryId, maintLoaded, maintLoading, loadMaintenanceData])

  useEffect(() => {
    if (tab === "master-data" && masterDataTab === "customers" && factoryId && !customerLoaded && !customerLoading) {
      void loadCustomers(factoryId)
    }
  }, [tab, masterDataTab, factoryId, customerLoaded, customerLoading, loadCustomers])

  const selectedVehicleAssignmentHistory = useMemo(() => {
    if (!assignmentHistoryVehicleId) return []
    const driverNameMap = new Map(dispatchDrivers.map((row) => [row.id, row.name]))
    return dispatchVehicleAssignments
      .filter((row) => row.vehicle_id === assignmentHistoryVehicleId)
      .map((row) => ({
        ...row,
        driver_name: driverNameMap.get(row.driver_id) || row.driver_id,
      }))
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from))
  }, [assignmentHistoryVehicleId, dispatchDrivers, dispatchVehicleAssignments])

  const driverAssignedVehiclesMap = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const vehicle of dispatchVehicles) {
      if (!vehicle.current_driver_id) continue
      const items = map.get(vehicle.current_driver_id) || []
      items.push(vehicle.code)
      map.set(vehicle.current_driver_id, items)
    }
    return map
  }, [dispatchVehicles])

  const groupedPermissions = useMemo(() => {
    return permissionOptions.reduce<Record<string, PermissionOption[]>>((acc, item) => {
      acc[item.module_name] = acc[item.module_name] || []
      acc[item.module_name].push(item)
      return acc
    }, {})
  }, [permissionOptions])

  const handleSaveFactory = async () => {
    if (!factoryId || !canManageSettings) return
    setSavingFactory(true)
    setFactoryMsg(null)
    const { error: err } = await supabase.from("factories").update(factoryInfo).eq("id", factoryId)
    setSavingFactory(false)
    setFactoryMsg(err ? { ok: false, text: err.message } : { ok: true, text: "Đã lưu thông tin công ty" })
    setTimeout(() => setFactoryMsg(null), 3000)
  }

  const openAdd = () => {
    setForm(emptyForm())
    setEditCode(null)
    setError("")
    setModal("add")
  }

  const openEdit = (s: Suffix) => {
    setForm({ code: s.code, name: s.name, nguon: s.nguon, chung_nhan: s.chung_nhan })
    setEditCode(s.code)
    setError("")
    setModal("edit")
  }

  const handleSave = async () => {
    if (!factoryId) return
    setError("")

    if (!form.code.trim()) {
      setError("Mã hậu tố không được để trống")
      return
    }
    if (!form.name.trim()) {
      setError("Tên không được để trống")
      return
    }
    if (!/^[a-z0-9]+$/.test(form.code.trim())) {
      setError("Mã hậu tố chỉ được dùng chữ thường và số")
      return
    }

    setSaving(true)
    try {
      if (modal === "add") {
        const { error: err } = await supabase.from("suffixes").insert({
          ...form,
          code: form.code.trim().toLowerCase(),
          factory_id: factoryId,
        })
        if (err) {
          setError(err.message)
          return
        }
      } else if (modal === "edit" && editCode) {
        const { error: err } = await supabase
          .from("suffixes")
          .update({ name: form.name, nguon: form.nguon, chung_nhan: form.chung_nhan })
          .eq("code", editCode)
          .eq("factory_id", factoryId)
        if (err) {
          setError(err.message)
          return
        }
      }
      setModal(null)
      await loadSuffixes(factoryId)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (code: string) => {
    if (!factoryId) return
    await supabase.from("suffixes").delete().eq("code", code).eq("factory_id", factoryId)
    setDelConfirm(null)
    await loadSuffixes(factoryId)
  }

  const loadUserPermissionCodes = async (userId: string) => {
    const { data } = await supabase
      .from("user_permissions")
      .select("permissions(code)")
      .eq("user_id", userId)
      .eq("granted", true)

    return (data || [])
      .map((row) => {
        const permission = Array.isArray(row.permissions) ? row.permissions[0] : row.permissions
        return permission?.code || ""
      })
      .filter(Boolean)
  }

  const openApproveModal = async (profile: ProfileRow) => {
    const selected = await loadUserPermissionCodes(profile.id)
    const fallback = selected.length ? selected : ROLE_DEFAULTS[profile.role] || []

    setUserError("")
    setUserEditor({
      userId: profile.id,
      username: profile.username,
      fullName: profile.full_name,
      factoryId: profile.factory_id || factoryId || "",
      role: profile.role,
      permissions: fallback,
      mode: "approve",
    })
  }

  const openEditUserModal = async (profile: ProfileRow) => {
    const selected = await loadUserPermissionCodes(profile.id)

    setUserError("")
    setUserEditor({
      userId: profile.id,
      username: profile.username,
      fullName: profile.full_name,
      factoryId: profile.factory_id || factoryId || "",
      role: profile.role,
      permissions: selected.length ? selected : ROLE_DEFAULTS[profile.role] || [],
      mode: "edit",
    })
  }

  const togglePermission = (code: string) => {
    if (!userEditor) return
    const exists = userEditor.permissions.includes(code)
    setUserEditor({
      ...userEditor,
      permissions: exists
        ? userEditor.permissions.filter((item) => item !== code)
        : [...userEditor.permissions, code].sort(),
    })
  }

  const handleRoleChange = (role: AppRole) => {
    if (!userEditor) return
    setUserEditor({
      ...userEditor,
      role,
      permissions: ROLE_DEFAULTS[role] || [],
    })
  }

  const saveUserApproval = async () => {
    if (!userEditor || !user) return
    if (!userEditor.factoryId) {
      setUserError("Vui lòng chọn nhà máy")
      return
    }
    if (userEditor.permissions.length === 0) {
      setUserError("Vui lòng chọn ít nhất 1 quyền")
      return
    }

    setSavingUser(true)
    setUserError("")

    try {
      const profilePatch =
        userEditor.mode === "approve"
          ? {
              factory_id: userEditor.factoryId,
              role: userEditor.role,
              status: "active",
              approved_by: user.id,
              approved_at: new Date().toISOString(),
              disabled_by: null,
              disabled_at: null,
            }
          : {
              factory_id: userEditor.factoryId,
              role: userEditor.role,
            }

      const { error: profileError } = await supabase
        .from("profiles")
        .update(profilePatch)
        .eq("id", userEditor.userId)

      if (profileError) {
        setUserError(profileError.message)
        return
      }

      const { error: deleteError } = await supabase
        .from("user_permissions")
        .delete()
        .eq("user_id", userEditor.userId)

      if (deleteError) {
        setUserError(deleteError.message)
        return
      }

      const rows = userEditor.permissions.map((code) => ({
        user_id: userEditor.userId,
        permission_code: code,
        granted: true,
        granted_by: user.id,
        granted_at: new Date().toISOString(),
      }))

      const { error: permissionError } = await supabase.from("user_permissions").insert(rows)
      if (permissionError) {
        setUserError(permissionError.message)
        return
      }

      setUserEditor(null)
      if (factoryId) await loadProfiles(factoryId)
    } finally {
      setSavingUser(false)
    }
  }

  const disableUser = async (profile: ProfileRow) => {
    if (!user || !canApproveUsers) return
    const { error } = await supabase
      .from("profiles")
      .update({
        status: "disabled",
        disabled_by: user.id,
        disabled_at: new Date().toISOString(),
      })
      .eq("id", profile.id)

    if (!error && factoryId) await loadProfiles(factoryId)
  }

  const saveCustomer = async () => {
    if (!factoryId) return
    if (!customerForm.ten_kh_en.trim()) { setCustomerError("Tên khách hàng không được để trống"); return }
    setCustomerSaving(true); setCustomerError("")
    try {
      const payload = { factory_id: factoryId, ma_kh: customerForm.ma_kh.trim() || null, ten_kh_en: customerForm.ten_kh_en.trim(), email: customerForm.email.trim() || null, dia_chi: customerForm.dia_chi.trim() || null }
      const result = customerEditId
        ? await supabase.from("customers").update(payload).eq("id", customerEditId).eq("factory_id", factoryId)
        : await supabase.from("customers").insert(payload)
      if (result.error) { setCustomerError(result.error.message); return }
      setCustomerModal(null); setCustomerEditId(null)
      void loadCustomers(factoryId)
    } catch (e) { setCustomerError(e instanceof Error ? e.message : "Lỗi") } finally { setCustomerSaving(false) }
  }

  const deleteCustomer = async () => {
    if (!factoryId || !customerDelConfirm) return
    await supabase.from("customers").delete().eq("id", customerDelConfirm.id).eq("factory_id", factoryId)
    setCustomerDelConfirm(null)
    void loadCustomers(factoryId)
  }

  const pendingUsers = profiles.filter((item) => item.status === "pending")
  const activeUsers = profiles.filter((item) => item.status === "active")
  const disabledUsers = profiles.filter((item) => item.status === "disabled")

  const tabs = [
    { key: "system" as const, label: "Hệ thống", icon: ShieldCheck, show: canViewUsers || canEditPermissions },
    { key: "factory-config" as const, label: "Cấu hình nhà máy", icon: SlidersHorizontal, show: canManageSettings },
    { key: "master-data" as const, label: "Danh mục", icon: Database, show: true },
    { key: "maintenance" as const, label: "Bảo trì", icon: Wrench, show: true },
  ].filter((item) => item.show)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Cài đặt</h1>
          <p className="text-sm text-slate-500 mt-0.5">Quản trị cấu hình, người dùng và phân quyền</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-2">
        <div className="flex flex-wrap gap-2">
          {tabs.map((item) => (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              className={
                "flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border transition-all " +
                (tab === item.key
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-white text-slate-600 border-transparent hover:bg-slate-50")
              }
            >
              <item.icon size={15} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      {tab === "system" && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-2">
            <div className="flex gap-2">
              {([
                { key: "users" as const, label: "Người dùng", icon: Users, show: canViewUsers },
                { key: "permissions" as const, label: "Phân quyền", icon: ShieldCheck, show: canEditPermissions },
              ] as const).filter((t) => t.show).map((item) => (
                <button
                  key={item.key}
                  onClick={() => setSystemTab(item.key)}
                  className={
                    "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all " +
                    (systemTab === item.key
                      ? "bg-blue-50 text-blue-700 border border-blue-200"
                      : "text-slate-600 hover:bg-slate-50")
                  }
                >
                  <item.icon size={14} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          {systemTab === "users" && canViewUsers && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
          <div className="bg-gradient-to-r from-blue-50 to-cyan-50 px-6 py-4 border-b border-slate-200 flex items-center gap-2">
            <Users size={16} className="text-blue-600" />
            <span className="font-extrabold text-slate-700">Người dùng và phê duyệt</span>
          </div>

          <div className="p-5 space-y-6">
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Chờ duyệt", value: pendingUsers.length, tone: "amber" },
                { label: "Đang hoạt động", value: activeUsers.length, tone: "emerald" },
                { label: "Đã khóa", value: disabledUsers.length, tone: "red" },
              ].map((item) => (
                <div key={item.label} className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                  <div className="text-xs text-slate-500">{item.label}</div>
                  <div className="text-2xl font-black text-slate-800 mt-1">{item.value}</div>
                </div>
              ))}
            </div>

            <div>
              <div className="flex items-center gap-2 mb-3">
                <UserCheck size={15} className="text-amber-600" />
                <h2 className="font-bold text-slate-800">Tài khoản chờ duyệt</h2>
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {["Username", "Họ tên", "Phòng ban", "Role", "Trạng thái", ""].map((head) => (
                        <th key={head} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">
                          {head}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pendingUsers.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                          Không có tài khoản chờ duyệt
                        </td>
                      </tr>
                    ) : (
                      pendingUsers.map((profile) => (
                        <tr key={profile.id} className="row-hover">
                          <td className="px-4 py-3 font-mono text-slate-700">{profile.username}</td>
                          <td className="px-4 py-3 font-semibold text-slate-800">{profile.full_name}</td>
                          <td className="px-4 py-3 text-slate-500">{profile.department || "—"}</td>
                          <td className="px-4 py-3 text-slate-500">{profile.role}</td>
                          <td className="px-4 py-3">
                            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">
                              Chờ duyệt
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {canApproveUsers && (
                              <button
                                onClick={() => openApproveModal(profile)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg"
                              >
                                <CheckCircle2 size={13} />
                                Duyệt
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck size={15} className="text-emerald-600" />
                <h2 className="font-bold text-slate-800">Tài khoản đang hoạt động</h2>
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {["Username", "Họ tên", "Role", "Trạng thái", "Phê duyệt lúc", ""].map((head) => (
                        <th key={head} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">
                          {head}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {activeUsers.map((profile) => (
                      <tr key={profile.id} className="row-hover">
                        <td className="px-4 py-3 font-mono text-slate-700">{profile.username}</td>
                        <td className="px-4 py-3 font-semibold text-slate-800">{profile.full_name}</td>
                        <td className="px-4 py-3 text-slate-500">{profile.role}</td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">
                            active
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {profile.approved_at ? new Date(profile.approved_at).toLocaleString("vi-VN") : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {canEditPermissions && (
                              <button
                                onClick={() => openEditUserModal(profile)}
                                className="p-1.5 hover:bg-blue-50 text-blue-500 rounded-lg transition-colors"
                              >
                                <Edit2 size={13} />
                              </button>
                            )}
                            {canApproveUsers && (
                              <button
                                onClick={() => disableUser(profile)}
                                className="p-1.5 hover:bg-red-50 text-red-500 rounded-lg transition-colors"
                              >
                                <Lock size={13} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
          )}

          {systemTab === "permissions" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
            <div className="bg-gradient-to-r from-indigo-50 to-sky-50 px-6 py-4 border-b border-slate-200 flex items-center gap-2">
              <ShieldCheck size={16} className="text-indigo-600" />
              <span className="font-extrabold text-slate-700">Phân quyền</span>
            </div>

            <div className="p-5 space-y-5">
              <div className="text-sm text-slate-500">
                Đây là nơi quản trị tập trung quyền theo module và action. Hiện tại quyền được gán trong modal duyệt user, và danh sách permission hệ thống đã được tải sẵn.
              </div>

              <div className="grid grid-cols-2 gap-4">
                {Object.entries(groupedPermissions).map(([moduleName, options]) => (
                  <div key={moduleName} className="border border-slate-200 rounded-xl p-4">
                    <div className="font-bold text-slate-800 mb-3">{moduleName}</div>
                    <div className="flex flex-wrap gap-2">
                      {options.map((option) => (
                        <span
                          key={option.code}
                          className="px-2 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700"
                        >
                          {option.action_name}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          )}
        </div>
      )}

      {tab === "factory-config" && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
            <div className="bg-gradient-to-r from-amber-50 to-orange-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <SlidersHorizontal size={16} className="text-amber-600" />
                <span className="font-extrabold text-slate-700">Cấu hình nhà máy</span>
              </div>
              {canManageSettings && (
                <div className="flex items-center gap-2">
                  {configTab !== "forest-plots" && (
                    <>
                      <button
                        onClick={() => { if (configTab !== "delivery-points") downloadConfigTemplate(configTab) }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold rounded-xl transition-all"
                        title="Tải file mẫu CSV để điền dữ liệu và import"
                      >
                        <Download size={13} /> Tải mẫu
                      </button>
                      <button
                        onClick={() => { if (configTab === "delivery-points") return; setImportResult(null); importFileRef.current?.click() }}
                        disabled={importing || configTab === "delivery-points"}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-xl transition-all disabled:opacity-50"
                      >
                        <Upload size={13} /> {importing ? "Đang nhập..." : "Nhập CSV"}
                      </button>
                    </>
                  )}
                  {configTab === "forest-plots" && (
                    <>
                      <input
                        ref={forestPlotGeoImportRef}
                        type="file"
                        accept=".geojson,.json"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          if (f) void handleImportForestPlotGeoJSON(f)
                        }}
                      />
                      <button
                        onClick={() => { setImportResult(null); forestPlotGeoImportRef.current?.click() }}
                        disabled={forestPlotGeoImporting}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-xl transition-all disabled:opacity-50"
                      >
                        <Upload size={13} /> {forestPlotGeoImporting ? "Đang import..." : "Import GeoJSON"}
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => {
                      setConfigError("")
                      if (configTab === "warehouses") {
                        setConfigEditId(null)
                        setInvWarehouseForm({ code: "", name: "", keeper_name: "", warehouse_type: "", is_active: true })
                        setConfigModal("warehouse")
                      } else if (configTab === "categories") {
                        setConfigEditId(null)
                        setInvCategoryForm({ code: "", name: "", sort_order: String(invCategories.length + 1), is_active: true })
                        setConfigModal("category")
                      } else if (configTab === "items") {
                        setConfigEditId(null)
                        setInvItemForm({ category_id: invCategories[0]?.id || "", code: "", name: "", unit: "", specification: "", selected_warehouse_ids: [], manages_lot: false, manages_expiry: false, min_stock: "0", max_stock: "0", is_active: true })
                        setConfigModal("item")
                      } else if (configTab === "delivery-points") {
                        setConfigEditId(null)
                        setDeliveryPointForm(emptyDeliveryPointForm(String(deliveryPoints.length + 1)))
                        setConfigModal("delivery-point")
                      } else if (configTab === "forest-plots") {
                        setConfigEditId(null)
                        setForestPlotForm(emptyForestPlotForm())
                        setForestPlotGeometry(null)
                        setConfigModal("forest-plot")
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
                  >
                    <Plus size={13} /> Thêm mới
                  </button>
                </div>
              )}
            </div>

            <div className="p-4">
              <div className="flex gap-2 mb-4">
                {[
                  { key: "warehouses" as const, label: "Kho" },
                  { key: "categories" as const, label: "Nhóm vật tư" },
                  { key: "items" as const, label: "Vật tư / Hóa chất" },
                  { key: "delivery-points" as const, label: "Điểm giao nhận" },
                  { key: "forest-plots" as const, label: "Lô vườn" },
                ].map((item) => (
                  <button
                    key={item.key}
                    onClick={() => { setConfigTab(item.key); setImportResult(null) }}
                    className={"px-4 py-2 rounded-xl text-sm font-bold transition-all " + (configTab === item.key ? "bg-amber-100 text-amber-700 border border-amber-200" : "text-slate-500 hover:bg-slate-50")}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {configTab !== "delivery-points" && (
                <input
                  ref={importFileRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void handleImportFile(file)
                    e.target.value = ""
                  }}
                />
              )}

              {importResult && (
                <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${importResult.errors.length === 0 ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-700">
                      {importResult.success > 0 ? `✅ Đã nhập ${importResult.success} dòng thành công` : "⚠️ Không có dòng nào được nhập"}
                      {importResult.errors.length > 0 && `, ${importResult.errors.length} lỗi`}
                    </span>
                    <button onClick={() => setImportResult(null)} className="p-1 hover:bg-slate-100 rounded-lg">
                      <X size={14} />
                    </button>
                  </div>
                  {importResult.errors.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs text-red-600 max-h-40 overflow-y-auto">
                      {importResult.errors.map((e, i) => <li key={i}>• {e}</li>)}
                    </ul>
                  )}
                </div>
              )}

              {configLoading ? (
                <div className="p-8 text-center text-slate-400 text-sm">Đang tải...</div>
              ) : configTab === "warehouses" ? (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {["Mã kho", "Tên kho", "Thủ kho", "Loại kho", "Trạng thái", ""].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {invWarehouses.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Chưa có kho nào</td></tr>
                    ) : invWarehouses.map((row) => (
                      <tr key={row.id} className="row-hover">
                        <td className="px-4 py-3 font-mono font-bold text-emerald-700">{row.code}</td>
                        <td className="px-4 py-3 font-semibold text-slate-800">{row.name}</td>
                        <td className="px-4 py-3 text-slate-500">{row.keeper_name || "—"}</td>
                        <td className="px-4 py-3 text-slate-500">{row.warehouse_type || "—"}</td>
                        <td className="px-4 py-3">
                          <span className={"px-2 py-0.5 rounded-full text-xs font-bold " + (row.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")}>
                            {row.is_active ? "Đang dùng" : "Tạm dừng"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {canManageSettings && (
                            <div className="flex items-center gap-1">
                              <button onClick={() => { setConfigError(""); setConfigEditId(row.id); setInvWarehouseForm({ code: row.code, name: row.name, keeper_name: row.keeper_name || "", warehouse_type: row.warehouse_type || "", is_active: row.is_active }); setConfigModal("warehouse") }} className="p-1.5 hover:bg-blue-50 text-blue-500 rounded-lg transition-colors"><Edit2 size={13} /></button>
                              <button onClick={() => setConfigDelConfirm({ type: "warehouse", id: row.id, label: row.name })} className="p-1.5 hover:bg-red-50 text-red-400 rounded-lg transition-colors"><Trash2 size={13} /></button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : configTab === "categories" ? (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {["Mã", "Tên nhóm", "Thứ tự", "Số vật tư", "Trạng thái", ""].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {invCategories.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Chưa có nhóm nào</td></tr>
                    ) : invCategories.map((row) => (
                      <tr key={row.id} className="row-hover">
                        <td className="px-4 py-3 font-mono font-bold text-amber-700">{row.code}</td>
                        <td className="px-4 py-3 font-semibold text-slate-800">{row.name}</td>
                        <td className="px-4 py-3 text-slate-500">{row.sort_order}</td>
                        <td className="px-4 py-3 text-slate-700 font-bold">{row.itemCount}</td>
                        <td className="px-4 py-3">
                          <span className={"px-2 py-0.5 rounded-full text-xs font-bold " + (row.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")}>
                            {row.is_active ? "Đang dùng" : "Tạm dừng"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {canManageSettings && (
                            <div className="flex items-center gap-1">
                              <button onClick={() => { setConfigError(""); setConfigEditId(row.id); setInvCategoryForm({ code: row.code, name: row.name, sort_order: String(row.sort_order), is_active: row.is_active }); setConfigModal("category") }} className="p-1.5 hover:bg-blue-50 text-blue-500 rounded-lg transition-colors"><Edit2 size={13} /></button>
                              <button onClick={() => setConfigDelConfirm({ type: "category", id: row.id, label: row.name })} className="p-1.5 hover:bg-red-50 text-red-400 rounded-lg transition-colors"><Trash2 size={13} /></button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : configTab === "items" ? (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {["Mã", "Tên vật tư", "Nhóm", "Kho chứa", "Lô/Hạn", "Min-Max", ""].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {invItems.length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Chưa có vật tư nào</td></tr>
                    ) : invItems.map((row) => (
                      <tr key={row.id} className="row-hover">
                        <td className="px-4 py-3 font-mono font-bold text-emerald-700">{row.code}</td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-800">{row.name}</div>
                          <div className="text-xs text-slate-400">{row.unit}{row.specification ? ` · ${row.specification}` : ""}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-500">{row.categoryName}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {row.warehouseCodes.map((w) => <span key={w} className="px-1.5 py-0.5 bg-slate-100 rounded-full text-xs font-bold text-slate-600">{w}</span>)}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            {row.manages_lot && <span className="px-1.5 py-0.5 bg-blue-100 rounded-full text-xs font-bold text-blue-700">Lô</span>}
                            {row.manages_expiry && <span className="px-1.5 py-0.5 bg-violet-100 rounded-full text-xs font-bold text-violet-700">Hạn</span>}
                            {!row.manages_lot && !row.manages_expiry && <span className="px-1.5 py-0.5 bg-slate-100 rounded-full text-xs font-bold text-slate-500">Thường</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-600 text-xs">{row.min_stock.toLocaleString("vi-VN")} – {row.max_stock.toLocaleString("vi-VN")}</td>
                        <td className="px-4 py-3">
                          {canManageSettings && (
                            <div className="flex items-center gap-1">
                              <button onClick={() => { setConfigError(""); setConfigEditId(row.id); setInvItemForm({ category_id: row.category_id || "", code: row.code, name: row.name, unit: row.unit, specification: row.specification || "", selected_warehouse_ids: row.default_warehouse_ids || [], manages_lot: row.manages_lot, manages_expiry: row.manages_expiry, min_stock: String(row.min_stock), max_stock: String(row.max_stock), is_active: row.is_active }); setConfigModal("item") }} className="p-1.5 hover:bg-blue-50 text-blue-500 rounded-lg transition-colors"><Edit2 size={13} /></button>
                              <button onClick={() => setConfigDelConfirm({ type: "item", id: row.id, label: row.name })} className="p-1.5 hover:bg-red-50 text-red-400 rounded-lg transition-colors"><Trash2 size={13} /></button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : configTab === "delivery-points" ? (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {["Mã điểm", "Đội", "Tọa độ", "Phiên", "Thứ tự", "Trạng thái", ""].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {deliveryPoints.length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Chưa có điểm giao nhận nào</td></tr>
                    ) : deliveryPoints.map((row) => (
                      <tr key={row.id} className="row-hover">
                        <td className="px-4 py-3 font-mono font-bold text-emerald-700">{row.ma_lo}</td>
                        <td className="px-4 py-3 text-slate-700 font-semibold">Đội {row.doi}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">{row.lat}, {row.lng}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          A:{row.phien_a.length} · B:{row.phien_b.length} · C:{row.phien_c.length} · D:{row.phien_d.length}
                        </td>
                        <td className="px-4 py-3 text-slate-500">{row.sort_order}</td>
                        <td className="px-4 py-3">
                          <span className={"px-2 py-0.5 rounded-full text-xs font-bold " + (row.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")}>
                            {row.is_active ? "Đang dùng" : "Tạm dừng"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {canManageSettings && (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => {
                                  setConfigError("")
                                  setConfigEditId(row.id)
                                  setDeliveryPointForm({
                                    ma_lo: row.ma_lo,
                                    doi: String(row.doi),
                                    lat: String(row.lat),
                                    lng: String(row.lng),
                                    phien_a: row.phien_a.join(", "),
                                    phien_b: row.phien_b.join(", "),
                                    phien_c: row.phien_c.join(", "),
                                    phien_d: row.phien_d.join(", "),
                                    sort_order: String(row.sort_order),
                                    is_active: row.is_active,
                                  })
                                  setConfigModal("delivery-point")
                                }}
                                className="p-1.5 hover:bg-blue-50 text-blue-500 rounded-lg transition-colors"
                              >
                                <Edit2 size={13} />
                              </button>
                              <button
                                onClick={() => setConfigDelConfirm({ type: "delivery-point", id: row.id, label: row.ma_lo })}
                                className="p-1.5 hover:bg-red-50 text-red-400 rounded-lg transition-colors"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : configTab === "forest-plots" ? (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {["Mã ngắn", "Mã đầy đủ", "Nông trường", "Đội", "Diện tích (ha)", "Trạng thái", ""].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {forestPlots.length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Chưa có lô vườn nào. Import GeoJSON hoặc thêm mới.</td></tr>
                    ) : forestPlots.map((row) => (
                      <tr key={row.id} className="row-hover">
                        <td className="px-4 py-3 font-mono font-bold text-emerald-700">{row.ten}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">{row.ma_lo_full || "—"}</td>
                        <td className="px-4 py-3 text-slate-700">{row.nong_truong || "—"}</td>
                        <td className="px-4 py-3 text-slate-700">{row.doi != null ? `Đội ${row.doi}` : "—"}</td>
                        <td className="px-4 py-3 text-slate-700">{row.dien_tich_ha != null ? row.dien_tich_ha.toFixed(2) : "—"}</td>
                        <td className="px-4 py-3">
                          <span className={"px-2 py-0.5 rounded-full text-xs font-bold " + (row.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")}>
                            {row.is_active ? "Đang dùng" : "Tạm dừng"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {canManageSettings && (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={async () => {
                                  setConfigError("")
                                  setConfigEditId(row.id)
                                  setForestPlotForm({
                                    ten: row.ten,
                                    ma_lo_full: row.ma_lo_full || "",
                                    nong_truong: row.nong_truong || "",
                                    doi: row.doi != null ? String(row.doi) : "",
                                    giong: row.giong || "",
                                    dien_tich_ha: row.dien_tich_ha != null ? String(row.dien_tich_ha) : "",
                                    nam_trong: row.nam_trong != null ? String(row.nam_trong) : "",
                                    nam_cao_up: row.nam_cao_up != null ? String(row.nam_cao_up) : "",
                                    is_active: row.is_active,
                                  })
                                  // Load geometry riêng để tránh nặng khi hiển thị list
                                  const { data } = await supabase
                                    .from("forest_plots").select("geometry").eq("id", row.id).single()
                                  setForestPlotGeometry(data?.geometry ?? null)
                                  setConfigModal("forest-plot")
                                }}
                                className="p-1.5 hover:bg-blue-50 text-blue-500 rounded-lg transition-colors"
                              >
                                <Edit2 size={13} />
                              </button>
                              <button
                                onClick={() => setConfigDelConfirm({ type: "forest-plot", id: row.id, label: row.ten })}
                                className="p-1.5 hover:bg-red-50 text-red-400 rounded-lg transition-colors"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
            Ghi nhớ: người dùng vận hành kho sẽ thao tác trong module <span className="font-bold">Quản lý kho</span>, còn thay đổi danh mục và định mức phải đi qua <span className="font-bold">Cài đặt / Cấu hình nhà máy</span>.
          </div>
        </div>
      )}

      {tab === "master-data" && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-2">
            <div className="flex gap-2">
              {[
                { key: "suffixes" as const, label: "Hậu tố lô", icon: Tag },
                { key: "company" as const, label: "Thông tin công ty", icon: Building2 },
                { key: "customers" as const, label: "Khách hàng", icon: ShoppingBag },
              ].map((item) => (
                <button
                  key={item.key}
                  onClick={() => setMasterDataTab(item.key)}
                  className={
                    "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all " +
                    (masterDataTab === item.key
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : "text-slate-600 hover:bg-slate-50")
                  }
                >
                  <item.icon size={14} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          {masterDataTab === "suffixes" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
            <div className="bg-gradient-to-r from-emerald-50 to-teal-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Tag size={16} className="text-emerald-600" />
                <span className="font-extrabold text-slate-700">Hậu tố lô</span>
                <span className="text-xs text-slate-500 ml-1">({suffixes.length} hậu tố)</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400 hidden md:block">Ký tự hậu tố dùng trong mã lô (VD: 01cs/26) và phân loại lô sản phẩm</span>
                {canManageSettings && (
                  <button
                    onClick={openAdd}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
                  >
                    <Plus size={13} /> Thêm hậu tố
                  </button>
                )}
              </div>
            </div>

            <div className="p-4">
              {loading ? (
                <div className="p-8 text-center text-slate-400 text-sm">Đang tải...</div>
              ) : suffixes.length === 0 ? (
                <div className="p-8 text-center text-slate-400">
                  <Tag size={32} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Chưa có hậu tố nào</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {["Mã", "Tên", "Nguồn gốc", "Chứng nhận", "Ví dụ mã lô", ""].map((head) => (
                        <th key={head} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">
                          {head}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {suffixes.map((item) => (
                      <tr key={item.code} className="row-hover">
                        <td className="px-4 py-3">
                          <span className="font-bold text-emerald-700 font-mono">{item.code}</span>
                          {SYSTEM_CODES.includes(item.code) && (
                            <span className="ml-2 px-1.5 py-0.5 bg-blue-100 text-blue-600 text-[10px] font-bold rounded-full">
                              Hệ thống
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-700 font-medium">{item.name}</td>
                        <td className="px-4 py-3 text-slate-500">{item.nguon || "—"}</td>
                        <td className="px-4 py-3 text-slate-500">{item.chung_nhan || "—"}</td>
                        <td className="px-4 py-3 text-slate-400 font-mono text-xs">{`01${item.code}/26`}</td>
                        <td className="px-4 py-3">
                          {canManageSettings && (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => openEdit(item)}
                                className="p-1.5 hover:bg-blue-50 text-blue-500 rounded-lg transition-colors"
                              >
                                <Edit2 size={13} />
                              </button>
                              <button
                                onClick={() => setDelConfirm(item.code)}
                                className="p-1.5 hover:bg-red-50 text-red-400 rounded-lg transition-colors"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          )}

          {masterDataTab === "company" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
            <div className="bg-gradient-to-r from-violet-50 to-purple-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 size={16} className="text-violet-600" />
                <span className="font-extrabold text-slate-700">Thông tin công ty (EUDR Seller)</span>
              </div>
              {canManageSettings && (
                <button
                  onClick={handleSaveFactory}
                  disabled={savingFactory}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all disabled:opacity-50"
                >
                  <Save size={13} /> {savingFactory ? "Đang lưu..." : "Lưu thông tin"}
                </button>
              )}
            </div>

            <div className="p-5">
              {factoryMsg && (
                <div
                  className={`mb-4 px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 ${
                    factoryMsg.ok
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : "bg-red-50 text-red-600 border border-red-200"
                  }`}
                >
                  {factoryMsg.ok ? <Save size={14} /> : <AlertTriangle size={14} />} {factoryMsg.text}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: "Tên công ty (tiếng Anh)", field: "full_name_en", colSpan: true },
                  { label: "Địa chỉ", field: "address_en", colSpan: true },
                  { label: "Người liên hệ", field: "contact_person", colSpan: false },
                  { label: "Email", field: "contact_email", colSpan: false },
                  { label: "Website", field: "website", colSpan: false },
                  { label: "Quốc gia", field: "country_en", colSpan: false },
                ].map(({ label, field, colSpan }) => (
                  <div key={field} className={colSpan ? "col-span-2" : ""}>
                    <label className="text-xs font-bold text-slate-600 block mb-1.5">{label}</label>
                    <input
                      value={factoryInfo[field as keyof FactoryInfo]}
                      onChange={(e) => setFactoryInfo((prev) => ({ ...prev, [field]: e.target.value }))}
                      disabled={!canManageSettings}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50 disabled:text-slate-400"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
          )}

          {masterDataTab === "customers" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
            <div className="bg-gradient-to-r from-blue-50 to-cyan-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingBag size={16} className="text-blue-600" />
                <span className="font-extrabold text-slate-700">Khách hàng</span>
                <span className="text-xs text-slate-400 ml-1">({customers.length} khách hàng)</span>
              </div>
              {canManageSettings && (
                <button
                  onClick={() => {
                    setCustomerEditId(null)
                    setCustomerForm({ ma_kh: "", ten_kh_en: "", email: "", dia_chi: "" })
                    setCustomerError("")
                    setCustomerModal("add")
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
                >
                  <Plus size={13} /> Thêm khách hàng
                </button>
              )}
            </div>

            <div className="overflow-hidden">
              {customerLoading ? (
                <div className="p-8 text-center text-slate-400 text-sm">Đang tải...</div>
              ) : customers.length === 0 ? (
                <div className="p-8 text-center text-slate-400">
                  <ShoppingBag size={32} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Chưa có khách hàng nào</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {["Mã KH", "Tên khách hàng", "Email", "Địa chỉ", ""].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {customers.map((c) => (
                      <React.Fragment key={c.id}>
                        <tr
                          className={"row-hover cursor-pointer " + (expandedCustomerId === c.id ? "bg-blue-50" : "")}
                          onClick={() => setExpandedCustomerId(expandedCustomerId === c.id ? null : c.id)}
                        >
                          <td className="px-4 py-3 font-mono font-bold text-blue-700">{c.ma_kh || "—"}</td>
                          <td className="px-4 py-3 font-semibold text-slate-800">{c.ten_kh_en || "—"}</td>
                          <td className="px-4 py-3 text-slate-500">{c.email || "—"}</td>
                          <td className="px-4 py-3 text-slate-500 max-w-xs truncate">{c.dia_chi || "—"}</td>
                          <td className="px-4 py-3">
                            {canManageSettings && (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setCustomerEditId(c.id)
                                    setCustomerForm({ ma_kh: c.ma_kh || "", ten_kh_en: c.ten_kh_en || "", email: c.email || "", dia_chi: c.dia_chi || "" })
                                    setCustomerError("")
                                    setCustomerModal("edit")
                                  }}
                                  className="p-1.5 hover:bg-blue-50 text-blue-500 rounded-lg transition-colors"
                                >
                                  <Edit2 size={13} />
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setCustomerDelConfirm({ id: c.id, label: c.ten_kh_en || c.ma_kh || "khách hàng" }) }}
                                  className="p-1.5 hover:bg-red-50 text-red-400 rounded-lg transition-colors"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                        {expandedCustomerId === c.id && (
                          <tr>
                            <td colSpan={5} className="px-6 py-4 bg-blue-50 border-b border-blue-100">
                              <div className="grid grid-cols-2 gap-4 text-sm">
                                <div><span className="font-bold text-slate-600">Mã KH: </span><span className="text-slate-800">{c.ma_kh || "—"}</span></div>
                                <div><span className="font-bold text-slate-600">Tên: </span><span className="text-slate-800">{c.ten_kh_en || "—"}</span></div>
                                <div><span className="font-bold text-slate-600">Email: </span><span className="text-slate-800">{c.email || "—"}</span></div>
                                <div className="col-span-2"><span className="font-bold text-slate-600">Địa chỉ: </span><span className="text-slate-800">{c.dia_chi || "—"}</span></div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          )}
        </div>
      )}


      {tab === "maintenance" && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
            <div className="bg-gradient-to-r from-orange-50 to-amber-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wrench size={16} className="text-orange-600" />
                <span className="font-extrabold text-slate-700">Bảo trì</span>
              </div>
              {canManageSettings && (
                <button
                  onClick={() => {
                    setMaintEditId(null); setMaintError("")
                    if (maintTab === "assets") { setAssetForm({ ma_tb: "", ten_tb: "", bo_phan: "Mủ tạp", loai: "may_moc", nam_sd: "", bien_so: "", mo_ta: "", trang_thai: "active" }); setMaintModal("asset") }
                    else if (maintTab === "staff") { setStaffForm({ ten: "", chuc_vu: "", email: "", active: true }); setMaintModal("staff") }
                    else if (maintTab === "vehicles") { setConfigEditId(null); setConfigError(""); setDispatchVehicleForm(emptyDispatchVehicleForm(String((dispatchVehicles.length > 0 ? Math.max(...dispatchVehicles.map(v => v.sort_order || 0)) + 1 : 1)))); setConfigModal("vehicle") }
                    else { setExtMatForm({ ten_vat_tu: "", dvt: "", code: "", specification: "", category_id: "", is_active: true }); setMaintModal("ext-mat") }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
                >
                  <Plus size={13} /> Thêm mới
                </button>
              )}
            </div>

            <div className="p-4">
              <div className="flex gap-2 mb-4 flex-wrap">
                {(["assets", "staff", "vehicles", "ext-materials"] as const).map((key) => (
                  <button
                    key={key}
                    onClick={() => setMaintTab(key)}
                    className={"flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-all " + (maintTab === key ? "bg-orange-100 text-orange-700 border border-orange-200" : "text-slate-500 hover:bg-slate-50")}
                  >
                    {key === "assets" ? <><Car size={13} /> Thiết bị</> : key === "staff" ? <><UserCog size={13} /> Nhân sự bảo trì</> : key === "vehicles" ? <><Car size={13} /> Xe &amp; Tài xế</> : <><ShoppingBag size={13} /> Vật tư ngoài</>}
                  </button>
                ))}
              </div>

              {maintLoading ? (
                <div className="p-8 text-center text-slate-400 text-sm">Đang tải...</div>
              ) : maintTab === "assets" ? (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {["Mã TB", "Tên thiết bị", "Bộ phận", "Loại", "Năm SD", "Trạng thái", ""].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {maintAssets.length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Chưa có thiết bị nào</td></tr>
                    ) : maintAssets.map((a) => (
                      <tr key={a.id} className="row-hover">
                        <td className="px-4 py-3 font-mono text-xs font-bold text-slate-700">{a.ma_tb}</td>
                        <td className="px-4 py-3 font-medium text-slate-700">{a.ten_tb}</td>
                        <td className="px-4 py-3 text-slate-500">{a.bo_phan}</td>
                        <td className="px-4 py-3 text-slate-500">{a.loai === "xe" ? "Xe" : "Máy móc"}</td>
                        <td className="px-4 py-3 text-slate-400 text-xs">{a.nam_sd || "—"}</td>
                        <td className="px-4 py-3">
                          <span className={"px-2 py-0.5 rounded-full text-xs font-bold " + (a.trang_thai === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")}>{a.trang_thai === "active" ? "Đang dùng" : "Ngừng"}</span>
                        </td>
                        <td className="px-4 py-3">
                          {canManageSettings && (
                            <div className="flex items-center gap-1">
                              <button onClick={() => { setMaintEditId(a.id); setMaintError(""); setAssetForm({ ma_tb: a.ma_tb, ten_tb: a.ten_tb, bo_phan: a.bo_phan, loai: a.loai, nam_sd: a.nam_sd || "", bien_so: a.bien_so || "", mo_ta: a.mo_ta || "", trang_thai: a.trang_thai }); setMaintModal("asset") }} className="p-1.5 hover:bg-blue-50 text-blue-500 rounded-lg transition-colors"><Edit2 size={13} /></button>
                              <button onClick={() => setMaintDelConfirm({ type: "asset", id: a.id, label: a.ten_tb })} className="p-1.5 hover:bg-red-50 text-red-400 rounded-lg transition-colors"><Trash2 size={13} /></button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : maintTab === "vehicles" ? (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {["Mã xe", "Tên xe", "Loại", "Biển số", "Tài xế chính", "Trạng thái", ""].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dispatchVehicles.length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Chưa có xe nào</td></tr>
                    ) : dispatchVehicles.map((v) => (
                      <tr key={v.id} className="row-hover">
                        <td className="px-4 py-3 font-mono font-bold text-orange-700">{v.code}</td>
                        <td className="px-4 py-3 font-medium text-slate-700">{v.name}</td>
                        <td className="px-4 py-3 text-slate-500 text-xs">{v.vehicle_type || "—"}</td>
                        <td className="px-4 py-3 text-slate-500 text-xs">{v.plate_number || "—"}</td>
                        <td className="px-4 py-3 text-slate-600 text-sm">{v.current_driver_name || <span className="text-slate-300">—</span>}</td>
                        <td className="px-4 py-3">
                          <span className={"px-2 py-0.5 rounded-full text-xs font-bold " + (v.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")}>{v.is_active ? "Hoạt động" : "Ngừng"}</span>
                        </td>
                        <td className="px-4 py-3">
                          {canManageSettings && (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => {
                                  setConfigEditId(v.id); setConfigError("")
                                  const cur = dispatchVehicleAssignments.find(a => a.vehicle_id === v.id && a.is_current)
                                  setDispatchVehicleForm({ code: v.code, name: v.name, vehicle_type: v.vehicle_type || "", plate_number: v.plate_number || "", sort_order: String(v.sort_order ?? 0), is_active: v.is_active, primary_driver_id: cur?.driver_id || "", effective_from: new Date().toISOString().slice(0, 10), note: "" })
                                  setConfigModal("vehicle")
                                }}
                                className="p-1.5 hover:bg-blue-50 text-blue-500 rounded-lg transition-colors"
                              ><Edit2 size={13} /></button>
                              <button
                                onClick={() => setConfigDelConfirm({ type: "vehicle", id: v.id, label: v.name })}
                                className="p-1.5 hover:bg-red-50 text-red-400 rounded-lg transition-colors"
                              ><Trash2 size={13} /></button>
                              <button
                                onClick={() => setAssignmentHistoryVehicleId(assignmentHistoryVehicleId === v.id ? null : v.id)}
                                className="p-1.5 hover:bg-orange-50 text-orange-400 rounded-lg transition-colors text-xs font-bold"
                                title="Lịch sử tài xế"
                              ><UserCog size={13} /></button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : maintTab === "staff" ? (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {["Tên", "Chức vụ", "Trạng thái", ""].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {maintStaff.length === 0 ? (
                      <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">Chưa có nhân sự</td></tr>
                    ) : maintStaff.map((s) => (
                      <tr key={s.id} className="row-hover">
                        <td className="px-4 py-3 font-medium text-slate-700">{s.ten}</td>
                        <td className="px-4 py-3 text-slate-500">{s.chuc_vu || "—"}</td>
                        <td className="px-4 py-3">
                          <span className={"px-2 py-0.5 rounded-full text-xs font-bold " + (s.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")}>{s.active ? "Đang làm" : "Ngừng"}</span>
                        </td>
                        <td className="px-4 py-3">
                          {canManageSettings && (
                            <div className="flex items-center gap-1">
                              <button onClick={() => { setMaintEditId(s.id); setMaintError(""); setStaffForm({ ten: s.ten, chuc_vu: s.chuc_vu || "", email: (s as { email?: string | null }).email || "", active: s.active }); setMaintModal("staff") }} className="p-1.5 hover:bg-blue-50 text-blue-500 rounded-lg transition-colors"><Edit2 size={13} /></button>
                              <button onClick={() => setMaintDelConfirm({ type: "staff", id: s.id, label: s.ten })} className="p-1.5 hover:bg-red-50 text-red-400 rounded-lg transition-colors"><Trash2 size={13} /></button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {["Mã", "Tên vật tư", "Đơn vị tính", "Quy cách", "Trạng thái", ""].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {maintExtMats.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Chưa có vật tư nào</td></tr>
                    ) : maintExtMats.map((m) => (
                      <tr key={m.id} className="row-hover">
                        <td className="px-4 py-3 font-mono text-xs text-slate-500">{m.code || "—"}</td>
                        <td className="px-4 py-3 font-medium text-slate-700">{m.ten_vat_tu}</td>
                        <td className="px-4 py-3 text-slate-500">{m.dvt || "—"}</td>
                        <td className="px-4 py-3 text-slate-500 text-xs">{m.specification || "—"}</td>
                        <td className="px-4 py-3">
                          <span className={"px-2 py-0.5 rounded-full text-xs font-bold " + (m.is_active !== false ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")}>{m.is_active !== false ? "Đang dùng" : "Ngừng"}</span>
                        </td>
                        <td className="px-4 py-3">
                          {canManageSettings && (
                            <div className="flex items-center gap-1">
                              <button onClick={() => { setMaintEditId(m.id); setMaintError(""); setExtMatForm({ ten_vat_tu: m.ten_vat_tu, dvt: m.dvt || "", code: m.code || "", specification: m.specification || "", category_id: m.category_id || "", is_active: m.is_active !== false }); setMaintModal("ext-mat") }} className="p-1.5 hover:bg-blue-50 text-blue-500 rounded-lg transition-colors"><Edit2 size={13} /></button>
                              <button onClick={() => setMaintDelConfirm({ type: "ext-mat", id: m.id, label: m.ten_vat_tu })} className="p-1.5 hover:bg-red-50 text-red-400 rounded-lg transition-colors"><Trash2 size={13} /></button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Maintenance modals */}
      {maintModal === "asset" && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <h2 className="text-lg font-extrabold text-slate-800">{maintEditId ? "Sửa thiết bị" : "Thêm thiết bị mới"}</h2>
              <button onClick={() => setMaintModal(null)} className="p-2 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              {maintError && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex items-center gap-2"><AlertTriangle size={14} />{maintError}</div>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Mã thiết bị *</label>
                  <input value={assetForm.ma_tb} onChange={e => setAssetForm(p => ({ ...p, ma_tb: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 font-mono" placeholder="VD: MCC-1" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Loại *</label>
                  <select value={assetForm.loai} onChange={e => setAssetForm(p => ({ ...p, loai: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                    <option value="may_moc">Máy móc</option>
                    <option value="xe">Xe</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Tên thiết bị *</label>
                <input value={assetForm.ten_tb} onChange={e => setAssetForm(p => ({ ...p, ten_tb: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" placeholder="VD: Máy cán cắt 1" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Bộ phận *</label>
                  <select value={assetForm.bo_phan} onChange={e => setAssetForm(p => ({ ...p, bo_phan: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                    {BO_PHAN_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Năm sử dụng</label>
                  <input value={assetForm.nam_sd} onChange={e => setAssetForm(p => ({ ...p, nam_sd: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" placeholder="VD: 2019" />
                </div>
              </div>
              {assetForm.loai === "xe" && (
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Biển số</label>
                  <input value={assetForm.bien_so} onChange={e => setAssetForm(p => ({ ...p, bien_so: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" placeholder="VD: 12A-12345" />
                </div>
              )}
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Mô tả</label>
                <input value={assetForm.mo_ta} onChange={e => setAssetForm(p => ({ ...p, mo_ta: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Trạng thái</label>
                <select value={assetForm.trang_thai} onChange={e => setAssetForm(p => ({ ...p, trang_thai: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                  <option value="active">Đang dùng</option>
                  <option value="inactive">Ngừng sử dụng</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setMaintModal(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
                <button onClick={saveMaintAsset} disabled={maintSaving} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl disabled:opacity-50">{maintSaving ? "Đang lưu..." : "Lưu"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {maintModal === "staff" && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <h2 className="text-lg font-extrabold text-slate-800">{maintEditId ? "Sửa nhân sự" : "Thêm nhân sự bảo trì"}</h2>
              <button onClick={() => setMaintModal(null)} className="p-2 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              {maintError && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex items-center gap-2"><AlertTriangle size={14} />{maintError}</div>}
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Họ tên *</label>
                <input value={staffForm.ten} onChange={e => setStaffForm(p => ({ ...p, ten: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" placeholder="VD: Nguyễn Văn A" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Chức vụ</label>
                <input value={staffForm.chuc_vu} onChange={e => setStaffForm(p => ({ ...p, chuc_vu: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" placeholder="VD: Nhân viên kỹ thuật" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Email nhận thông báo</label>
                <input type="email" value={staffForm.email} onChange={e => setStaffForm(p => ({ ...p, email: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" placeholder="VD: giamdoc@gmail.com" />
              </div>
              <div className="flex items-center gap-3">
                <input type="checkbox" id="staff-active" checked={staffForm.active} onChange={e => setStaffForm(p => ({ ...p, active: e.target.checked }))} className="w-4 h-4 accent-emerald-600" />
                <label htmlFor="staff-active" className="text-sm font-bold text-slate-600">Đang làm việc</label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setMaintModal(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
                <button onClick={saveMaintStaff} disabled={maintSaving} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl disabled:opacity-50">{maintSaving ? "Đang lưu..." : "Lưu"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {maintModal === "ext-mat" && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <h2 className="text-lg font-extrabold text-slate-800">{maintEditId ? "Sửa vật tư" : "Thêm vật tư ngoài"}</h2>
              <button onClick={() => setMaintModal(null)} className="p-2 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              {maintError && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex items-center gap-2"><AlertTriangle size={14} />{maintError}</div>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Mã vật tư</label>
                  <input value={extMatForm.code} onChange={e => setExtMatForm(p => ({ ...p, code: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 font-mono" placeholder="VD: BD22211" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Đơn vị tính</label>
                  <input value={extMatForm.dvt} onChange={e => setExtMatForm(p => ({ ...p, dvt: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" placeholder="VD: cái, kg" />
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Tên vật tư *</label>
                <input value={extMatForm.ten_vat_tu} onChange={e => setExtMatForm(p => ({ ...p, ten_vat_tu: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" placeholder="VD: Bạc đạn 22211" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Quy cách / Đặc tính</label>
                <input value={extMatForm.specification} onChange={e => setExtMatForm(p => ({ ...p, specification: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" placeholder="VD: 110x50x40, 6204-2RS" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Nhóm vật tư</label>
                <select value={extMatForm.category_id} onChange={e => setExtMatForm(p => ({ ...p, category_id: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                  <option value="">— Không phân nhóm —</option>
                  {invCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="extmat-active" checked={extMatForm.is_active} onChange={e => setExtMatForm(p => ({ ...p, is_active: e.target.checked }))} className="rounded" />
                <label htmlFor="extmat-active" className="text-sm font-bold text-slate-600">Đang sử dụng</label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setMaintModal(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
                <button onClick={saveMaintExtMat} disabled={maintSaving} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl disabled:opacity-50">{maintSaving ? "Đang lưu..." : "Lưu"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {maintDelConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="text-lg font-extrabold text-slate-800 mb-2">Xác nhận xóa</h3>
            <p className="text-sm text-slate-600 mb-6">Xóa <span className="font-bold text-red-600">&quot;{maintDelConfirm.label}&quot;</span>? Thao tác không thể hoàn tác.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setMaintDelConfirm(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
              <button onClick={deleteMaintItem} className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl">Xóa</button>
            </div>
          </div>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <h2 className="text-lg font-extrabold text-slate-800">
                {modal === "add" ? "Thêm hậu tố mới" : `Sửa hậu tố "${editCode}"`}
              </h2>
              <button onClick={() => setModal(null)} className="p-2 hover:bg-slate-100 rounded-xl">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex items-center gap-2">
                  <AlertTriangle size={14} /> {error}
                </div>
              )}

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Mã hậu tố *</label>
                <input
                  value={form.code}
                  onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value.toLowerCase() }))}
                  disabled={modal === "edit"}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 font-mono disabled:bg-slate-50 disabled:text-slate-400"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Tên hậu tố *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Nguồn gốc</label>
                  <input
                    value={form.nguon}
                    onChange={(e) => setForm((prev) => ({ ...prev, nguon: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Chứng nhận</label>
                  <input
                    value={form.chung_nhan}
                    onChange={(e) => setForm((prev) => ({ ...prev, chung_nhan: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 flex justify-end gap-3 rounded-b-2xl">
              <button onClick={() => setModal(null)} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
                Hủy
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all disabled:opacity-50"
              >
                {saving ? "Đang lưu..." : "Lưu"}
              </button>
            </div>
          </div>
        </div>
      )}

      {delConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-red-100 text-red-600 rounded-xl">
                <AlertTriangle size={18} />
              </div>
              <div>
                <h3 className="font-extrabold text-slate-800">Xóa hậu tố &quot;{delConfirm}&quot;?</h3>
                <p className="text-sm text-slate-500 mt-1">Hành động này không thể hoàn tác.</p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setDelConfirm(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
                Hủy
              </button>
              <button onClick={() => handleDelete(delConfirm)} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl">
                Xóa
              </button>
            </div>
          </div>
        </div>
      )}

      {customerModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <h2 className="text-lg font-extrabold text-slate-800">{customerModal === "add" ? "Thêm khách hàng" : "Sửa khách hàng"}</h2>
              <button onClick={() => setCustomerModal(null)} className="p-2 hover:bg-slate-100 rounded-xl"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              {customerError && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex items-center gap-2"><AlertTriangle size={14} />{customerError}</div>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Mã khách hàng</label>
                  <input value={customerForm.ma_kh} onChange={e => setCustomerForm(p => ({ ...p, ma_kh: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 font-mono" placeholder="VD: OLAM" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Email</label>
                  <input value={customerForm.email} onChange={e => setCustomerForm(p => ({ ...p, email: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" placeholder="email@company.com" />
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Tên khách hàng *</label>
                <input value={customerForm.ten_kh_en} onChange={e => setCustomerForm(p => ({ ...p, ten_kh_en: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" placeholder="VD: OLAM International" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Địa chỉ</label>
                <input value={customerForm.dia_chi} onChange={e => setCustomerForm(p => ({ ...p, dia_chi: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" placeholder="Địa chỉ công ty" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setCustomerModal(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
                <button onClick={saveCustomer} disabled={customerSaving} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl disabled:opacity-50">{customerSaving ? "Đang lưu..." : "Lưu"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {customerDelConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="text-lg font-extrabold text-slate-800 mb-2">Xác nhận xóa</h3>
            <p className="text-sm text-slate-600 mb-6">Xóa khách hàng <span className="font-bold text-red-600">&quot;{customerDelConfirm.label}&quot;</span>? Thao tác không thể hoàn tác.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setCustomerDelConfirm(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
              <button onClick={deleteCustomer} className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl">Xóa</button>
            </div>
          </div>
        </div>
      )}

      {userEditor && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <div>
                <h2 className="text-lg font-extrabold text-slate-800">
                  {userEditor.mode === "approve" ? "Duyệt tài khoản" : "Sửa quyền người dùng"}
                </h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  {userEditor.fullName} ({userEditor.username})
                </p>
              </div>
              <button onClick={() => setUserEditor(null)} className="p-2 hover:bg-slate-100 rounded-xl">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {userError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex items-center gap-2">
                  <AlertTriangle size={14} /> {userError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Nhà máy *</label>
                  <select
                    value={userEditor.factoryId}
                    onChange={(e) => setUserEditor({ ...userEditor, factoryId: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                  >
                    {factories.map((factory) => (
                      <option key={factory.id} value={factory.id}>
                        {factory.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Role *</label>
                  <select
                    value={userEditor.role}
                    onChange={(e) => handleRoleChange(e.target.value as AppRole)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                  >
                    {(["admin", "manager", "user", "customer"] as AppRole[]).map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-3">Permissions *</label>
                <div className="grid grid-cols-2 gap-4">
                  {Object.entries(groupedPermissions).map(([moduleName, options]) => (
                    <div key={moduleName} className="border border-slate-200 rounded-xl p-4">
                      <div className="font-bold text-slate-800 mb-3">{moduleName}</div>
                      <div className="space-y-2">
                        {options.map((option) => (
                          <label key={option.code} className="flex items-center gap-2 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              checked={userEditor.permissions.includes(option.code)}
                              onChange={() => togglePermission(option.code)}
                              className="rounded border-slate-300"
                            />
                            <span>{option.action_name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 flex justify-end gap-3 rounded-b-2xl">
              <button onClick={() => setUserEditor(null)} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
                Huy
              </button>
              <button
                onClick={saveUserApproval}
                disabled={savingUser}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all disabled:opacity-50"
              >
                {savingUser ? "Đang lưu..." : userEditor.mode === "approve" ? "Duyệt và kích hoạt" : "Lưu quyền"}
              </button>
            </div>
          </div>
        </div>
      )}

      {configModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className={`bg-white rounded-2xl shadow-2xl w-full ${configModal === "forest-plot" ? "max-w-3xl max-h-[90vh] overflow-y-auto" : "max-w-lg"}`}>
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <h2 className="text-base font-extrabold text-slate-800">
                {configModal === "warehouse"
                  ? (configEditId ? "Sửa kho" : "Thêm kho mới")
                  : configModal === "category"
                    ? (configEditId ? "Sửa nhóm" : "Thêm nhóm vật tư")
                    : configModal === "item"
                      ? (configEditId ? "Sửa vật tư" : "Thêm vật tư")
                      : configModal === "forest-plot"
                        ? (configEditId ? "Sửa lô vườn" : "Thêm lô vườn mới")
                        : (configEditId ? "Sửa điểm giao nhận" : "Thêm điểm giao nhận")}
              </h2>
              <button onClick={() => setConfigModal(null)} className="p-2 hover:bg-slate-100 rounded-xl"><X size={16} /></button>
            </div>

            <div className="p-6 space-y-4">
              {configError && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex items-center gap-2"><AlertTriangle size={14} />{configError}</div>}

              {configModal === "warehouse" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Mã kho *</label>
                      <input value={invWarehouseForm.code} onChange={(e) => setInvWarehouseForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))} disabled={!!configEditId} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50" />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Loại kho</label>
                      <input value={invWarehouseForm.warehouse_type} onChange={(e) => setInvWarehouseForm((p) => ({ ...p, warehouse_type: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-1.5">Tên kho *</label>
                    <input value={invWarehouseForm.name} onChange={(e) => setInvWarehouseForm((p) => ({ ...p, name: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-1.5">Thủ kho</label>
                    <input value={invWarehouseForm.keeper_name} onChange={(e) => setInvWarehouseForm((p) => ({ ...p, keeper_name: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={invWarehouseForm.is_active} onChange={(e) => setInvWarehouseForm((p) => ({ ...p, is_active: e.target.checked }))} /> Đang hoạt động
                  </label>
                </>
              )}

              {configModal === "category" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Mã nhóm *</label>
                      <input value={invCategoryForm.code} onChange={(e) => setInvCategoryForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))} disabled={!!configEditId} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50" />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Thứ tự</label>
                      <input value={invCategoryForm.sort_order} onChange={(e) => setInvCategoryForm((p) => ({ ...p, sort_order: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-1.5">Tên nhóm *</label>
                    <input value={invCategoryForm.name} onChange={(e) => setInvCategoryForm((p) => ({ ...p, name: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={invCategoryForm.is_active} onChange={(e) => setInvCategoryForm((p) => ({ ...p, is_active: e.target.checked }))} /> Đang hoạt động
                  </label>
                </>
              )}

              {configModal === "item" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Mã vật tư *</label>
                      <input value={invItemForm.code} onChange={(e) => setInvItemForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))} disabled={!!configEditId} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50" />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Nhóm vật tư *</label>
                      <select value={invItemForm.category_id} onChange={(e) => setInvItemForm((p) => ({ ...p, category_id: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                        <option value="">Chọn nhóm</option>
                        {invCategories.map((c) => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Tên vật tư *</label>
                      <input value={invItemForm.name} onChange={(e) => setInvItemForm((p) => ({ ...p, name: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Đơn vị *</label>
                      <input value={invItemForm.unit} onChange={(e) => setInvItemForm((p) => ({ ...p, unit: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-1.5">Quy cách</label>
                    <input value={invItemForm.specification} onChange={(e) => setInvItemForm((p) => ({ ...p, specification: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-1.5">Kho chứa *</label>
                    <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      {invWarehouses.map((w) => (
                        <label key={w.id} className="flex items-center gap-2 text-sm text-slate-700">
                          <input type="checkbox" checked={invItemForm.selected_warehouse_ids.includes(w.id)} onChange={(e) => setInvItemForm((p) => ({ ...p, selected_warehouse_ids: e.target.checked ? [...p.selected_warehouse_ids, w.id] : p.selected_warehouse_ids.filter((id) => id !== w.id) }))} />
                          {w.code} - {w.name}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Tồn tối thiểu</label>
                      <input value={invItemForm.min_stock} onChange={(e) => setInvItemForm((p) => ({ ...p, min_stock: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Tồn tối đa</label>
                      <input value={invItemForm.max_stock} onChange={(e) => setInvItemForm((p) => ({ ...p, max_stock: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={invItemForm.manages_lot} onChange={(e) => setInvItemForm((p) => ({ ...p, manages_lot: e.target.checked }))} /> Quản lý lô</label>
                    <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={invItemForm.manages_expiry} onChange={(e) => setInvItemForm((p) => ({ ...p, manages_expiry: e.target.checked }))} /> Quản lý hạn</label>
                    <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={invItemForm.is_active} onChange={(e) => setInvItemForm((p) => ({ ...p, is_active: e.target.checked }))} /> Đang dùng</label>
                  </div>
                </>
              )}
              {configModal === "driver" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                    <label className="text-xs font-bold text-slate-600 block mb-1.5">Mã tài xế</label>
                      <input value={dispatchDriverForm.code} onChange={(e) => setDispatchDriverForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Số điện thoại</label>
                      <input value={dispatchDriverForm.phone} onChange={(e) => setDispatchDriverForm((p) => ({ ...p, phone: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-1.5">Tên tài xế *</label>
                    <input value={dispatchDriverForm.name} onChange={(e) => setDispatchDriverForm((p) => ({ ...p, name: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={dispatchDriverForm.is_active} onChange={(e) => setDispatchDriverForm((p) => ({ ...p, is_active: e.target.checked }))} /> Đang dùng
                  </label>
                </>
              )}
              {configModal === "vehicle" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Mã xe *</label>
                      <input value={dispatchVehicleForm.code} onChange={(e) => setDispatchVehicleForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))} disabled={!!configEditId} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50" />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Thứ tự</label>
                      <input value={dispatchVehicleForm.sort_order} onChange={(e) => setDispatchVehicleForm((p) => ({ ...p, sort_order: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Tên xe *</label>
                      <input value={dispatchVehicleForm.name} onChange={(e) => setDispatchVehicleForm((p) => ({ ...p, name: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Loại xe</label>
                      <input value={dispatchVehicleForm.vehicle_type} onChange={(e) => setDispatchVehicleForm((p) => ({ ...p, vehicle_type: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Biển số</label>
                      <input value={dispatchVehicleForm.plate_number} onChange={(e) => setDispatchVehicleForm((p) => ({ ...p, plate_number: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Tài xế chính *</label>
                      <select value={dispatchVehicleForm.primary_driver_id} onChange={(e) => setDispatchVehicleForm((p) => ({ ...p, primary_driver_id: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                        <option value="">Chọn tài xế</option>
                        {dispatchDrivers.filter((row) => row.is_active || row.id === dispatchVehicleForm.primary_driver_id).map((row) => (
                          <option key={row.id} value={row.id}>{row.code ? `${row.code} - ${row.name}` : row.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Hiệu lực từ *</label>
                      <input type="date" value={dispatchVehicleForm.effective_from} onChange={(e) => setDispatchVehicleForm((p) => ({ ...p, effective_from: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                    <div className="flex items-end">
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input type="checkbox" checked={dispatchVehicleForm.is_active} onChange={(e) => setDispatchVehicleForm((p) => ({ ...p, is_active: e.target.checked }))} /> Đang dùng
                      </label>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-1.5">Ghi chú thay đổi tài xế chính</label>
                    <textarea value={dispatchVehicleForm.note} onChange={(e) => setDispatchVehicleForm((p) => ({ ...p, note: e.target.value }))} rows={3} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 resize-none" />
                  </div>
                </>
              )}
              {configModal === "delivery-point" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Mã điểm *</label>
                      <input value={deliveryPointForm.ma_lo} onChange={(e) => setDeliveryPointForm((p) => ({ ...p, ma_lo: e.target.value.toUpperCase() }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Đội *</label>
                      <input value={deliveryPointForm.doi} onChange={(e) => setDeliveryPointForm((p) => ({ ...p, doi: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Vĩ độ *</label>
                      <input value={deliveryPointForm.lat} onChange={(e) => setDeliveryPointForm((p) => ({ ...p, lat: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Kinh độ *</label>
                      <input value={deliveryPointForm.lng} onChange={(e) => setDeliveryPointForm((p) => ({ ...p, lng: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Phiên A</label>
                      <input value={deliveryPointForm.phien_a} onChange={(e) => setDeliveryPointForm((p) => ({ ...p, phien_a: e.target.value }))} placeholder="A1, A2, B1" className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Phiên B</label>
                      <input value={deliveryPointForm.phien_b} onChange={(e) => setDeliveryPointForm((p) => ({ ...p, phien_b: e.target.value }))} placeholder="A1, B2" className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Phiên C</label>
                      <input value={deliveryPointForm.phien_c} onChange={(e) => setDeliveryPointForm((p) => ({ ...p, phien_c: e.target.value }))} placeholder="C1, D2" className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Phiên D</label>
                      <input value={deliveryPointForm.phien_d} onChange={(e) => setDeliveryPointForm((p) => ({ ...p, phien_d: e.target.value }))} placeholder="D1, E2" className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Thứ tự</label>
                      <input value={deliveryPointForm.sort_order} onChange={(e) => setDeliveryPointForm((p) => ({ ...p, sort_order: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                    <div className="flex items-end">
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input type="checkbox" checked={deliveryPointForm.is_active} onChange={(e) => setDeliveryPointForm((p) => ({ ...p, is_active: e.target.checked }))} /> Đang hoạt động
                      </label>
                    </div>
                  </div>
                </>
              )}

              {configModal === "forest-plot" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Mã ngắn (Ten) *</label>
                      <input
                        value={forestPlotForm.ten}
                        onChange={(e) => setForestPlotForm((p) => ({ ...p, ten: e.target.value.toUpperCase() }))}
                        disabled={!!configEditId}
                        placeholder="VD: J1T"
                        className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Mã đầy đủ</label>
                      <input
                        value={forestPlotForm.ma_lo_full}
                        onChange={(e) => setForestPlotForm((p) => ({ ...p, ma_lo_full: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Nông trường</label>
                      <input
                        value={forestPlotForm.nong_truong}
                        onChange={(e) => setForestPlotForm((p) => ({ ...p, nong_truong: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Đội</label>
                      <input
                        type="number"
                        value={forestPlotForm.doi}
                        onChange={(e) => setForestPlotForm((p) => ({ ...p, doi: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Giống</label>
                      <input
                        value={forestPlotForm.giong}
                        onChange={(e) => setForestPlotForm((p) => ({ ...p, giong: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Diện tích (ha)</label>
                      <input
                        type="number"
                        step="0.0001"
                        value={forestPlotForm.dien_tich_ha}
                        onChange={(e) => setForestPlotForm((p) => ({ ...p, dien_tich_ha: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div className="flex items-end">
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input type="checkbox" checked={forestPlotForm.is_active} onChange={(e) => setForestPlotForm((p) => ({ ...p, is_active: e.target.checked }))} />
                        Đang hoạt động
                      </label>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Năm trồng</label>
                      <input
                        type="number"
                        value={forestPlotForm.nam_trong}
                        onChange={(e) => setForestPlotForm((p) => ({ ...p, nam_trong: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Năm cạo UP</label>
                      <input
                        type="number"
                        value={forestPlotForm.nam_cao_up}
                        onChange={(e) => setForestPlotForm((p) => ({ ...p, nam_cao_up: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-1.5">Vẽ vùng lô vườn trên bản đồ (tùy chọn)</label>
                    <div className="rounded-xl overflow-hidden border border-slate-200">
                      <PolygonDrawMap existingGeometry={forestPlotGeometry} onChange={setForestPlotGeometry} />
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 flex justify-end gap-3 rounded-b-2xl">
              <button onClick={() => setConfigModal(null)} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
              <button
                onClick={
                  configModal === "warehouse"
                    ? saveConfigWarehouse
                    : configModal === "category"
                      ? saveConfigCategory
                      : configModal === "item"
                        ? saveConfigItem
                        : configModal === "driver"
                          ? saveDispatchDriver
                          : configModal === "vehicle"
                            ? saveDispatchVehicle
                            : configModal === "forest-plot"
                              ? saveForestPlot
                              : saveDeliveryPoint
                }
                disabled={configSaving}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md disabled:opacity-50"
              >
                {configSaving ? "Đang lưu..." : "Lưu"}
              </button>
            </div>
          </div>
        </div>
      )}

      {assignmentHistoryVehicleId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <div>
                <h2 className="text-base font-extrabold text-slate-800">Lịch sử tài xế chính</h2>
                <p className="text-sm text-slate-500 mt-1">
                  {dispatchVehicles.find((row) => row.id === assignmentHistoryVehicleId)?.name || ""}
                </p>
              </div>
              <button onClick={() => setAssignmentHistoryVehicleId(null)} className="p-2 hover:bg-slate-100 rounded-xl"><X size={16} /></button>
            </div>
            <div className="p-6">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {["Tài xế", "Hiệu lực từ", "Hiệu lực đến", "Trạng thái", "Ghi chú"].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selectedVehicleAssignmentHistory.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">Chưa có lịch sử thay đổi</td></tr>
                  ) : selectedVehicleAssignmentHistory.map((row) => (
                    <tr key={row.id}>
                      <td className="px-4 py-3 font-semibold text-slate-800">{row.driver_name}</td>
                      <td className="px-4 py-3 text-slate-500">{row.effective_from}</td>
                      <td className="px-4 py-3 text-slate-500">{row.effective_to || "Hiện tại"}</td>
                      <td className="px-4 py-3">
                        <span className={"px-2 py-0.5 rounded-full text-xs font-bold " + (row.is_current ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")}>
                          {row.is_current ? "Đang áp dụng" : "Đã đóng"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{row.note || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {configDelConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-red-100 text-red-600 rounded-xl"><AlertTriangle size={18} /></div>
              <div>
                <h3 className="font-extrabold text-slate-800">Xóa &quot;{configDelConfirm.label}&quot;?</h3>
                <p className="text-sm text-slate-500 mt-1">Hành động này không thể hoàn tác.</p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setConfigDelConfirm(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
              <button onClick={() => void deleteConfigItem()} disabled={configSaving} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl disabled:opacity-50">
                {configSaving ? "Đang xóa..." : "Xóa"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
