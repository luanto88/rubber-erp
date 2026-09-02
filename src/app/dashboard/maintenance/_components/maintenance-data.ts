import { supabase } from "@/lib/supabase"
import { convertCurrency, currencySymbol as sharedCurrencySymbol } from "@/lib/currency"

// Re-export để không phải sửa các import cũ trong module Bảo trì đang dùng currencySymbol từ đây.
export const currencySymbol = sharedCurrencySymbol

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

export const HANG_MUC_LIST = ["Sửa chữa", "Bảo dưỡng"] as const
export type HangMuc = (typeof HANG_MUC_LIST)[number]

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

export type MaintenanceExtMaterial = {
  id: string
  factory_id: string
  ten_vat_tu: string
  dvt: string | null
  code: string | null
  specification: string | null
  category_id: string | null
  is_active: boolean
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
  created_by: string | null
  nguoi_thuc_hien: string[]
  nv_phu_trach: string | null
  phu_trach_bao_tri: string | null
  bgd_phu_trach: string | null
  giam_doc: string | null
  trang_thai: "cho_duyet" | "da_duyet" | "huy" | "tu_choi"
  nguoi_duyet: string | null
  ngay_duyet: string | null
  inventory_issue_doc_id: string | null
  inventory_issue_doc_ids?: string[] | null
  ly_do_tu_choi?: string | null
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

  const { data: groupMemberData } = await supabase
    .from("personnel_group_members")
    .select("staff_id, group_id, personnel_groups(id, name, code)")
    .eq("factory_id", factoryId)

  type PersonnelGroupRef = { id: string; name: string | null; code: string | null }
  const groupMap = new Map<string, { group_ids: string[]; group_names: string[] }>()
  for (const row of (groupMemberData || []) as Array<{ staff_id: string; group_id: string; personnel_groups: PersonnelGroupRef | PersonnelGroupRef[] | null }>) {
    const existing = groupMap.get(row.staff_id) || { group_ids: [], group_names: [] }
    if (row.group_id && !existing.group_ids.includes(row.group_id)) existing.group_ids.push(row.group_id)
    // Quan hệ personnel_group_members → personnel_groups là many-to-one (1 group_id), nên
    // PostgREST trả về personnel_groups dạng OBJECT đơn, không phải mảng — không được dùng
    // `?.[0]` (luôn undefined trên object, khiến group_names không bao giờ điền được dù dữ
    // liệu personnel_group_members đã có sẵn). Xử lý an toàn cả 2 dạng để phòng hờ.
    const groupRef = row.personnel_groups
    const groupRecord = Array.isArray(groupRef) ? groupRef[0] : groupRef
    const groupName = groupRecord?.name?.trim()
    if (groupName && !existing.group_names.includes(groupName)) existing.group_names.push(groupName)
    groupMap.set(row.staff_id, existing)
  }

  return ((data || []) as Array<Omit<MaintenanceStaff, "group_ids" | "group_names">>).map((staff) => {
    const groups = groupMap.get(staff.id)
    return {
      ...staff,
      group_ids: groups?.group_ids || [],
      group_names: groups?.group_names || [],
    }
  })
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
  const usdEquiv = convertCurrency(chiPhi, loaiTien, "USD")
  return usdEquiv > 200 ? "lon" : "nho"
}

// Nhãn hiển thị trạng thái biên bản — dùng chung cho danh sách và trang chi tiết
export function trangThaiLabel(s: string | null | undefined): string {
  if (s === "da_duyet") return "Đã duyệt"
  if (s === "huy") return "Đã hủy"
  if (s === "tu_choi") return "Từ chối"
  return "Chờ duyệt"
}

const BO_PHAN_PREFIX: Record<string, string> = {
  "Mủ tạp": "MT",
  "Mủ nước": "MN",
  "Đội xe": "DX",
  "Nước thải": "NT",
  "Biomass": "BO",
  "Văn phòng": "VP",
  "Khác": "K",
}

// Generate biên bản code: XX-DDMMYY/XXX (XX = department prefix)
export async function generateMaBB(factoryId: string, ngay: string, boPhan: string): Promise<string> {
  const d = new Date(ngay)
  const dd = String(d.getDate()).padStart(2, "0")
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const yy = String(d.getFullYear()).slice(-2)
  const deptCode = BO_PHAN_PREFIX[boPhan] || "MT"
  const prefix = `${deptCode}-${dd}${mm}${yy}`

  const { data } = await supabase
    .from("maintenance_records")
    .select("ma_bb")
    .eq("factory_id", factoryId)
    .like("ma_bb", `${prefix}/%`)

  // Lấy SỐ LỚN NHẤT đã dùng + 1 — không đếm số dòng, vì lỗ hổng trong dãy số (vd 1 biên
  // bản ở giữa đã bị "Xóa hẳn") khiến đếm dòng luôn sinh ra đúng mã đã tồn tại, gây
  // duplicate key vĩnh viễn không tự phục hồi (xem bug 2026-08-08: /001 + /003 tồn tại,
  // /002 bị thiếu -> đếm dòng = 2 -> luôn sinh /003).
  const maxSeq = (data || []).reduce((max, row) => {
    const n = parseInt(row.ma_bb?.slice(prefix.length + 1) || "", 10)
    return Number.isFinite(n) && n > max ? n : max
  }, 0)
  return `${prefix}/${String(maxSeq + 1).padStart(3, "0")}`
}
