import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { loadReportForActor, requireNormsReport, userHasNormsReport } from "@/app/api/norms/_lib/report-access"
import { cancelSigningRequest, createSigningRequest, type SigningFieldInput } from "@/lib/signing/requests"
import { scheduleSigningNotify } from "@/lib/signing/notify"
import { addDaysISO } from "@/lib/date-utils"
import { NORM_REPORT_LOAI_TAI_LIEU, NORM_REPORT_SIGN_ORDER, NORMS_MODUN, reportLockRange, type NormReportSignRole } from "@/lib/norms/report-types"
import { overLines } from "@/lib/norms/report-templates"

export const dynamic = "force-dynamic"

// POST — Gửi ký 1 báo cáo định mức: Người lập (10, ký) → Ban giám đốc (20, phê duyệt). PDF do client dựng
// (đã có số báo cáo — gọi reserve-number trước). Gửi lại sau Trả về: huỷ yêu cầu ký cũ, tạo yêu cầu mới.
// Mẫu khoá ngày (8A, 09): đặt khoa_tu / khoa_den ⇒ tech_norm_entry_locked() chặn sửa nhập liệu của kỳ.

type Body = { fileBase64: string; fieldsByRole: Record<NormReportSignRole, SigningFieldInput[]>; nguoiLapId: string; bgdId: string }

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
    if (report.van_ban_document_id) return NextResponse.json({ error: "Báo cáo đang ký qua Văn bản nội bộ" }, { status: 409 })
    if (!report.ma_bao_cao) return NextResponse.json({ error: "Chưa cấp số báo cáo" }, { status: 400 })
    if (!body.nguoiLapId || !body.bgdId) return NextResponse.json({ error: "Chưa chọn Người lập hoặc Ban giám đốc" }, { status: 400 })
    if (body.nguoiLapId === body.bgdId) return NextResponse.json({ error: "Người lập và Ban giám đốc phải là 2 người khác nhau" }, { status: 400 })
    if (body.nguoiLapId !== actor.userId && !(await userHasNormsReport(actor.factoryId, body.nguoiLapId))) {
      return NextResponse.json({ error: "Người lập được chọn chưa có quyền lập báo cáo định mức" }, { status: 400 })
    }
    if (report.template_kieu === "thang_8a") {
      const missing = overLines(batch.snapshot).filter((l) => !String(report.giai_trinh?.[l.key] || "").trim())
      if (missing.length) {
        return NextResponse.json({ error: `Chưa giải trình ${missing.length} chỉ tiêu vượt định mức: ${missing.map((l) => l.itemName).join(", ")}` }, { status: 400 })
      }
    }
    const fileBytes = Buffer.from(String(body.fileBase64 || ""), "base64")
    if (!fileBytes.length) return NextResponse.json({ error: "File PDF rỗng" }, { status: 400 })
    for (const role of Object.keys(NORM_REPORT_SIGN_ORDER) as NormReportSignRole[]) {
      if (!body.fieldsByRole?.[role]?.length) return NextResponse.json({ error: "Thiếu khung ký trên báo cáo" }, { status: 400 })
    }

    if (report.yeu_cau_ky_id) {
      const { data: oldYc } = await supabaseAdmin.from("yeu_cau_ky").select("trang_thai").eq("id", report.yeu_cau_ky_id).maybeSingle()
      if (oldYc?.trang_thai === "dang_luan_chuyen") {
        await cancelSigningRequest({ yeuCauId: report.yeu_cau_ky_id, userId: actor.userId, isAdmin: true })
      }
    }

    const userByRole: Record<NormReportSignRole, string> = { nguoi_lap: body.nguoiLapId, bgd: body.bgdId }
    const signers = (Object.keys(NORM_REPORT_SIGN_ORDER) as NormReportSignRole[]).map((role) => ({
      userId: userByRole[role],
      thuTu: NORM_REPORT_SIGN_ORDER[role].thuTu,
      vaiTro: NORM_REPORT_SIGN_ORDER[role].vaiTro,
      fields: body.fieldsByRole[role],
    }))
    const { yeuCauId, notifyPlan } = await createSigningRequest({
      factoryId: actor.factoryId,
      modun: NORMS_MODUN,
      loaiTaiLieu: NORM_REPORT_LOAI_TAI_LIEU[report.template_kieu],
      banGhiId: id,
      maHoSo: report.ma_bao_cao,
      nguoiTaoId: actor.userId,
      fileBytes,
      fileExt: "pdf",
      signers,
    })
    const lock = reportLockRange(report.template_kieu, report.khoa_ngay, batch.snapshot, addDaysISO)
    const { error: upErr } = await supabaseAdmin
      .from("tech_norm_reports")
      .update({
        trang_thai: "cho_ky",
        yeu_cau_ky_id: yeuCauId,
        nguoi_lap_id: body.nguoiLapId,
        bgd_id: body.bgdId,
        du_lieu_hash: batch.du_lieu_hash,
        khoa_tu: lock?.tu ?? null,
        khoa_den: lock?.den ?? null,
        gui_ky_luc: new Date().toISOString(),
      })
      .eq("id", id)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 })
    scheduleSigningNotify(notifyPlan)
    return NextResponse.json({ yeuCauId })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) === 500 ? 400 : isoAuthErrorStatus(err) })
  }
}
