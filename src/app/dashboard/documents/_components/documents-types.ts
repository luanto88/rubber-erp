// Types và constants cho module Văn bản Nội bộ

import { supabase } from "@/lib/supabase"

export type VanBanTrangThai =
  | "draft"
  | "cho_ky_phong_ban"
  | "cho_phe_duyet"
  | "da_phe_duyet"
  | "tra_ve"

export type VanBanDocumentType = {
  id: string
  code: string
  name: string
  ky_hieu: string
  sort_order: number
  is_active: boolean
}

// Chữ viết tắt ký thay, chọn ngay lúc ký (SignPlacementModal) — áp dụng cho cả bước
// ký phòng ban (nguoi_ky[step].sign_as) và Phê duyệt cuối (phe_duyet_sign_as).
export type SignAsType = "none" | "KT" | "TM" | "TL" | "TUQ"

export const SIGN_AS_OPTIONS: Exclude<SignAsType, "none">[] = ["KT", "TM", "TL", "TUQ"]

export const SIGN_AS_LABEL: Record<Exclude<SignAsType, "none">, string> = {
  KT: "KT. (Ký thay)",
  TM: "TM. (Thay mặt)",
  TL: "TL. (Thừa lệnh)",
  TUQ: "TUQ. (Thừa ủy quyền)",
}

export type ThuTuKyStep = {
  step: number
  type: "phong_ban" | "ca_nhan"
  phong_ban_code?: string
  phong_ban_name?: string
  user_id?: string
  ten?: string
  chuc_vu?: string
  // Dùng khi phan_loai = 'Mat': đích danh 1 người nhận thông báo cho bước này
  mat_recipient_user_id?: string
}

export type VanBanDocument = {
  id: string
  factory_id: string
  ma_van_ban: string | null
  ten_van_ban: string
  cap_tl: string | null
  phong_ban: string | null
  loai_van_ban: string | null
  so_van_ban: string | null
  nam: number | null
  phan_loai: string       // 'Thuong' | 'Mat'
  trang_thai: VanBanTrangThai
  thu_tu_ky_json: ThuTuKyStep[]
  buoc_hien_tai: number
  so_buoc_tong: number
  nguoi_ky: Record<string, { ten: string; chuc_vu: string; ky_at: string; is_kt?: boolean; sign_as?: SignAsType }>
  placement_ky: Record<string, unknown>
  tra_ve_step: number | null
  tra_ve_ly_do: string | null
  tra_ve_nguoi: string | null
  tra_ve_at: string | null
  ngay_phe_duyet: string | null
  file_goc_url: string | null
  file_signed_pdf_url: string | null
  file_signed_office_url: string | null
  file_signed_office_type: string | null
  auto_convert_pdf: boolean
  is_uploaded: boolean
  phong_ban_ky_display: string[] | null
  nguoi_soan_thao_display: string | null
  mo_ta_tim_kiem: string | null
  soan_thao_user_id: string | null
  phe_duyet_user_id: string | null
  phe_duyet: string | null
  pham_vi: string | null            // 'Cong_ty' | 'Don_vi'
  phe_duyet_is_kt: boolean | null   // LEGACY — set lúc soạn thảo cho văn bản cũ trước 2026-07-06, chỉ đọc để hiển thị
  phe_duyet_sign_as: SignAsType | null   // chọn lúc ký (SignPlacementModal) — thay thế phe_duyet_is_kt cho văn bản mới
  ghi_chu: string | null
  created_at: string
  updated_at: string
}

export const PHAN_LOAI_OPTIONS = ["Thuong", "Mat"] as const
export type PhanLoaiCode = (typeof PHAN_LOAI_OPTIONS)[number]

export const PHAN_LOAI_LABEL: Record<string, string> = {
  Thuong: "Thường",
  Mat: "Mật",
}

export const PHAN_LOAI_COLOR: Record<string, string> = {
  Thuong: "bg-slate-100 text-slate-600",
  Mat: "bg-red-100 text-red-700 border border-red-200",
}

export const LOAI_VAN_BAN_OPTIONS = ["DN", "TTR", "BC", "KH", "BB"] as const
export type LoaiVanBanCode = (typeof LOAI_VAN_BAN_OPTIONS)[number]

export const LOAI_VAN_BAN_LABEL: Record<string, string> = {
  DN: "Đề nghị",
  TTR: "Tờ trình",
  BC: "Báo cáo",
  KH: "Kế hoạch",
  BB: "Biên bản",
}

