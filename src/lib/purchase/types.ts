// Kiểu dữ liệu + helper THUẦN cho module Đề nghị mua vật tư hàng hóa (ĐNMVT).
// Không import gì server-only — client và API route dùng chung.

export type PurchaseStatus = "nhap" | "cho_ky" | "tra_ve" | "da_duyet" | "dang_mua" | "hoan_tat" | "dong" | "huy"

export const PURCHASE_STATUS_LABEL: Record<PurchaseStatus, string> = {
  nhap: "Nháp",
  cho_ky: "Đang ký duyệt",
  tra_ve: "Bị trả về",
  da_duyet: "Đã duyệt",
  dang_mua: "Đang mua",
  hoan_tat: "Hoàn tất",
  dong: "Đã đóng",
  huy: "Đã huỷ",
}

export const PURCHASE_STATUS_CLASS: Record<PurchaseStatus, string> = {
  nhap: "bg-slate-100 text-slate-600",
  cho_ky: "bg-amber-100 text-amber-700",
  tra_ve: "bg-rose-100 text-rose-700",
  da_duyet: "bg-emerald-100 text-emerald-700",
  dang_mua: "bg-blue-100 text-blue-700",
  hoan_tat: "bg-emerald-100 text-emerald-700",
  dong: "bg-slate-200 text-slate-600",
  huy: "bg-red-100 text-red-600",
}

/** Phiếu gốc đang trong giai đoạn mua (ghi nhận mua / điều chỉnh / đóng). */
export function isPurchaseBuying(status: PurchaseStatus): boolean {
  return status === "da_duyet" || status === "dang_mua"
}

/** Phiếu còn sửa được nội dung (người đề nghị). */
export function isPurchaseEditable(status: PurchaseStatus): boolean {
  return status === "nhap" || status === "tra_ve"
}

export const PURCHASE_LOAI_TAI_LIEU = "purchase_request"
export const PURCHASE_MODUN = "purchase"

/** Ngưỡng cảnh báo lệch đơn giá so với giá gợi ý. */
export const PRICE_DEVIATION_LIMIT_PCT = 10

/** "01/ĐNMVT" — số quay về 01 mỗi năm. */
export function formatSoPhieu(so: number | null | undefined): string {
  if (!so || so <= 0) return "—/ĐNMVT"
  return `${String(so).padStart(2, "0")}/ĐNMVT`
}

/** Nhãn đầy đủ kèm năm (số trùng giữa các năm là bình thường). */
export function formatSoPhieuFull(so: number | null | undefined, nam: number | null | undefined): string {
  return nam ? `${formatSoPhieu(so)} (${nam})` : formatSoPhieu(so)
}

/** % lệch của `price` so với `suggested`; null nếu không có giá gợi ý hợp lệ. */
export function priceDeviationPct(price: number, suggested: number | null | undefined): number | null {
  if (!suggested || suggested <= 0 || !Number.isFinite(price) || price <= 0) return null
  return ((price - suggested) / suggested) * 100
}

export function isPriceDeviationExceeded(pct: number | null): boolean {
  return pct !== null && Math.abs(pct) > PRICE_DEVIATION_LIMIT_PCT
}

export function formatMoney(value: number | null | undefined, loaiTien: string): string {
  const n = Number(value || 0)
  const digits = loaiTien === "USD" ? 2 : 0
  return n.toLocaleString("vi-VN", { minimumFractionDigits: 0, maximumFractionDigits: digits })
}

export function formatQty(value: number | null | undefined): string {
  return Number(value || 0).toLocaleString("vi-VN", { maximumFractionDigits: 3 })
}

