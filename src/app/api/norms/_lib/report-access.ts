// Định mức KTKT GĐ4 — helper route API báo cáo kỳ (server, service role). Rule 30.
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { IsoAuthError, isoActorHasPermission, type IsoActor } from "@/app/api/iso/_lib/iso-actor"
import type { NormReport, NormReportBatch } from "@/lib/norms/report-types"

export async function loadReportForActor(actor: IsoActor, id: string): Promise<{ report: NormReport; batch: NormReportBatch }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new IsoAuthError("Mã báo cáo không hợp lệ", 400)
  const { data: report } = await supabaseAdmin.from("tech_norm_reports").select("*").eq("id", id).eq("factory_id", actor.factoryId).maybeSingle()
  if (!report) throw new IsoAuthError("Không tìm thấy báo cáo", 404)
  const { data: batch } = await supabaseAdmin.from("tech_norm_report_batches").select("*").eq("id", report.batch_id).maybeSingle()
  if (!batch) throw new IsoAuthError("Không tìm thấy bộ báo cáo", 404)
  return { report: report as NormReport, batch: batch as NormReportBatch }
}

export async function requireNormsReport(actor: IsoActor): Promise<void> {
  if (!(await isoActorHasPermission(actor, ["norms.report"]))) throw new IsoAuthError("Bạn chưa có quyền lập báo cáo định mức (norms.report)", 403)
}

/** Người dùng (không phải người gọi) có quyền norms.report? — mirror isoActorHasPermission. */
export async function userHasNormsReport(factoryId: string, userId: string): Promise<boolean> {
  const { data: p } = await supabaseAdmin.from("profiles").select("id,role,status,factory_id").eq("id", userId).maybeSingle()
  if (!p || p.status !== "active" || p.factory_id !== factoryId) return false
  return isoActorHasPermission({ userId, factoryId, role: (p.role as string) || "", isAdmin: p.role === "admin" }, ["norms.report"])
}

export function dbErrorText(message: string): string {
  const m = message.match(/(NORM_[A-Z_]+):\s*([\s\S]*)$/)
  return m ? m[2] : message
}