export const LOAI_VAN_BAN_KY_HIEU: Record<string, string> = {
  DN: "ĐN",
  TTR: "Ttr",
  BC: "BC",
  KH: "KH",
  BB: "BB",
}

export const PHONG_BAN_VAN_BAN_OPTIONS = [
  "PHK", "KTNN", "QLCL", "KHXD", "TCKT", "TCHC", "TTBV", "NMCB", "CS",
] as const

export const TRANG_THAI_LABEL: Record<VanBanTrangThai, string> = {
  draft: "Nháp",
  cho_ky_phong_ban: "Chờ ký phòng ban",
  cho_phe_duyet: "Chờ phê duyệt",
  da_phe_duyet: "Đã phê duyệt",
  tra_ve: "Trả về",
}

export const TRANG_THAI_COLOR: Record<VanBanTrangThai, string> = {
  draft: "bg-slate-100 text-slate-600",
  cho_ky_phong_ban: "bg-amber-100 text-amber-700",
  cho_phe_duyet: "bg-orange-100 text-orange-700",
  da_phe_duyet: "bg-emerald-100 text-emerald-700",
  tra_ve: "bg-rose-100 text-rose-700",
}

// Xây dựng mã văn bản: 01/ĐN-KTNN
export function buildMaVanBan(so: number | string, kyHieu: string, phongBan: string): string {
  if (!so || !kyHieu || !phongBan) return ""
  const num = typeof so === "string" ? parseInt(so) : so
  if (isNaN(num) || num < 1) return ""
  return `${String(num).padStart(2, "0")}/${kyHieu}-${phongBan}`
}

// Chuẩn hóa tên file lưu vào Supabase Storage — bỏ dấu tiếng Việt, chỉ giữ ký tự an toàn.
// Mirror sanitizeStorageFileName() của module ISO (iso/documents/[id]/page.tsx).
export function sanitizeStorageFileName(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".")
  const rawBase = lastDot > 0 ? fileName.slice(0, lastDot) : fileName
  const rawExt = lastDot > 0 ? fileName.slice(lastDot + 1) : ""
  const base = rawBase
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120)
  const ext = rawExt.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()
  return `${base || "file"}${ext ? `.${ext}` : ""}`
}

// Tính số văn bản tiếp theo THẬT theo (loại, phòng ban, năm) — đọc trực tiếp
// MAX(so_van_ban) từ van_ban_documents. Trước đây gợi ý này đọc bảng đếm riêng
// `van_ban_sequences` (cột `last_so`/`loai`) — sai tên cột thật của bảng đó
// (`so_hien_tai`/`loai_van_ban`) nên luôn âm thầm trả về 0 → gợi ý luôn là "01" dù
// đã có văn bản trước đó. Bảng đếm riêng còn bị lệch dữ liệu thật mỗi khi người
// dùng tự sửa tay mã hoặc dùng luồng Upload ký tay (cả 2 đều không tăng bộ đếm đó).
// Tính thẳng từ dữ liệu thật loại bỏ hẳn nguồn số liệu thứ 2 có thể lệch — dùng
// chung cho cả preview (gợi ý) lẫn lúc lưu (new/page.tsx và new/upload/page.tsx).
export async function computeNextVanBanSo(
  fid: string,
  loaiVanBan: string,
  phongBan: string,
  nam: number,
): Promise<number> {
  const { data } = await supabase
    .from("van_ban_documents")
    .select("so_van_ban")
    .eq("factory_id", fid)
    .eq("loai_van_ban", loaiVanBan)
    .eq("phong_ban", phongBan)
    .eq("nam", nam)
  let max = 0
  for (const row of (data || []) as { so_van_ban: string | null }[]) {
    const m = (row.so_van_ban || "").match(/^(\d+)/)
    if (!m) continue
    const n = parseInt(m[1], 10)
    if (!isNaN(n) && n > max) max = n
  }
  return max + 1
}

// ── Parser tên file "01/ĐN-NMCB Tên văn bản" (nhiều biến thể không dấu "/") ─────
// Dùng chung cho cả `new/page.tsx` (Soạn thảo mới) lẫn `new/upload/page.tsx`
// (Upload ký tay) — trước đây chỉ Upload có, Soạn thảo mới chỉ lấy nguyên tên file
// làm tên văn bản (không tách được Loại VB/Phòng ban/mã lẫn trong tên).

export type ParsedVanBan = {
  matched: boolean
  loai_van_ban?: string
  phong_ban?: string
  so?: number
  ten_van_ban?: string
}

const normalizeVn = (s: string) => s.normalize("NFC").toLowerCase()

