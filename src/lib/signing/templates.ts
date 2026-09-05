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

export async function getLatestSignTemplate(
  factoryId: string,
  loaiTaiLieu: string,
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
  return (data as SignTemplateRow | null) ?? null
}

export async function saveSignTemplate(params: {
  factoryId: string
  loaiTaiLieu: string
  khung: SignTemplateBox[]
  taoBoi: string
}): Promise<SignTemplateRow> {
  if (!params.khung.length) {
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
