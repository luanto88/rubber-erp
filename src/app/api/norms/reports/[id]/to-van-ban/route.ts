import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { loadReportForActor, requireNormsReport, userHasNormsReport } from "@/app/api/norms/_lib/report-access"
import { addDaysISO } from "@/lib/date-utils"
import { fmtDateVN, reportLockRange } from "@/lib/norms/report-types"

export const dynamic = "force-dynamic"

// POST — "Ký nhiều bước qua Văn bản nội bộ": tạo văn bản NHÁP (loại BC, phòng NMCB, đúng số báo cáo đã cấp,
// file = PDF báo cáo, người soạn = người lập, người phê duyệt = BGĐ đã chọn) rồi người dùng mở văn bản để
// thêm bước ký / cài vị trí / gửi. Báo cáo chuyển "Chờ ký" và theo trạng thái văn bản (lib/norms/server.ts).

type Body = { fileBase64: string; nguoiLapId: string; bgdId: string }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveIsoActor(req)
    await requireNormsReport(actor)
    const { id } = await params
    const { report, batch } = await loadReportForActor(actor, id)
    const body = (await req.json()) as Body
    if (report.trang_thai !== "nhap" && report.trang_thai !== "tra_ve") {
      return NextResponse.json({ error: "Báo cáo không ở trạng thái Nháp / Bị trả về" }, { status: 409 })
    }
    if (report.van_ban_document_id) {
      const { data: doc } = await supabaseAdmin.from("van_ban_documents").select("id").eq("id", report.van_ban_document_id).maybeSingle()
      if (doc) return NextResponse.json({ docId: doc.id })
    }
    if (!report.ma_bao_cao || !report.so || !report.nam) return NextResponse.json({ error: "Chưa cấp số báo cáo" }, { status: 400 })
    if (!body.nguoiLapId || !body.bgdId || body.nguoiLapId === body.bgdId) {
      return NextResponse.json({ error: "Chọn Người lập và Ban giám đốc (2 người khác nhau)" }, { status: 400 })
    }
    if (body.nguoiLapId !== actor.userId && !(await userHasNormsReport(actor.factoryId, body.nguoiLapId))) {
      return NextResponse.json({ error: "Người lập được chọn chưa có quyền lập báo cáo định mức" }, { status: 400 })
    }
    if (report.yeu_cau_ky_id) {
      const { data: yc } = await supabaseAdmin.from("yeu_cau_ky").select("trang_thai").eq("id", report.yeu_cau_ky_id).maybeSingle()
      if (yc?.trang_thai === "dang_luan_chuyen") return NextResponse.json({ error: "Báo cáo đang có yêu cầu ký — thu hồi trước" }, { status: 409 })
    }
    const fileBytes = Buffer.from(String(body.fileBase64 || ""), "base64")
    if (!fileBytes.length) return NextResponse.json({ error: "File PDF rỗng" }, { status: 400 })

    const { data: people } = await supabaseAdmin.from("profiles").select("id, full_name, username").in("id", [body.nguoiLapId, body.bgdId])
    const nameOf = (uid: string) => {
      const p = (people || []).find((x) => x.id === uid)
      return (p?.full_name || p?.username || "") as string
    }
    const path = `${actor.factoryId}/vanban/drafts/${Date.now()}_bao_cao_dinh_muc_${report.so}_${report.nam}.pdf`
    const { error: upErr } = await supabaseAdmin.storage.from("iso-documents").upload(path, fileBytes, { contentType: "application/pdf", upsert: false })
    if (upErr) return NextResponse.json({ error: `Không tải được file: ${upErr.message}` }, { status: 400 })
    const fileUrl = supabaseAdmin.storage.from("iso-documents").getPublicUrl(path).data.publicUrl

    const snap = batch.snapshot
    const ten = `${report.template_name} (${fmtDateVN(snap.from)} – ${fmtDateVN(snap.to)})`
    const { data: doc, error: insErr } = await supabaseAdmin
      .from("van_ban_documents")
      .insert({
        factory_id: actor.factoryId,
        ma_van_ban: report.ma_bao_cao,
        ten_van_ban: ten,
        loai_van_ban: report.loai_van_ban,
        phong_ban: report.phong_ban,
        so_van_ban: String(report.so).padStart(2, "0"),
        nam: report.nam,
        che_do_xem: "cong_khai",
        trang_thai: "draft",
        is_uploaded: false,
        thu_tu_ky_json: [],
        buoc_hien_tai: 0,
        so_buoc_tong: 0,
        nguoi_ky: {},
        placement_ky: {},
        soan_thao_user_id: body.nguoiLapId,
        nguoi_soan_thao_display: nameOf(body.nguoiLapId),
        phe_duyet_user_id: body.bgdId,
        phe_duyet: nameOf(body.bgdId),
        pham_vi: "Cong_ty",
        ghi_chu: `Báo cáo định mức KTKT ${report.template_code} — lập từ module Định mức`,
        file_goc_url: fileUrl,
      })
      .select("id")
      .single()
    if (insErr || !doc) {
      await supabaseAdmin.storage.from("iso-documents").remove([path])
      return NextResponse.json({ error: insErr?.message || "Không tạo được văn bản" }, { status: 400 })
    }
    const lock = reportLockRange(report.template_kieu, report.khoa_ngay, snap, addDaysISO)
    const { error: rErr } = await supabaseAdmin
      .from("tech_norm_reports")
      .update({
        trang_thai: "cho_ky",
        van_ban_document_id: doc.id,
        yeu_cau_ky_id: null,
        nguoi_lap_id: body.nguoiLapId,
        bgd_id: body.bgdId,
        du_lieu_hash: batch.du_lieu_hash,
        khoa_tu: lock?.tu ?? null,
        khoa_den: lock?.den ?? null,
        gui_ky_luc: new Date().toISOString(),
      })
      .eq("id", id)
    if (rErr) return NextResponse.json({ error: rErr.message }, { status: 400 })
    return NextResponse.json({ docId: doc.id })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) === 500 ? 400 : isoAuthErrorStatus(err) })
  }
}
