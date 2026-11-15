import { NextRequest, NextResponse } from "next/server"
import { resolveIsoActor, isoActorHasPermission, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { syncNormReports } from "@/lib/norms/server"

export const dynamic = "force-dynamic"

// POST { ids: string[] } — đồng bộ lười trạng thái báo cáo đang chờ ký (theo yêu cầu ký / văn bản nội bộ).
export async function POST(req: NextRequest) {
  try {
    const actor = await resolveIsoActor(req)
    if (!(await isoActorHasPermission(actor, ["norms.view"]))) return NextResponse.json({ error: "Không có quyền" }, { status: 403 })
    const body = (await req.json().catch(() => ({}))) as { ids?: string[] }
    const ids = (body.ids || []).filter((x) => /^[0-9a-f-]{36}$/i.test(String(x)))
    await syncNormReports(actor.factoryId, ids)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) })
  }
}
