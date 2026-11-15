import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { dbErrorText, loadDailyReportForActor, requireDailyReport } from "../../_lib/access"

export const dynamic = "force-dynamic"

// POST { so?: number } — cấp số báo cáo kho theo dãy BC-NMCB (chung Văn bản nội bộ + báo cáo định mức) trước khi
// dựng PDF gửi ký. so = số nhập tay (chặn trùng); bỏ trống = số kế tiếp. Đã có số ⇒ giữ nguyên (trừ khi đổi).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveIsoActor(req)
    await requireDailyReport(actor)
    const { id } = await params
    const report = await loadDailyReportForActor(actor, id)
    if (report.trang_thai !== "nhap" && report.trang_thai !== "tra_ve") {
      return NextResponse.json({ error: "Báo cáo đã gửi ký — không đổi số được" }, { status: 409 })
    }
    const body = (await req.json().catch(() => ({}))) as { so?: number | string | null }
    const so = body.so === null || body.so === undefined || body.so === "" ? null : Math.trunc(Number(body.so))
    if (so !== null && !(so >= 1)) return NextResponse.json({ error: "Số báo cáo không hợp lệ" }, { status: 400 })
    const { data, error } = await supabaseAdmin.rpc("inventory_daily_report_reserve_number", { p_report_id: id, p_so: so })
    if (error) return NextResponse.json({ error: dbErrorText(error.message) }, { status: 409 })
    return NextResponse.json({ maBaoCao: data as string })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) })
  }
}
