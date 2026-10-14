// Doc-UI — registry trạng thái DÙNG CHUNG cho Văn bản nội bộ, Tài liệu ISO, Hồ sơ thực hiện ISO.
// Nguồn sự thật DUY NHẤT về nhãn + tông màu trạng thái của 2 module. Các map cũ
// `TRANG_THAI_LABEL/COLOR` (documents-types.ts, iso-types.ts) và `FORM_INSTANCE_STATUS_*`
// đã chuyển thành alias đọc từ đây để không vỡ import cũ.
//
// File THUẦN (không import gì runtime) — dùng được ở cả client lẫn route server.
// Màu tông theo mẫu previews/enterprise-iso-vanban-unified-preview.html (valid/pending/draft/
// danger). Class viết literal để Tailwind quét được — KHÔNG ghép chuỗi động.

export type StatusTone = "valid" | "pending" | "warn" | "draft" | "danger" | "returned" | "info"

export type StatusDomain =
  | "doc"
  | "iso"
  | "form"
  // U0 (2026-10-14) — các module còn lại, áp dần ở U1-U7.
  | "maintenance"
  | "dispatch_progress"
  | "quality"
  | "purchase"
  | "inventory"
  | "export"
  | "lot"
  | "storage"

export const TONE_CLASSES: Record<StatusTone, { badge: string; dot: string; pulse: boolean }> = {
  valid: { badge: "bg-[#ecfdf5] text-[#065f46] border-[#a7f3d0]", dot: "bg-[#15803d]", pulse: false },
  pending: { badge: "bg-[#fffbeb] text-[#92400e] border-[#fde68a]", dot: "bg-[#d97706]", pulse: true },
  // Cần chú ý nhưng không chờ ai (vd "Đã ký — dữ liệu đã đổi"): vàng, chấm KHÔNG nhấp nháy.
  warn: { badge: "bg-[#fffbeb] text-[#92400e] border-[#fde68a]", dot: "bg-[#d97706]", pulse: false },
  draft: { badge: "bg-[#f8fafc] text-[#475569] border-[#cbd5e1]", dot: "bg-[#94a3b8]", pulse: false },
  danger: { badge: "bg-[#fef2f2] text-[#991b1b] border-[#fecaca]", dot: "bg-[#dc2626]", pulse: false },
  returned: { badge: "bg-[#fff1f2] text-[#9f1239] border-[#fecdd3]", dot: "bg-[#e11d48]", pulse: false },
  // Trạng thái trung tính đang tiến (Đang mua, Xuất hàng…). Xanh dương — trước 2026-10-14 là
  // brand (xanh lá) dễ lẫn với "Đã duyệt".
  info: { badge: "bg-[#f0f9ff] text-[#075985] border-[#bae6fd]", dot: "bg-[#0284c7]", pulse: false },
}

type StatusEntry = { label: string; tone: StatusTone }

export const DOC_STATUS: Record<string, StatusEntry> = {
  draft: { label: "Nháp", tone: "draft" },
  cho_ky_phong_ban: { label: "Chờ ký phòng ban", tone: "pending" },
  cho_phe_duyet: { label: "Chờ phê duyệt", tone: "pending" },
  da_phe_duyet: { label: "Đã phê duyệt", tone: "valid" },
  tra_ve: { label: "Trả về", tone: "returned" },
}

export const ISO_STATUS: Record<string, StatusEntry> = {
  draft: { label: "Nháp", tone: "draft" },
  cho_xem_xet: { label: "Chờ xem xét", tone: "pending" },
  cho_phe_duyet: { label: "Chờ phê duyệt", tone: "pending" },
  co_hieu_luc: { label: "Có hiệu lực", tone: "valid" },
  het_hieu_luc: { label: "Hết hiệu lực", tone: "danger" },
  tra_ve: { label: "Trả về", tone: "returned" },
  bi_tu_choi_phe_duyet: { label: "Phê duyệt từ chối", tone: "danger" },
}

export const FORM_STATUS: Record<string, StatusEntry> = {
  draft: { label: "Nháp", tone: "draft" },
  cho_xem_xet: { label: "Chờ xem xét", tone: "pending" },
  cho_phe_duyet: { label: "Chờ phê duyệt", tone: "pending" },
  da_phe_duyet: { label: "Đã phê duyệt", tone: "valid" },
  tra_ve: { label: "Trả về", tone: "returned" },
  tu_choi: { label: "Từ chối", tone: "danger" },
}

// ── U0: các module còn lại — NHÃN giữ đúng như màn hình hiện tại, chỉ quy về 7 tông. ──

/** maintenance_records.trang_thai */
export const MAINTENANCE_STATUS: Record<string, StatusEntry> = {
  cho_duyet: { label: "Chờ duyệt", tone: "pending" },
  da_duyet: { label: "Đã duyệt", tone: "valid" },
  tu_choi: { label: "Từ chối", tone: "returned" },
  huy: { label: "Đã hủy", tone: "danger" },
}

