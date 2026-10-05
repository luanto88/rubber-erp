import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"
import {
  fetchActiveYeuCau,
  fetchNguoiKyForYeuCau,
  chunk,
  readStatusParams,
  statusErrorResponse,
} from "@/app/api/signing/_lib/status-query"
import { hashDispatchEntry } from "@/lib/signing/data-fingerprint"

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
    const keptRows = [] as typeof yeuCauRows
    for (const r of yeuCauRows) {
      const key = r.ban_ghi_id || r.ma_ho_so
      if (!key || seen.has(key)) continue
      keptRows.push(r)
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

    // Phát hiện lệch dữ liệu THEO NỘI DUNG: so hash các trường in lên PDF (yeu_cau_ky.du_lieu_hash,
    // chốt lúc gửi ký) với hash tính lại từ dispatch_entries hiện tại. Trước đây so updated_at
    // với tao_luc → writeBackToDispatch() (module Sản lượng) ghi lại y nguyên vẫn bị báo "đã đổi".
    // Yêu cầu cũ không có du_lieu_hash (hoặc cột chưa tồn tại) → coi như không đổi.
    const hoanTatRows = Array.from(seen.values()).filter((r) => r.trangThai === "hoan_tat")
    if (hoanTatRows.length) {
      const hashByYeuCau = await fetchDuLieuHash(hoanTatRows.map((r) => r.yeuCauId))
      const needCheck = hoanTatRows.filter((r) => hashByYeuCau.get(r.yeuCauId))
      if (needCheck.length) {
        const currentHashByEntry = await fetchCurrentDispatchHashes(factoryId, needCheck.map((r) => r.entryId))
        for (const row of needCheck) {
          const current = currentHashByEntry.get(row.entryId)
          // Không đọc được phiếu (đã xóa/lỗi) → không khẳng định đã đổi.
          row.dataChanged = !!current && current !== hashByYeuCau.get(row.yeuCauId)
        }
      }
    }

    return NextResponse.json(Array.from(seen.values()))
  } catch (err) {
    return statusErrorResponse(err)
  }
}

export const GET = handle
export const POST = handle

/** Map yeu_cau_ky.id → du_lieu_hash. Cột chưa tồn tại (migration chưa chạy) → map rỗng. */
async function fetchDuLieuHash(yeuCauIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (const part of chunk([...new Set(yeuCauIds)])) {
    const { data, error } = await supabaseAdmin.from("yeu_cau_ky").select("id, du_lieu_hash").in("id", part)
    if (error) {
      console.warn("[dispatch/signing-status] Không đọc được du_lieu_hash:", error.message)
      return new Map()
    }
    for (const r of (data || []) as { id: string; du_lieu_hash: string | null }[]) {
      if (r.du_lieu_hash) map.set(r.id, r.du_lieu_hash)
    }
  }
  return map
}

/** Map dispatch_entries.id → hash nội dung hiện tại (1 query/lô, không N+1). */
async function fetchCurrentDispatchHashes(factoryId: string, entryIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (const part of chunk([...new Set(entryIds)])) {
    const { data, error } = await supabaseAdmin
      .from("dispatch_entries")
      .select("id, ngay, chung_nhan, rows")
      .eq("factory_id", factoryId)
      .in("id", part)
    if (error) {
      console.warn("[dispatch/signing-status] Không đọc được phiếu điều xe:", error.message)
      continue
    }
    for (const r of (data || []) as { id: string; ngay: string | null; chung_nhan: string | null; rows: unknown }[]) {
      map.set(r.id, hashDispatchEntry(r))
    }
  }
  return map
}
