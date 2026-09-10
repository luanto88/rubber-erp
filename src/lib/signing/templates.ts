import { getSupabaseAdmin } from "@/lib/supabase-admin"

// CRUD cho bảng `mau_vi_tri` — mẫu vị trí trường ký theo loại tài liệu, dùng
// chung cho mọi module upload PDF/DOCX (Văn bản, ISO...). Chỉ tạo mới, KHÔNG
// bao giờ ghi đè bản cũ (mỗi lần lưu tăng `phien_ban`) — xem comment trong
// migration `20260902_signing_core_tables.sql`.
//
// Đây là bước "xây trang Cài đặt vị trí ký" (CLAUDE.md mục "Kế hoạch phiên sau
// 2026-09-02") — CHƯA tích hợp vào bất kỳ route ký thật nào (api/documents/sign,
// api/sign/generate-pdf...). File này chỉ phục vụ đọc/ghi mẫu, không đụng
// `yeu_cau_ky`/`truong_ky`/`stampPdf`.

export type SignTemplateBoxLoai = "chu_ky" | "qr" | "ngay_ky" | "ghi_chu"
export type SignTemplateAnchor = "dau" | "cuoi" | "moi_trang"
export type ChucVuKey = "chinh_quyen" | "kiem_nhiem" | "doan_the"

// Mirror SignAsType/SIGN_AS_OPTIONS/SIGN_AS_LABEL của documents-types.ts (module Văn bản) —
// khai báo riêng ở đây để giữ templates.ts độc lập module, dùng chung được cho mọi loại tài
// liệu khác sau này (ISO...). Giá trị PHẢI khớp 1-1 với documents-types.ts nếu 1 bên đổi.
export type SignTemplateSignAsKey = "KT" | "TM" | "TL" | "TUQ"

export const SIGN_TEMPLATE_SIGN_AS_OPTIONS: SignTemplateSignAsKey[] = ["KT", "TM", "TL", "TUQ"]

export const SIGN_TEMPLATE_SIGN_AS_LABEL: Record<SignTemplateSignAsKey, string> = {
  KT: "KT. (Ký thay)",
  TM: "TM. (Thay mặt)",
  TL: "TL. (Thừa lệnh)",
  TUQ: "TUQ. (Thừa ủy quyền)",
}

// Vượt trên tối thiểu mà comment cột `khung` trong migration liệt kê
// (vai_tro/neo_trang/so_trang/x_pt/y_pt/w_pt/h_pt) — `khung` là JSONB tự do
// (chỉ ràng buộc `jsonb_typeof = 'array'`), nên thêm các trường phục vụ preview/
// tích hợp sau này (loai, nhan, bat_buoc, show_name, chuc_vu_key, clone_of) là an
// toàn, không vi phạm constraint nào.
export type SignTemplateBox = {
  vai_tro: string
  clone_of?: string | null
  neo_trang: SignTemplateAnchor
  so_trang: number
  x_pt: number
  y_pt: number
  w_pt: number
  h_pt: number
  loai: SignTemplateBoxLoai
  nhan?: string | null
  bat_buoc: boolean
  show_name?: boolean
  // Hiện CHỨC VỤ dưới tên — công tắc ĐỘC LẬP với `show_name`, vì file PDF gốc có thể đã in sẵn
  // tên và/hoặc chức vụ; chỉ người soạn thảo biết cần vẽ đè cái nào. Optional: mẫu lưu TRƯỚC
  // 2026-09-04 chỉ có `show_name` (khi đó 1 công tắc gộp bật/tắt cả hai) → đọc ra `undefined`,
  // mọi nơi tiêu thụ PHẢI fallback `show_chuc_vu ?? show_name` để giữ đúng ý nghĩa mẫu cũ.
  show_chuc_vu?: boolean
  chuc_vu_key?: ChucVuKey | null
  // Tiền tố ký thay KT./TM./TL./TUQ. do NGƯỜI SOẠN THẢO chọn 1 lần lúc vẽ mẫu (chỉ áp dụng cho
  // vai trò phe_duyet, và ky_buoc khi bước thực tế là ký theo phòng ban) — optional, mẫu cũ lưu
  // trước phiên này không có trường này, đọc ra sẽ là undefined, KHÔNG phá dữ liệu cũ. CHƯA được
  // api/documents/sign/route.ts đọc — chỉ có tác dụng khi tích hợp "vị trí CỨNG" ở phiên sau.
  sign_as?: SignTemplateSignAsKey | null
}

export type SignTemplateRow = {
  id: string
  factory_id: string
  loai_tai_lieu: string
  phien_ban: number
  khung: SignTemplateBox[]
  tao_boi: string
  tao_luc: string
}

// ── Định nghĩa vai trò cho module ISO ──────────────────────────────────────────
export type IsoSignRoleId = "soan_thao" | "xem_xet" | "phe_duyet" | "qr"
export const ISO_ROLE_ORDER: IsoSignRoleId[] = ["soan_thao", "xem_xet", "phe_duyet", "qr"]

