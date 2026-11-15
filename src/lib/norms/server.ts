// Định mức KTKT GĐ4 — đồng bộ trạng thái báo cáo kỳ với yêu cầu ký / Văn bản nội bộ (SERVER-ONLY, service role).
// Lỗi chỉ log, không ném — không được làm hỏng lượt ký đã thành công. Rule 30.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { NORMS_MODUN, type NormReportStatus } from "./report-types"

type ReportRow = { id: string; factory_id: string; batch_id: string; template_kieu: string; trang_thai: NormReportStatus; yeu_cau_ky_id: string | null; van_ban_document_id: string | null }

const REPORT_COLS = "id,factory_id,batch_id,template_kieu,trang_thai,yeu_cau_ky_id,van_ban_document_id"

/** Mẫu 8A đã ký ⇒ các khung định mức đã áp trong kỳ chuyển "Đã khoá". */
async function lockVersionsOfReport(r: ReportRow): Promise<void> {
  if (r.template_kieu !== "thang_8a") return
  const supabase = getSupabaseAdmin()
  const { data: batch } = await supabase.from("tech_norm_report_batches").select("snapshot").eq("id", r.batch_id).maybeSingle()
  const snap = (batch?.snapshot || {}) as { draftUsed?: boolean; versions?: Array<{ id?: string; status?: string }> }
  if (snap.draftUsed) return
  const ids = (snap.versions || []).map((v) => v.id).filter((x): x is string => !!x)
  if (!ids.length) return
  const { error } = await supabase.from("tech_norm_versions").update({ status: "locked" }).eq("factory_id", r.factory_id).eq("status", "active").in("id", ids)
  if (error) console.warn("[norms] Không khoá được khung định mức:", error.message)
}

async function setStatus(r: ReportRow, next: NormReportStatus, extra: Record<string, unknown> = {}): Promise<void> {
  if (r.trang_thai === next && !Object.keys(extra).length) return
  const supabase = getSupabaseAdmin()
  const patch: Record<string, unknown> = { trang_thai: next, ...extra }
  if (next === "da_ky") patch.da_ky_luc = new Date().toISOString()
  const { error } = await supabase.from("tech_norm_reports").update(patch).eq("id", r.id)
  if (error) {
    console.warn("[norms] Không cập nhật được trạng thái báo cáo:", error.message)
    return
  }
  if (next === "da_ky" && r.trang_thai !== "da_ky") await lockVersionsOfReport(r)
}

/** Sau ký / trả về / huỷ yêu cầu ký modun `norms`. */
export async function syncNormReportFromSigning(yeuCauId: string): Promise<void> {
  try {
    const supabase = getSupabaseAdmin()
    const { data: yc } = await supabase.from("yeu_cau_ky").select("id,modun,ban_ghi_id,trang_thai,tra_ve_ly_do").eq("id", yeuCauId).maybeSingle()
    if (!yc || yc.modun !== NORMS_MODUN || !yc.ban_ghi_id) return
    const { data: r } = await supabase.from("tech_norm_reports").select(REPORT_COLS).eq("id", yc.ban_ghi_id).maybeSingle()
    const report = r as ReportRow | null
    if (!report || report.yeu_cau_ky_id !== yc.id || report.trang_thai === "huy") return
    if (yc.trang_thai === "hoan_tat") await setStatus(report, "da_ky")
    else if (yc.trang_thai === "dang_luan_chuyen") await setStatus(report, yc.tra_ve_ly_do ? "tra_ve" : "cho_ky")
    else if (yc.trang_thai === "huy" && report.trang_thai !== "da_ky") await setStatus(report, "nhap", { yeu_cau_ky_id: null })
  } catch (err) {
    console.error("[norms] Lỗi đồng bộ từ ký số:", err)
  }
}

/** Báo cáo ký nhiều bước qua Văn bản nội bộ: theo trạng thái văn bản. */
export async function syncNormReportFromVanBan(docId: string): Promise<void> {
  try {
    const supabase = getSupabaseAdmin()
    const { data: rows } = await supabase.from("tech_norm_reports").select(REPORT_COLS).eq("van_ban_document_id", docId).neq("trang_thai", "huy")
    if (!rows?.length) return
    const { data: doc } = await supabase.from("van_ban_documents").select("id,trang_thai").eq("id", docId).maybeSingle()
    for (const report of rows as ReportRow[]) {
      if (!doc) {
        if (report.trang_thai !== "da_ky") await setStatus(report, "nhap", { van_ban_document_id: null })
        continue
      }
      const st = doc.trang_thai as string
      await setStatus(report, st === "da_phe_duyet" ? "da_ky" : st === "tra_ve" ? "tra_ve" : "cho_ky")
    }
  } catch (err) {
    console.error("[norms] Lỗi đồng bộ từ Văn bản nội bộ:", err)
  }
}

/** Đồng bộ lười (mở danh sách / chi tiết) cho các báo cáo đang chờ ký. */
export async function syncNormReports(factoryId: string, ids: string[]): Promise<void> {
  if (!ids.length) return
  const supabase = getSupabaseAdmin()
  const { data } = await supabase.from("tech_norm_reports").select(REPORT_COLS).eq("factory_id", factoryId).in("id", ids.slice(0, 200))
  for (const r of (data || []) as ReportRow[]) {
    if (r.van_ban_document_id) await syncNormReportFromVanBan(r.van_ban_document_id)
    else if (r.yeu_cau_ky_id) await syncNormReportFromSigning(r.yeu_cau_ky_id)
  }
}
