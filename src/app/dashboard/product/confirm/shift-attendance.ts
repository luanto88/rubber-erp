// A2 (chốt 2026-11-26): phải điểm danh Ca trước khi quét thành phẩm. Server-only (service role).
// "Đã điểm danh" = phiếu điểm danh của Ca này (ngày + dây chuyền) có ít nhất 1 dòng người.
// Chỉ áp cho mã ca là đơn vị loại "ca" trong attendance_units; bảng chưa có / lỗi ⇒ không áp (không chặn nhầm).

import { getSupabaseAdmin } from "@/lib/supabase-admin"

export type ShiftAttendanceStatus = {
  /** false = không áp điều kiện (ca không phải đơn vị Ca, hoặc chưa dùng module Chấm công). */
  applies: boolean
  /** Đã điểm danh ở ít nhất 1 dây chuyền trong danh sách hỏi (hoặc bất kỳ dây chuyền nếu không truyền). */
  taken: boolean
  /** Dây chuyền đã có điểm danh. */
  dayChuyens: string[]
}

export async function shiftAttendanceStatus(
  factoryId: string,
  ngay: string,
  ca: string,
  dayChuyens: string[] = [],
): Promise<ShiftAttendanceStatus> {
  const none: ShiftAttendanceStatus = { applies: false, taken: true, dayChuyens: [] }
  if (!factoryId || !ngay || !ca) return none
  const sb = getSupabaseAdmin()
  const { data: unit, error: unitErr } = await sb
    .from("attendance_units")
    .select("code, loai")
    .eq("factory_id", factoryId)
    .eq("code", ca)
    .maybeSingle()
  if (unitErr || !unit || unit.loai !== "ca") return none

  let q = sb.from("attendance_daily_sheets").select("id, day_chuyen").eq("factory_id", factoryId).eq("ngay", ngay)
  if (dayChuyens.length > 0) q = q.in("day_chuyen", dayChuyens)
  const { data: sheets, error: shErr } = await q
  if (shErr) return none
  const sheetList = (sheets || []) as { id: string; day_chuyen: string }[]
  if (sheetList.length === 0) return { applies: true, taken: false, dayChuyens: [] }

  const { data: secs, error: secErr } = await sb
    .from("attendance_sheet_sections")
    .select("id, sheet_id")
    .in("sheet_id", sheetList.map((s) => s.id))
    .eq("loai", "ca_san_xuat")
    .eq("ca", ca)
  if (secErr) return none
  const secList = (secs || []) as { id: string; sheet_id: string }[]
  if (secList.length === 0) return { applies: true, taken: false, dayChuyens: [] }

  const { data: lines, error: lnErr } = await sb
    .from("attendance_sheet_lines")
    .select("section_id")
    .in("section_id", secList.map((s) => s.id))
    .limit(1000)
  if (lnErr) return none
  const withLines = new Set(((lines || []) as { section_id: string }[]).map((l) => l.section_id))
  const dcOfSheet = new Map(sheetList.map((s) => [s.id, s.day_chuyen]))
  const done = Array.from(new Set(secList.filter((s) => withLines.has(s.id)).map((s) => dcOfSheet.get(s.sheet_id) || ""))).filter(Boolean)
  return { applies: true, taken: done.length > 0, dayChuyens: done }
}
