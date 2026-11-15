// Kho vật tư — đồng bộ trạng thái báo cáo sử dụng theo ngày với yêu cầu ký (SERVER-ONLY, service role).
// Lỗi chỉ log, không ném — không được làm hỏng lượt ký đã thành công. Mirror src/lib/norms/server.ts. Rule 13.

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { INVENTORY_REPORT_MODUN, type DailyReportStatus } from "./types"

type Row = { id: string; trang_thai: DailyReportStatus; yeu_cau_ky_id: string | null }
const COLS = "id,trang_thai,yeu_cau_ky_id"

async function setStatus(r: Row, next: DailyReportStatus, extra: Record<string, unknown> = {}): Promise<void> {
  if (r.trang_thai === next && !Object.keys(extra).length) return
  const patch: Record<string, unknown> = { trang_thai: next, ...extra }
  if (next === "da_ky" && r.trang_thai !== "da_ky") patch.da_ky_luc = new Date().toISOString()
  const { error } = await getSupabaseAdmin().from("inventory_daily_reports").update(patch).eq("id", r.id)
  if (error) console.warn("[inventory-report] Không cập nhật được trạng thái báo cáo:", error.message)
}

/** Sau ký / trả về / huỷ yêu cầu ký modun `inventory_report`. No-op với modun khác. */
export async function syncInventoryDailyReportFromSigning(yeuCauId: string): Promise<void> {
  try {
    const supabase = getSupabaseAdmin()
    const { data: yc } = await supabase.from("yeu_cau_ky").select("id,modun,ban_ghi_id,trang_thai,tra_ve_ly_do").eq("id", yeuCauId).maybeSingle()
    if (!yc || yc.modun !== INVENTORY_REPORT_MODUN || !yc.ban_ghi_id) return
    const { data } = await supabase.from("inventory_daily_reports").select(COLS).eq("id", yc.ban_ghi_id).maybeSingle()
    const r = data as Row | null
    if (!r || r.yeu_cau_ky_id !== yc.id || r.trang_thai === "huy") return
    if (yc.trang_thai === "hoan_tat") await setStatus(r, "da_ky")
    else if (yc.trang_thai === "dang_luan_chuyen") await setStatus(r, yc.tra_ve_ly_do ? "tra_ve" : "cho_ky")
    else if (yc.trang_thai === "huy" && r.trang_thai !== "da_ky") await setStatus(r, "nhap", { yeu_cau_ky_id: null })
  } catch (err) {
    console.error("[inventory-report] Lỗi đồng bộ từ ký số:", err)
  }
}

/** Đồng bộ lười (mở danh sách / chi tiết) cho các báo cáo đang chờ ký. */
export async function syncInventoryDailyReports(factoryId: string, ids: string[]): Promise<void> {
  if (!ids.length) return
  const { data } = await getSupabaseAdmin().from("inventory_daily_reports").select(COLS).eq("factory_id", factoryId).in("id", ids.slice(0, 200))
  for (const r of (data || []) as Row[]) if (r.yeu_cau_ky_id) await syncInventoryDailyReportFromSigning(r.yeu_cau_ky_id)
}

/** Dòng tóm tắt cho thông báo ký (Telegram / chuông). */
export async function buildInventoryReportSummary(reportId: string): Promise<string[]> {
  const { data: r } = await getSupabaseAdmin().from("inventory_daily_reports").select("template_name,tu_ngay,den_ngay,snapshot").eq("id", reportId).maybeSingle()
  if (!r) return []
  const d = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "")
  const cols = ((r.snapshot as { columns?: unknown[] } | null)?.columns || []).length
  return [`${r.template_name}`, `Kỳ: ${d(r.tu_ngay)} – ${d(r.den_ngay)}`, ...(cols ? [`${cols} cột vật tư`] : [])]
}