// Khớp 1 trong các `candidates` ở đầu chuỗi `str` (không phân biệt hoa/thường, chuẩn hóa dấu),
// ưu tiên candidate dài nhất trước để tránh khớp nhầm khi các mã có tiền tố chung.
function matchPrefix(str: string, candidates: string[]): { matched: string; rest: string } | null {
  const sorted = [...candidates].filter(Boolean).sort((a, b) => b.length - a.length)
  for (const c of sorted) {
    if (normalizeVn(str.slice(0, c.length)) === normalizeVn(c)) {
      return { matched: c, rest: str.slice(c.length) }
    }
  }
  return null
}

// Giống matchPrefix nhưng bắt buộc ranh giới từ sau khi khớp (hết chuỗi hoặc theo sau là khoảng trắng),
// tránh khớp nhầm 1 phần của mã phòng ban dài hơn (ví dụ "CS" trong 1 chuỗi thực ra là "CSKH").
function matchPhongBanPrefix(str: string): { matched: string; rest: string } | null {
  const upper = str.toUpperCase()
  const sorted = [...PHONG_BAN_VAN_BAN_OPTIONS].sort((a, b) => b.length - a.length)
  for (const pb of sorted) {
    if (upper.startsWith(pb)) {
      const rest = str.slice(pb.length)
      if (rest.length === 0 || /^\s/.test(rest)) return { matched: pb, rest }
    }
  }
  return null
}

// Windows không cho phép ký tự "/" trong tên file, nên người dùng đặt tên file theo nhiều biến thể
// không dấu gạch chéo, ví dụ với "01/ĐN-NMCB Đề nghị thay máy lạnh...":
//   "01 ĐN-NMCB Đề nghị thay máy lạnh..."   (dấu cách thay "/")
//   "01ĐN-NMCB Đề nghị thay máy lạnh..."    (không có ký tự phân cách trước ký hiệu)
//   "01ĐNNMCB Đề nghị thay máy lạnh..."     (không có ký tự phân cách nào cả)
// Parser tách tuần tự: số thứ tự (chữ số đầu) → ký hiệu loại văn bản (so khớp docTypes/hằng số tĩnh)
// → mã phòng ban (so khớp PHONG_BAN_VAN_BAN_OPTIONS, có ranh giới) → phần còn lại là tên/trích yếu.
// Khớp từng phần độc lập (không phải tất-cả-hoặc-không): nếu 1 phần không khớp được
// (ví dụ danh mục chưa kịp tải, hoặc org dùng loại chưa đăng ký), vẫn cố suy ra các
// phần còn lại — tránh để cả 3 trường cùng trống chỉ vì 1 phần không khớp quy ước.
export function parseVanBanFileName(fileName: string, docTypes: VanBanDocumentType[]): ParsedVanBan {
  const base = fileName.replace(/\.[^.]+$/, "").trim()

  const soMatch = base.match(/^(\d{1,4})/)
  if (!soMatch) return { matched: false }
  const so = parseInt(soMatch[1], 10)
  const afterSo = base.slice(soMatch[0].length).replace(/^[\s\-/]+/, "")

  const kyHieuCandidates = Array.from(
    new Set([...docTypes.map((t) => t.ky_hieu), ...Object.values(LOAI_VAN_BAN_KY_HIEU)]),
  )
  const kyHieuMatch = matchPrefix(afterSo, kyHieuCandidates)

  let loai_van_ban: string | undefined
  let afterKyHieu = afterSo
  if (kyHieuMatch) {
    const matchedType = docTypes.find((t) => normalizeVn(t.ky_hieu) === normalizeVn(kyHieuMatch.matched))
    loai_van_ban = matchedType?.code
    if (!loai_van_ban) {
      const reverseEntry = Object.entries(LOAI_VAN_BAN_KY_HIEU).find(
        ([, ky]) => normalizeVn(ky) === normalizeVn(kyHieuMatch.matched),
      )
      loai_van_ban = reverseEntry?.[0]
    }
    afterKyHieu = kyHieuMatch.rest.replace(/^[\s\-/]+/, "")
  }

  const phongBanMatch = matchPhongBanPrefix(afterKyHieu)
  const tenSource = phongBanMatch ? phongBanMatch.rest : afterKyHieu
  const ten_van_ban = tenSource.replace(/^[\s\-/]+/, "").trim()

  return {
    matched: !!(loai_van_ban || phongBanMatch || ten_van_ban),
    loai_van_ban,
    phong_ban: phongBanMatch?.matched,
    so,
    ten_van_ban: ten_van_ban || undefined,
  }
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return ""
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return d
  return dt.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })
}
