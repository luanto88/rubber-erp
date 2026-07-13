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
import { loadRequiredNotes, type RequiredNote } from "@/lib/required-notes"
import { ResponsiveTableWrapper } from "../_components/responsive-table-wrapper"
import { ModalShell } from "../_components/modal-shell"
import { QualityTargetsTab } from "./_components/quality-targets-tab"
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
  FileText,
  KeyRound,
  ImagePlus,
  Eye,
  EyeOff,
  Sun,
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
  ca_a_ten: string
  ca_b_ten: string
  ca_c_ten: string
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

function isMaintenanceProfileLinkConstraintError(message: string) {
  return /uniq_maintenance_staff_profile_id|duplicate key value violates unique constraint/i.test(message)
}

function getMaintenanceProfileLinkConflictMessage(staffName?: string | null) {
  const suffix = staffName?.trim() ? `voi nhan su "${staffName.trim()}"` : "voi mot nhan su khac"
  return `Tai khoan nay da duoc lien ket ${suffix}. Vui long go lien ket o ho so cu truoc khi lien ket lai.`
}

function isPersonnelGroupsUnavailableError(message: string) {
  return /personnel_groups|personnel_group_members|does not exist|could not find the table|schema cache|permission denied|relation .* does not exist/i.test(message)
}

function formatPersonnelGroupsIssue(groupsError?: string, membersError?: string) {
  const issues = [
    groupsError?.trim() ? `personnel_groups: ${groupsError.trim()}` : "",
    membersError?.trim() ? `personnel_group_members: ${membersError.trim()}` : "",
  ].filter(Boolean)

  return issues[0] || "Tính năng nhóm chưa sẵn sàng."
}

type PermissionOption = {
  code: string
  label: string
  module_name: string
  action_name: string
  module_label?: string
  action_label?: string
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

type SettingsTab = "system" | "factory-config" | "master-data" | "maintenance" | "iso-vanban"
type SensitiveActionKind = "change_pin" | "change_signature" | "change_password"
type SensitiveActionModal = {
  actionType: SensitiveActionKind
  title: string
  submitLabel: string
  challengeId: string | null
  maskedEmail: string | null
  currentPassword: string
  currentPin: string
  otp: string
  newPin?: string
  newPassword?: string
  file?: File
}

type SystemTab = "users" | "permissions" | "personnel"

type MasterDataTab = "suffixes" | "company" | "customers" | "required-notes" | "van-ban-types"

type VanBanDocumentTypeRow = {
  id: string
  code: string
  name: string
  ky_hieu: string
  sort_order: number
  is_active: boolean
}

type FactoryConfigTab = "warehouses" | "categories" | "items" | "delivery-points" | "forest-plots" | "quality-targets"

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
  profile_id: string | null
  ten: string
  group_ids: string[]
  group_names: string[]
  chuc_vu: string | null
  gioi_tinh: string | null
  chuc_vu_chinh_quyen: string | null
  chuc_vu_kim_nhiem: string | null
  email: string | null
  active: boolean
}

type StaffViewFilter = "all" | "maintenance" | "unlinked"

type PersonnelAccountAuditRow = {
  profile: ProfileRow
  linkedStaff: MaintenanceStaffRow | null
}

type PersonnelGroupRow = {
  id: string
  factory_id: string
  code: string | null
  name: string
  description: string | null
  is_system: boolean
  is_active: boolean
  sort_order: number
}

type PersonnelGroupMemberRow = {
  staff_id: string
  group_id: string
  personnel_groups: Array<{
    id: string
    name: string | null
    code: string | null
  }> | null
}

