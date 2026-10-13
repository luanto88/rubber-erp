// Doc-UI — registry trạng thái DÙNG CHUNG cho Văn bản nội bộ, Tài liệu ISO, Hồ sơ thực hiện ISO.
// Nguồn sự thật DUY NHẤT về nhãn + tông màu trạng thái của 2 module. Các map cũ
// `TRANG_THAI_LABEL/COLOR` (documents-types.ts, iso-types.ts) và `FORM_INSTANCE_STATUS_*`
// đã chuyển thành alias đọc từ đây để không vỡ import cũ.
//
// File THUẦN (không import gì runtime) — dùng được ở cả client lẫn route server.
// Màu tông theo mẫu previews/enterprise-iso-vanban-unified-preview.html (valid/pending/draft/
// danger). Class viết literal để Tailwind quét được — KHÔNG ghép chuỗi động.

export type StatusTone = "valid" | "pending" | "draft" | "danger" | "returned" | "info"

export type StatusDomain = "doc" | "iso" | "form"

export const TONE_CLASSES: Record<StatusTone, { badge: string; dot: string; pulse: boolean }> = {
  valid: { badge: "bg-[#ecfdf5] text-[#065f46] border-[#a7f3d0]", dot: "bg-[#15803d]", pulse: false },
  pending: { badge: "bg-[#fffbeb] text-[#92400e] border-[#fde68a]", dot: "bg-[#d97706]", pulse: true },
  draft: { badge: "bg-[#f8fafc] text-[#475569] border-[#cbd5e1]", dot: "bg-[#94a3b8]", pulse: false },
  danger: { badge: "bg-[#fef2f2] text-[#991b1b] border-[#fecaca]", dot: "bg-[#dc2626]", pulse: false },
  returned: { badge: "bg-[#fff1f2] text-[#9f1239] border-[#fecdd3]", dot: "bg-[#e11d48]", pulse: false },
  info: { badge: "bg-brand-50 text-brand-800 border-brand-200", dot: "bg-brand-600", pulse: false },
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

const REGISTRY: Record<StatusDomain, Record<string, StatusEntry>> = {
  doc: DOC_STATUS,
  iso: ISO_STATUS,
  form: FORM_STATUS,
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
