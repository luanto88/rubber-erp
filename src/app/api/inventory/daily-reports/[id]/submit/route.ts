import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { cancelSigningRequest, createSigningRequest, type SigningFieldInput } from "@/lib/signing/requests"
import { scheduleSigningNotify } from "@/lib/signing/notify"
import { DAILY_REPORT_LOAI_TAI_LIEU, DAILY_REPORT_SIGN_ORDER, INVENTORY_REPORT_MODUN, type DailyReportSignRole } from "@/lib/inventory-daily-report/types"
import { loadReportApprovers } from "@/app/api/_lib/report-approvers"
import { DAILY_REPORT_PERMISSION, loadDailyReportForActor, requireDailyReport } from "../../_lib/access"

export const dynamic = "force-dynamic"

// POST — Gửi ký 1 báo cáo kho theo ngày: Người lập (10, ký) → Ban giám đốc (20, phê duyệt). PDF do client dựng (đã có
// số — gọi reserve-number trước). Gửi lại sau Trả về: huỷ yêu cầu ký cũ, tạo mới. Không khoá phiếu kho (đã chốt) —
// trang chi tiết kiểm "Đã ký — dữ liệu đã đổi" bằng hash.

type Body = { fileBase64: string; fieldsByRole: Record<DailyReportSignRole, SigningFieldInput[]>; nguoiLapId: string; bgdId: string }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveIsoActor(req)
    await requireDailyReport(actor)
    const { id } = await params
    const report = await loadDailyReportForActor(actor, id)
    const body = (await req.json()) as Body
    if (report.trang_thai !== "nhap" && report.trang_thai !== "tra_ve") {
      return NextResponse.json({ error: "Báo cáo không ở trạng thái Nháp / Bị trả về" }, { status: 409 })
    }
    if (!report.ma_bao_cao) return NextResponse.json({ error: "Chưa cấp số báo cáo" }, { status: 400 })
    if (!body.nguoiLapId || !body.bgdId) return NextResponse.json({ error: "Chưa chọn Người lập hoặc Ban giám đốc" }, { status: 400 })
    if (body.nguoiLapId === body.bgdId) return NextResponse.json({ error: "Người lập và Ban giám đốc phải là 2 người khác nhau" }, { status: 400 })
    // Cùng danh sách hộp Gửi ký hiển thị (nhân viên NMCB active + người gửi; BGD theo chức vụ) — chặn id ngoài danh sách.
    const ap = await loadReportApprovers(actor, DAILY_REPORT_PERMISSION, { nguoiLapScope: "nmcb" })
    if (!ap.nguoiLap.some((p) => p.id === body.nguoiLapId)) {
      return NextResponse.json({ error: "Người lập được chọn không thuộc nhân viên Nhà máy chế biến (hoặc tài khoản đã khoá)" }, { status: 400 })
    }
    if (!ap.bgd.some((p) => p.id === body.bgdId)) {
      return NextResponse.json({ error: "Người phê duyệt được chọn không thuộc Ban giám đốc" }, { status: 400 })
    }
    const fileBytes = Buffer.from(String(body.fileBase64 || ""), "base64")
    if (!fileBytes.length) return NextResponse.json({ error: "File PDF rỗng" }, { status: 400 })
    for (const role of Object.keys(DAILY_REPORT_SIGN_ORDER) as DailyReportSignRole[]) {
      if (!body.fieldsByRole?.[role]?.length) return NextResponse.json({ error: "Thiếu khung ký trên báo cáo" }, { status: 400 })
    }

    if (report.yeu_cau_ky_id) {
      const { data: oldYc } = await supabaseAdmin.from("yeu_cau_ky").select("trang_thai").eq("id", report.yeu_cau_ky_id).maybeSingle()
      if (oldYc?.trang_thai === "dang_luan_chuyen") {
        await cancelSigningRequest({ yeuCauId: report.yeu_cau_ky_id, userId: actor.userId, isAdmin: true })
      }
    }

    const userByRole: Record<DailyReportSignRole, string> = { nguoi_lap: body.nguoiLapId, bgd: body.bgdId }
    const signers = (Object.keys(DAILY_REPORT_SIGN_ORDER) as DailyReportSignRole[]).map((role) => ({
      userId: userByRole[role],
      thuTu: DAILY_REPORT_SIGN_ORDER[role].thuTu,
      vaiTro: DAILY_REPORT_SIGN_ORDER[role].vaiTro,
      fields: body.fieldsByRole[role],
    }))
    const { yeuCauId, notifyPlan } = await createSigningRequest({
      factoryId: actor.factoryId,
      modun: INVENTORY_REPORT_MODUN,
      loaiTaiLieu: DAILY_REPORT_LOAI_TAI_LIEU[report.template_kieu],
      banGhiId: id,
      maHoSo: report.ma_bao_cao,
      nguoiTaoId: actor.userId,
      fileBytes,
      fileExt: "pdf",
      signers,
    })
    const { error: upErr } = await supabaseAdmin
      .from("inventory_daily_reports")
      .update({ trang_thai: "cho_ky", yeu_cau_ky_id: yeuCauId, nguoi_lap_id: body.nguoiLapId, bgd_id: body.bgdId, gui_ky_luc: new Date().toISOString() })
      .eq("id", id)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 })
    scheduleSigningNotify(notifyPlan)
    return NextResponse.json({ yeuCauId })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) === 500 ? 400 : isoAuthErrorStatus(err) })
  }
}
