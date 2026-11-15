import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { dbErrorText, loadReportForActor, requireNormsReport } from "@/app/api/norms/_lib/report-access"

export const dynamic = "force-dynamic"

// POST { so?: number } — cấp số báo cáo theo dãy Văn bản nội bộ (BC-NMCB, năm) trước khi dựng PDF gửi ký.
// so = số nhập tay (chặn trùng); bỏ trống = số kế tiếp. Báo cáo đã có số ⇒ giữ nguyên (trừ khi đổi số).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveIsoActor(req)
    await requireNormsReport(actor)
    const { id } = await params
    const { report } = await loadReportForActor(actor, id)
    if (report.trang_thai !== "nhap" && report.trang_thai !== "tra_ve") {
      return NextResponse.json({ error: "Báo cáo đã gửi ký — không đổi số được" }, { status: 409 })
    }
    const body = (await req.json().catch(() => ({}))) as { so?: number | null }
    const so = body.so === null || body.so === undefined || body.so === ("" as unknown) ? null : Math.trunc(Number(body.so))
    if (so !== null && !(so >= 1)) return NextResponse.json({ error: "Số báo cáo không hợp lệ" }, { status: 400 })
    const { data, error } = await supabaseAdmin.rpc("tech_norm_report_reserve_number", { p_report_id: id, p_so: so })
    if (error) return NextResponse.json({ error: dbErrorText(error.message) }, { status: 409 })
    return NextResponse.json({ maBaoCao: data as string })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) })
  }
}
