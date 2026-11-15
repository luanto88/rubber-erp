// Kho vật tư — helper route API báo cáo sử dụng theo ngày (server, service role). Rule 13.
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { IsoAuthError, isoActorHasPermission, type IsoActor } from "@/app/api/iso/_lib/iso-actor"
import type { DailyReport } from "@/lib/inventory-daily-report/types"

export const DAILY_REPORT_PERMISSION = "inventory.daily_report"

export async function loadDailyReportForActor(actor: IsoActor, id: string): Promise<DailyReport> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new IsoAuthError("Mã báo cáo không hợp lệ", 400)
  const { data } = await supabaseAdmin.from("inventory_daily_reports").select("*").eq("id", id).eq("factory_id", actor.factoryId).maybeSingle()
  if (!data) throw new IsoAuthError("Không tìm thấy báo cáo", 404)
  return data as DailyReport
}

export async function requireDailyReport(actor: IsoActor): Promise<void> {
  if (!(await isoActorHasPermission(actor, [DAILY_REPORT_PERMISSION]))) {
    throw new IsoAuthError("Bạn chưa có quyền lập báo cáo sử dụng theo ngày (inventory.daily_report)", 403)
  }
}

export function dbErrorText(message: string): string {
  const m = message.match(/((?:INV|NORM)_[A-Z_]+):\s*([\s\S]*)$/)
  return m ? m[2] : message
}