export type PurchaseLineInput = {
  item_id: string | null
  item_code: string | null
  item_name: string
  unit: string | null
  so_luong: number
  don_gia: number
  muc_dich: string | null
  ghi_chu: string | null
  gia_goi_y: number | null
  nguon_gia_goi_y: string | null
  ly_do_lech_gia: string | null
  la_vat_tu_moi: boolean
  /** Ảnh đính kèm của dòng (không in lên PDF). */
  image_urls?: string[]
  /** Nơi mua dự kiến (in lên PDF). */
  mua_tai?: string | null
  /** Ngày dự kiến có hàng YYYY-MM-DD (tuỳ chọn). */
  ngay_co_hang?: string | null
  /** Ngày cần hàng YYYY-MM-DD — bắt buộc với phiếu lập từ GĐ2d. */
  ngay_can_hang?: string | null
}

export type PurchaseRequestRow = {
  id: string
  factory_id: string
  nam: number
  so: number
  ngay: string
  loai: "goc" | "dieu_chinh"
  nguoi_de_nghi_id: string
  nguoi_de_nghi_ten: string | null
  giam_doc_user_id: string | null
  ke_toan_user_id: string | null
  trang_thai: PurchaseStatus
  loai_tien: string
  tong_tien: number
  ghi_chu: string | null
  /** Bộ phận đề nghị — NULL với phiếu tạo trước GĐ2b. */
  bo_phan?: string | null
  /** Ngày cần hàng sớm nhất trong các dòng — NULL với phiếu tạo trước GĐ2d. */
  ngay_can_hang?: string | null
  yeu_cau_ky_id: string | null
  ngay_duyet: string | null
  ly_do_huy: string | null
  huy_luc: string | null
  created_at: string
  parent_request_id?: string | null
  ly_do_dieu_chinh?: string | null
  ly_do_dong?: string | null
  dong_luc?: string | null
  /** GĐ2g: phiếu lập từ biên bản bảo trì (vật tư mua ngoài) — nhập cứng vào Kho tạm KT. */
  maintenance_record_id?: string | null
  lap_boi_id?: string | null
}

/** Thông tin biên bản bảo trì nguồn của phiếu (GĐ2g). */
export type PurchaseMaintenanceSource = { id: string; maBb: string | null; ktWarehouseId: string | null; ktCode: string }

export type PurchaseLineRow = PurchaseLineInput & {
  id: string
  request_id: string
  sort_order: number
  thanh_tien: number
  lech_gia_pct: number | null
  sl_da_mua: number
  parent_line_id?: string | null
  truoc_item_id?: string | null
  truoc_item_code?: string | null
  truoc_item_name?: string | null
  truoc_so_luong?: number | null
  truoc_don_gia?: number | null
  /** Số liệu tồn kho/tiêu hao/lần mua trước CHỤP LẠI lúc gửi ký (GĐ2e) — bằng chứng bất biến cho người duyệt. */
  insight_snapshot?: PurchaseInsightSnapshot | null
}

/** Thông số hiệu lực của 1 dòng gốc (sau các phiếu điều chỉnh đã duyệt) — từ RPC purchase_effective_lines. */
export type PurchaseEffectiveLine = {
  root_line_id: string
  item_id: string | null
  item_code: string | null
  item_name: string
  unit: string | null
  so_luong: number
  don_gia: number
  received: number
  adjusted: boolean
  pending_adjust: boolean
}

export type PurchaseReceiptRow = {
  id: string
  inventory_document_id: string | null
  document_code: string | null
  ngay: string
  warehouse_id: string | null
  warehouse_label: string
  nha_cung_cap: string | null
  ghi_chu: string | null
  image_urls: string[]
  tong_tien: number
  loai_tien: string | null
  created_by: string | null
  created_at: string
  lines: { item_name: string; unit: string | null; quantity: number; don_gia: number | null; lot_no: string | null }[]
  cancelled: boolean
}

export type PurchaseAdjustmentSummary = {
  id: string
  so: number
  nam: number
  trang_thai: PurchaseStatus
  ly_do_dieu_chinh: string | null
  created_at: string
}

/** % lệch tối đa giữa giá mua thực tế và giá duyệt hiệu lực trước khi phải lập phiếu điều chỉnh. */
export const RECEIVE_PRICE_TOLERANCE_PCT = 10