/** Tiến độ sản lượng của phiếu điều xe (ENTRY_PROGRESS_UI). */
export const DISPATCH_PROGRESS_STATUS: Record<string, StatusEntry> = {
  ke_hoach: { label: "Kế hoạch", tone: "draft" },
  mot_phan: { label: "Đã có sản lượng", tone: "pending" },
  du: { label: "Đủ sản lượng", tone: "valid" },
}

/** qc_results.trang_thai */
export const QUALITY_STATUS: Record<string, StatusEntry> = {
  dat: { label: "Đạt", tone: "valid" },
  khong_dat: { label: "Không đạt", tone: "danger" },
}

/** purchase_requests.trang_thai */
export const PURCHASE_STATUS: Record<string, StatusEntry> = {
  nhap: { label: "Nháp", tone: "draft" },
  cho_ky: { label: "Đang ký duyệt", tone: "pending" },
  tra_ve: { label: "Bị trả về", tone: "returned" },
  da_duyet: { label: "Đã duyệt", tone: "valid" },
  dang_mua: { label: "Đang mua", tone: "info" },
  hoan_tat: { label: "Hoàn tất", tone: "valid" },
  dong: { label: "Đã đóng", tone: "draft" },
  huy: { label: "Đã huỷ", tone: "danger" },
}

/** inventory_documents.status; `cho_duyet` là trạng thái phái sinh (posted && !approved_at). */
export const INVENTORY_STATUS: Record<string, StatusEntry> = {
  draft: { label: "Nháp", tone: "draft" },
  cho_duyet: { label: "Chờ duyệt", tone: "pending" },
  posted: { label: "Đã ghi sổ", tone: "valid" },
  cancelled: { label: "Đã hủy", tone: "danger" },
}

/** export_orders.trang_thai (NULL ⇒ caller coi là đã duyệt, như getExportOrderStatus). */
export const EXPORT_STATUS: Record<string, StatusEntry> = {
  cho_phe_duyet: { label: "Chờ phê duyệt", tone: "pending" },
  da_phe_duyet: { label: "Đã phê duyệt", tone: "valid" },
}

/** lots.trang_thai — key là nhãn ĐÃ qua normalizeLotStatus (product/shared.ts). */
export const LOT_STATUS: Record<string, StatusEntry> = {
  "Dở dang": { label: "Dở dang", tone: "pending" },
  "Hoàn thành": { label: "Hoàn thành", tone: "valid" },
  "Xuất hàng": { label: "Xuất hàng", tone: "info" },
}

/** ngans.trang_thai */
export const STORAGE_STATUS: Record<string, StatusEntry> = {
  "Đang nhận": { label: "Đang nhận", tone: "draft" },
  "Đang nhận (Cần cập nhật)": { label: "Đang nhận", tone: "draft" }, // giá trị cũ (storage-status.ts)
  "Đóng": { label: "Đóng", tone: "returned" },
  "Chờ sản xuất": { label: "Chờ sản xuất", tone: "pending" },
  "Đang sản xuất": { label: "Đang sản xuất", tone: "valid" },
  "Đã sản xuất": { label: "Đã sản xuất", tone: "info" },
}

const REGISTRY: Record<StatusDomain, Record<string, StatusEntry>> = {
  doc: DOC_STATUS,
  iso: ISO_STATUS,
  form: FORM_STATUS,
  maintenance: MAINTENANCE_STATUS,
  dispatch_progress: DISPATCH_PROGRESS_STATUS,
  quality: QUALITY_STATUS,
  purchase: PURCHASE_STATUS,
  inventory: INVENTORY_STATUS,
  export: EXPORT_STATUS,
  lot: LOT_STATUS,
  storage: STORAGE_STATUS,
}

export function resolveStatus(domain: StatusDomain, status: string | null | undefined): StatusEntry {
  const key = status || "draft"
  return REGISTRY[domain][key] ?? { label: key, tone: "draft" }
}

/** Dựng lại map label kiểu cũ (`Record<key, label>`) từ registry. */
export function labelMap<K extends string>(registry: Record<string, StatusEntry>): Record<K, string> {
  return Object.fromEntries(Object.entries(registry).map(([k, v]) => [k, v.label])) as Record<K, string>
}

/** Dựng lại map class kiểu cũ (`Record<key, className>`) — chỉ bg + text + border-color. */
export function colorMap<K extends string>(registry: Record<string, StatusEntry>): Record<K, string> {
  return Object.fromEntries(Object.entries(registry).map(([k, v]) => [k, TONE_CLASSES[v.tone].badge])) as Record<K, string>
}
