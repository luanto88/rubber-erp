// Thuần (client + server): quy đổi "loại pallet" ghi trên kiện thành phẩm ra vật tư pallet thực tế.
// Mỗi kiện còn tồn (kể cả đã xuất một phần) chiếm đúng 1 bộ pallet theo loại của kiện.
// Đã chốt với người dùng 2026-10-26: Sắt đế gỗ = 1 sắt dày + 1 đế gỗ; Sắt đế nhựa = 1 sắt dày + 1 đế
// nhựa; Sắt mỏng = 1 sắt mỏng; MB5 = 1 MB5; Gỗ = 1 pallet gỗ. 2026-10-27: thêm MB4.

// GĐ3 (2026-11-08): danh sách thành phần nằm ở bảng pallet_components (src/lib/pallet-components.ts), người dùng
// thêm được thành phần mới ⇒ mã là chuỗi tự do. Các hằng số cứng dưới đây CHỈ còn là quy đổi dự phòng (palletComponents)
// khi pallet sản xuất chưa khai báo thành phần trong Quy cách đóng gói.
export type PalletComponent = string

type LegacyPalletComponent = "sat_day" | "sat_mong" | "de_go" | "de_nhua" | "mb5" | "mb4" | "pallet_go"

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

const RECIPES: Record<string, LegacyPalletComponent[]> = {
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
