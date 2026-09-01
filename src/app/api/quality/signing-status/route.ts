import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"

export const dynamic = "force-dynamic"

// Đọc trạng thái ký (yeu_cau_ky) theo từng NGÀY cho danh sách Kiểm nghiệm. RLS gốc của
// yeu_cau_ky chỉ cho owner/participant/admin đọc — không đủ cho mọi người xem danh sách Kiểm
// nghiệm thấy banner "Chờ ký duyệt"/"Đã ký duyệt". Dùng route service-role riêng (mirror
// src/app/api/quality/approvers/route.ts trước đây, src/app/api/signing/participants/route.ts)
// thay vì mở rộng RLS chung của bảng — bảng này dùng chung cho nhiều module tương lai, có thể
// cần giữ kín trạng thái ký ở module khác.
type SignerRow = { userId: string; thuTu: number; trangThai: string }
type Row = {
  date: string
  yeuCauId: string
  trangThai: "dang_luan_chuyen" | "hoan_tat"
  nguoiTao: string
  pheDuyetUserId: string | null
  fileHienTai: string | null
  traVeLyDo: string | null
  dataChanged: boolean
  // Toàn bộ người ký kèm thu_tu/trang_thai — dùng để tính "có phải lượt của người đang xem
  // hay không" ở badge (xem src/app/dashboard/_components/signing-my-turn.ts).
  signers: SignerRow[]
}

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const factoryId = req.nextUrl.searchParams.get("factoryId")
    const datesParam = req.nextUrl.searchParams.get("dates")
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
      .eq("modun", "quality")
      .eq("loai_tai_lieu", "quality_kqkn")
      .in("trang_thai", ["dang_luan_chuyen", "hoan_tat"])
      .order("tao_luc", { ascending: false })
    if (datesParam) {
      const dates = datesParam.split(",").filter(Boolean)
      if (dates.length) q = q.in("ma_ho_so", dates)
    }

    const { data: yeuCauRows, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    if (!yeuCauRows?.length) return NextResponse.json([])

    const yeuCauIds = yeuCauRows.map((r) => r.id as string)
    // Lấy TOÀN BỘ người ký (không chỉ phe_duyet) — vừa để suy pheDuyetUserId như cũ, vừa để
    // build signers[] đầy đủ phục vụ tính "myTurn" ở badge.
    const { data: allSignerRows } = await supabaseAdmin
      .from("nguoi_ky")
      .select("yeu_cau_id, user_id, vai_tro, thu_tu, trang_thai")
      .in("yeu_cau_id", yeuCauIds)
    type NguoiKyRow = { yeu_cau_id: string; user_id: string; vai_tro: string; thu_tu: number; trang_thai: string }
    const pheDuyetByYeuCau = new Map(
      ((allSignerRows || []) as NguoiKyRow[])
        .filter((r) => r.vai_tro === "phe_duyet")
        .map((r) => [r.yeu_cau_id, r.user_id]),
    )
    const signersByYeuCau = new Map<string, SignerRow[]>()
    for (const r of (allSignerRows || []) as NguoiKyRow[]) {
      const list = signersByYeuCau.get(r.yeu_cau_id) ?? []
      list.push({ userId: r.user_id, thuTu: r.thu_tu, trangThai: r.trang_thai })
      signersByYeuCau.set(r.yeu_cau_id, list)
    }

    // Đã order tao_luc desc — dòng đầu tiên gặp mỗi "ma_ho_so" là mới nhất, giữ lại. Phòng
    // trường hợp còn sót dữ liệu trùng ma_ho_so cũ (trước khi có unique index, xem migration
    // 20260904_signing_quality_dedup.sql) — không để hiển thị 2 banner cho cùng 1 ngày.
    const seen = new Map<string, Row>()
    for (const r of yeuCauRows) {
      const key = r.ma_ho_so as string
      if (!key || seen.has(key)) continue
      seen.set(key, {
        date: key,
        yeuCauId: r.id as string,
        trangThai: r.trang_thai as Row["trangThai"],
        nguoiTao: r.nguoi_tao as string,
        pheDuyetUserId: pheDuyetByYeuCau.get(r.id as string) ?? null,
        fileHienTai: r.file_hien_tai as string | null,
        traVeLyDo: (r.tra_ve_ly_do as string | null) ?? null,
        dataChanged: false,
        signers: signersByYeuCau.get(r.id as string) ?? [],
      })
    }

    // Phát hiện lệch dữ liệu: so thời điểm ghi mới nhất của qc_results đúng ngày đó với
    // yeu_cau_ky.tao_luc (thời điểm PDF được chốt nội dung để ký) — mới hơn nghĩa là có
    // qc_results đã được thêm/sửa SAU khi ký, dù không chặn (theo quyết định đã chốt) vẫn cần
    // báo cho người dùng biết file đã ký không còn khớp dữ liệu hiện tại.
    const hoanTatRows = Array.from(seen.values()).filter((r) => r.trangThai === "hoan_tat")
    if (hoanTatRows.length) {
      const taoLucByYeuCau = new Map(yeuCauRows.map((r) => [r.id as string, r.tao_luc as string]))
      const { data: qcRows } = await supabaseAdmin
        .from("qc_results")
        .select("ngay_kn, created_at, updated_at")
        .eq("factory_id", factoryId)
        .in("ngay_kn", hoanTatRows.map((r) => r.date))
      const latestByDate = new Map<string, number>()
      for (const r of qcRows || []) {
        const key = (r.ngay_kn as string)?.slice(0, 10)
        if (!key) continue
        const t = Math.max(
          new Date(r.created_at as string).getTime(),
          new Date(r.updated_at as string).getTime(),
        )
        if (t > (latestByDate.get(key) ?? 0)) latestByDate.set(key, t)
      }
      for (const row of hoanTatRows) {
        const taoLuc = new Date(taoLucByYeuCau.get(row.yeuCauId) || 0).getTime()
        const latest = latestByDate.get(row.date) ?? 0
        row.dataChanged = latest > taoLuc
      }
    }

    return NextResponse.json(Array.from(seen.values()))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: 400 })
  }
}
