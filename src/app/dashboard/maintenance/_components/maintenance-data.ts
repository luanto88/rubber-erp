import { supabase } from "@/lib/supabase"

export const BO_PHAN_LIST = [
  "Mủ tạp",
  "Mủ nước",
  "Nước thải",
  "Biomass",
  "Đội xe",
  "Văn phòng",
  "Khác",
] as const

export type BoPhan = (typeof BO_PHAN_LIST)[number]

export type MaintenanceAsset = {
  id: string
  factory_id: string
  ma_tb: string
  ten_tb: string
  bo_phan: string
  loai: "may_moc" | "xe"
  nam_sd: string | null
  bien_so: string | null
  mo_ta: string | null
  trang_thai: "active" | "inactive"
}

export type MaintenanceStaff = {
  id: string
  factory_id: string
  ten: string
  chuc_vu: string | null
  active: boolean
}

export type MaintenanceExtMaterial = {
  id: string
  factory_id: string
  ten_vat_tu: string
  dvt: string | null
}

export type MaintenanceMaterial = {
  id: string
  line_id: string
  record_id: string
  factory_id: string
  nguon: "trong_kho" | "ben_ngoai"
  inventory_item_id: string | null
  ten_vat_tu: string
  dvt: string | null
  so_luong: number
  don_gia: number | null
  loai_tien: string | null
  thanh_tien: number | null
  sort_order: number
}

export type MaintenanceRecordLine = {
  id: string
  record_id: string
  factory_id: string
  sort_order: number
  asset_id: string | null
  ten_tb: string
  ma_tb: string
  ten_tai_xe: string | null
  noi_dung: string | null
  nguyen_nhan: string | null
  cac_khac_phuc: string | null
  loai_sua_chua: "lon" | "nho" | null
  chi_phi_dk: number
  loai_tien: string
  cong_tho: number
  nhien_lieu_su_dung: string | null
  dvt_do: string | null
  so_luong_do: number | null
  image_urls: string[]
  materials?: MaintenanceMaterial[]
}

export type MaintenanceRecord = {
  id: string
  factory_id: string
  ma_bb: string | null
  hang_muc: "Sửa chữa" | "Bảo dưỡng"
  ngay: string
  tu_gio: string | null
  den_gio: string | null
  bo_phan: string
  nguoi_tao: string | null
  nguoi_thuc_hien: string[]
  nv_phu_trach: string | null
  phu_trach_bao_tri: string | null
  bgd_phu_trach: string | null
  giam_doc: string | null
  trang_thai: "cho_duyet" | "da_duyet" | "huy"
  nguoi_duyet: string | null
  ngay_duyet: string | null
  inventory_issue_doc_id: string | null
  ghi_chu: string | null
  created_at: string
  updated_at: string
  lines?: MaintenanceRecordLine[]
}

export async function loadMaintenanceAssets(factoryId: string): Promise<MaintenanceAsset[]> {
  const { data } = await supabase
    .from("maintenance_assets")
    .select("*")
    .eq("factory_id", factoryId)
    .eq("trang_thai", "active")
    .order("bo_phan")
    .order("ten_tb")
  return (data || []) as MaintenanceAsset[]
}

export async function loadMaintenanceStaff(factoryId: string): Promise<MaintenanceStaff[]> {
  const { data } = await supabase
    .from("maintenance_staff")
    .select("*")
    .eq("factory_id", factoryId)
    .eq("active", true)
    .order("ten")
  return (data || []) as MaintenanceStaff[]
}

export async function loadMaintenanceExtMaterials(factoryId: string): Promise<MaintenanceExtMaterial[]> {
  const { data } = await supabase
    .from("maintenance_external_materials")
    .select("*")
    .eq("factory_id", factoryId)
    .order("ten_vat_tu")
  return (data || []) as MaintenanceExtMaterial[]
}

// Auto-classify repair type based on cost (USD threshold = 200)
export function suggestLoaiSuaChua(chiPhi: number, loaiTien: string): "lon" | "nho" {
  const usdEquiv =
    loaiTien === "USD" ? chiPhi :
    loaiTien === "KHR" ? chiPhi / 4100 :
    loaiTien === "VND" ? chiPhi / 25000 : 0
  return usdEquiv > 200 ? "lon" : "nho"
}

// Format currency symbol
export function currencySymbol(loaiTien: string): string {
  if (loaiTien === "KHR") return "៛"
  if (loaiTien === "VND") return "₫"
  return "$"
}

// Generate biên bản code: MT-DDMMYY/XXX
export async function generateMaBB(factoryId: string, ngay: string): Promise<string> {
  const d = new Date(ngay)
  const dd = String(d.getDate()).padStart(2, "0")
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const yy = String(d.getFullYear()).slice(-2)
  const prefix = `MT-${dd}${mm}${yy}`

  // Count existing records for this date
  const { data } = await supabase
    .from("maintenance_records")
    .select("ma_bb")
    .eq("factory_id", factoryId)
    .like("ma_bb", `${prefix}/%`)

  const count = (data || []).length + 1
  return `${prefix}/${String(count).padStart(3, "0")}`
}
