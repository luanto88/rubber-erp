import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"

export const dynamic = "force-dynamic"

// Route CÔNG KHAI (không yêu cầu đăng nhập) phục vụ trang tra cứu QR `/iso-doc/[id]`.
//
// Vì sao cần route riêng thay vì để trang đọc thẳng Supabase bằng anon key: RLS của
// `iso_documents` chỉ cho người đăng nhập cùng nhà máy đọc, và kể cả có nới RLS thì client sẽ
// thấy TOÀN BỘ cột — gồm tên người soạn thảo/xem xét/phê duyệt, lý do soát xét, ghi chú nội bộ.
// Ở đây dùng service role nhưng CHỈ trả đúng phần metadata vốn đã in công khai trên chính trang
// bìa tài liệu, xem PUBLIC_FIELDS bên dưới.
//
// Mirror mức độ lộ thông tin của `/api/documents/verify/[logId]`: không thêm gì ngoài những gì
// người cầm bản in giấy đã nhìn thấy.

/** Cột được phép đọc từ DB — cố ý KHÔNG lấy soan_thao/xem_xet/phe_duyet, ly_do/noi_dung soát xét, ghi_chu. */
const DOC_COLS = [
  "id",
  "factory_id",
  "ma_tai_lieu",
  "ten_tai_lieu",
  "loai_tai_lieu",
  "phan_loai_tl",
  "phong_ban",
  "cap_tl",
  "lan_ban_hanh",
  "trang_thai",
  "ngay_hieu_luc",
  "ngay_het_hieu_luc",
  "ma_tai_lieu_cu",
  "ma_tai_lieu_moi",
  "parent_doc_id",
  "file_signed_pdf_url",
  "file_signed_office_url",
  "file_goc_url",
].join(", ")

/** Chỉ tài liệu ĐÃ BAN HÀNH mới được công khai — bản nháp/đang luân chuyển tuyệt đối không lộ ra ngoài. */
const PUBLIC_STATUSES = new Set(["co_hieu_luc", "het_hieu_luc"])

type DocRow = {
  id: string
  factory_id: string
  ma_tai_lieu: string | null
  ten_tai_lieu: string | null
  loai_tai_lieu: string | null
  phan_loai_tl: string | null
  parent_doc_id: string | null
  phong_ban: string | null
  cap_tl: string | null
  lan_ban_hanh: string | null
  trang_thai: string
  ngay_hieu_luc: string | null
  ngay_het_hieu_luc: string | null
  ma_tai_lieu_cu: string | null
  ma_tai_lieu_moi: string | null
  file_signed_pdf_url: string | null
  file_signed_office_url: string | null
  file_goc_url: string | null
}

type ReplacementRow = {
  id: string
  ma_tai_lieu: string | null
  ten_tai_lieu: string | null
  lan_ban_hanh: string | null
  ngay_hieu_luc: string | null
}

const REPLACEMENT_COLS = "id, ma_tai_lieu, ten_tai_lieu, lan_ban_hanh, ngay_hieu_luc"

/**
 * Tìm bản đang có hiệu lực thay thế cho một tài liệu đã hết hiệu lực.
 *
 * Hai đường tra, vì luồng soát xét cho phép ĐỔI MÃ (xem rule 17-iso-soat-xet):
 *  1. Bản mới giữ nguyên mã, hoặc bản cũ có ghi sẵn `ma_tai_lieu_moi` → tra theo mã đó.
 *  2. Bản mới ghi `ma_tai_lieu_cu` = mã của bản cũ → tra ngược lại.
 *
 * Cố ý dùng 2 truy vấn rời thay vì `.or(...)`: chuỗi filter của PostgREST tự tách bằng dấu phẩy
 * nên mã tài liệu chứa ký tự lạ có thể làm hỏng câu lệnh — 2 truy vấn `.eq()` thì luôn an toàn.
 */
