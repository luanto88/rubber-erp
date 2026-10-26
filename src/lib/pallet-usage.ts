// Thuần (client + server): quy đổi "loại pallet" ghi trên kiện thành phẩm ra vật tư pallet thực tế.
// Mỗi kiện còn tồn (kể cả đã xuất một phần) chiếm đúng 1 bộ pallet theo loại của kiện.
// Đã chốt với người dùng 2026-10-26: Sắt đế gỗ = 1 sắt dày + 1 đế gỗ; Sắt đế nhựa = 1 sắt dày + 1 đế
// nhựa; Sắt mỏng = 1 sắt mỏng; MB5 = 1 MB5; Gỗ = 1 pallet gỗ. 2026-10-27: thêm MB4.

export type PalletComponent = "sat_day" | "sat_mong" | "de_go" | "de_nhua" | "mb5" | "mb4" | "pallet_go"

export const PALLET_COMPONENT_LABEL: Record<PalletComponent, string> = {
  sat_day: "Pallet sắt dày",
  sat_mong: "Pallet sắt mỏng",
  de_go: "Đế gỗ",
  de_nhua: "Đế nhựa",
  mb5: "Pallet MB5",
  mb4: "Pallet MB4",
  pallet_go: "Pallet gỗ",
}

export const PALLET_COMPONENT_ORDER: PalletComponent[] = ["sat_day", "sat_mong", "de_go", "de_nhua", "mb5", "mb4", "pallet_go"]

/**
 * Thành phần → mã vật tư trong Kho vật tư (phân loại "Pallet các loại"). Sắt mỏng gộp nhiều mã
 * (UBE/Zeon, Chemie) thành 1 dòng "PM" — từng mã chỉ còn là ghi chú. Mã chưa tạo trong kho (vd MB4)
 * vẫn tính được số pallet, chỉ không có tồn sổ sách.
 */
export const PALLET_COMPONENT_ITEMS: Record<PalletComponent, { groupCode: string; itemCodes: string[] }> = {
  sat_day: { groupCode: "DPH", itemCodes: ["DPH"] },
  sat_mong: { groupCode: "PM", itemCodes: ["MUBEZ", "MCH"] },
  de_go: { groupCode: "ĐG", itemCodes: ["ĐG"] },
  de_nhua: { groupCode: "ĐN", itemCodes: ["ĐN"] },
  mb5: { groupCode: "PMB5", itemCodes: ["PMB5"] },
  mb4: { groupCode: "PMB4", itemCodes: ["PMB4"] },
  pallet_go: { groupCode: "PG", itemCodes: ["PG"] },
}

export const PALLET_COMPONENT_CODES = new Set<string>(PALLET_COMPONENT_ORDER)

const strip = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/^pallet\s+/, "")
    .replace(/\s+/g, " ")
    .trim()

const RECIPES: Record<string, PalletComponent[]> = {
  "sat de go": ["sat_day", "de_go"],
  "sat de nhua": ["sat_day", "de_nhua"],
  "sat mong": ["sat_mong"],
  mb5: ["mb5"],
  mb4: ["mb4"],
  go: ["pallet_go"],
}

/** Vật tư thành phần của 1 loại pallet; `null` = loại chưa có quy đổi (báo "Không xác định"). */
export function palletComponents(palletType: string): PalletComponent[] | null {
  return RECIPES[strip(palletType)] || null
}

/** Mã pallet thành phần đã chuẩn hoá (sắt mỏng ⇒ PM) của 1 mã vật tư kho; null nếu không phải pallet. */
export function palletGroupOfItemCode(itemCode: string): { component: PalletComponent; groupCode: string } | null {
  const code = itemCode.trim().toUpperCase()
  for (const c of PALLET_COMPONENT_ORDER) {
    if (PALLET_COMPONENT_ITEMS[c].itemCodes.some((x) => x.toUpperCase() === code)) {
      return { component: c, groupCode: PALLET_COMPONENT_ITEMS[c].groupCode }
    }
  }
  return null
}

// ── Loại pallet xuất (bảng export_pallet_types) ──
export type ExportPalletForm = "roi" | "kien" | "boc_mang"

export const EXPORT_PALLET_FORM_LABEL: Record<ExportPalletForm, string> = {
  roi: "Xuất rời — pallet trả về kho",
  kien: "Xuất khẩu dạng kiện — mất pallet của kiện",
  boc_mang: "Bọc màng PE — pallet trả về, chỉ mất thành phần khai báo",
}

export type ExportPalletType = {
  id: string
  ten: string
  hinh_thuc: ExportPalletForm
  mat_thanh_phan: PalletComponent[]
  sort_order: number
  is_active: boolean
}

/** Dùng khi bảng export_pallet_types chưa có (migration chưa chạy) — đúng danh sách cũ. */
export const DEFAULT_EXPORT_PALLET_TYPES: Omit<ExportPalletType, "id">[] = [
  { ten: "Rời", hinh_thuc: "roi", mat_thanh_phan: [], sort_order: 10, is_active: true },
  { ten: "Pallet sắt đế gỗ", hinh_thuc: "kien", mat_thanh_phan: [], sort_order: 20, is_active: true },
  { ten: "PE đế gỗ", hinh_thuc: "boc_mang", mat_thanh_phan: ["de_go"], sort_order: 30, is_active: true },
  { ten: "PE đế nhựa", hinh_thuc: "boc_mang", mat_thanh_phan: ["de_nhua"], sort_order: 40, is_active: true },
  { ten: "Gỗ", hinh_thuc: "kien", mat_thanh_phan: [], sort_order: 50, is_active: true },
  { ten: "MB4", hinh_thuc: "kien", mat_thanh_phan: [], sort_order: 60, is_active: true },
  { ten: "MB5", hinh_thuc: "kien", mat_thanh_phan: [], sort_order: 70, is_active: true },
]

export const normalizePalletTypeName = (s: string | null | undefined) =>
  String(s || "").normalize("NFC").trim().toLowerCase()