export const ISO_ROLE_DEFS: Record<
  IsoSignRoleId,
  {
    label: string
    loai: SignTemplateBoxLoai
    batBuoc: boolean
    showNameDefault: boolean
    showChucVuDefault: boolean
    defaultBox: { xPct: number; yPct: number; wPct: number; hPct: number }
  }
> = {
  soan_thao: {
    label: "Người soạn thảo",
    loai: "chu_ky",
    batBuoc: true,
    showNameDefault: false,
    showChucVuDefault: false,
    defaultBox: { xPct: 8, yPct: 74, wPct: 26, hPct: 14 },
  },
  xem_xet: {
    label: "Người xem xét",
    loai: "chu_ky",
    batBuoc: true,
    showNameDefault: false,
    showChucVuDefault: false,
    defaultBox: { xPct: 37, yPct: 74, wPct: 26, hPct: 14 },
  },
  phe_duyet: {
    label: "Người phê duyệt",
    loai: "chu_ky",
    batBuoc: true,
    showNameDefault: false,
    showChucVuDefault: false,
    defaultBox: { xPct: 66, yPct: 74, wPct: 26, hPct: 14 },
  },
  qr: {
    label: "Mã QR xác thực",
    loai: "qr",
    batBuoc: false,
    showNameDefault: false,
    showChucVuDefault: false,
    defaultBox: { xPct: 80, yPct: 6, wPct: 14, hPct: 10 },
  },
}

export const ISO_ROLE_COLORS: Record<IsoSignRoleId, { fg: string; bg: string }> = {
  soan_thao: { fg: "#0284c7", bg: "rgba(2,132,199,.14)" },
  xem_xet: { fg: "#d97706", bg: "rgba(217,119,6,.14)" },
  phe_duyet: { fg: "#059669", bg: "rgba(5,150,105,.14)" },
  qr: { fg: "#7c3aed", bg: "rgba(124,58,237,.14)" },
}

/**
 * Chuẩn hoá key mẫu cho ISO:
 * - Theo loại: `iso:loai:${loai}` (vd: `iso:loai:QT`, `iso:loai:HD`, `iso:loai:F`, `iso:loai:PL`)
 * - Theo mã: `iso:code:${code}` (vd: `iso:code:NMCB-QT01-F01`)
 */
export function formatIsoTemplateKey(codeOrType: string, isSpecificCode = false): string {
  const clean = codeOrType.trim()
  if (clean.startsWith("iso:")) return clean
  return isSpecificCode ? `iso:code:${clean}` : `iso:loai:${clean}`
}

export function parseTemplateKey(key: string): {
  modun: "van_ban" | "iso"
  isCode: boolean
  code: string
} {
  if (key.startsWith("iso:code:")) {
    return { modun: "iso", isCode: true, code: key.slice("iso:code:".length) }
  }
  if (key.startsWith("iso:loai:")) {
    return { modun: "iso", isCode: false, code: key.slice("iso:loai:".length) }
  }
  if (key.startsWith("iso:")) {
    return { modun: "iso", isCode: false, code: key.slice("iso:".length) }
  }
  return { modun: "van_ban", isCode: false, code: key }
}

export async function getLatestSignTemplate(
  factoryId: string,
  loaiTaiLieu: string,
  options?: { fallbackLoai?: string },
): Promise<SignTemplateRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("mau_vi_tri")
    .select("*")
    .eq("factory_id", factoryId)
    .eq("loai_tai_lieu", loaiTaiLieu)
    .order("phien_ban", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (data) return data as SignTemplateRow

  if (options?.fallbackLoai && options.fallbackLoai !== loaiTaiLieu) {
    const { data: fallbackData, error: fallbackError } = await getSupabaseAdmin()
      .from("mau_vi_tri")
      .select("*")
      .eq("factory_id", factoryId)
      .eq("loai_tai_lieu", options.fallbackLoai)
      .order("phien_ban", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (fallbackError) throw new Error(fallbackError.message)
    return (fallbackData as SignTemplateRow | null) ?? null
  }

  return null
}

export async function saveSignTemplate(params: {
  factoryId: string
  loaiTaiLieu: string
  khung: SignTemplateBox[]
  taoBoi: string
  allowEmpty?: boolean
}): Promise<SignTemplateRow> {
  if (!params.khung.length && !params.allowEmpty) {
    throw new Error("Chưa đặt khung nào — cần ít nhất 1 vai trò bắt buộc trước khi lưu mẫu")
  }
  const latest = await getLatestSignTemplate(params.factoryId, params.loaiTaiLieu)
  const nextPhienBan = (latest?.phien_ban ?? 0) + 1
  const { data, error } = await getSupabaseAdmin()
    .from("mau_vi_tri")
    .insert({
      factory_id: params.factoryId,
      loai_tai_lieu: params.loaiTaiLieu,
      phien_ban: nextPhienBan,
      khung: params.khung,
      tao_boi: params.taoBoi,
    })
    .select("*")
    .single()
  if (error) throw new Error(error.message)
  return data as SignTemplateRow
}
