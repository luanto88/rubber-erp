import { NextRequest, NextResponse } from "next/server"
import { resolveIsoActor, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { loadReportApprovers } from "@/app/api/_lib/report-approvers"
import { DAILY_REPORT_PERMISSION, requireDailyReport } from "../_lib/access"

export const dynamic = "force-dynamic"

// GET — người ký báo cáo kho theo ngày: Người lập (quyền inventory.daily_report) + Ban giám đốc (mặc định Giám đốc).
export async function GET(req: NextRequest) {
  try {
    const actor = await resolveIsoActor(req)
    await requireDailyReport(actor)
    return NextResponse.json(await loadReportApprovers(actor, DAILY_REPORT_PERMISSION))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) })
  }
}
