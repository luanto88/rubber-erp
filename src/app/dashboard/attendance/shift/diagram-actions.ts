"use server"

// A3 — khung giờ thật của từng Ca sản xuất trong ngày (kiện quét đầu → cuối, cùng dây chuyền) cho Sơ đồ dây chuyền.
// Cùng cách tính khung với phiếu TKSX (sheet-report-actions.ts, `prodWindows`). Service role + tự xác thực token
// (trực ca có thể không có quyền Thành phẩm ⇒ không đọc lot_transactions qua RLS của người xem).

import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { fetchAllPaginated } from "@/lib/supabase-helpers"
import { loadGradeConfigServer } from "@/lib/product-grade-server"
import { dayChuyenForCsr } from "@/lib/product-lot-config"
import { assertProductAccess } from "@/app/dashboard/product/confirm/report-access"
import type { ProdWindow } from "@/lib/attendance/diagram"

const VIEW_PERMISSIONS = ["attendance.view", "attendance.approve", "attendance.mark_all", "attendance.mark", "attendance.shift_check"]

export async function loadProductionWindows(
  accessToken: string | null,
  factoryId: string,
  ngay: string,
  dayChuyen: string,
): Promise<ProdWindow[]> {
  await assertProductAccess(accessToken, factoryId, VIEW_PERMISSIONS, "xem sơ đồ dây chuyền")
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ngay)) throw new Error("Ngày không hợp lệ.")
  const sb = getSupabaseAdmin()
  const [grade, unitRes] = await Promise.all([
    loadGradeConfigServer(factoryId),
    sb.from("attendance_units").select("code, loai").eq("factory_id", factoryId),
  ])
  if (unitRes.error) throw new Error(unitRes.error.message)
  const caCodes = new Set(((unitRes.data || []) as { code: string; loai: string }[]).filter((u) => u.loai === "ca").map((u) => u.code))

  type TxRow = { ca: string | null; created_at: string | null; quet_luc?: string | null; lots: { loai_csr: string | null } | null }
  const txs = (await fetchAllPaginated<TxRow>((from, to) =>
    // "*" để vẫn chạy khi thiếu cột quet_luc (migration 20261213). lots!inner nhiều-1 ⇒ 1 object.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sb as any)
      .from("lot_transactions")
      .select("*, lots!inner(factory_id, loai_csr)")
      .eq("lots.factory_id", factoryId)
      .eq("ngay_nhap", ngay)
      .order("id", { ascending: true })
      .range(from, to),
  )).filter((t) => t.lots?.loai_csr && dayChuyenForCsr(t.lots.loai_csr, grade) === dayChuyen)

  const span = new Map<string, { s: number; e: number; start: string; end: string }>()
  for (const t of txs) {
    const ca = t.ca || ""
    if (!caCodes.has(ca)) continue
    const at = t.quet_luc || t.created_at
    if (!at) continue
    const v = new Date(at).getTime()
    if (!Number.isFinite(v)) continue
    const cur = span.get(ca)
    if (!cur) span.set(ca, { s: v, e: v, start: at, end: at })
    else {
      if (v < cur.s) Object.assign(cur, { s: v, start: at })
      if (v > cur.e) Object.assign(cur, { e: v, end: at })
    }
  }
  return Array.from(span.entries())
    .map(([ca, x]) => ({ ca, start: x.start, end: x.end }))
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
}