/** Số dư còn được mua của 1 dòng gốc. */
export function remainingQty(e: Pick<PurchaseEffectiveLine, "so_luong" | "received">): number {
  return Math.max(0, Math.round((Number(e.so_luong) - Number(e.received)) * 1000) / 1000)
}

export type PurchaseSigner = {
  userId: string
  thuTu: number
  vaiTro: string
  trangThai: string
  hoTen: string
  kyLuc: string | null
}

export type PurchaseApprover = { id: string; full_name: string; chuc_vu: string }

/** Thứ tự ký cứng: Người đề nghị → Giám đốc → Kế toán. */
export const PURCHASE_SIGN_ORDER = {
  nguoi_de_nghi: { thuTu: 10, vaiTro: "ky" as const, label: "Người đề nghị" },
  giam_doc: { thuTu: 20, vaiTro: "ky" as const, label: "Giám đốc nhà máy" },
  ke_toan: { thuTu: 30, vaiTro: "phe_duyet" as const, label: "Kế toán" },
}

export type PurchaseSignRole = keyof typeof PURCHASE_SIGN_ORDER

/** Có phải Phó giám đốc (ký thay — in "KT. Giám đốc nhà máy"). */
export function isDeputyDirector(chucVu: string | null | undefined): boolean {
  return /ph[oó]\s*gi[aá]m\s*đ[oố]c/i.test(String(chucVu || ""))
}

/** Số ảnh tối đa mỗi dòng vật tư / mỗi lần ghi nhận mua. */
export const PURCHASE_MAX_IMAGES = 10

/** Chỉ giữ URL http(s) hợp lệ, bỏ trùng, cắt theo giới hạn. */
export function sanitizeImageUrls(value: unknown, max = PURCHASE_MAX_IMAGES): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const v of value) {
    if (typeof v !== "string") continue
    const u = v.trim()
    if (!/^https?:\/\//i.test(u) || out.includes(u)) continue
    out.push(u)
    if (out.length >= max) break
  }
  return out
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Chuẩn hoá ngày YYYY-MM-DD; giá trị khác → null. */
export function normalizeIsoDate(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim().slice(0, 10) : ""
  if (!ISO_DATE_RE.test(s)) return null
  return Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? null : s
}

/** Số ngày từ `fromIso` tới `toIso` (âm nếu đã qua). */
export function daysBetweenIso(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000)
}

/** Ngày nhỏ nhất trong danh sách (bỏ giá trị rỗng/không hợp lệ). */
export function minIsoDate(values: (string | null | undefined)[]): string | null {
  const ok = values.map(normalizeIsoDate).filter(Boolean) as string[]
  return ok.length ? ok.sort()[0] : null
}

/** Ngưỡng mức độ gấp theo số ngày còn lại tới ngày cần hàng. */
export const PURCHASE_URGENT_DAYS = 3
export const PURCHASE_SOON_DAYS = 7

export type PurchaseUrgency = {
  level: "qua_han" | "gap" | "sap" | "binh_thuong"
  days: number
  label: string
  /** Nhãn ngắn hiển thị trong ô ngày ở form ("Quá hạn"/"Gấp"/"Sắp tới"); null khi bình thường. */
  shortLabel: string | null
  className: string
}

/**
 * Mức độ gấp của phiếu/dòng theo ngày cần hàng so với hôm nay (giờ nhà máy).
 * Chỉ có ý nghĩa khi phiếu còn đang xử lý — caller tự bỏ qua phiếu đã xong/huỷ/đóng.
 */
