import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"

export const dynamic = "force-dynamic"

// Đọc trạng thái ký (yeu_cau_ky) theo từng PHIẾU ĐIỀU XE (dispatch_entries.id, dùng làm
// ma_ho_so) cho danh sách Điều xe. RLS gốc của yeu_cau_ky chỉ cho owner/participant/admin
// đọc — không đủ cho mọi người xem danh sách Điều xe thấy badge "Chờ ký duyệt"/"Đã ký
// duyệt". Dùng route service-role riêng, mirror src/app/api/quality/signing-status/route.ts.
type Row = {
  entryId: string
  yeuCauId: string
  trangThai: "dang_luan_chuyen" | "hoan_tat"
  nguoiTao: string
  pheDuyetUserId: string | null
  fileHienTai: string | null
  traVeLyDo: string | null
  dataChanged: boolean
}

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const factoryId = req.nextUrl.searchParams.get("factoryId")
    const entryIdsParam = req.nextUrl.searchParams.get("entryIds")
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
      .eq("modun", "dispatch")
      .eq("loai_tai_lieu", "dispatch_bang_phan_xe")
      .in("trang_thai", ["dang_luan_chuyen", "hoan_tat"])
      .order("tao_luc", { ascending: false })
    if (entryIdsParam) {
      const ids = entryIdsParam.split(",").filter(Boolean)
      if (ids.length) q = q.in("ma_ho_so", ids)
    }

    const { data: yeuCauRows, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    if (!yeuCauRows?.length) return NextResponse.json([])

    const yeuCauIds = yeuCauRows.map((r) => r.id as string)
    const { data: pheDuyetRows } = await supabaseAdmin
      .from("nguoi_ky")
      .select("yeu_cau_id, user_id")
      .in("yeu_cau_id", yeuCauIds)
      .eq("vai_tro", "phe_duyet")
    const pheDuyetByYeuCau = new Map(
      (pheDuyetRows || []).map((r: { yeu_cau_id: string; user_id: string }) => [r.yeu_cau_id, r.user_id]),
    )

    // Đã order tao_luc desc — dòng đầu tiên gặp mỗi "ma_ho_so" là mới nhất, giữ lại. Từ
    // migration 20260904, unique index `uniq_yeu_cau_ky_active_business_key` đã chặn
    // trùng ma_ho_so ở tầng DB cho MỌI module (bao gồm dispatch), nên về lý thuyết mỗi
    // entryId chỉ còn đúng 1 dòng active — vẫn giữ dedupe này để an toàn nếu có dữ liệu
    // cũ hoặc thay đổi migration sau này.
    const seen = new Map<string, Row>()
    for (const r of yeuCauRows) {
      const key = r.ma_ho_so as string
      if (!key || seen.has(key)) continue
      seen.set(key, {
        entryId: key,
        yeuCauId: r.id as string,
        trangThai: r.trang_thai as Row["trangThai"],
        nguoiTao: r.nguoi_tao as string,
        pheDuyetUserId: pheDuyetByYeuCau.get(r.id as string) ?? null,
        fileHienTai: r.file_hien_tai as string | null,
        traVeLyDo: (r.tra_ve_ly_do as string | null) ?? null,
        dataChanged: false,
      })
    }

    // Phát hiện lệch dữ liệu: so `dispatch_entries.updated_at` với `yeu_cau_ky.tao_luc` (thời
    // điểm PDF được chốt nội dung để ký). Mới hơn ⇒ phiếu đã bị ghi đè sau khi ký — phổ biến
    // nhất qua writeBackToDispatch() (module Sản lượng), kênh này KHÔNG bị chặn (theo quyết
    // định đã chốt) nên chỉ báo cho người dùng biết, không chặn ghi.
    const hoanTatRows = Array.from(seen.values()).filter((r) => r.trangThai === "hoan_tat")
    if (hoanTatRows.length) {
      const taoLucByYeuCau = new Map(yeuCauRows.map((r) => [r.id as string, r.tao_luc as string]))
      const { data: entryRows } = await supabaseAdmin
        .from("dispatch_entries")
        .select("id, updated_at")
        .in("id", hoanTatRows.map((r) => r.entryId))
      const updatedAtByEntry = new Map(
        (entryRows || []).map((r) => [r.id as string, new Date(r.updated_at as string).getTime()]),
      )
      for (const row of hoanTatRows) {
        const taoLuc = new Date(taoLucByYeuCau.get(row.yeuCauId) || 0).getTime()
        const latest = updatedAtByEntry.get(row.entryId) ?? 0
        row.dataChanged = latest > taoLuc
      }
    }

    return NextResponse.json(Array.from(seen.values()))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: 400 })
  }
}
