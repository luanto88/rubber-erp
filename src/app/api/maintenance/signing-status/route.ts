import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"

export const dynamic = "force-dynamic"

// Đọc trạng thái ký (yeu_cau_ky) theo từng BIÊN BẢN (maintenance_records.id, dùng làm
// ma_ho_so) cho cả 4 bundle Bảo trì (su_co_nho/bao_duong/bao_duong_xe/sua_chua_nho_xe — một
// biên bản chỉ khớp đúng 1 bundle tại một thời điểm nên không cần biết chính xác loại nào,
// lọc theo `recordIds` là đủ phân biệt). RLS gốc của yeu_cau_ky/nguoi_ky chỉ cho owner/
// participant/admin đọc — không đủ cho mọi người xem trang chi tiết biên bản thấy đúng
// tiến độ ký của mọi người. Mirror src/app/api/dispatch/signing-status/route.ts, khác ở
// chỗ trả về ĐẦY ĐỦ danh sách người ký (không chỉ 1 "người phê duyệt") vì các bundle này có
// nhiều người ký ngang hàng, không phải mô hình 2 người (lập biểu/lập bảng + 1 người duyệt).

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

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const factoryId = req.nextUrl.searchParams.get("factoryId")
    const recordIdsParam = req.nextUrl.searchParams.get("recordIds")
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

    let q = supabaseAdmin
      .from("yeu_cau_ky")
      .select("id, ma_ho_so, trang_thai, nguoi_tao, file_hien_tai, tao_luc, tra_ve_ly_do")
      .eq("factory_id", factoryId)
      .eq("modun", "maintenance")
      .in("loai_tai_lieu", MAINTENANCE_SIGN_BUNDLES)
      .in("trang_thai", ["dang_luan_chuyen", "hoan_tat"])
      .order("tao_luc", { ascending: false })
    if (recordIdsParam) {
      const ids = recordIdsParam.split(",").filter(Boolean)
      if (ids.length) q = q.in("ma_ho_so", ids)
    }

    const { data: yeuCauRows, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    if (!yeuCauRows?.length) return NextResponse.json([])

    // Dedupe theo ma_ho_so, giữ dòng mới nhất — unique index `uniq_yeu_cau_ky_active_business_key`
    // (migration 20260904) đã chặn trùng ở tầng DB, nhưng vẫn dedupe phòng dữ liệu cũ.
    const seenYeuCau = new Map<string, typeof yeuCauRows[number]>()
    for (const r of yeuCauRows) {
      const key = r.ma_ho_so as string
      if (key && !seenYeuCau.has(key)) seenYeuCau.set(key, r)
    }
    const yeuCauIds = Array.from(seenYeuCau.values()).map((r) => r.id as string)

    const { data: signerRows } = await supabaseAdmin
      .from("nguoi_ky")
      .select("yeu_cau_id, user_id, thu_tu, vai_tro, trang_thai")
      .in("yeu_cau_id", yeuCauIds)
      .order("thu_tu", { ascending: true })

    const userIds = [...new Set((signerRows || []).map((r: { user_id: string }) => r.user_id))]
    const profilesById = new Map<string, string>()
    if (userIds.length) {
      const { data: profileRows } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, username")
        .in("id", userIds)
      for (const p of (profileRows || []) as { id: string; full_name: string | null; username: string | null }[]) {
        profilesById.set(p.id, p.full_name || p.username || "")
      }
    }

    const signersByYeuCau = new Map<string, SignerStatus[]>()
    for (const s of (signerRows || []) as { yeu_cau_id: string; user_id: string; thu_tu: number; vai_tro: string; trang_thai: string }[]) {
      const arr = signersByYeuCau.get(s.yeu_cau_id) || []
      arr.push({ userId: s.user_id, thuTu: s.thu_tu, vaiTro: s.vai_tro, trangThai: s.trang_thai, hoTen: profilesById.get(s.user_id) || "" })
      signersByYeuCau.set(s.yeu_cau_id, arr)
    }

    const result: Row[] = Array.from(seenYeuCau.entries()).map(([recordId, r]) => ({
      recordId,
      yeuCauId: r.id as string,
      trangThai: r.trang_thai as Row["trangThai"],
      nguoiTao: r.nguoi_tao as string,
      fileHienTai: (r.file_hien_tai as string | null) ?? null,
      traVeLyDo: (r.tra_ve_ly_do as string | null) ?? null,
      signers: signersByYeuCau.get(r.id as string) || [],
      dataChanged: false,
    }))

    // Phát hiện lệch dữ liệu: so updated_at mới nhất của maintenance_records với
    // yeu_cau_ky.tao_luc (thời điểm nội dung biên bản được chốt để ký) — mirror
    // src/app/api/quality/signing-status/route.ts. Chỉ cần cho hồ sơ đã hoan_tat.
    const hoanTatRows = result.filter((r) => r.trangThai === "hoan_tat")
    if (hoanTatRows.length) {
      const { data: recordRows } = await supabaseAdmin
        .from("maintenance_records")
        .select("id, updated_at")
        .in("id", hoanTatRows.map((r) => r.recordId))
      const updatedAtByRecord = new Map(
        ((recordRows || []) as { id: string; updated_at: string | null }[]).map((rec) => [rec.id, rec.updated_at]),
      )
      for (const row of hoanTatRows) {
        const yc = seenYeuCau.get(row.recordId)
        const taoLuc = new Date((yc?.tao_luc as string) || 0).getTime()
        const updatedAt = new Date(updatedAtByRecord.get(row.recordId) || 0).getTime()
        row.dataChanged = updatedAt > taoLuc
      }
    }

    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: 400 })
  }
}
