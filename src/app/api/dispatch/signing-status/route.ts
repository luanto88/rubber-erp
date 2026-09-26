import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"
import {
  fetchActiveYeuCau,
  fetchNguoiKyForYeuCau,
  fetchUpdatedAtMap,
  readStatusParams,
  statusErrorResponse,
} from "@/app/api/signing/_lib/status-query"

export const dynamic = "force-dynamic"

// Đọc trạng thái ký (yeu_cau_ky) theo từng PHIẾU ĐIỀU XE (dispatch_entries.id — lưu ở
// `ban_ghi_id`, bản ghi lịch sử lưu ở `ma_ho_so`) cho danh sách Điều xe. RLS gốc của yeu_cau_ky
// chỉ cho owner/participant/admin đọc — không đủ cho mọi người xem danh sách Điều xe thấy badge
// "Chờ ký duyệt"/"Đã ký duyệt". Dùng route service-role riêng.
//
// Nhận id qua POST body (khuyến nghị — danh sách dài không vỡ URL) hoặc GET query (tương thích).
type SignerRow = { userId: string; thuTu: number; trangThai: string }
type Row = {
  entryId: string
  yeuCauId: string
  trangThai: "dang_luan_chuyen" | "hoan_tat"
  nguoiTao: string
  pheDuyetUserId: string | null
  fileHienTai: string | null
  traVeLyDo: string | null
  dataChanged: boolean
  signers: SignerRow[]
}

async function handle(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const { factoryId, ids } = await readStatusParams(req, "entryIds")
    if (!factoryId) {
      return NextResponse.json({ error: "Thiếu factoryId" }, { status: 400 })
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("factory_id")
      .eq("id", authUser.id)
      .single()
    if (!profile || profile.factory_id !== factoryId) {
      return NextResponse.json({ error: "Không có quyền xem nhà máy này" }, { status: 403 })
    }
    if (ids && !ids.length) return NextResponse.json([])

    const yeuCauRows = await fetchActiveYeuCau({
      factoryId,
      modun: "dispatch",
      loaiTaiLieu: ["dispatch_bang_phan_xe"],
      ids,
    })
    if (!yeuCauRows.length) return NextResponse.json([])

    // Đã sắp tao_luc desc — dòng đầu tiên gặp mỗi bản ghi là mới nhất, giữ lại.
    const seen = new Map<string, Row>()
    const taoLucByYeuCau = new Map<string, string>()
    const keptRows = [] as typeof yeuCauRows
    for (const r of yeuCauRows) {
      const key = r.ban_ghi_id || r.ma_ho_so
      if (!key || seen.has(key)) continue
      keptRows.push(r)
      taoLucByYeuCau.set(r.id, r.tao_luc)
      seen.set(key, {
        entryId: key,
        yeuCauId: r.id,
        trangThai: r.trang_thai as Row["trangThai"],
        nguoiTao: r.nguoi_tao,
        pheDuyetUserId: null,
        fileHienTai: r.file_hien_tai,
        traVeLyDo: r.tra_ve_ly_do ?? null,
        dataChanged: false,
        signers: [],
      })
    }

    // Chỉ lấy người ký của các yêu cầu được giữ lại (không cần cho bản cũ bị khử trùng).
    const signerRows = await fetchNguoiKyForYeuCau(keptRows.map((r) => r.id))
    const byYeuCau = new Map<string, Row>(Array.from(seen.values()).map((row) => [row.yeuCauId, row]))
    for (const s of signerRows) {
      const row = byYeuCau.get(s.yeu_cau_id)
      if (!row) continue
      row.signers.push({ userId: s.user_id, thuTu: s.thu_tu, trangThai: s.trang_thai })
      if (s.vai_tro === "phe_duyet") row.pheDuyetUserId = s.user_id
    }

    // Phát hiện lệch dữ liệu: so `dispatch_entries.updated_at` với `yeu_cau_ky.tao_luc` (thời
    // điểm PDF được chốt nội dung để ký). Mới hơn ⇒ phiếu đã bị ghi đè sau khi ký — phổ biến
    // nhất qua writeBackToDispatch() (module Sản lượng), kênh này KHÔNG bị chặn (theo quyết
    // định đã chốt) nên chỉ báo cho người dùng biết, không chặn ghi.
    const hoanTatRows = Array.from(seen.values()).filter((r) => r.trangThai === "hoan_tat")
    if (hoanTatRows.length) {
      const updatedAtByEntry = await fetchUpdatedAtMap("dispatch_entries", hoanTatRows.map((r) => r.entryId))
      for (const row of hoanTatRows) {
        const taoLuc = new Date(taoLucByYeuCau.get(row.yeuCauId) || 0).getTime()
        row.dataChanged = (updatedAtByEntry.get(row.entryId) ?? 0) > taoLuc
      }
    }

    return NextResponse.json(Array.from(seen.values()))
  } catch (err) {
    return statusErrorResponse(err)
  }
}

export const GET = handle
export const POST = handle
