import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoActorHasPermission, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { DEFAULT_REPAIR_THRESHOLD_USD, normalizeRepairThreshold } from "@/lib/maintenance-threshold"

export const dynamic = "force-dynamic"

const MANAGE_CODES = ["settings.maintenance_config", "settings.manage_config"]

// GET — ngưỡng sửa chữa Lớn/Nhỏ (USD) của nhà máy + người gọi có sửa được không.
export async function GET(req: NextRequest) {
  try {
    const actor = await resolveIsoActor(req)
    const { data, error } = await supabaseAdmin.from("factories").select("*").eq("id", actor.factoryId).maybeSingle()
    if (error) throw new Error(error.message)
    const row = (data || {}) as Record<string, unknown>
    return NextResponse.json({
      thresholdUsd: normalizeRepairThreshold(row.nguong_sua_chua_lon),
      columnReady: "nguong_sua_chua_lon" in row,
      canManage: await isoActorHasPermission(actor, MANAGE_CODES),
      defaultUsd: DEFAULT_REPAIR_THRESHOLD_USD,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) })
  }
}

// POST { thresholdUsd } — admin hoặc settings.maintenance_config / settings.manage_config.
// Chỉ ảnh hưởng biên bản lưu / đồng bộ giá / gửi ký SAU khi đổi; biên bản đã gửi ký hoặc đã duyệt giữ nguyên.
export async function POST(req: NextRequest) {
  try {
    const actor = await resolveIsoActor(req)
    if (!(await isoActorHasPermission(actor, MANAGE_CODES))) {
      return NextResponse.json({ error: "Không có quyền cấu hình bảo trì" }, { status: 403 })
    }
    const body = (await req.json().catch(() => ({}))) as { thresholdUsd?: unknown }
    const value = Number(body.thresholdUsd)
    if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) {
      return NextResponse.json({ error: "Ngưỡng phải là số lớn hơn 0 (USD)." }, { status: 400 })
    }
    const rounded = Math.round(value * 100) / 100
    const { error } = await supabaseAdmin.from("factories").update({ nguong_sua_chua_lon: rounded }).eq("id", actor.factoryId)
    if (error) {
      const missing = /nguong_sua_chua_lon/.test(error.message)
      return NextResponse.json(
        { error: missing ? "Chưa chạy migration 20261104_factories_repair_threshold.sql." : error.message },
        { status: missing ? 409 : 500 },
      )
    }
    return NextResponse.json({ thresholdUsd: rounded })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) })
  }
}
