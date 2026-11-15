import { NextRequest, NextResponse } from "next/server"
import { resolveIsoActor, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { loadReportApprovers } from "@/app/api/_lib/report-approvers"

export const dynamic = "force-dynamic"

// GET — người ký báo cáo định mức (rule 30, GĐ4): Người lập (quyền norms.report) + Ban giám đốc.
// Logic dùng chung với báo cáo kho theo ngày: src/app/api/_lib/report-approvers.ts.
export async function GET(req: NextRequest) {
  try {
    const actor = await resolveIsoActor(req)
    return NextResponse.json(await loadReportApprovers(actor, "norms.report"))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) })
  }
}
