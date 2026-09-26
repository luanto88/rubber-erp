import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"
import {
  chunk,
  fetchActiveYeuCau,
  fetchNguoiKyForYeuCau,
  fetchUpdatedAtMap,
  readStatusParams,
  statusErrorResponse,
  type YeuCauStatusRow,
} from "@/app/api/signing/_lib/status-query"

export const dynamic = "force-dynamic"

// Đọc trạng thái ký (yeu_cau_ky) theo từng BIÊN BẢN (maintenance_records.id — lưu ở
// `ban_ghi_id`, bản ghi lịch sử lưu ở `ma_ho_so`) cho cả 4 bundle Bảo trì (su_co_nho/bao_duong/
// bao_duong_xe/sua_chua_nho_xe — một biên bản chỉ khớp đúng 1 bundle tại một thời điểm). RLS gốc
// của yeu_cau_ky/nguoi_ky chỉ cho owner/participant/admin đọc — không đủ cho mọi người xem danh
// sách thấy đúng tiến độ ký. Trả về ĐẦY ĐỦ danh sách người ký vì các bundle này có nhiều người
// ký ngang hàng.
//
// Nhận id qua POST body (khuyến nghị — danh sách dài không vỡ URL) hoặc GET query (tương thích).

const MAINTENANCE_SIGN_BUNDLES = ["su_co_nho", "bao_duong", "bao_duong_xe", "sua_chua_nho_xe"]

type SignerStatus = { userId: string; thuTu: number; vaiTro: string; trangThai: string; hoTen: string }
type Row = {
  recordId: string
  yeuCauId: string
  trangThai: "dang_luan_chuyen" | "hoan_tat"
  nguoiTao: string
  fileHienTai: string | null
  traVeLyDo: string | null
  signers: SignerStatus[]
  dataChanged: boolean
}

async function handle(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const { factoryId, ids } = await readStatusParams(req, "recordIds")
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
      modun: "maintenance",
      loaiTaiLieu: MAINTENANCE_SIGN_BUNDLES,
      ids,
    })
    if (!yeuCauRows.length) return NextResponse.json([])

    // Dedupe theo ban_ghi_id (UUID của record), fallback sang ma_ho_so cho bản ghi lịch sử cũ.
    // Rows đã sắp mới nhất trước — dòng gặp đầu tiên là yêu cầu mới nhất.
    const seenYeuCau = new Map<string, YeuCauStatusRow>()
    for (const r of yeuCauRows) {
      const key = r.ban_ghi_id || r.ma_ho_so
      if (key && !seenYeuCau.has(key)) seenYeuCau.set(key, r)
    }
    const yeuCauIds = Array.from(seenYeuCau.values()).map((r) => r.id)

    const signerRows = await fetchNguoiKyForYeuCau(yeuCauIds)

    const userIds = [...new Set(signerRows.map((r) => r.user_id))]
    const profilesById = new Map<string, string>()
    for (const part of chunk(userIds)) {
      const { data: profileRows } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, username")
        .in("id", part)
      for (const p of (profileRows || []) as { id: string; full_name: string | null; username: string | null }[]) {
        profilesById.set(p.id, p.full_name || p.username || "")
      }
    }

    const signersByYeuCau = new Map<string, SignerStatus[]>()
    for (const s of signerRows) {
      const arr = signersByYeuCau.get(s.yeu_cau_id) || []
      arr.push({ userId: s.user_id, thuTu: s.thu_tu, vaiTro: s.vai_tro, trangThai: s.trang_thai, hoTen: profilesById.get(s.user_id) || "" })
      signersByYeuCau.set(s.yeu_cau_id, arr)
    }

    const result: Row[] = Array.from(seenYeuCau.entries()).map(([recordId, r]) => ({
      recordId,
      yeuCauId: r.id,
      trangThai: r.trang_thai as Row["trangThai"],
      nguoiTao: r.nguoi_tao,
      fileHienTai: r.file_hien_tai ?? null,
      traVeLyDo: r.tra_ve_ly_do ?? null,
      signers: signersByYeuCau.get(r.id) || [],
      dataChanged: false,
    }))

    // Phát hiện lệch dữ liệu: so updated_at mới nhất của maintenance_records với
    // yeu_cau_ky.tao_luc (thời điểm nội dung biên bản được chốt để ký). Chỉ cho hồ sơ hoan_tat.
    const hoanTatRows = result.filter((r) => r.trangThai === "hoan_tat")
    if (hoanTatRows.length) {
      const updatedAtByRecord = await fetchUpdatedAtMap("maintenance_records", hoanTatRows.map((r) => r.recordId))
      for (const row of hoanTatRows) {
        const yc = seenYeuCau.get(row.recordId)
        const taoLuc = new Date(yc?.tao_luc || 0).getTime()
        row.dataChanged = (updatedAtByRecord.get(row.recordId) ?? 0) > taoLuc
      }
    }

    return NextResponse.json(result)
  } catch (err) {
    return statusErrorResponse(err)
  }
}

export const GET = handle
export const POST = handle