type PersonnelGroupForm = {
  code: string
  name: string
  description: string
  sort_order: string
  is_active: boolean
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

type RequiredNoteForm = {
  content: string
  sort_order: string
  is_active: boolean
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
  license_number: string | null
  license_class: string | null
  license_expiry: string | null
  id_number: string | null
  notes: string | null
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
  license_number: string
  license_class: string
  license_expiry: string
  id_number: string
  notes: string
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
    ca_a_ten: "",
    ca_b_ten: "",
    ca_c_ten: "",
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
    license_number: "",
    license_class: "",
    license_expiry: "",
    id_number: "",
    notes: "",
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

const PERMISSION_MODULE_LABELS: Record<string, string> = {
  dispatch: "Điều xe",
  documents: "Văn bản",
  export: "Xuất hàng",
  inventory: "Kho vật tư",
  iso: "ISO",
  maintenance: "Bảo trì",
  notes: "Ghi chú nhanh",
  output: "Sản lượng",
  process: "Kiểm soát quá trình",
  product: "Thành phẩm",
  quality: "Kiểm nghiệm",
  settings: "Cài đặt",
  storage: "Ngăn lưu",
  suffixes: "Hậu tố",
  users: "Người dùng",
  warehouse: "Kho thành phẩm",
}

const PERMISSION_ACTION_LABELS: Record<string, string> = {
  analytics: "thống kê",
  approve: "duyệt tài khoản",
  cancel: "hủy phiếu",
  create: "tạo",
  delete: "xóa",
  delete_order: "xóa đơn",
  distribute: "phân phối",
  edit: "sửa",
  edit_permission: "sửa quyền",
  export_file: "xuất file",
  forms: "thực hiện hồ sơ",
  import: "nhập",
  ky_phong_ban: "ký phòng ban",
  manage_config: "quản trị cấu hình",
  mark_completed: "đánh dấu hoàn thành",
  master_data: "danh mục",
  maintenance_config: "cấu hình bảo trì",
  phe_duyet: "phê duyệt",
  post: "ghi sổ",
  print: "in",
  quick_add: "thêm nhanh",
  quick_add_customer: "thêm nhanh khách hàng",
  settings: "cấu hình",
  signature: "ký số",
  soat_xet: "soát xét",
  upload_signed: "tải lên bản đã ký",
  view: "xem",
  view_own: "xem đơn được cấp",
  xem_xet: "xem xét",
}

function prettifyPermissionModule(moduleName: string) {
  return PERMISSION_MODULE_LABELS[moduleName] || moduleName.replaceAll("_", " ")
}

function prettifyPermissionAction(actionName: string) {
  return PERMISSION_ACTION_LABELS[actionName] || actionName.replaceAll("_", " ")
}

function isMaintenanceStaffRole(value?: string | null) {
  const normalized = String(value || "").toLowerCase()
  return normalized.includes("bảo trì")
    || normalized.includes("bao tri")
    || normalized.includes("cơ điện")
    || normalized.includes("co dien")
}

function isMaintenanceStaffMember(staff: Pick<MaintenanceStaffRow, "group_names" | "chuc_vu">) {
  return staff.group_names.some((groupName) => isMaintenanceStaffRole(groupName)) || isMaintenanceStaffRole(staff.chuc_vu)
}

function labelPermission(code: string) {
  const [moduleName = "", actionName = ""] = code.split(".")
  return {
    code,
    module_name: moduleName,
    action_name: actionName,
    module_label: prettifyPermissionModule(moduleName),
    action_label: prettifyPermissionAction(actionName),
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
    "quality-targets": {
      // Tab này không dùng nút "Tải mẫu"/"Nhập CSV" (bị ẩn), giữ entry để thỏa mãn kiểu Record đầy đủ.
      filename: "muc_tieu_chat_luong.csv",
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

  const isAdmin = user?.role === "admin"
  const canManageSettings = isAdmin || hasPermission(user, "settings.manage_config")
  const canViewUsers = hasPermission(user, "users.view")
  const canApproveUsers = hasPermission(user, "users.approve")
  const canEditPermissions = hasPermission(user, "users.edit_permission")
  const canViewMasterData = isAdmin || hasPermission(user, "settings.master_data")
  const canViewMaintenanceConfig = isAdmin || hasPermission(user, "settings.maintenance_config")
  const canViewIsoSignature = isAdmin || hasPermission(user, "iso.signature")

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
  const [vehicleDriverSearch, setVehicleDriverSearch] = useState("")
  const [assignmentHistoryVehicleId, setAssignmentHistoryVehicleId] = useState<string | null>(null)
  const [vehicleDriverAddOpen, setVehicleDriverAddOpen] = useState(false)
  const [vehicleDriverAddForm, setVehicleDriverAddForm] = useState({ name: "", code: "", phone: "", license_number: "", license_class: "", license_expiry: "", id_number: "", notes: "", is_active: true })
  const [vehicleDriverAddSaving, setVehicleDriverAddSaving] = useState(false)
  const [vehicleDriverAddError, setVehicleDriverAddError] = useState("")
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
  const [personnelGroups, setPersonnelGroups] = useState<PersonnelGroupRow[]>([])
  const [personnelGroupsAvailable, setPersonnelGroupsAvailable] = useState(false)
  const [personnelGroupsIssue, setPersonnelGroupsIssue] = useState("")
  const [maintExtMats, setMaintExtMats] = useState<MaintenanceExtMaterialRow[]>([])
  const [maintLoading, setMaintLoading] = useState(false)
  const [maintLoaded, setMaintLoaded] = useState(false)
  const [maintModal, setMaintModal] = useState<"asset" | "staff" | "staff-group" | "ext-mat" | null>(null)
  const [maintEditId, setMaintEditId] = useState<string | null>(null)
  const [maintSaving, setMaintSaving] = useState(false)
  const [maintError, setMaintError] = useState("")
  const [maintDelConfirm, setMaintDelConfirm] = useState<{ type: "asset" | "staff" | "staff-group" | "ext-mat"; id: string; label: string } | null>(null)
  const [assetForm, setAssetForm] = useState({ ma_tb: "", ten_tb: "", bo_phan: "Mủ tạp", loai: "may_moc", nam_sd: "", bien_so: "", mo_ta: "", trang_thai: "active" })
  const [staffForm, setStaffForm] = useState({
    profile_id: "",
    ten: "",
    group_ids: [] as string[],
    chuc_vu: "",
    gioi_tinh: "",
    chuc_vu_chinh_quyen: "",
    chuc_vu_kim_nhiem: "",
    email: "",
    active: true,
  })
  const [staffViewFilter, setStaffViewFilter] = useState<StaffViewFilter>("all")
  const [personnelLinkModal, setPersonnelLinkModal] = useState<{ profileId: string; staffId: string } | null>(null)
  const [personnelGroupForm, setPersonnelGroupForm] = useState<PersonnelGroupForm>({
    code: "",
    name: "",
    description: "",
    sort_order: "0",
    is_active: true,
  })
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

  const [requiredNotes, setRequiredNotes] = useState<RequiredNote[]>([])
  const [requiredNotesLoading, setRequiredNotesLoading] = useState(false)
  const [requiredNotesLoaded, setRequiredNotesLoaded] = useState(false)
  const [requiredNoteModal, setRequiredNoteModal] = useState<"add" | "edit" | null>(null)
  const [requiredNoteEditId, setRequiredNoteEditId] = useState<string | null>(null)
  const [requiredNoteForm, setRequiredNoteForm] = useState<RequiredNoteForm>({ content: "", sort_order: "0", is_active: true })
  const [requiredNoteSaving, setRequiredNoteSaving] = useState(false)
  const [requiredNoteError, setRequiredNoteError] = useState("")
  const [requiredNoteDelConfirm, setRequiredNoteDelConfirm] = useState<{ id: string; label: string } | null>(null)

  // Loại văn bản state
  const [vanBanTypes, setVanBanTypes] = useState<VanBanDocumentTypeRow[]>([])
  const [vbtLoading, setVbtLoading] = useState(false)
  const [vbtLoaded, setVbtLoaded] = useState(false)
  const [vbtModal, setVbtModal] = useState<"add" | "edit" | null>(null)
  const [vbtEditId, setVbtEditId] = useState<string | null>(null)
  const [vbtForm, setVbtForm] = useState({ code: "", name: "", ky_hieu: "", sort_order: "0", is_active: true })
  const [vbtSaving, setVbtSaving] = useState(false)
  const [vbtError, setVbtError] = useState("")
  const [vbtDelConfirm, setVbtDelConfirm] = useState<{ id: string; label: string } | null>(null)

  // ISO & Văn bản tab state
  const [isoVanBanTab, setIsoVanBanTab] = useState<"chu-ky">("chu-ky")
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null)
  const [signatureUploading, setSignatureUploading] = useState(false)
  const [pinForm, setPinForm] = useState({ pin: "", pinConfirm: "", showPin: false })
  const [pinSaving, setPinSaving] = useState(false)
  const [pinMsg, setPinMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [sigMsg, setSigMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [hasPinSet, setHasPinSet] = useState(false)
  const [passwordForm, setPasswordForm] = useState({ password: "", confirm: "", show: false })
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordMsg, setPasswordMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [sensitiveActionModal, setSensitiveActionModal] = useState<SensitiveActionModal | null>(null)
  const [sensitiveActionLoading, setSensitiveActionLoading] = useState(false)
  const [sensitiveActionError, setSensitiveActionError] = useState("")
  const signatureInputRef = useRef<HTMLInputElement>(null)

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
        module_label: prettifyPermissionModule(item.module_name),
        action_label: prettifyPermissionAction(item.action_name),
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
      const [aRes, sRes, gRes, gmRes, mRes, driverRes, vehicleRes, assignmentRes] = await Promise.all([
        supabase.from("maintenance_assets").select("*").eq("factory_id", fid).order("bo_phan").order("ma_tb"),
        supabase.from("maintenance_staff").select("*").eq("factory_id", fid).order("ten"),
        supabase.from("personnel_groups").select("id, factory_id, code, name, description, is_system, is_active, sort_order").eq("factory_id", fid).order("sort_order").order("name"),
        supabase.from("personnel_group_members").select("staff_id, group_id, personnel_groups(id, name, code)").eq("factory_id", fid),
        supabase.from("maintenance_external_materials").select("*").eq("factory_id", fid).order("ten_vat_tu"),
        supabase.from("dispatch_drivers").select("*").eq("factory_id", fid).order("name"),
        supabase.from("dispatch_vehicles").select("id, factory_id, code, name, vehicle_type, plate_number, sort_order, is_active").eq("factory_id", fid).order("sort_order").order("code"),
        supabase.from("dispatch_vehicle_driver_assignments").select("id, factory_id, vehicle_id, driver_id, effective_from, effective_to, is_current, note").eq("factory_id", fid).order("is_current", { ascending: false }).order("effective_from", { ascending: false }),
      ])
      setMaintAssets((aRes.data || []) as MaintenanceAssetRow[])

      const personnelGroupsError = gRes.error?.message || ""
      const personnelGroupMembersError = gmRes.error?.message || ""
      const groupsUnavailable = (!!personnelGroupsError && isPersonnelGroupsUnavailableError(personnelGroupsError))
        || (!!personnelGroupMembersError && isPersonnelGroupsUnavailableError(personnelGroupMembersError))

      console.info("[settings] personnel groups query", {
        factoryId: fid,
        personnel_groups: {
          status: gRes.status,
          count: gRes.data?.length || 0,
          error: gRes.error ? { message: gRes.error.message, code: gRes.error.code } : null,
        },
        personnel_group_members: {
          status: gmRes.status,
          count: gmRes.data?.length || 0,
          error: gmRes.error ? { message: gmRes.error.message, code: gmRes.error.code } : null,
        },
      })

      if (groupsUnavailable) {
        setPersonnelGroups([])
        setPersonnelGroupsAvailable(false)
        setPersonnelGroupsIssue(formatPersonnelGroupsIssue(personnelGroupsError, personnelGroupMembersError))
      } else {
        setPersonnelGroups((gRes.data || []) as PersonnelGroupRow[])
        setPersonnelGroupsAvailable(true)
        setPersonnelGroupsIssue("")
      }

      if (gRes.error && !groupsUnavailable) {
        setMaintError(gRes.error.message)
      }

      if (gmRes.error && !groupsUnavailable) {
        setMaintError(gmRes.error.message)
      }

      const groupMap = new Map<string, { group_ids: string[]; group_names: string[] }>()
      for (const row of (groupsUnavailable ? [] : (gmRes.data || [])) as PersonnelGroupMemberRow[]) {
        const existing = groupMap.get(row.staff_id) || { group_ids: [], group_names: [] }
        if (row.group_id && !existing.group_ids.includes(row.group_id)) existing.group_ids.push(row.group_id)
        const groupName = row.personnel_groups?.[0]?.name?.trim()
        if (groupName && !existing.group_names.includes(groupName)) existing.group_names.push(groupName)
        groupMap.set(row.staff_id, existing)
      }
      const nextStaff = ((sRes.data || []) as Array<Omit<MaintenanceStaffRow, "group_ids" | "group_names">>).map((staff) => {
        const groups = groupMap.get(staff.id)
        return {
          ...staff,
          group_ids: groups?.group_ids || [],
          group_names: groups?.group_names || [],
        }
      })
      setMaintStaff(nextStaff)
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

  const ensureMaintenanceProfileAvailable = useCallback(async (profileId: string, currentStaffId?: string | null) => {
    let query = supabase
      .from("maintenance_staff")
      .select("id, ten")
      .eq("profile_id", profileId)
      .limit(1)

    if (currentStaffId) {
      query = query.neq("id", currentStaffId)
    }

    const { data, error } = await query.maybeSingle()
    if (error && error.code !== "PGRST116") {
      return { ok: false as const, error: error.message }
    }

    if (data) {
      return { ok: false as const, error: getMaintenanceProfileLinkConflictMessage(data.ten) }
    }

    return { ok: true as const }
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

  const loadMasterRequiredNotes = useCallback(async (fid: string) => {
    setRequiredNotesLoading(true)
    try {
      setRequiredNotes(await loadRequiredNotes(supabase, fid, false))
      setRequiredNotesLoaded(true)
    } finally {
      setRequiredNotesLoading(false)
    }
  }, [])

  const loadVanBanTypes = useCallback(async (_fid: string) => {
    setVbtLoading(true)
    try {
      // Bảng van_ban_document_types là danh mục dùng chung toàn hệ thống,
      // không có cột factory_id (xem supabase/migrations/20260610_van_ban_types_sequences.sql)
      const { data } = await supabase
        .from("van_ban_document_types")
        .select("id, code, name, ky_hieu, sort_order, is_active")
        .order("sort_order")
      setVanBanTypes((data || []) as VanBanDocumentTypeRow[])
      setVbtLoaded(true)
    } finally {
      setVbtLoading(false)
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
        const nextProfileId = staffForm.profile_id || null
        if (nextProfileId) {
          const profileAvailability = await ensureMaintenanceProfileAvailable(nextProfileId, maintEditId)
          if (!profileAvailability.ok) { setMaintError(profileAvailability.error); return }
        }

        const payload = {
          factory_id: factoryId,
          profile_id: nextProfileId,
          ten: staffForm.ten.trim(),
          chuc_vu: staffForm.chuc_vu.trim() || null,
          gioi_tinh: staffForm.gioi_tinh || null,
          chuc_vu_chinh_quyen: staffForm.chuc_vu_chinh_quyen.trim() || null,
          chuc_vu_kim_nhiem: staffForm.chuc_vu_kim_nhiem.trim() || null,
          email: staffForm.email.trim() || null,
          active: staffForm.active,
        }
      const result = maintEditId
        ? await supabase.from("maintenance_staff").update(payload).eq("id", maintEditId).eq("factory_id", factoryId).select("id").single()
        : await supabase.from("maintenance_staff").insert(payload).select("id").single()
      if (result.error) {
        setMaintError(isMaintenanceProfileLinkConstraintError(result.error.message) ? getMaintenanceProfileLinkConflictMessage() : result.error.message)
        return
      }
      const savedStaffId = result.data?.id
      if (savedStaffId && personnelGroupsAvailable) {
        const deleteMembershipRes = await supabase.from("personnel_group_members").delete().eq("factory_id", factoryId).eq("staff_id", savedStaffId)
        if (deleteMembershipRes.error && !/personnel_group_members|does not exist|Could not find the table/i.test(deleteMembershipRes.error.message)) {
          setMaintError(deleteMembershipRes.error.message)
          return
        }

        if (staffForm.group_ids.length > 0) {
          const insertMembershipRes = await supabase
            .from("personnel_group_members")
            .insert(staffForm.group_ids.map((groupId) => ({ factory_id: factoryId, staff_id: savedStaffId, group_id: groupId })))

          if (insertMembershipRes.error && !/personnel_group_members|does not exist|Could not find the table/i.test(insertMembershipRes.error.message)) {
            setMaintError(insertMembershipRes.error.message)
            return
          }
        }
      }
      setMaintModal(null)
      void loadMaintenanceData(factoryId)
    } catch (e) { setMaintError(e instanceof Error ? e.message : "Lỗi") } finally { setMaintSaving(false) }
  }

  const savePersonnelGroup = async () => {
    if (!factoryId) return
    if (!personnelGroupsAvailable) { setMaintError(personnelGroupsIssue || "Tính năng nhóm chưa sẵn sàng trên hệ thống này."); return }
    if (!personnelGroupForm.name.trim()) { setMaintError("Tên nhóm không được để trống"); return }
    setMaintSaving(true); setMaintError("")
    try {
      const payload = {
        factory_id: factoryId,
        code: personnelGroupForm.code.trim() || null,
        name: personnelGroupForm.name.trim(),
        description: personnelGroupForm.description.trim() || null,
        sort_order: Number(personnelGroupForm.sort_order || 0),
        is_active: personnelGroupForm.is_active,
      }
      const result = maintEditId
        ? await supabase.from("personnel_groups").update(payload).eq("id", maintEditId).eq("factory_id", factoryId)
        : await supabase.from("personnel_groups").insert(payload)
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
    const table = maintDelConfirm.type === "asset"
      ? "maintenance_assets"
      : maintDelConfirm.type === "staff"
        ? "maintenance_staff"
        : maintDelConfirm.type === "staff-group"
          ? "personnel_groups"
          : "maintenance_external_materials"
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
        license_number: dispatchDriverForm.license_number.trim() || null,
        license_class: dispatchDriverForm.license_class.trim() || null,
        license_expiry: dispatchDriverForm.license_expiry || null,
        id_number: dispatchDriverForm.id_number.trim() || null,
        notes: dispatchDriverForm.notes.trim() || null,
        is_active: dispatchDriverForm.is_active,
      }
      const result = configEditId
        ? await supabase.from("dispatch_drivers").update(payload).eq("id", configEditId).eq("factory_id", factoryId)
        : await supabase.from("dispatch_drivers").insert(payload)
      if (result.error) { setConfigError(result.error.message); return }
      setConfigModal(null)
      void loadMaintenanceData(factoryId)
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : "Lỗi không xác định")
    } finally {
      setConfigSaving(false)
    }
  }

  const handleVehicleDriverAdd = async () => {
    if (!factoryId) return
    if (!vehicleDriverAddForm.name.trim()) { setVehicleDriverAddError("Tên tài xế không được để trống"); return }
    setVehicleDriverAddSaving(true)
    setVehicleDriverAddError("")
    try {
      const payload = {
        factory_id: factoryId,
        code: vehicleDriverAddForm.code.trim().toUpperCase() || null,
        name: vehicleDriverAddForm.name.trim(),
        phone: vehicleDriverAddForm.phone.trim() || null,
        license_number: vehicleDriverAddForm.license_number.trim() || null,
        license_class: vehicleDriverAddForm.license_class.trim() || null,
        license_expiry: vehicleDriverAddForm.license_expiry || null,
        id_number: vehicleDriverAddForm.id_number.trim() || null,
        notes: vehicleDriverAddForm.notes.trim() || null,
        is_active: vehicleDriverAddForm.is_active,
      }
      const { data, error } = await supabase.from("dispatch_drivers").insert(payload).select("id").single()
      if (error) { setVehicleDriverAddError(error.message); return }
      await loadMaintenanceData(factoryId)
      if (data?.id) setDispatchVehicleForm((p) => ({ ...p, primary_driver_id: data.id }))
      setVehicleDriverAddOpen(false)
    } catch (err) {
      setVehicleDriverAddError(err instanceof Error ? err.message : "Lỗi không xác định")
    } finally {
      setVehicleDriverAddSaving(false)
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
      void loadMaintenanceData(factoryId)
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
      const features: Array<{ properties?: Record<string, unknown> | null; geometry?: unknown }> = geojson?.features ?? []
      if (!features.length) { setConfigError("File GeoJSON không có features"); return }
      const seen = new Set<string>()
      const rows = features.flatMap((f) => {
        const p = f?.properties || {}
        const ten = String(p.Ten || "").trim()
        if (!ten || seen.has(ten)) return []
        seen.add(ten)
        return [{
          factory_id: factoryId,
          ten,
          ma_lo_full: p.Ma_lo_2026 ? String(p.Ma_lo_2026).trim() : null,
          nong_truong: p.Nong_truong ? String(p.Nong_truong).trim() : null,
          doi: p.Doi_2026 != null ? (parseInt(String(p.Doi_2026)) || null) : null,
          giong: p.Giong ? String(p.Giong).trim() : null,
          dien_tich_ha: p.Dtich2026_ha != null ? (parseFloat(String(p.Dtich2026_ha)) || null) : null,
          nam_trong: p.Nam_trong != null ? (parseInt(String(p.Nam_trong)) || null) : null,
          nam_cao_up: p.Nam_cao_up != null ? (parseInt(String(p.Nam_cao_up)) || null) : null,
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
      if (configDelConfirm.type === "driver" || configDelConfirm.type === "vehicle") {
        void loadMaintenanceData(factoryId)
      } else {
        void loadConfigData(factoryId)
      }
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
    if (
      !hasPermission(sessionUser, "settings.manage_config") &&
      !hasPermission(sessionUser, "users.view") &&
      !hasPermission(sessionUser, "users.approve") &&
      !hasPermission(sessionUser, "settings.master_data") &&
      !hasPermission(sessionUser, "settings.maintenance_config") &&
      !hasPermission(sessionUser, "iso.signature")
    ) {
      setLoading(false)
      window.location.replace("/dashboard")
      return
    }

    await Promise.all([
      loadSuffixes(fid),
      loadProfiles(fid),
      loadPermissions(),
      supabase
        .from("factories")
        .select("id, name, full_name_en, address_en, contact_person, contact_email, website, country_en, ca_a_ten, ca_b_ten, ca_c_ten")
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
              ca_a_ten: ownFactory.ca_a_ten || "",
              ca_b_ten: ownFactory.ca_b_ten || "",
              ca_c_ten: ownFactory.ca_c_ten || "",
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
    if (!factoryId) return

    setMaintLoaded(false)
    setMaintAssets([])
    setMaintStaff([])
    setPersonnelGroups([])
    setPersonnelGroupsAvailable(false)
    setPersonnelGroupsIssue("")
    setMaintExtMats([])
    setDispatchDrivers([])
    setDispatchVehicles([])
    setDispatchVehicleAssignments([])
    setMaintError("")
  }, [factoryId])

  useEffect(() => {
    const shouldLoadMaintenanceData =
      tab === "maintenance" || (tab === "system" && systemTab === "personnel")

    if (shouldLoadMaintenanceData && factoryId && !maintLoaded && !maintLoading) {
      void loadMaintenanceData(factoryId)
    }
  }, [tab, systemTab, factoryId, maintLoaded, maintLoading, loadMaintenanceData])

  useEffect(() => {
    if (tab === "master-data" && masterDataTab === "customers" && factoryId && !customerLoaded && !customerLoading) {
      void loadCustomers(factoryId)
    }
  }, [tab, masterDataTab, factoryId, customerLoaded, customerLoading, loadCustomers])

  useEffect(() => {
    if (tab === "master-data" && masterDataTab === "required-notes" && factoryId && !requiredNotesLoaded && !requiredNotesLoading) {
      void loadMasterRequiredNotes(factoryId)
    }
  }, [tab, masterDataTab, factoryId, requiredNotesLoaded, requiredNotesLoading, loadMasterRequiredNotes])

  useEffect(() => {
    if (tab === "master-data" && masterDataTab === "van-ban-types" && factoryId && !vbtLoaded && !vbtLoading) {
      void loadVanBanTypes(factoryId)
    }
  }, [tab, masterDataTab, factoryId, vbtLoaded, vbtLoading, loadVanBanTypes])

  useEffect(() => {
    if (tab === "iso-vanban" && user && factoryId) {
      const loadSignInfo = async () => {
        // Kiểm tra đã có ảnh chữ ký chưa
        const sigPath = `signatures/${factoryId}/${user.id}/chu_ky.png`
        const { data } = supabase.storage.from("iso-documents").getPublicUrl(sigPath)
        // Thử fetch HEAD để check tồn tại
        try {
          const res = await fetch(data.publicUrl, { method: "HEAD" })
          if (res.ok) setSignatureUrl(data.publicUrl + "?t=" + Date.now())
        } catch { /* bỏ qua */ }

        // Kiểm tra đã thiết lập PIN chưa
        const { data: pinRow } = await supabase
          .from("sign_pins")
          .select("user_id")
          .eq("user_id", user.id)
          .single()
        setHasPinSet(!!pinRow)
      }
      void loadSignInfo()
    }
  }, [tab, user, factoryId])

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

  const activeProfilesForLink = useMemo(
    () => profiles.filter((profile) => profile.status === "active"),
    [profiles],
  )

  const maintStaffByProfileId = useMemo(() => {
    const map = new Map<string, MaintenanceStaffRow>()
    for (const staff of maintStaff) {
      if (staff.profile_id && !map.has(staff.profile_id)) {
        map.set(staff.profile_id, staff)
      }
    }
    return map
  }, [maintStaff])

  const personnelAccountAudit = useMemo<PersonnelAccountAuditRow[]>(() => {
    return profiles.map((profile) => ({
      profile,
      linkedStaff: maintStaffByProfileId.get(profile.id) || null,
    }))
  }, [profiles, maintStaffByProfileId])

  const profilesWithoutPersonnel = useMemo(
    () => personnelAccountAudit.filter((item) => !item.linkedStaff),
    [personnelAccountAudit],
  )

  const staffWithoutProfile = useMemo(
    () => maintStaff.filter((staff) => !staff.profile_id),
    [maintStaff],
  )

  const linkedProfileCount = useMemo(
    () => personnelAccountAudit.filter((item) => item.linkedStaff).length,
    [personnelAccountAudit],
  )

  const availableStaffForAccountLink = useMemo(() => {
    return maintStaff
      .filter((staff) => !staff.profile_id)
      .sort((a, b) => a.ten.localeCompare(b.ten, "vi"))
  }, [maintStaff])

  const availableProfilesForStaffForm = useMemo(() => {
    const currentProfileId = maintEditId
      ? maintStaff.find((staff) => staff.id === maintEditId)?.profile_id || null
      : staffForm.profile_id || null

    return profiles.filter((profile) => {
      if (profile.id === currentProfileId) return true
      if (profile.status !== "active") return false
      return !maintStaffByProfileId.has(profile.id)
    })
  }, [maintEditId, maintStaff, maintStaffByProfileId, profiles, staffForm.profile_id])

  const filteredMaintStaff = useMemo(() => {
    if (staffViewFilter === "maintenance") {
      return maintStaff.filter((staff) => isMaintenanceStaffMember(staff))
    }
    if (staffViewFilter === "unlinked") {
      return maintStaff.filter((staff) => !staff.profile_id)
    }
    return maintStaff
  }, [maintStaff, staffViewFilter])

  const openNewStaffModal = useCallback((profile?: ProfileRow) => {
    setMaintEditId(null)
    setMaintError("")
    setStaffForm({
      profile_id: profile?.id || "",
      ten: profile?.full_name || "",
      group_ids: [],
      chuc_vu: "",
      gioi_tinh: "",
      chuc_vu_chinh_quyen: "",
      chuc_vu_kim_nhiem: "",
      email: "",
      active: true,
    })
    setMaintModal("staff")
  }, [])

  const openEditStaffModal = useCallback((staff: MaintenanceStaffRow, nextProfileId?: string) => {
    setMaintEditId(staff.id)
    setMaintError("")
    setStaffForm({
      profile_id: nextProfileId ?? (staff.profile_id || ""),
      ten: staff.ten,
      group_ids: [...staff.group_ids],
      chuc_vu: staff.chuc_vu || "",
      gioi_tinh: staff.gioi_tinh || "",
      chuc_vu_chinh_quyen: staff.chuc_vu_chinh_quyen || "",
      chuc_vu_kim_nhiem: staff.chuc_vu_kim_nhiem || "",
      email: staff.email || "",
      active: staff.active,
    })
    setMaintModal("staff")
  }, [])

  const handleQuickLinkProfileToStaff = useCallback(async () => {
    if (!factoryId || !personnelLinkModal) return
    setMaintSaving(true)
    setMaintError("")
    try {
      const profileAvailability = await ensureMaintenanceProfileAvailable(personnelLinkModal.profileId, personnelLinkModal.staffId)
      if (!profileAvailability.ok) {
        setMaintError(profileAvailability.error)
        return
      }

      const result = await supabase
        .from("maintenance_staff")
        .update({ profile_id: personnelLinkModal.profileId })
        .eq("id", personnelLinkModal.staffId)
        .eq("factory_id", factoryId)
      if (result.error) {
        setMaintError(isMaintenanceProfileLinkConstraintError(result.error.message) ? getMaintenanceProfileLinkConflictMessage() : result.error.message)
        return
      }
      setPersonnelLinkModal(null)
      await loadMaintenanceData(factoryId)
    } catch (error) {
      setMaintError(error instanceof Error ? error.message : "Lỗi không xác định")
    } finally {
      setMaintSaving(false)
    }
  }, [ensureMaintenanceProfileAvailable, factoryId, loadMaintenanceData, personnelLinkModal])

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

  const saveRequiredNote = async () => {
    if (!factoryId) return
    if (!requiredNoteForm.content.trim()) { setRequiredNoteError("Nội dung ghi chú không được để trống"); return }
    setRequiredNoteSaving(true)
    setRequiredNoteError("")
    try {
      if (requiredNoteEditId) {
        const { error: updateError } = await supabase
          .from("required_notes")
          .update({
            content: requiredNoteForm.content.trim(),
            sort_order: Number(requiredNoteForm.sort_order) || 0,
            is_active: requiredNoteForm.is_active,
          })
          .eq("id", requiredNoteEditId)
          .eq("factory_id", factoryId)
        if (updateError) { setRequiredNoteError(updateError.message); return }
      } else {
        const { error: insertError } = await supabase
          .from("required_notes")
          .insert({
            factory_id: factoryId,
            content: requiredNoteForm.content.trim(),
            sort_order: Number(requiredNoteForm.sort_order) || 0,
            is_active: requiredNoteForm.is_active,
          })
        if (insertError) { setRequiredNoteError(insertError.message); return }
      }
      setRequiredNoteModal(null)
      setRequiredNoteEditId(null)
      setRequiredNoteForm({ content: "", sort_order: "0", is_active: true })
      void loadMasterRequiredNotes(factoryId)
    } catch (e) {
      setRequiredNoteError(e instanceof Error ? e.message : "Lỗi")
    } finally {
      setRequiredNoteSaving(false)
    }
  }

  const deleteRequiredNote = async () => {
    if (!factoryId || !requiredNoteDelConfirm) return
    await supabase
      .from("required_notes")
      .delete()
      .eq("id", requiredNoteDelConfirm.id)
      .eq("factory_id", factoryId)
    setRequiredNoteDelConfirm(null)
    void loadMasterRequiredNotes(factoryId)
  }

  const saveVanBanType = async () => {
    if (!factoryId) return
    if (!vbtForm.code.trim()) { setVbtError("Mã loại không được để trống"); return }
    if (!vbtForm.name.trim()) { setVbtError("Tên loại không được để trống"); return }
    if (!vbtForm.ky_hieu.trim()) { setVbtError("Ký hiệu mã không được để trống"); return }
    setVbtSaving(true)
    setVbtError("")
    try {
      // van_ban_document_types là danh mục dùng chung toàn hệ thống, không có cột factory_id
      const payload = {
        code: vbtForm.code.trim().toUpperCase(),
        name: vbtForm.name.trim(),
        ky_hieu: vbtForm.ky_hieu.trim(),
        sort_order: Number(vbtForm.sort_order) || 0,
        is_active: vbtForm.is_active,
      }
      if (vbtEditId) {
        const { error: e } = await supabase.from("van_ban_document_types").update(payload).eq("id", vbtEditId)
        if (e) { setVbtError(e.message); return }
      } else {
        const { error: e } = await supabase.from("van_ban_document_types").insert(payload)
        if (e) { setVbtError(e.message); return }
      }
      setVbtModal(null)
      setVbtEditId(null)
      setVbtForm({ code: "", name: "", ky_hieu: "", sort_order: "0", is_active: true })
      void loadVanBanTypes(factoryId)
    } catch (e) {
      setVbtError(e instanceof Error ? e.message : "Lỗi")
    } finally {
      setVbtSaving(false)
    }
  }

  const deleteVanBanType = async () => {
    if (!factoryId || !vbtDelConfirm) return
    // Kiểm tra xem có văn bản nào đang dùng loại này không
    const { count } = await supabase.from("van_ban_documents")
      .select("id", { count: "exact", head: true })
      .eq("factory_id", factoryId)
      .eq("loai_van_ban", vanBanTypes.find((t) => t.id === vbtDelConfirm.id)?.code || "")
    if ((count ?? 0) > 0) {
      setVbtError(`Không thể xóa vì đang có văn bản sử dụng loại này`)
      setVbtDelConfirm(null)
      return
    }
    await supabase.from("van_ban_document_types").delete().eq("id", vbtDelConfirm.id)
    setVbtDelConfirm(null)
    void loadVanBanTypes(factoryId)
  }

  const getAccessToken = async () => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) {
      throw new Error("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại")
    }
    return token
  }

  const closeSensitiveActionModal = () => {
    setSensitiveActionModal(null)
    setSensitiveActionError("")
    setSensitiveActionLoading(false)
  }

  const beginSensitiveAction = (action: Omit<SensitiveActionModal, "challengeId" | "maskedEmail" | "currentPassword" | "currentPin" | "otp">) => {
    setSensitiveActionError("")
    setSensitiveActionModal({
      ...action,
      challengeId: null,
      maskedEmail: null,
      currentPassword: "",
      currentPin: "",
      otp: "",
    })
  }

  const requestSensitiveOtp = async () => {
    if (!user || !sensitiveActionModal) return
    if (!sensitiveActionModal.currentPassword || !sensitiveActionModal.currentPin) {
      setSensitiveActionError("Vui lòng nhập mật khẩu hiện tại và PIN cũ")
      return
    }

    setSensitiveActionLoading(true)
    setSensitiveActionError("")
    try {
      const accessToken = await getAccessToken()
      const res = await fetch("/api/account/request-otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          userId: user.id,
          actionType: sensitiveActionModal.actionType,
          currentPassword: sensitiveActionModal.currentPassword,
          currentPin: sensitiveActionModal.currentPin,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setSensitiveActionError(json.error || "Không gửi được OTP")
        return
      }

      setSensitiveActionModal((prev) => prev ? {
        ...prev,
        challengeId: json.challengeId || null,
        maskedEmail: json.maskedEmail || null,
      } : prev)
    } catch (error) {
      setSensitiveActionError(error instanceof Error ? error.message : "Không gửi được OTP")
    } finally {
      setSensitiveActionLoading(false)
    }
  }

  const confirmSensitiveAction = async () => {
    if (!user || !sensitiveActionModal?.challengeId) return
    if (!sensitiveActionModal.otp.trim()) {
      setSensitiveActionError("Vui lòng nhập mã OTP")
      return
    }

    setSensitiveActionLoading(true)
    setSensitiveActionError("")
    try {
      const accessToken = await getAccessToken()
      const verifyRes = await fetch("/api/account/verify-otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          userId: user.id,
          actionType: sensitiveActionModal.actionType,
          challengeId: sensitiveActionModal.challengeId,
          otp: sensitiveActionModal.otp,
        }),
      })
      const verifyJson = await verifyRes.json()
      if (!verifyRes.ok) {
        setSensitiveActionError(verifyJson.error || "OTP không hợp lệ")
        return
      }

      const actionToken = String(verifyJson.actionToken || "")
      if (!actionToken) {
        setSensitiveActionError("Không lấy được xác thực thay đổi")
        return
      }

      if (sensitiveActionModal.actionType === "change_pin") {
        const res = await fetch("/api/sign/set-pin", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            userId: user.id,
            pin: sensitiveActionModal.newPin,
            actionToken,
          }),
        })
        const json = await res.json()
        if (!res.ok) {
          setSensitiveActionError(json.error || "Không đổi được PIN")
          return
        }
        setHasPinSet(true)
        setPinForm({ pin: "", pinConfirm: "", showPin: false })
        setPinMsg({ ok: true, text: "Đã đổi PIN ký duyệt thành công" })
      } else if (sensitiveActionModal.actionType === "change_signature") {
        if (!sensitiveActionModal.file) {
          setSensitiveActionError("Chưa có file chữ ký để cập nhật")
          return
        }

        const formData = new FormData()
        formData.append("userId", user.id)
        formData.append("actionToken", actionToken)
        formData.append("file", sensitiveActionModal.file)

        const res = await fetch("/api/account/update-signature", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
          body: formData,
        })
        const json = await res.json()
        if (!res.ok) {
          setSensitiveActionError(json.error || "Không đổi được chữ ký")
          return
        }
        setSignatureUrl(`${json.publicUrl}?t=${Date.now()}`)
        setSigMsg({ ok: true, text: "Đã cập nhật chữ ký cá nhân" })
      } else {
        const res = await fetch("/api/account/change-password", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            userId: user.id,
            newPassword: sensitiveActionModal.newPassword,
            actionToken,
          }),
        })
        const json = await res.json()
        if (!res.ok) {
          setSensitiveActionError(json.error || "Không đổi được mật khẩu")
          return
        }
        setPasswordForm({ password: "", confirm: "", show: false })
        setPasswordMsg({ ok: true, text: "Đã đổi mật khẩu thành công" })
      }

      closeSensitiveActionModal()
    } catch (error) {
      setSensitiveActionError(error instanceof Error ? error.message : "Xác thực thay đổi thất bại")
    } finally {
      setSensitiveActionLoading(false)
    }
  }

  const handleSignatureUpload = async (file: File) => {
    if (!user || !factoryId) return
    if (file.type !== "image/png") {
      setSigMsg({ ok: false, text: "Vui lòng chọn file chữ ký định dạng PNG" })
      return
    }
    if (signatureUrl) {
      beginSensitiveAction({
        actionType: "change_signature",
        title: "Xác thực đổi chữ ký cá nhân",
        submitLabel: "Đổi chữ ký",
        file,
      })
      return
    }
    setSignatureUploading(true)
    setSigMsg(null)
    try {
      const sigPath = `signatures/${factoryId}/${user.id}/chu_ky.png`
      const { error } = await supabase.storage
        .from("iso-documents")
        .upload(sigPath, file, { contentType: "image/png", upsert: true })
      if (error) { setSigMsg({ ok: false, text: error.message }); return }
      const { data } = supabase.storage.from("iso-documents").getPublicUrl(sigPath)
      setSignatureUrl(data.publicUrl + "?t=" + Date.now())
      setSigMsg({ ok: true, text: "Tải lên thành công!" })
    } finally {
      setSignatureUploading(false)
    }
  }

  const handleSetPin = async () => {
    if (!user) return
    if (pinForm.pin !== pinForm.pinConfirm) {
      setPinMsg({ ok: false, text: "Xác nhận PIN không khớp" })
      return
    }
    if (!/^\d{4,6}$/.test(pinForm.pin)) {
      setPinMsg({ ok: false, text: "PIN phải là 4–6 chữ số" })
      return
    }
    if (hasPinSet) {
      beginSensitiveAction({
        actionType: "change_pin",
        title: "Xác thực đổi PIN ký duyệt",
        submitLabel: "Đổi PIN",
        newPin: pinForm.pin,
      })
      return
    }
    setPinSaving(true)
    setPinMsg(null)
    try {
      const accessToken = await getAccessToken()
      const res = await fetch("/api/sign/set-pin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ userId: user.id, pin: pinForm.pin }),
      })
      const json = await res.json()
      if (!res.ok) { setPinMsg({ ok: false, text: json.error || "Lỗi" }); return }
      setPinMsg({ ok: true, text: "Đã lưu PIN ký duyệt!" })
      setHasPinSet(true)
      setPinForm({ pin: "", pinConfirm: "", showPin: false })
    } finally {
      setPinSaving(false)
    }
  }

  const handleChangePassword = async () => {
    if (!user) return
    if (!hasPinSet) {
      setPasswordMsg({ ok: false, text: "Bạn cần thiết lập PIN ký duyệt trước khi đổi mật khẩu" })
      return
    }
    if (passwordForm.password !== passwordForm.confirm) {
      setPasswordMsg({ ok: false, text: "Xác nhận mật khẩu mới không khớp" })
      return
    }
    if (passwordForm.password.length < 6) {
      setPasswordMsg({ ok: false, text: "Mật khẩu mới phải có ít nhất 6 ký tự" })
      return
    }

    setPasswordSaving(true)
    setPasswordMsg(null)
    beginSensitiveAction({
      actionType: "change_password",
      title: "Xác thực đổi mật khẩu",
      submitLabel: "Đổi mật khẩu",
      newPassword: passwordForm.password,
    })
    setPasswordSaving(false)
  }

  const pendingUsers = profiles.filter((item) => item.status === "pending")
  const activeUsers = profiles.filter((item) => item.status === "active")
  const disabledUsers = profiles.filter((item) => item.status === "disabled")

  const tabs = [
    { key: "system" as const, label: "Hệ thống", icon: ShieldCheck, show: canViewUsers || canEditPermissions },
    { key: "factory-config" as const, label: "Cấu hình nhà máy", icon: SlidersHorizontal, show: canManageSettings },
    { key: "master-data" as const, label: "Danh mục", icon: Database, show: canViewMasterData },
    { key: "maintenance" as const, label: "Bảo trì", icon: Wrench, show: canViewMaintenanceConfig },
    { key: "iso-vanban" as const, label: "ISO & Văn bản", icon: FileText, show: canViewIsoSignature },
  ].filter((item) => item.show)

  const configModalFooter = (
    <>
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
    </>
  )

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
            <div className="flex flex-wrap gap-2">
                {([
                  { key: "users" as const, label: "Người dùng", icon: Users, show: canViewUsers },
                  { key: "permissions" as const, label: "Phân quyền", icon: ShieldCheck, show: canEditPermissions },
                  { key: "personnel" as const, label: "Nhân sự", icon: UserCog, show: canViewMaintenanceConfig },
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
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
              <ResponsiveTableWrapper>
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
              </ResponsiveTableWrapper>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck size={15} className="text-emerald-600" />
                <h2 className="font-bold text-slate-800">Tài khoản đang hoạt động</h2>
              </div>
              <ResponsiveTableWrapper>
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
              </ResponsiveTableWrapper>
            </div>
          </div>
        </div>
          )}

          {systemTab === "personnel" && canViewMaintenanceConfig && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
            <div className="bg-gradient-to-r from-orange-50 to-amber-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserCog size={16} className="text-orange-600" />
                <span className="font-extrabold text-slate-700">Nhân sự</span>
              </div>
              {canManageSettings && (
                <button
                  onClick={() => openNewStaffModal()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
                >
                  <Plus size={13} /> Thêm nhân sự
                </button>
              )}
            </div>

            <div className="p-4 space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-emerald-700">Tài khoản đã liên kết</div>
                  <div className="mt-1 text-2xl font-extrabold text-emerald-900">{linkedProfileCount}</div>
                  <div className="text-xs text-emerald-700/80">Tài khoản đã có hồ sơ nhân sự tương ứng.</div>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-amber-700">Tài khoản chưa có hồ sơ</div>
                  <div className="mt-1 text-2xl font-extrabold text-amber-900">{profilesWithoutPersonnel.length}</div>
                  <div className="text-xs text-amber-700/80">Có thể tạo hồ sơ mới hoặc gắn vào hồ sơ đang trống link.</div>
                </div>
                <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-sky-700">Hồ sơ chưa liên kết</div>
                  <div className="mt-1 text-2xl font-extrabold text-sky-900">{staffWithoutProfile.length}</div>
                  {/* eslint-disable-next-line react/no-unescaped-entities */}
                  <div className="text-xs text-sky-700/80">Dùng filter "Chưa liên kết" để rà soát nhanh các hồ sơ này.</div>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-[1.3fr,1fr]">
                <div className="rounded-2xl border border-amber-200 bg-amber-50/40">
                  <div className="flex items-center justify-between border-b border-amber-200 px-4 py-3">
                    <div>
                      <h3 className="text-sm font-extrabold text-slate-700">Tài khoản chưa có hồ sơ</h3>
                      <p className="text-xs text-slate-500">Admin có thể tạo hồ sơ mới hoặc gắn tài khoản này vào hồ sơ đang có.</p>
                    </div>
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-amber-700">{profilesWithoutPersonnel.length}</span>
                  </div>
                  <div className="divide-y divide-amber-100">
                    {profilesWithoutPersonnel.length === 0 ? (
                      <div className="px-4 py-6 text-sm text-slate-500">Tất cả tài khoản trong nhà máy này đã có hồ sơ nhân sự.</div>
                    ) : profilesWithoutPersonnel.map(({ profile }) => (
                      <div key={profile.id} className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <div className="font-semibold text-slate-700">{profile.full_name}</div>
                          <div className="text-xs text-slate-500">{profile.username} • {profile.department || "Chưa có phòng ban"} • {profile.status}</div>
                        </div>
                        {canManageSettings && (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              onClick={() => openNewStaffModal(profile)}
                              className="rounded-xl bg-orange-600 px-3 py-1.5 text-xs font-bold text-white transition-all hover:bg-orange-700"
                            >
                              Tạo hồ sơ từ tài khoản
                            </button>
                            <button
                              onClick={() => setPersonnelLinkModal({ profileId: profile.id, staffId: availableStaffForAccountLink[0]?.id || "" })}
                              disabled={availableStaffForAccountLink.length === 0}
                              className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition-all hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Liên kết vào hồ sơ có sẵn
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-sky-200 bg-sky-50/40">
                  <div className="flex items-center justify-between border-b border-sky-200 px-4 py-3">
                    <div>
                      <h3 className="text-sm font-extrabold text-slate-700">Hồ sơ chưa liên kết tài khoản</h3>
                      <p className="text-xs text-slate-500">Các hồ sơ này đang dùng độc lập và nên được rà soát định kỳ.</p>
                    </div>
                    <button
                      onClick={() => setStaffViewFilter("unlinked")}
                      className="rounded-full border border-sky-200 bg-white px-2.5 py-1 text-xs font-bold text-sky-700 transition-all hover:bg-sky-100"
                    >
                      Lọc chưa liên kết
                    </button>
                  </div>
                  <div className="divide-y divide-sky-100">
                    {staffWithoutProfile.length === 0 ? (
                      <div className="px-4 py-6 text-sm text-slate-500">Chưa có hồ sơ nào bị bỏ trống liên kết tài khoản.</div>
                    ) : staffWithoutProfile.slice(0, 6).map((staff) => (
                      <div key={staff.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div>
                          <div className="font-semibold text-slate-700">{staff.ten}</div>
                          <div className="text-xs text-slate-500">{staff.chuc_vu || "Chưa có chức vụ"} • {staff.group_names.join(", ") || "Chưa có nhóm"}</div>
                        </div>
                        {canManageSettings && (
                          <button
                            onClick={() => openEditStaffModal(staff)}
                            className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition-all hover:border-slate-400"
                          >
                            Mở hồ sơ
                          </button>
                        )}
                      </div>
                    ))}
                    {staffWithoutProfile.length > 6 && (
                      <div className="px-4 py-3 text-xs text-slate-500">Còn {staffWithoutProfile.length - 6} hồ sơ chưa liên kết khác trong danh sách bên dưới.</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {([
                  { key: "all", label: "Tất cả nhân sự" },
                  { key: "maintenance", label: "Nhân sự bảo trì" },
                  { key: "unlinked", label: "Chưa liên kết" },
                ] as const).map((filter) => (
                  <button
                    key={filter.key}
                    onClick={() => setStaffViewFilter(filter.key)}
                    className={"rounded-full px-3 py-1.5 text-xs font-bold transition-all " + (staffViewFilter === filter.key ? "bg-sky-100 text-sky-700 border border-sky-200" : "text-slate-500 hover:bg-slate-100")}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>

              <ResponsiveTableWrapper>
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {["Tên", "Tài khoản", "Nhóm", "Chức vụ", "Giới tính", "Chức vụ chính quyền", "Chức vụ kiêm nhiệm", "Trạng thái", ""].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredMaintStaff.length === 0 ? (
                      <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">Chưa có nhân sự phù hợp</td></tr>
                    ) : filteredMaintStaff.map((s) => (
                      <tr key={`sys-${s.id}`} className="row-hover">
                        <td className="px-4 py-3 font-medium text-slate-700">{s.ten}</td>
                        <td className="px-4 py-3 text-slate-500">{s.profile_id ? (activeProfilesForLink.find((profile) => profile.id === s.profile_id)?.username || "Đã liên kết") : "—"}</td>
                        <td className="px-4 py-3 text-slate-500">{s.group_names.join(", ") || "—"}</td>
                        <td className="px-4 py-3 text-slate-500">{s.chuc_vu || "—"}</td>
                        <td className="px-4 py-3 text-slate-500">{s.gioi_tinh || "—"}</td>
                        <td className="px-4 py-3 text-slate-500">{s.chuc_vu_chinh_quyen || "—"}</td>
                        <td className="px-4 py-3 text-slate-500">{s.chuc_vu_kim_nhiem || "—"}</td>
                        <td className="px-4 py-3">
                          <span className={"px-2 py-0.5 rounded-full text-xs font-bold " + (s.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")}>{s.active ? "Đang làm" : "Ngừng"}</span>
                        </td>
                        <td className="px-4 py-3">
                          {canManageSettings && (
                            <div className="flex items-center gap-1">
                              <button onClick={() => openEditStaffModal(s)} className="p-1.5 hover:bg-blue-50 text-blue-500 rounded-lg transition-colors"><Edit2 size={13} /></button>
                              <button onClick={() => setMaintDelConfirm({ type: "staff", id: s.id, label: s.ten })} className="p-1.5 hover:bg-red-50 text-red-400 rounded-lg transition-colors"><Trash2 size={13} /></button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ResponsiveTableWrapper>

              <div className="rounded-2xl border border-slate-200 bg-slate-50/60">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <div>
                    <h3 className="text-sm font-extrabold text-slate-700">Nhóm</h3>
                    <p className="text-xs text-slate-500">Danh mục nhóm dùng chung cho Nhân sự, Bảo trì và các module sau này.</p>
                  </div>
                  {canManageSettings && personnelGroupsAvailable && (
                    <button
                      onClick={() => {
                        setMaintEditId(null)
                        setMaintError("")
                        setPersonnelGroupForm({ code: "", name: "", description: "", sort_order: "0", is_active: true })
                        setMaintModal("staff-group")
                      }}
                      className="flex items-center gap-1.5 rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-bold text-white transition-all hover:bg-slate-900"
                    >
                      <Plus size={13} /> Thêm nhóm
                    </button>
                  )}
                </div>
                <ResponsiveTableWrapper className="rounded-none rounded-b-2xl border-0 shadow-none">
                  <table className="w-full text-sm">
                    <thead className="bg-white border-b border-slate-200">
                      <tr>
                        {["Mã", "Tên nhóm", "Mô tả", "Loại", "Thứ tự", "Trạng thái", ""].map((h) => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {!personnelGroupsAvailable ? (
                        <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">{personnelGroupsIssue || "Tính năng nhóm chưa sẵn sàng trên môi trường này."}</td></tr>
                      ) : personnelGroups.length === 0 ? (
                        <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Chưa có nhóm nào</td></tr>
                      ) : personnelGroups.map((group) => (
                        <tr key={group.id} className="row-hover">
                          <td className="px-4 py-3 font-mono text-xs text-slate-500">{group.code || "—"}</td>
                          <td className="px-4 py-3 font-medium text-slate-700">{group.name}</td>
                          <td className="px-4 py-3 text-slate-500">{group.description || "—"}</td>
                          <td className="px-4 py-3 text-slate-500">{group.is_system ? "Hệ thống" : "Tự tạo"}</td>
                          <td className="px-4 py-3 text-slate-500">{group.sort_order}</td>
                          <td className="px-4 py-3">
                            <span className={"px-2 py-0.5 rounded-full text-xs font-bold " + (group.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")}>
                              {group.is_active ? "Đang dùng" : "Ngừng"}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {canManageSettings && (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => {
                                    setMaintEditId(group.id)
                                    setMaintError("")
                                    setPersonnelGroupForm({
                                      code: group.code || "",
                                      name: group.name,
                                      description: group.description || "",
                                      sort_order: String(group.sort_order ?? 0),
                                      is_active: group.is_active,
                                    })
                                    setMaintModal("staff-group")
                                  }}
                                  className="rounded-lg p-1.5 text-blue-500 transition-colors hover:bg-blue-50"
                                >
                                  <Edit2 size={13} />
                                </button>
                                {!group.is_system && (
                                  <button
                                    onClick={() => setMaintDelConfirm({ type: "staff-group", id: group.id, label: group.name })}
                                    className="rounded-lg p-1.5 text-red-400 transition-colors hover:bg-red-50"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ResponsiveTableWrapper>
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {Object.entries(groupedPermissions).map(([moduleName, options]) => (
                  <div key={moduleName} className="border border-slate-200 rounded-xl p-4">
                      <div className="font-bold text-slate-800 mb-3">{options[0]?.module_label || moduleName}</div>
                    <div className="flex flex-wrap gap-2">
                      {options.map((option) => (
                        <span
                          key={option.code}
                          className="px-2 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700"
                        >
                          {option.action_label || option.action_name}
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
            <div className="bg-gradient-to-r from-amber-50 to-orange-50 px-6 py-4 border-b border-slate-200 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <SlidersHorizontal size={16} className="text-amber-600" />
                <span className="font-extrabold text-slate-700">Cấu hình nhà máy</span>
              </div>
              {canManageSettings && configTab !== "quality-targets" && (
                <div className="flex flex-wrap items-center gap-2">
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
              <div className="flex flex-wrap gap-2 mb-4">
                {[
                  { key: "warehouses" as const, label: "Kho" },
                  { key: "categories" as const, label: "Nhóm vật tư" },
                  { key: "items" as const, label: "Vật tư / Hóa chất" },
                  { key: "delivery-points" as const, label: "Điểm giao nhận" },
                  { key: "forest-plots" as const, label: "Lô vườn" },
                  { key: "quality-targets" as const, label: "Mục tiêu chất lượng" },
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
                <ResponsiveTableWrapper>
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
                </ResponsiveTableWrapper>
              ) : configTab === "categories" ? (
                <ResponsiveTableWrapper>
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
                </ResponsiveTableWrapper>
              ) : configTab === "items" ? (
                <ResponsiveTableWrapper>
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
                </ResponsiveTableWrapper>
              ) : configTab === "delivery-points" ? (
                <ResponsiveTableWrapper>
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
                </ResponsiveTableWrapper>
              ) : configTab === "forest-plots" ? (
                <ResponsiveTableWrapper>
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
                </ResponsiveTableWrapper>
              ) : configTab === "quality-targets" ? (
                <QualityTargetsTab factoryId={factoryId} canManage={canManageSettings} />
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
            <div className="flex flex-wrap gap-2">
              {[
                { key: "suffixes" as const, label: "Hậu tố lô", icon: Tag },
                { key: "company" as const, label: "Thông tin công ty", icon: Building2 },
                { key: "customers" as const, label: "Khách hàng", icon: ShoppingBag },
                { key: "required-notes" as const, label: "Ghi chú bắt buộc", icon: FileText },
                { key: "van-ban-types" as const, label: "Loại văn bản", icon: FileText },
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
                <ResponsiveTableWrapper>
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
                </ResponsiveTableWrapper>
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

          {masterDataTab === "company" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden mt-4">
            <div className="bg-gradient-to-r from-amber-50 to-orange-50 px-6 py-4 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Sun size={16} className="text-amber-600" />
                <span className="font-extrabold text-slate-700">Tên ca sản xuất</span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Dùng để in trên phiếu báo thành phẩm và gợi ý trong màn hình quét QR xác nhận sản xuất. Để trống nếu không đặt tên riêng cho ca.
              </p>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  { label: "Tên Ca A", field: "ca_a_ten" as const },
                  { label: "Tên Ca B", field: "ca_b_ten" as const },
                  { label: "Tên Ca C", field: "ca_c_ten" as const },
                ].map(({ label, field }) => (
                  <div key={field}>
                    <label className="text-xs font-bold text-slate-600 block mb-1.5">{label}</label>
                    <input
                      value={factoryInfo[field]}
                      onChange={(e) => setFactoryInfo((prev) => ({ ...prev, [field]: e.target.value }))}
                      disabled={!canManageSettings}
                      placeholder="Vd: Sok Khum"
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-amber-500 disabled:bg-slate-50 disabled:text-slate-400"
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
                <ResponsiveTableWrapper className="rounded-none border-0 shadow-none">
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
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
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
                </ResponsiveTableWrapper>
              )}
            </div>
          </div>
          )}

          {masterDataTab === "required-notes" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
            <div className="bg-gradient-to-r from-amber-50 to-orange-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-amber-600" />
                <span className="font-extrabold text-slate-700">Ghi chú bắt buộc</span>
                <span className="text-xs text-slate-400 ml-1">({requiredNotes.length} ghi chú)</span>
              </div>
              {canManageSettings && (
                <button
                  onClick={() => {
                    setRequiredNoteEditId(null)
                    setRequiredNoteForm({ content: "", sort_order: String(requiredNotes.length + 1), is_active: true })
                    setRequiredNoteError("")
                    setRequiredNoteModal("add")
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
                >
                  <Plus size={13} /> Thêm ghi chú
                </button>
              )}
            </div>

            <div className="p-4">
              {requiredNotesLoading ? (
                <div className="p-8 text-center text-slate-400 text-sm">Đang tải...</div>
              ) : requiredNotes.length === 0 ? (
                <div className="p-8 text-center text-slate-400">
                  <FileText size={32} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Chưa có ghi chú dùng chung nào</p>
                </div>
              ) : (
                <ResponsiveTableWrapper>
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {["Nội dung", "Thứ tự", "Trạng thái", ""].map((head) => (
                        <th key={head} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">
                          {head}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {requiredNotes.map((item) => (
                      <tr key={item.id} className="row-hover">
                        <td className="px-4 py-3 text-slate-700 font-medium">{item.content}</td>
                        <td className="px-4 py-3 text-slate-500">{item.sort_order}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${item.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                            {item.is_active ? "Đang dùng" : "Ẩn"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {canManageSettings && (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => {
                                  setRequiredNoteEditId(item.id)
                                  setRequiredNoteForm({ content: item.content, sort_order: String(item.sort_order), is_active: item.is_active })
                                  setRequiredNoteError("")
                                  setRequiredNoteModal("edit")
                                }}
                                className="p-1.5 hover:bg-blue-50 text-blue-500 rounded-lg transition-colors"
                              >
                                <Edit2 size={13} />
                              </button>
                              <button
                                onClick={() => setRequiredNoteDelConfirm({ id: item.id, label: item.content })}
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
                </ResponsiveTableWrapper>
              )}
            </div>
          </div>
          )}

          {masterDataTab === "van-ban-types" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-blue-600" />
                <span className="font-extrabold text-slate-700">Loại văn bản</span>
                <span className="text-xs text-slate-400 ml-1">({vanBanTypes.length} loại)</span>
              </div>
              {canManageSettings && (
                <button
                  onClick={() => {
                    setVbtEditId(null)
                    setVbtForm({ code: "", name: "", ky_hieu: "", sort_order: String(vanBanTypes.length + 1), is_active: true })
                    setVbtError("")
                    setVbtModal("add")
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
                >
                  <Plus size={13} /> Thêm loại
                </button>
              )}
            </div>

            <div className="p-4">
              {vbtLoading ? (
                <div className="p-8 text-center text-slate-400 text-sm">Đang tải...</div>
              ) : vanBanTypes.length === 0 ? (
                <div className="p-8 text-center text-slate-400">
                  <FileText size={32} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Chưa có loại văn bản nào</p>
                </div>
              ) : (
                <ResponsiveTableWrapper>
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {["Mã loại", "Tên loại", "Ký hiệu mã", "Thứ tự", "Trạng thái", ""].map((head) => (
                        <th key={head} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">
                          {head}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {vanBanTypes.map((item) => (
                      <tr key={item.id} className="row-hover">
                        <td className="px-4 py-3 font-mono font-bold text-slate-700">{item.code}</td>
                        <td className="px-4 py-3 text-slate-700 font-medium">{item.name}</td>
                        <td className="px-4 py-3 font-mono text-slate-600">{item.ky_hieu}</td>
                        <td className="px-4 py-3 text-slate-500">{item.sort_order}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${item.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                            {item.is_active ? "Đang dùng" : "Ẩn"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {canManageSettings && (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => {
                                  setVbtEditId(item.id)
                                  setVbtForm({ code: item.code, name: item.name, ky_hieu: item.ky_hieu, sort_order: String(item.sort_order), is_active: item.is_active })
                                  setVbtError("")
                                  setVbtModal("edit")
                                }}
                                className="p-1.5 hover:bg-blue-50 text-blue-500 rounded-lg transition-colors"
                              >
                                <Edit2 size={13} />
                              </button>
                              <button
                                onClick={() => setVbtDelConfirm({ id: item.id, label: `${item.code} — ${item.name}` })}
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
                </ResponsiveTableWrapper>
              )}
              {vbtError && !vbtModal && (
                <div className="mt-3 flex items-center gap-2 px-4 py-2 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                  <AlertTriangle size={14} />
                  {vbtError}
                </div>
              )}
            </div>
          </div>
          )}
        </div>
      )}


      {tab === "maintenance" && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
            <div className="bg-gradient-to-r from-orange-50 to-amber-50 px-6 py-4 border-b border-slate-200 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Wrench size={16} className="text-orange-600" />
                <span className="font-extrabold text-slate-700">Bảo trì</span>
              </div>
              {canManageSettings && (
                <div className="flex flex-wrap items-center gap-2">
                  {maintTab === "vehicles" && (
                    <button
                      onClick={() => { setConfigEditId(null); setConfigError(""); setDispatchDriverForm(emptyDispatchDriverForm()); setConfigModal("driver") }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-xl transition-all"
                    >
                      <Plus size={13} /> Thêm tài xế
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setMaintEditId(null); setMaintError("")
                      if (maintTab === "assets") { setAssetForm({ ma_tb: "", ten_tb: "", bo_phan: "Mủ tạp", loai: "may_moc", nam_sd: "", bien_so: "", mo_ta: "", trang_thai: "active" }); setMaintModal("asset") }
                      else if (maintTab === "staff") openNewStaffModal()
                      else if (maintTab === "vehicles") { setConfigEditId(null); setConfigError(""); setDispatchVehicleForm(emptyDispatchVehicleForm(String((dispatchVehicles.length > 0 ? Math.max(...dispatchVehicles.map(v => v.sort_order || 0)) + 1 : 1)))); setConfigModal("vehicle") }
                      else { setExtMatForm({ ten_vat_tu: "", dvt: "", code: "", specification: "", category_id: "", is_active: true }); setMaintModal("ext-mat") }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
                  >
                    <Plus size={13} /> {maintTab === "vehicles" ? "Thêm xe" : "Thêm mới"}
                  </button>
                </div>
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
                    {key === "assets" ? <><Car size={13} /> Thiết bị</> : key === "staff" ? <><UserCog size={13} /> Nhân sự</> : key === "vehicles" ? <><Car size={13} /> Xe &amp; Tài xế</> : <><ShoppingBag size={13} /> Vật tư ngoài</>}
                  </button>
                ))}
              </div>

              {maintLoading ? (
                <div className="p-8 text-center text-slate-400 text-sm">Đang tải...</div>
              ) : maintTab === "assets" ? (
                <ResponsiveTableWrapper>
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
                </ResponsiveTableWrapper>
              ) : maintTab === "vehicles" ? (
                <>
                <ResponsiveTableWrapper>
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
                </ResponsiveTableWrapper>
                <div className="border-t border-slate-200 mt-2 pt-4">
                  <div className="flex items-center gap-2 mb-3">
                    <h3 className="text-sm font-extrabold text-slate-700">Danh sách tài xế</h3>
                    <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{dispatchDrivers.length} tài xế</span>
                  </div>
                  <ResponsiveTableWrapper>
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        {["Mã", "Tên tài xế", "Điện thoại", "Hạng bằng", "Hết hạn", "Trạng thái", ""].map((h) => (
                          <th key={h} className="px-4 py-2.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {dispatchDrivers.length === 0 ? (
                        <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">Chưa có tài xế nào</td></tr>
                      ) : dispatchDrivers.map((d) => (
                        <tr key={d.id} className="row-hover">
                          <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{d.code || "—"}</td>
                          <td className="px-4 py-2.5 font-medium text-slate-700">{d.name}</td>
                          <td className="px-4 py-2.5 text-slate-500 text-xs">{d.phone || "—"}</td>
                          <td className="px-4 py-2.5 text-slate-500 text-xs">{d.license_class || "—"}</td>
                          <td className="px-4 py-2.5 text-xs">{d.license_expiry ? <span className={new Date(d.license_expiry) < new Date() ? "text-red-600 font-bold" : "text-slate-500"}>{d.license_expiry}</span> : <span className="text-slate-300">—</span>}</td>
                          <td className="px-4 py-2.5">
                            <span className={"px-2 py-0.5 rounded-full text-xs font-bold " + (d.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")}>{d.is_active ? "Đang dùng" : "Ngừng"}</span>
                          </td>
                          <td className="px-4 py-2.5">
                            {canManageSettings && (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => {
                                    setConfigEditId(d.id); setConfigError("")
                                    setDispatchDriverForm({ code: d.code || "", name: d.name, phone: d.phone || "", license_number: d.license_number || "", license_class: d.license_class || "", license_expiry: d.license_expiry || "", id_number: d.id_number || "", notes: d.notes || "", is_active: d.is_active })
                                    setConfigModal("driver")
                                  }}
                                  className="p-1.5 hover:bg-blue-50 text-blue-500 rounded-lg transition-colors"
                                ><Edit2 size={13} /></button>
                                <button
                                  onClick={() => setConfigDelConfirm({ type: "driver", id: d.id, label: d.name })}
                                  className="p-1.5 hover:bg-red-50 text-red-400 rounded-lg transition-colors"
                                ><Trash2 size={13} /></button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </ResponsiveTableWrapper>
                </div>
                </>
              ) : maintTab === "staff" ? (
                <>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {([
                    { key: "all", label: "Tất cả nhân sự" },
                    { key: "maintenance", label: "Nhân sự bảo trì" },
                    { key: "unlinked", label: "Chưa liên kết" },
                  ] as const).map((filter) => (
                    <button
                      key={filter.key}
                      onClick={() => setStaffViewFilter(filter.key)}
                      className={"rounded-full px-3 py-1.5 text-xs font-bold transition-all " + (staffViewFilter === filter.key ? "bg-sky-100 text-sky-700 border border-sky-200" : "text-slate-500 hover:bg-slate-100")}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
                <ResponsiveTableWrapper>
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {["Tên", "Tài khoản", "Nhóm", "Chức vụ", "Giới tính", "Chức vụ chính quyền", "Chức vụ kiêm nhiệm", "Trạng thái", ""].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredMaintStaff.length === 0 ? (
                      <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">Chưa có nhân sự phù hợp</td></tr>
                    ) : filteredMaintStaff.map((s) => (
                      <tr key={s.id} className="row-hover">
                        <td className="px-4 py-3 font-medium text-slate-700">{s.ten}</td>
                          <td className="px-4 py-3 text-slate-500">{s.profile_id ? (activeProfilesForLink.find((profile) => profile.id === s.profile_id)?.username || "Đã liên kết") : "—"}</td>
                          <td className="px-4 py-3 text-slate-500">{s.group_names.join(", ") || "—"}</td>
                          <td className="px-4 py-3 text-slate-500">{s.chuc_vu || "—"}</td>
                        <td className="px-4 py-3 text-slate-500">{s.gioi_tinh || "—"}</td>
                        <td className="px-4 py-3 text-slate-500">{s.chuc_vu_chinh_quyen || "—"}</td>
                        <td className="px-4 py-3 text-slate-500">{s.chuc_vu_kim_nhiem || "—"}</td>
                        <td className="px-4 py-3">
                          <span className={"px-2 py-0.5 rounded-full text-xs font-bold " + (s.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")}>{s.active ? "Đang làm" : "Ngừng"}</span>
                        </td>
                        <td className="px-4 py-3">
                          {canManageSettings && (
                            <div className="flex items-center gap-1">
                              <button onClick={() => openEditStaffModal(s)} className="p-1.5 hover:bg-blue-50 text-blue-500 rounded-lg transition-colors"><Edit2 size={13} /></button>
                              <button onClick={() => setMaintDelConfirm({ type: "staff", id: s.id, label: s.ten })} className="p-1.5 hover:bg-red-50 text-red-400 rounded-lg transition-colors"><Trash2 size={13} /></button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </ResponsiveTableWrapper>
                </>
              ) : (
                <ResponsiveTableWrapper>
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
                </ResponsiveTableWrapper>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Maintenance modals */}
      {maintModal === "asset" && (
        <ModalShell
          title={maintEditId ? "Sửa thiết bị" : "Thêm thiết bị mới"}
          onClose={() => setMaintModal(null)}
          maxWidth="lg"
          footer={
            <>
              <button onClick={() => setMaintModal(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
              <button onClick={saveMaintAsset} disabled={maintSaving} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl disabled:opacity-50">{maintSaving ? "Đang lưu..." : "Lưu"}</button>
            </>
          }
        >
            <div className="space-y-4">
              {maintError && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex items-center gap-2"><AlertTriangle size={14} />{maintError}</div>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            </div>
        </ModalShell>
      )}

      {maintModal === "staff" && (
        <ModalShell
          title={maintEditId ? "Sửa nhân sự" : "Thêm nhân sự"}
          onClose={() => setMaintModal(null)}
          maxWidth="md"
          footer={
            <>
              <button onClick={() => setMaintModal(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
              <button onClick={saveMaintStaff} disabled={maintSaving} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl disabled:opacity-50">{maintSaving ? "Đang lưu..." : "Lưu"}</button>
            </>
          }
        >
            <div className="space-y-4">
              {maintError && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex items-center gap-2"><AlertTriangle size={14} />{maintError}</div>}
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Họ tên *</label>
                <input value={staffForm.ten} onChange={e => setStaffForm(p => ({ ...p, ten: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" placeholder="VD: Nguyễn Văn A" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Liên kết tài khoản</label>
                <select
                  value={staffForm.profile_id}
                  onChange={(e) => {
                    const nextProfileId = e.target.value
                    const linkedProfile = availableProfilesForStaffForm.find((profile) => profile.id === nextProfileId)
                    setStaffForm((prev) => ({
                      ...prev,
                      profile_id: nextProfileId,
                      ten: linkedProfile && !prev.ten.trim() ? linkedProfile.full_name : prev.ten,
                    }))
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                >
                  <option value="">Không liên kết</option>
                  {availableProfilesForStaffForm.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.full_name} ({profile.username})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Nhóm</label>
                {!maintLoaded ? (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                    Đang tải danh mục nhóm...
                  </div>
                ) : !personnelGroupsAvailable ? (
                  <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                    {personnelGroupsIssue || "Tính năng nhóm chưa sẵn sàng trên hệ thống này."}
                  </div>
                ) : personnelGroups.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                    Chưa có danh mục nhóm cho nhà máy này. Hãy thêm nhóm đầu tiên để bắt đầu.
                  </div>
                ) : (
                  <div className="max-h-40 space-y-2 overflow-auto rounded-xl border border-slate-300 px-3 py-2">
                    {personnelGroups.filter((group) => group.is_active !== false).map((group) => {
                      const checked = staffForm.group_ids.includes(group.id)
                      return (
                        <label key={group.id} className="flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => setStaffForm((prev) => ({
                              ...prev,
                              group_ids: e.target.checked
                                ? [...prev.group_ids, group.id]
                                : prev.group_ids.filter((item) => item !== group.id),
                            }))}
                          />
                          <span>{group.name}</span>
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Chức vụ</label>
                <input value={staffForm.chuc_vu} onChange={e => setStaffForm(p => ({ ...p, chuc_vu: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" placeholder="VD: Nhân viên kỹ thuật" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Email nhận thông báo</label>
                <input type="email" value={staffForm.email} onChange={e => setStaffForm(p => ({ ...p, email: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" placeholder="VD: giamdoc@gmail.com" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Giới tính</label>
                  <select value={staffForm.gioi_tinh} onChange={e => setStaffForm(p => ({ ...p, gioi_tinh: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                    <option value="">Chưa chọn</option>
                    <option value="Nam">Nam</option>
                    <option value="Nữ">Nữ</option>
                    <option value="Khác">Khác</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Chức vụ chính quyền</label>
                  <input value={staffForm.chuc_vu_chinh_quyen} onChange={e => setStaffForm(p => ({ ...p, chuc_vu_chinh_quyen: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" placeholder="VD: Chủ tịch công đoàn" />
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Chức vụ kiêm nhiệm</label>
                <input value={staffForm.chuc_vu_kim_nhiem} onChange={e => setStaffForm(p => ({ ...p, chuc_vu_kim_nhiem: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" placeholder="VD: Trưởng ban ISO" />
              </div>
              <div className="flex items-center gap-3">
                <input type="checkbox" id="staff-active" checked={staffForm.active} onChange={e => setStaffForm(p => ({ ...p, active: e.target.checked }))} className="w-4 h-4 accent-emerald-600" />
                <label htmlFor="staff-active" className="text-sm font-bold text-slate-600">Đang làm việc</label>
              </div>
            </div>
        </ModalShell>
      )}

      {personnelLinkModal && (
        <ModalShell
          title="Liên kết vào hồ sơ có sẵn"
          onClose={() => setPersonnelLinkModal(null)}
          maxWidth="md"
          footer={
            <>
              <button onClick={() => setPersonnelLinkModal(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
              <button onClick={handleQuickLinkProfileToStaff} disabled={maintSaving || !personnelLinkModal.staffId} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl disabled:opacity-50">
                {maintSaving ? "Đang lưu..." : "Liên kết"}
              </button>
            </>
          }
        >
              <p className="text-xs text-slate-500 -mt-2 mb-4">
                {profiles.find((profile) => profile.id === personnelLinkModal.profileId)?.full_name || "Tài khoản đã chọn"}
              </p>
              {maintError && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex items-center gap-2"><AlertTriangle size={14} />{maintError}</div>}
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Chọn hồ sơ chưa liên kết</label>
                <select
                  value={personnelLinkModal.staffId}
                  onChange={(e) => setPersonnelLinkModal((prev) => (prev ? { ...prev, staffId: e.target.value } : prev))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                >
                  <option value="">Chọn hồ sơ</option>
                  {availableStaffForAccountLink.map((staff) => (
                    <option key={staff.id} value={staff.id}>
                      {staff.ten}{staff.chuc_vu ? ` - ${staff.chuc_vu}` : ""}
                    </option>
                  ))}
                </select>
              </div>
        </ModalShell>
      )}

      {maintModal === "staff-group" && (
        <ModalShell
          title={maintEditId ? "Sửa nhóm" : "Thêm nhóm"}
          onClose={() => setMaintModal(null)}
          maxWidth="lg"
          footer={
            <>
              <button onClick={() => setMaintModal(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
              <button onClick={savePersonnelGroup} disabled={maintSaving} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl disabled:opacity-50">{maintSaving ? "Đang lưu..." : "Lưu nhóm"}</button>
            </>
          }
        >
              <div className="space-y-4">
              {maintError && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex items-center gap-2"><AlertTriangle size={14} />{maintError}</div>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Mã nhóm</label>
                  <input value={personnelGroupForm.code} onChange={e => setPersonnelGroupForm((p) => ({ ...p, code: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 font-mono" placeholder="VD: bao-tri" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Thứ tự</label>
                  <input value={personnelGroupForm.sort_order} onChange={e => setPersonnelGroupForm((p) => ({ ...p, sort_order: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" inputMode="numeric" />
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Tên nhóm *</label>
                <input value={personnelGroupForm.name} onChange={e => setPersonnelGroupForm((p) => ({ ...p, name: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" placeholder="VD: Bảo trì" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Mô tả</label>
                <textarea value={personnelGroupForm.description} onChange={e => setPersonnelGroupForm((p) => ({ ...p, description: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 min-h-[96px]" placeholder="Nhóm dùng cho phê duyệt, bảo trì hoặc quản lý công việc..." />
              </div>
              <div className="flex items-center gap-3">
                <input type="checkbox" id="personnel-group-active" checked={personnelGroupForm.is_active} onChange={e => setPersonnelGroupForm((p) => ({ ...p, is_active: e.target.checked }))} className="w-4 h-4 accent-emerald-600" />
                <label htmlFor="personnel-group-active" className="text-sm font-bold text-slate-600">Đang sử dụng</label>
              </div>
              </div>
        </ModalShell>
      )}

      {maintModal === "ext-mat" && (
        <ModalShell
          title={maintEditId ? "Sửa vật tư ngoài" : "Thêm vật tư ngoài"}
          onClose={() => setMaintModal(null)}
          maxWidth="lg"
          footer={
            <>
              <button onClick={() => setMaintModal(null)} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
              <button onClick={saveMaintExtMat} disabled={maintSaving} className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md disabled:opacity-50">{maintSaving ? "Đang lưu..." : "Lưu"}</button>
            </>
          }
        >
            <div className="space-y-4">
              {maintError && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex items-center gap-2"><AlertTriangle size={14} />{maintError}</div>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Mã vật tư</label>
                  <input value={extMatForm.code} onChange={e => setExtMatForm(p => ({ ...p, code: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 font-mono" placeholder="VD: BD22211" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Nhóm vật tư</label>
                  <select value={extMatForm.category_id} onChange={e => setExtMatForm(p => ({ ...p, category_id: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                    <option value="">— Không phân nhóm —</option>
                    {invCategories.map(c => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Tên vật tư *</label>
                  <input value={extMatForm.ten_vat_tu} onChange={e => setExtMatForm(p => ({ ...p, ten_vat_tu: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" placeholder="VD: Bạc đạn 22211" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Đơn vị tính</label>
                  <input value={extMatForm.dvt} onChange={e => setExtMatForm(p => ({ ...p, dvt: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" placeholder="VD: cái, kg" />
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Quy cách / Đặc tính</label>
                <input value={extMatForm.specification} onChange={e => setExtMatForm(p => ({ ...p, specification: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" placeholder="VD: 110x50x40, 6204-2RS" />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="extmat-active" checked={extMatForm.is_active} onChange={e => setExtMatForm(p => ({ ...p, is_active: e.target.checked }))} className="rounded" />
                <label htmlFor="extmat-active" className="text-sm font-bold text-slate-600">Đang sử dụng</label>
              </div>
            </div>
        </ModalShell>
      )}

      {maintDelConfirm && (
        <ModalShell
          title="Xác nhận xóa"
          onClose={() => setMaintDelConfirm(null)}
          maxWidth="sm"
          footer={
            <>
              <button onClick={() => setMaintDelConfirm(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
              <button onClick={deleteMaintItem} className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl">Xóa</button>
            </>
          }
        >
            <p className="text-sm text-slate-600">Xóa <span className="font-bold text-red-600">&quot;{maintDelConfirm.label}&quot;</span>? Thao tác không thể hoàn tác.</p>
        </ModalShell>
      )}

      {modal && (
        <ModalShell
          title={modal === "add" ? "Thêm hậu tố mới" : `Sửa hậu tố "${editCode}"`}
          onClose={() => setModal(null)}
          maxWidth="md"
          footer={
            <>
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
            </>
          }
        >
            <div className="space-y-4">
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
        </ModalShell>
      )}

      {delConfirm && (
        <ModalShell
          title={
            <span className="flex items-center gap-3">
              <span className="p-2 bg-red-100 text-red-600 rounded-xl"><AlertTriangle size={18} /></span>
              {`Xóa hậu tố "${delConfirm}"?`}
            </span>
          }
          onClose={() => setDelConfirm(null)}
          maxWidth="sm"
          footer={
            <>
              <button onClick={() => setDelConfirm(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
                Hủy
              </button>
              <button onClick={() => handleDelete(delConfirm)} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl">
                Xóa
              </button>
            </>
          }
        >
            <p className="text-sm text-slate-500">Hành động này không thể hoàn tác.</p>
        </ModalShell>
      )}

      {requiredNoteModal && (
        <ModalShell
          title={requiredNoteModal === "add" ? "Thêm ghi chú" : "Sửa ghi chú"}
          onClose={() => setRequiredNoteModal(null)}
          maxWidth="md"
          footer={
            <>
              <button onClick={() => setRequiredNoteModal(null)} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
              <button onClick={saveRequiredNote} disabled={requiredNoteSaving} className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl shadow-md disabled:opacity-50">{requiredNoteSaving ? "Đang lưu..." : "Lưu"}</button>
            </>
          }
        >
            <div className="space-y-4">
              {requiredNoteError && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex items-center gap-2"><AlertTriangle size={14} />{requiredNoteError}</div>}
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Nội dung ghi chú *</label>
                <input value={requiredNoteForm.content} onChange={e => setRequiredNoteForm((p) => ({ ...p, content: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-amber-500" placeholder="VD: Xe hư giữa đường" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Thứ tự</label>
                  <input value={requiredNoteForm.sort_order} onChange={e => setRequiredNoteForm((p) => ({ ...p, sort_order: e.target.value.replace(/\D/g, "") }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-amber-500" />
                </div>
                <div className="flex items-center gap-2 pt-7">
                  <input type="checkbox" id="required-note-active" checked={requiredNoteForm.is_active} onChange={e => setRequiredNoteForm((p) => ({ ...p, is_active: e.target.checked }))} className="rounded" />
                  <label htmlFor="required-note-active" className="text-sm font-bold text-slate-600">Đang sử dụng</label>
                </div>
              </div>
            </div>
        </ModalShell>
      )}

      {requiredNoteDelConfirm && (
        <ModalShell
          title="Xác nhận xóa"
          onClose={() => setRequiredNoteDelConfirm(null)}
          maxWidth="sm"
          footer={
            <>
              <button onClick={() => setRequiredNoteDelConfirm(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
              <button onClick={deleteRequiredNote} className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl">Xóa</button>
            </>
          }
        >
            <p className="text-sm text-slate-600">Xóa ghi chú <span className="font-bold text-red-600">&quot;{requiredNoteDelConfirm.label}&quot;</span>? Thao tác không thể hoàn tác.</p>
        </ModalShell>
      )}

      {vbtModal && (
        <ModalShell
          title={vbtModal === "add" ? "Thêm loại văn bản" : "Sửa loại văn bản"}
          onClose={() => { setVbtModal(null); setVbtError("") }}
          maxWidth="md"
          footer={
            <>
              <button onClick={() => { setVbtModal(null); setVbtError("") }} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
              <button onClick={saveVanBanType} disabled={vbtSaving} className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-md disabled:opacity-50">{vbtSaving ? "Đang lưu..." : "Lưu"}</button>
            </>
          }
        >
            <div className="space-y-4">
              {vbtError && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex items-center gap-2"><AlertTriangle size={14} />{vbtError}</div>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Mã loại *</label>
                  <input
                    value={vbtForm.code}
                    onChange={e => setVbtForm(p => ({ ...p, code: e.target.value.toUpperCase() }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-mono outline-none focus:border-blue-500"
                    placeholder="VD: BC"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Ký hiệu mã *</label>
                  <input
                    value={vbtForm.ky_hieu}
                    onChange={e => setVbtForm(p => ({ ...p, ky_hieu: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-mono outline-none focus:border-blue-500"
                    placeholder="VD: BC"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Tên loại *</label>
                <input
                  value={vbtForm.name}
                  onChange={e => setVbtForm(p => ({ ...p, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-blue-500"
                  placeholder="VD: Báo cáo"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Thứ tự</label>
                  <input
                    value={vbtForm.sort_order}
                    onChange={e => setVbtForm(p => ({ ...p, sort_order: e.target.value.replace(/\D/g, "") }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-blue-500"
                  />
                </div>
                <div className="flex items-center gap-2 pt-7">
                  <input type="checkbox" id="vbt-active" checked={vbtForm.is_active} onChange={e => setVbtForm(p => ({ ...p, is_active: e.target.checked }))} className="rounded" />
                  <label htmlFor="vbt-active" className="text-sm font-bold text-slate-600">Đang sử dụng</label>
                </div>
              </div>
            </div>
        </ModalShell>
      )}

      {vbtDelConfirm && (
        <ModalShell
          title="Xác nhận xóa"
          onClose={() => { setVbtDelConfirm(null); setVbtError("") }}
          maxWidth="sm"
          footer={
            <>
              <button onClick={() => { setVbtDelConfirm(null); setVbtError("") }} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
              <button onClick={deleteVanBanType} className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl">Xóa</button>
            </>
          }
        >
            <p className="text-sm text-slate-600">Xóa loại văn bản <span className="font-bold text-red-600">&quot;{vbtDelConfirm.label}&quot;</span>? Thao tác không thể hoàn tác.</p>
            {vbtError && <p className="text-sm text-red-600 mt-3">{vbtError}</p>}
        </ModalShell>
      )}

      {customerModal && (
        <ModalShell
          title={customerModal === "add" ? "Thêm khách hàng" : "Sửa khách hàng"}
          onClose={() => setCustomerModal(null)}
          maxWidth="md"
          footer={
            <>
              <button onClick={() => setCustomerModal(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
              <button onClick={saveCustomer} disabled={customerSaving} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl disabled:opacity-50">{customerSaving ? "Đang lưu..." : "Lưu"}</button>
            </>
          }
        >
            <div className="space-y-4">
              {customerError && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex items-center gap-2"><AlertTriangle size={14} />{customerError}</div>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            </div>
        </ModalShell>
      )}

      {customerDelConfirm && (
        <ModalShell
          title="Xác nhận xóa"
          onClose={() => setCustomerDelConfirm(null)}
          maxWidth="sm"
          footer={
            <>
              <button onClick={() => setCustomerDelConfirm(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
              <button onClick={deleteCustomer} className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl">Xóa</button>
            </>
          }
        >
            <p className="text-sm text-slate-600">Xóa khách hàng <span className="font-bold text-red-600">&quot;{customerDelConfirm.label}&quot;</span>? Thao tác không thể hoàn tác.</p>
        </ModalShell>
      )}

      {userEditor && (
        <ModalShell
          title={userEditor.mode === "approve" ? "Duyệt tài khoản" : "Sửa quyền người dùng"}
          onClose={() => setUserEditor(null)}
          maxWidth="4xl"
          footer={
            <>
              <button onClick={() => setUserEditor(null)} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
                Hủy
              </button>
              <button
                onClick={saveUserApproval}
                disabled={savingUser}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all disabled:opacity-50"
              >
                {savingUser ? "Đang lưu..." : userEditor.mode === "approve" ? "Duyệt và kích hoạt" : "Lưu quyền"}
              </button>
            </>
          }
        >
            <div className="space-y-5">
              <p className="text-sm text-slate-500 -mt-3">
                {userEditor.fullName} ({userEditor.username})
              </p>
              {userError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex items-center gap-2">
                  <AlertTriangle size={14} /> {userError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                <label className="text-xs font-bold text-slate-600 block mb-3">Phân quyền *</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {Object.entries(groupedPermissions).map(([moduleName, options]) => (
                    <div key={moduleName} className="border border-slate-200 rounded-xl p-4">
                      <div className="font-bold text-slate-800 mb-3">{options[0]?.module_label || moduleName}</div>
                      <div className="space-y-2">
                        {options.map((option) => (
                          <label key={option.code} className="flex items-center gap-2 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              checked={userEditor.permissions.includes(option.code)}
                              onChange={() => togglePermission(option.code)}
                              className="rounded border-slate-300"
                            />
                            <span>{option.action_label || option.action_name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
        </ModalShell>
      )}

      {configModal && (
        <ModalShell
          title={
            configModal === "warehouse"
              ? (configEditId ? "Sửa kho" : "Thêm kho mới")
              : configModal === "category"
                ? (configEditId ? "Sửa nhóm" : "Thêm nhóm vật tư")
                : configModal === "item"
                  ? (configEditId ? "Sửa vật tư" : "Thêm vật tư")
                  : configModal === "forest-plot"
                    ? (configEditId ? "Sửa lô vườn" : "Thêm lô vườn mới")
                    : configModal === "driver"
                      ? (configEditId ? "Sửa tài xế" : "Thêm tài xế mới")
                      : configModal === "vehicle"
                        ? (configEditId ? "Sửa xe" : "Thêm xe mới")
                        : (configEditId ? "Sửa điểm giao nhận" : "Thêm điểm giao nhận")
          }
          onClose={() => setConfigModal(null)}
          maxWidth={configModal === "forest-plot" ? "3xl" : "lg"}
          footer={configModalFooter}
        >
            <div className="space-y-4">
              {configError && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex items-center gap-2"><AlertTriangle size={14} />{configError}</div>}

              {configModal === "warehouse" && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      {invWarehouses.map((w) => (
                        <label key={w.id} className="flex items-center gap-2 text-sm text-slate-700">
                          <input type="checkbox" checked={invItemForm.selected_warehouse_ids.includes(w.id)} onChange={(e) => setInvItemForm((p) => ({ ...p, selected_warehouse_ids: e.target.checked ? [...p.selected_warehouse_ids, w.id] : p.selected_warehouse_ids.filter((id) => id !== w.id) }))} />
                          {w.code} - {w.name}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-1.5">Tên tài xế *</label>
                    <input value={dispatchDriverForm.name} onChange={(e) => setDispatchDriverForm((p) => ({ ...p, name: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Mã tài xế</label>
                      <input value={dispatchDriverForm.code} onChange={(e) => setDispatchDriverForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Số điện thoại</label>
                      <input value={dispatchDriverForm.phone} onChange={(e) => setDispatchDriverForm((p) => ({ ...p, phone: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Số GPLX</label>
                      <input value={dispatchDriverForm.license_number} onChange={(e) => setDispatchDriverForm((p) => ({ ...p, license_number: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" placeholder="VD: 030012345678" />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Hạng bằng</label>
                      <input value={dispatchDriverForm.license_class} onChange={(e) => setDispatchDriverForm((p) => ({ ...p, license_class: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" placeholder="VD: B2, C, D" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngày hết hạn bằng</label>
                      <input type="date" value={dispatchDriverForm.license_expiry} onChange={(e) => setDispatchDriverForm((p) => ({ ...p, license_expiry: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Số CMND/CCCD</label>
                      <input value={dispatchDriverForm.id_number} onChange={(e) => setDispatchDriverForm((p) => ({ ...p, id_number: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-1.5">Ghi chú</label>
                    <input value={dispatchDriverForm.notes} onChange={(e) => setDispatchDriverForm((p) => ({ ...p, notes: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={dispatchDriverForm.is_active} onChange={(e) => setDispatchDriverForm((p) => ({ ...p, is_active: e.target.checked }))} /> Đang dùng
                  </label>
                </>
              )}
              {configModal === "vehicle" && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Mã xe *</label>
                      <input value={dispatchVehicleForm.code} onChange={(e) => setDispatchVehicleForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))} disabled={!!configEditId} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50" />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Thứ tự</label>
                      <input value={dispatchVehicleForm.sort_order} onChange={(e) => setDispatchVehicleForm((p) => ({ ...p, sort_order: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Tên xe *</label>
                      <input value={dispatchVehicleForm.name} onChange={(e) => setDispatchVehicleForm((p) => ({ ...p, name: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Loại xe</label>
                      <input value={dispatchVehicleForm.vehicle_type} onChange={(e) => setDispatchVehicleForm((p) => ({ ...p, vehicle_type: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Biển số</label>
                      <input value={dispatchVehicleForm.plate_number} onChange={(e) => setDispatchVehicleForm((p) => ({ ...p, plate_number: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-bold text-slate-600">Tài xế chính *</label>
                        <button
                          type="button"
                          onClick={() => { setVehicleDriverAddOpen(true); setVehicleDriverAddError(""); setVehicleDriverAddForm({ name: "", code: "", phone: "", license_number: "", license_class: "", license_expiry: "", id_number: "", notes: "", is_active: true }) }}
                          className="flex items-center gap-0.5 text-[10px] font-bold text-emerald-600 hover:text-emerald-700"
                        >
                          <Plus size={10} /> Thêm tài xế
                        </button>
                      </div>
                      <input
                        type="text"
                        placeholder="Tìm tài xế..."
                        value={vehicleDriverSearch}
                        onChange={(e) => setVehicleDriverSearch(e.target.value)}
                        className="w-full px-3 py-1.5 border border-slate-200 rounded-t-xl text-xs outline-none focus:border-emerald-400 bg-slate-50"
                      />
                      <select
                        value={dispatchVehicleForm.primary_driver_id}
                        onChange={(e) => { setDispatchVehicleForm((p) => ({ ...p, primary_driver_id: e.target.value })); setVehicleDriverSearch("") }}
                        className="w-full px-3 py-2 border border-t-0 border-slate-300 rounded-b-xl text-sm outline-none focus:border-emerald-500"
                        size={Math.min(5, dispatchDrivers.filter(r => (r.is_active || r.id === dispatchVehicleForm.primary_driver_id) && (!vehicleDriverSearch || r.name.toLowerCase().includes(vehicleDriverSearch.toLowerCase()) || (r.code || "").toLowerCase().includes(vehicleDriverSearch.toLowerCase()))).length + 1)}
                      >
                        <option value="">Chọn tài xế</option>
                        {dispatchDrivers
                          .filter((row) => (row.is_active || row.id === dispatchVehicleForm.primary_driver_id) && (!vehicleDriverSearch || row.name.toLowerCase().includes(vehicleDriverSearch.toLowerCase()) || (row.code || "").toLowerCase().includes(vehicleDriverSearch.toLowerCase())))
                          .map((row) => (
                            <option key={row.id} value={row.id}>{row.code ? `${row.code} - ${row.name}` : row.name}</option>
                          ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Mã điểm *</label>
                      <input value={deliveryPointForm.ma_lo} onChange={(e) => setDeliveryPointForm((p) => ({ ...p, ma_lo: e.target.value.toUpperCase() }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Đội *</label>
                      <input value={deliveryPointForm.doi} onChange={(e) => setDeliveryPointForm((p) => ({ ...p, doi: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Vĩ độ *</label>
                      <input value={deliveryPointForm.lat} onChange={(e) => setDeliveryPointForm((p) => ({ ...p, lat: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Kinh độ *</label>
                      <input value={deliveryPointForm.lng} onChange={(e) => setDeliveryPointForm((p) => ({ ...p, lng: e.target.value }))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Phiên A</label>
                      <input value={deliveryPointForm.phien_a} onChange={(e) => setDeliveryPointForm((p) => ({ ...p, phien_a: e.target.value }))} placeholder="A1, A2, B1" className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Phiên B</label>
                      <input value={deliveryPointForm.phien_b} onChange={(e) => setDeliveryPointForm((p) => ({ ...p, phien_b: e.target.value }))} placeholder="A1, B2" className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Phiên C</label>
                      <input value={deliveryPointForm.phien_c} onChange={(e) => setDeliveryPointForm((p) => ({ ...p, phien_c: e.target.value }))} placeholder="C1, D2" className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Phiên D</label>
                      <input value={deliveryPointForm.phien_d} onChange={(e) => setDeliveryPointForm((p) => ({ ...p, phien_d: e.target.value }))} placeholder="D1, E2" className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                    <div className="isolate rounded-xl overflow-hidden border border-slate-200">
                      <PolygonDrawMap existingGeometry={forestPlotGeometry} onChange={setForestPlotGeometry} />
                    </div>
                  </div>
                </>
              )}
            </div>
        </ModalShell>
      )}

      {vehicleDriverAddOpen && (
        <ModalShell
          title="Thêm tài xế mới"
          onClose={() => setVehicleDriverAddOpen(false)}
          maxWidth="lg"
          zIndexClassName="z-[60]"
          footer={
            <>
              <button onClick={() => setVehicleDriverAddOpen(false)} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
              <button
                onClick={() => void handleVehicleDriverAdd()}
                disabled={vehicleDriverAddSaving}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md disabled:opacity-50"
              >
                {vehicleDriverAddSaving ? "Đang lưu..." : "Lưu"}
              </button>
            </>
          }
        >
            <div className="space-y-4">
              {vehicleDriverAddError && (
                <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                  <AlertTriangle size={14} className="shrink-0" />
                  <span>{vehicleDriverAddError}</span>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Tên tài xế *</label>
                  <input
                    value={vehicleDriverAddForm.name}
                    onChange={(e) => setVehicleDriverAddForm((p) => ({ ...p, name: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                    placeholder="Họ và tên"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Mã tài xế</label>
                  <input
                    value={vehicleDriverAddForm.code}
                    onChange={(e) => setVehicleDriverAddForm((p) => ({ ...p, code: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 font-mono"
                    placeholder="VD: TX01"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Điện thoại</label>
                  <input
                    value={vehicleDriverAddForm.phone}
                    onChange={(e) => setVehicleDriverAddForm((p) => ({ ...p, phone: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                    placeholder="Số điện thoại"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Số CMND/CCCD</label>
                  <input
                    value={vehicleDriverAddForm.id_number}
                    onChange={(e) => setVehicleDriverAddForm((p) => ({ ...p, id_number: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                    placeholder="Số CMND/CCCD"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Số GPLX</label>
                  <input
                    value={vehicleDriverAddForm.license_number}
                    onChange={(e) => setVehicleDriverAddForm((p) => ({ ...p, license_number: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                    placeholder="Số giấy phép lái xe"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Hạng bằng lái</label>
                  <input
                    value={vehicleDriverAddForm.license_class}
                    onChange={(e) => setVehicleDriverAddForm((p) => ({ ...p, license_class: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                    placeholder="VD: B2, C, D..."
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngày hết hạn bằng lái</label>
                <input
                  type="date"
                  value={vehicleDriverAddForm.license_expiry}
                  onChange={(e) => setVehicleDriverAddForm((p) => ({ ...p, license_expiry: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Ghi chú</label>
                <textarea
                  value={vehicleDriverAddForm.notes}
                  onChange={(e) => setVehicleDriverAddForm((p) => ({ ...p, notes: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 resize-none"
                  placeholder="Ghi chú thêm..."
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={vehicleDriverAddForm.is_active}
                  onChange={(e) => setVehicleDriverAddForm((p) => ({ ...p, is_active: e.target.checked }))}
                  className="w-4 h-4 rounded accent-emerald-600"
                />
                <span className="text-sm font-semibold text-slate-700">Đang sử dụng</span>
              </label>
            </div>
        </ModalShell>
      )}

      {assignmentHistoryVehicleId && (
        <ModalShell
          title={
            <span>
              <span className="block">Lịch sử tài xế chính</span>
              <span className="text-sm font-normal text-slate-500 mt-1 block">
                {dispatchVehicles.find((row) => row.id === assignmentHistoryVehicleId)?.name || ""}
              </span>
            </span>
          }
          onClose={() => setAssignmentHistoryVehicleId(null)}
          maxWidth="2xl"
        >
          <ResponsiveTableWrapper>
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
          </ResponsiveTableWrapper>
        </ModalShell>
      )}

      {configDelConfirm && (
        <ModalShell
          title={
            <span className="flex items-center gap-3">
              <span className="p-2 bg-red-100 text-red-600 rounded-xl"><AlertTriangle size={18} /></span>
              {`Xóa "${configDelConfirm.label}"?`}
            </span>
          }
          onClose={() => setConfigDelConfirm(null)}
          maxWidth="sm"
          footer={
            <>
              <button onClick={() => setConfigDelConfirm(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
              <button onClick={() => void deleteConfigItem()} disabled={configSaving} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl disabled:opacity-50">
                {configSaving ? "Đang xóa..." : "Xóa"}
              </button>
            </>
          }
        >
            <p className="text-sm text-slate-500">Hành động này không thể hoàn tác.</p>
        </ModalShell>
      )}

      {/* ── Tab ISO & Văn bản ── */}
      {tab === "iso-vanban" && (
        <div className="space-y-4">
          {/* Tab header */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
            <div className="bg-gradient-to-r from-violet-50 to-indigo-50 px-6 py-4 border-b border-slate-200 flex items-center gap-2">
              <FileText size={16} className="text-violet-600" />
              <span className="font-extrabold text-slate-700">ISO & Văn bản nội bộ</span>
            </div>

            {/* Sub-tabs */}
            <div className="px-6 pt-4 flex flex-wrap gap-2 border-b border-slate-100">
              {([{ key: "chu-ky" as const, label: "Chữ ký cá nhân", icon: KeyRound }]).map((st) => (
                <button
                  key={st.key}
                  onClick={() => setIsoVanBanTab(st.key)}
                  className={
                    "flex items-center gap-1.5 px-4 py-2 text-sm font-bold rounded-t-xl border-b-2 transition-all " +
                    (isoVanBanTab === st.key
                      ? "text-violet-700 border-violet-500 bg-violet-50"
                      : "text-slate-500 border-transparent hover:bg-slate-50")
                  }
                >
                  <st.icon size={14} />
                  {st.label}
                </button>
              ))}
            </div>

            {/* Sub-tab: Chữ ký cá nhân */}
            {isoVanBanTab === "chu-ky" && (
              <div className="p-6 space-y-8">
                {/* Ảnh chữ ký */}
                <div>
                  <h3 className="text-sm font-extrabold text-slate-700 mb-1 flex items-center gap-2">
                    <ImagePlus size={15} className="text-violet-500" />
                    Ảnh chữ ký
                  </h3>
                  <p className="text-xs text-slate-500 mb-4">
                    Tải lên ảnh chữ ký tay của bạn dạng PNG, nền trắng hoặc trong suốt. Ảnh này sẽ được nhúng vào tài liệu khi bạn ký duyệt.
                  </p>

                  <div className="flex items-start gap-6">
                    {/* Preview */}
                    <div className="w-48 h-24 border-2 border-dashed border-slate-200 rounded-xl flex items-center justify-center bg-slate-50 overflow-hidden shrink-0">
                      {signatureUrl ? (
                        <img
                          src={signatureUrl}
                          alt="Chữ ký"
                          className="max-w-full max-h-full object-contain p-2"
                        />
                      ) : (
                        <div className="text-center">
                          <ImagePlus size={24} className="mx-auto mb-1 text-slate-300" />
                          <p className="text-xs text-slate-400">Chưa có ảnh</p>
                        </div>
                      )}
                    </div>

                    {/* Upload button */}
                    <div className="space-y-2">
                      <input
                        ref={signatureInputRef}
                        type="file"
                        accept="image/png"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) void handleSignatureUpload(file)
                          e.target.value = ""
                        }}
                      />
                      <button
                        onClick={() => signatureInputRef.current?.click()}
                        disabled={signatureUploading}
                        className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold rounded-xl disabled:opacity-50 transition-all"
                      >
                        <ImagePlus size={14} />
                        {signatureUploading ? "Đang tải lên..." : signatureUrl ? "Thay đổi ảnh chữ ký" : "Tải lên ảnh chữ ký"}
                      </button>
                      <p className="text-xs text-slate-400">Định dạng: PNG · Nên dùng nền trắng hoặc trong suốt</p>
                    </div>
                  </div>

                  {sigMsg && (
                    <div className={`mt-3 px-4 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 ${sigMsg.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                      {sigMsg.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                      {sigMsg.text}
                    </div>
                  )}
                </div>

                <div className="border-t border-slate-100" />

                {/* PIN ký duyệt */}
                <div>
                  <h3 className="text-sm font-extrabold text-slate-700 mb-1 flex items-center gap-2">
                    <KeyRound size={15} className="text-violet-500" />
                    PIN ký duyệt
                    {hasPinSet && (
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs font-bold rounded-full">Đã thiết lập</span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-500 mb-4">
                    PIN 4–6 chữ số dùng để xác nhận danh tính khi ký duyệt tài liệu. Giữ bí mật, không chia sẻ cho người khác.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg">
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">
                        {hasPinSet ? "PIN mới" : "Tạo PIN"}
                      </label>
                      <div className="relative">
                        <input
                          type={pinForm.showPin ? "text" : "password"}
                          inputMode="numeric"
                          pattern="[0-9]*"
                          maxLength={6}
                          placeholder="4–6 chữ số"
                          value={pinForm.pin}
                          onChange={(e) => setPinForm((p) => ({ ...p, pin: e.target.value.replace(/\D/g, "") }))}
                          className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 pr-9 font-mono tracking-widest"
                        />
                        <button
                          type="button"
                          onClick={() => setPinForm((p) => ({ ...p, showPin: !p.showPin }))}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        >
                          {pinForm.showPin ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Xác nhận PIN</label>
                      <input
                        type={pinForm.showPin ? "text" : "password"}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={6}
                        placeholder="Nhập lại PIN"
                        value={pinForm.pinConfirm}
                        onChange={(e) => setPinForm((p) => ({ ...p, pinConfirm: e.target.value.replace(/\D/g, "") }))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 font-mono tracking-widest"
                      />
                    </div>
                  </div>

                  {pinMsg && (
                    <div className={`mt-3 px-4 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 max-w-lg ${pinMsg.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                      {pinMsg.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                      {pinMsg.text}
                    </div>
                  )}

                  <div className="mt-4">
                    <button
                      onClick={() => void handleSetPin()}
                      disabled={pinSaving || !pinForm.pin || !pinForm.pinConfirm}
                      className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold rounded-xl disabled:opacity-50 transition-all"
                    >
                      <KeyRound size={14} />
                      {pinSaving ? "Đang lưu..." : hasPinSet ? "Đổi PIN" : "Thiết lập PIN"}
                    </button>
                  </div>
                </div>
                <div className="border-t border-slate-100" />

                <div>
                  <h3 className="text-sm font-extrabold text-slate-700 mb-1 flex items-center gap-2">
                    <Lock size={15} className="text-violet-500" />
                    Đổi mật khẩu đăng nhập
                  </h3>
                  <p className="text-xs text-slate-500 mb-4">
                    Khi đổi mật khẩu, hệ thống sẽ yêu cầu nhập mật khẩu hiện tại, PIN cũ và xác nhận thêm bằng OTP gửi qua email cá nhân.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg">
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Mật khẩu mới</label>
                      <input
                        type={passwordForm.show ? "text" : "password"}
                        value={passwordForm.password}
                        onChange={(e) => setPasswordForm((p) => ({ ...p, password: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
                        placeholder="Tối thiểu 6 ký tự"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Xác nhận mật khẩu mới</label>
                      <input
                        type={passwordForm.show ? "text" : "password"}
                        value={passwordForm.confirm}
                        onChange={(e) => setPasswordForm((p) => ({ ...p, confirm: e.target.value }))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
                        placeholder="Nhập lại mật khẩu mới"
                      />
                    </div>
                  </div>

                  <label className="mt-3 inline-flex items-center gap-2 cursor-pointer text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={passwordForm.show}
                      onChange={(e) => setPasswordForm((p) => ({ ...p, show: e.target.checked }))}
                      className="w-4 h-4 rounded accent-violet-600"
                    />
                    Hiện mật khẩu mới
                  </label>

                  {passwordMsg && (
                    <div className={`mt-3 px-4 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 max-w-lg ${passwordMsg.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                      {passwordMsg.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                      {passwordMsg.text}
                    </div>
                  )}

                  <div className="mt-4">
                    <button
                      onClick={() => void handleChangePassword()}
                      disabled={passwordSaving || !passwordForm.password || !passwordForm.confirm}
                      className="flex items-center gap-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-900 text-white text-sm font-bold rounded-xl disabled:opacity-50 transition-all"
                    >
                      <Lock size={14} />
                      {passwordSaving ? "Đang chuẩn bị..." : "Đổi mật khẩu"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {sensitiveActionModal && (
        <ModalShell
          title={sensitiveActionModal.title}
          onClose={closeSensitiveActionModal}
          maxWidth="md"
          zIndexClassName="z-[80]"
          backdropClassName="bg-slate-950/50"
          footer={
            <>
              <button
                onClick={closeSensitiveActionModal}
                className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Hủy
              </button>
              <button
                onClick={() => void (sensitiveActionModal.challengeId ? confirmSensitiveAction() : requestSensitiveOtp())}
                disabled={
                  sensitiveActionLoading ||
                  (!sensitiveActionModal.challengeId
                    ? !sensitiveActionModal.currentPassword || !sensitiveActionModal.currentPin
                    : !sensitiveActionModal.otp)
                }
                className="px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold rounded-xl disabled:opacity-50"
              >
                {sensitiveActionLoading
                  ? "Đang xử lý..."
                  : sensitiveActionModal.challengeId
                    ? sensitiveActionModal.submitLabel
                    : "Gửi OTP"}
              </button>
            </>
          }
        >
            <p className="text-sm text-slate-500 -mt-2 mb-4">
              {sensitiveActionModal.challengeId
                ? `Nhập OTP đã gửi đến ${sensitiveActionModal.maskedEmail || "email cá nhân"} để tiếp tục.`
                : "Xác minh bằng mật khẩu hiện tại, PIN cũ và OTP email trước khi hệ thống cho phép thay đổi."}
            </p>
            <div className="space-y-4">
              {!sensitiveActionModal.challengeId ? (
                <>
                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-1.5">Mật khẩu hiện tại</label>
                    <input
                      type="password"
                      value={sensitiveActionModal.currentPassword}
                      onChange={(e) => {
                        const value = e.target.value
                        setSensitiveActionModal((prev) => prev ? { ...prev, currentPassword: value } : prev)
                        setSensitiveActionError("")
                      }}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
                      placeholder="Nhập mật khẩu hiện tại"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-1.5">PIN cũ</label>
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={6}
                      value={sensitiveActionModal.currentPin}
                      onChange={(e) => {
                        const value = e.target.value.replace(/\D/g, "")
                        setSensitiveActionModal((prev) => prev ? { ...prev, currentPin: value } : prev)
                        setSensitiveActionError("")
                      }}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 font-mono tracking-widest"
                      placeholder="Nhập PIN cũ"
                    />
                  </div>
                </>
              ) : (
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Mã OTP</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={sensitiveActionModal.otp}
                    onChange={(e) => {
                      const value = e.target.value.replace(/\D/g, "")
                      setSensitiveActionModal((prev) => prev ? { ...prev, otp: value } : prev)
                      setSensitiveActionError("")
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 font-mono tracking-[0.35em]"
                    placeholder="6 chữ số"
                  />
                </div>
              )}

              {sensitiveActionError && (
                <div className="px-4 py-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2">
                  <AlertTriangle size={14} />
                  {sensitiveActionError}
                </div>
              )}
            </div>
        </ModalShell>
      )}
    </div>
  )
}