export function purchaseUrgency(ngayCanHang: string | null | undefined, todayIso: string): PurchaseUrgency | null {
  const d = normalizeIsoDate(ngayCanHang)
  if (!d) return null
  const days = daysBetweenIso(todayIso, d)
  if (days < 0) return { level: "qua_han", days, label: `Quá hạn ${-days} ngày`, shortLabel: "Quá hạn", className: "bg-red-600 text-white" }
  if (days <= PURCHASE_URGENT_DAYS) {
    return { level: "gap", days, label: days === 0 ? "Gấp · cần hôm nay" : `Gấp · còn ${days} ngày`, shortLabel: "Gấp", className: "bg-red-100 text-red-700" }
  }
  if (days <= PURCHASE_SOON_DAYS) return { level: "sap", days, label: `Còn ${days} ngày`, shortLabel: "Sắp tới", className: "bg-amber-100 text-amber-700" }
  return { level: "binh_thuong", days, label: `Còn ${days} ngày`, shortLabel: null, className: "bg-slate-100 text-slate-600" }
}

/** Phiếu còn đang trong luồng xử lý (đáng hiện nhãn gấp). */
export function isPurchaseActive(status: PurchaseStatus): boolean {
  return status === "nhap" || status === "cho_ky" || status === "tra_ve" || status === "da_duyet" || status === "dang_mua"
}

/** Tên file tải về:"Phiếu đề nghị mua 01-ĐNMVT (2026)". `/` trong số phiếu đổi thành `-`. */
export function purchaseDownloadBaseName(loai: string | null | undefined, so: number, nam: number): string {
  const prefix = loai === "dieu_chinh" ? "Phiếu điều chỉnh" : "Phiếu đề nghị mua"
  return `${prefix} ${formatSoPhieuFull(so, nam).replace(/\//g, "-")}`
}

// ── Bằng chứng tồn kho / tiêu hao (GĐ2e) ─────────────────────────────────────

export type PurchaseItemInsight = {
  stock: { warehouseId: string; code: string; name: string; onHand: number }[]
  totalStock: number
  recentPurchases: { ngay: string; so: number; nam: number; soLuong: number; donGia: number; loaiTien: string }[]
  openRequests: { id: string; so: number; nam: number; trangThai: string; soLuong: number }[]
  lastImportDate: string | null
  lastExportDate: string | null
  recentImports?: { ngay: string; soLuong: number }[]
  recentExports?: { ngay: string; soLuong: number }[]
  export90: number
  categorySamples?: { donGia: number; loaiTien: string; requestId?: string }[]
}

/** Bản chụp lưu vào purchase_request_lines.insight_snapshot lúc gửi ký. */
export type PurchaseInsightSnapshot = PurchaseItemInsight & {
  capturedAt: string
  daysLeft: number | null
}

/** Tồn còn đủ dùng hơn ngần này ngày → cảnh báo "Tồn còn nhiều" cho người duyệt. */
export const PURCHASE_STOCK_PLENTY_DAYS = 60

/** Số ngày tồn hiện tại còn đủ dùng theo tốc độ xuất dùng 90 ngày; null nếu 90 ngày không xuất. */
export function insightDaysLeft(insight: Pick<PurchaseItemInsight, "export90" | "totalStock">): number | null {
  const perDay = insight.export90 > 0 ? insight.export90 / 90 : 0
  return perDay > 0 ? Math.floor(insight.totalStock / perDay) : null
}

/** Cảnh báo cho người duyệt: tồn còn nhiều / vật tư đang có trong phiếu khác chưa hoàn tất. */
export function insightWarnings(insight: PurchaseItemInsight): string[] {
  const out: string[] = []
  const days = insightDaysLeft(insight)
  if (days !== null && days > PURCHASE_STOCK_PLENTY_DAYS) out.push(`Tồn còn nhiều (đủ dùng > ${PURCHASE_STOCK_PLENTY_DAYS} ngày)`)
  else if (days === null && insight.totalStock > 0) out.push("Tồn còn nhiều (90 ngày không xuất dùng)")
  if (insight.openRequests.length > 0) {
    out.push(`Đang có trong phiếu khác chưa hoàn tất: ${insight.openRequests.map((r) => formatSoPhieuFull(r.so, r.nam)).join(", ")}`)
  }
  return out
}

/** Bản chụp còn hợp lệ để gửi ký (chụp trong vòng ngần này phút). */
export const PURCHASE_SNAPSHOT_MAX_AGE_MIN = 30
