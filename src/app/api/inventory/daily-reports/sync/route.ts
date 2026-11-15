import { NextRequest, NextResponse } from "next/server"
import { resolveIsoActor, isoActorHasPermission, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { syncInventoryDailyReports } from "@/lib/inventory-daily-report/server"
import { DAILY_REPORT_PERMISSION } from "../_lib/access"

export const dynamic = "force-dynamic"

// POST { ids: string[] } — đồng bộ lười trạng thái báo cáo kho theo ngày đang chờ ký.
export async function POST(req: NextRequest) {
  try {
    const actor = await resolveIsoActor(req)
    if (!(await isoActorHasPermission(actor, [DAILY_REPORT_PERMISSION]))) return NextResponse.json({ error: "Không có quyền" }, { status: 403 })
    const body = (await req.json().catch(() => ({}))) as { ids?: string[] }
    const ids = (body.ids || []).filter((x) => /^[0-9a-f-]{36}$/i.test(String(x)))
    await syncInventoryDailyReports(actor.factoryId, ids)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) })
  }
}