async function findReplacement(doc: DocRow): Promise<ReplacementRow | null> {
  const supabase = getSupabaseAdmin()
  const targetCode = doc.ma_tai_lieu_moi || doc.ma_tai_lieu

  const byCode = targetCode
    ? await supabase
        .from("iso_documents")
        .select(REPLACEMENT_COLS)
        .eq("factory_id", doc.factory_id)
        .eq("trang_thai", "co_hieu_luc")
        .eq("ma_tai_lieu", targetCode)
        .neq("id", doc.id)
        .order("ngay_hieu_luc", { ascending: false })
        .limit(1)
    : { data: null }

  const found = (byCode.data as ReplacementRow[] | null)?.[0]
  if (found) return found

  if (!doc.ma_tai_lieu) return null
  const byOldCode = await supabase
    .from("iso_documents")
    .select(REPLACEMENT_COLS)
    .eq("factory_id", doc.factory_id)
    .eq("trang_thai", "co_hieu_luc")
    .eq("ma_tai_lieu_cu", doc.ma_tai_lieu)
    .neq("id", doc.id)
    .order("ngay_hieu_luc", { ascending: false })
    .limit(1)

  return (byOldCode.data as ReplacementRow[] | null)?.[0] ?? null
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase.from("iso_documents").select(DOC_COLS).eq("id", id).maybeSingle()
    if (error) {
      return NextResponse.json({ error: "Không đọc được tài liệu" }, { status: 500 })
    }

    const doc = data as DocRow | null
    if (!doc) {
      return NextResponse.json({ error: "Không tìm thấy tài liệu này" }, { status: 404 })
    }

    // Thông báo trung tính, không xác nhận/phủ nhận nội dung bên trong — tài liệu chưa ban hành
    // là dữ liệu nội bộ.
    if (!PUBLIC_STATUSES.has(doc.trang_thai)) {
      return NextResponse.json(
        { error: "Tài liệu này chưa được ban hành nên không tra cứu công khai được." },
        { status: 403 },
      )
    }

    const expired = doc.trang_thai === "het_hieu_luc"
    const replacement = expired ? await findReplacement(doc) : null

    // Liên kết Cha - Con phục vụ tra cứu QR:
    // 1. Nếu là tài liệu cha: Lấy danh sách các biểu mẫu con đính kèm trong cùng bộ
    let childDocs: Array<{
      id: string
      maTaiLieu: string | null
      tenTaiLieu: string | null
      loaiTaiLieu: string | null
      lanBanHanh: string | null
      fileUrl: string | null
    }> = []

    if (doc.phan_loai_tl !== "con") {
      const { data: children } = await supabase
        .from("iso_documents")
        .select("id, ma_tai_lieu, ten_tai_lieu, loai_tai_lieu, lan_ban_hanh, file_signed_pdf_url, file_signed_office_url, file_goc_url")
        .eq("factory_id", doc.factory_id)
        .eq("parent_doc_id", doc.id)
        .eq("trang_thai", "co_hieu_luc")
        .order("ma_tai_lieu", { ascending: true })

      if (children && children.length > 0) {
        childDocs = children.map((c) => ({
          id: c.id,
          maTaiLieu: c.ma_tai_lieu,
          tenTaiLieu: c.ten_tai_lieu,
          loaiTaiLieu: c.loai_tai_lieu,
          lanBanHanh: c.lan_ban_hanh,
          fileUrl: c.file_signed_pdf_url || c.file_signed_office_url || c.file_goc_url,
        }))
      }
    }

    // 2. Nếu là biểu mẫu con: Lấy thông tin Quy trình cha
    let parentDoc: {
      id: string
      maTaiLieu: string | null
      tenTaiLieu: string | null
    } | null = null

    if (doc.parent_doc_id) {
      const { data: parent } = await supabase
        .from("iso_documents")
        .select("id, ma_tai_lieu, ten_tai_lieu")
        .eq("id", doc.parent_doc_id)
        .maybeSingle()

      if (parent) {
        parentDoc = {
          id: parent.id,
          maTaiLieu: parent.ma_tai_lieu,
          tenTaiLieu: parent.ten_tai_lieu,
        }
      }
    }

    return NextResponse.json({
      id: doc.id,
      maTaiLieu: doc.ma_tai_lieu,
      tenTaiLieu: doc.ten_tai_lieu,
      loaiTaiLieu: doc.loai_tai_lieu,
      phanLoaiTl: doc.phan_loai_tl,
      phongBan: doc.phong_ban,
      capTl: doc.cap_tl,
      lanBanHanh: doc.lan_ban_hanh,
      trangThai: doc.trang_thai,
      ngayHieuLuc: doc.ngay_hieu_luc,
      ngayHetHieuLuc: doc.ngay_het_hieu_luc,
      // Với bản hết hiệu lực, restamp-pdf đã GHI ĐÈ file_signed_pdf_url bằng bản đóng dấu
      // "HẾT HIỆU LỰC" ⇒ QR cũ quét ra đúng bản có dấu, không cần thêm cột nào.
      fileUrl: doc.file_signed_pdf_url || doc.file_signed_office_url || doc.file_goc_url,
      childDocs,
      parentDoc,
      replacement: replacement
        ? {
            id: replacement.id,
            maTaiLieu: replacement.ma_tai_lieu,
            tenTaiLieu: replacement.ten_tai_lieu,
            lanBanHanh: replacement.lan_ban_hanh,
            ngayHieuLuc: replacement.ngay_hieu_luc,
          }
        : null,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: 500 })
  }
}
