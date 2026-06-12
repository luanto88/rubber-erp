import type { SupabaseClient } from "@supabase/supabase-js"
import type { DiemGN } from "@/lib/dispatch-master"

export type LegacyDispatchRow = {
  uid?: string
  _date?: string
  day_chuyen?: string
  so_xe?: string
  chuyen?: number
  tai_xe?: string
  diem_gn?: string[]
  phien?: string[]
  lo_thu_hoach?: string[]
  xu_ly?: string
  lo_trinh?: string[]
  doi?: number[]
  so_km?: number | string
  kl_ct?: string
  drc_c?: string
  kl_ck?: string
  kl_dct?: string
  drc_dc?: string
  kl_dck?: string
  kl_dkt?: string
  drc_dk?: string
  kl_dkk?: string
  kl_dt?: string
  drc_d?: string
  kl_dk?: string
  kl_mn?: string
  drc_mn?: string
  kl_mnk?: string
  ngan_ref?: string[]
  ghi_chu?: string
  locked?: boolean
  row_id?: string
  dispatch_entry_id?: string
}

export type DispatchEntryRowRecord = {
  id: string
  factory_id: string
  dispatch_entry_id: string
  uid_legacy: string | null
  ngay: string
  day_chuyen: string | null
  so_xe: string
  chuyen: number
  tai_xe: string | null
  diem_gn: string[] | null
  phien: string[] | null
  lo_thu_hoach: string[] | null
  xu_ly: string | null
  lo_trinh: string[] | null
  doi: number[] | null
  so_km: number | string | null
  kl_ct: number | string | null
  drc_c: number | string | null
  kl_ck: number | string | null
  kl_dct: number | string | null
  drc_dc: number | string | null
  kl_dck: number | string | null
  kl_dkt: number | string | null
  drc_dk: number | string | null
  kl_dkk: number | string | null
  kl_dt: number | string | null
  drc_d: number | string | null
  kl_dk: number | string | null
  kl_mn: number | string | null
  drc_mn: number | string | null
  kl_mnk: number | string | null
  ngan_ref: string[] | null
  ghi_chu: string | null
  locked: boolean | null
  sort_order: number | null
}

export type DispatchEntryWithResolvedRows<TExtra extends Record<string, unknown> = Record<string, never>> = TExtra & {
  id: string
  ngay: string
  rows: LegacyDispatchRow[]
}

const NUM_FIELDS = [
  "kl_ct", "drc_c", "kl_ck",
  "kl_dct", "drc_dc", "kl_dck",
  "kl_dkt", "drc_dk", "kl_dkk",
  "kl_dt", "drc_d", "kl_dk",
  "kl_mn", "drc_mn", "kl_mnk",
] as const

function parseNum(value: unknown) {
  const n = Number.parseFloat(String(value ?? ""))
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

function stringifyNum(value: unknown) {
  const n = Number.parseFloat(String(value ?? ""))
  if (!Number.isFinite(n)) return ""
  return String(Math.round(n * 100) / 100)
}

function arr<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : []
}

function stripRowsFromSelect(select: string) {
  return select
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part && part !== "rows")
    .join(",")
}

export function toISODate(ngay: string) {
  if (!ngay) return new Date().toISOString().slice(0, 10)
  if (ngay.includes("/")) {
    const [d, m, y] = ngay.split("/")
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`
  }
  return ngay.slice(0, 10)
}

export function getDoisForDispatchRow(row: Pick<LegacyDispatchRow, "diem_gn" | "doi">, deliveryPoints: DiemGN[]) {
  if (Array.isArray(row.doi) && row.doi.length > 0) return [...new Set(row.doi)].sort((a, b) => a - b)
  return [...new Set(arr(row.diem_gn).map((pointCode) => deliveryPoints.find((point) => point.ma_lo === pointCode)?.doi ?? 0).filter(Boolean))]
    .sort((a, b) => a - b)
}

export function dispatchDbRowToLegacy(row: DispatchEntryRowRecord): LegacyDispatchRow {
  const legacy: LegacyDispatchRow = {
    row_id: row.id,
    dispatch_entry_id: row.dispatch_entry_id,
    uid: row.uid_legacy || row.id,
    _date: toISODate(row.ngay),
    day_chuyen: row.day_chuyen || undefined,
    so_xe: row.so_xe || "",
    chuyen: Number(row.chuyen) || 1,
    tai_xe: row.tai_xe || "",
    diem_gn: arr(row.diem_gn),
    phien: arr(row.phien),
    lo_thu_hoach: arr(row.lo_thu_hoach),
    xu_ly: row.xu_ly || "",
    lo_trinh: arr(row.lo_trinh),
    doi: arr(row.doi),
    so_km: parseNum(row.so_km),
    ngan_ref: arr(row.ngan_ref),
    ghi_chu: row.ghi_chu || "",
    locked: Boolean(row.locked),
  }

  for (const field of NUM_FIELDS) {
    legacy[field] = stringifyNum(row[field])
  }

  return legacy
}

export function legacyDispatchRowToDb(
  row: LegacyDispatchRow,
  params: {
    factoryId: string
    dispatchEntryId: string
    ngay: string
    dayChuyen: string
    sortOrder: number
    deliveryPoints: DiemGN[]
  },
) {
  const payload: Record<string, unknown> = {
    factory_id: params.factoryId,
    dispatch_entry_id: params.dispatchEntryId,
    uid_legacy: row.uid || `r_${Date.now()}_${params.sortOrder}`,
    ngay: toISODate(params.ngay),
    day_chuyen: params.dayChuyen || row.day_chuyen || "Mủ tạp",
    so_xe: row.so_xe || "",
    chuyen: Number(row.chuyen) || 1,
    tai_xe: row.tai_xe || null,
    diem_gn: arr(row.diem_gn),
    phien: arr(row.phien),
    lo_thu_hoach: arr(row.lo_thu_hoach),
    xu_ly: row.xu_ly || null,
    lo_trinh: arr(row.lo_trinh),
    doi: getDoisForDispatchRow(row, params.deliveryPoints),
    so_km: parseNum(row.so_km),
    ngan_ref: arr(row.ngan_ref),
    ghi_chu: row.ghi_chu || null,
    locked: Boolean(row.locked),
    sort_order: params.sortOrder,
  }

  for (const field of NUM_FIELDS) {
    payload[field] = parseNum(row[field])
  }

  return payload
}

export async function replaceDispatchEntryRows(
  supabase: SupabaseClient,
  params: {
    factoryId: string
    dispatchEntryId: string
    ngay: string
    dayChuyen: string
    rows: LegacyDispatchRow[]
    deliveryPoints: DiemGN[]
  },
) {
  const { error: deleteError } = await supabase
    .from("dispatch_entry_rows")
    .delete()
    .eq("factory_id", params.factoryId)
    .eq("dispatch_entry_id", params.dispatchEntryId)

  if (deleteError) throw deleteError

  if (params.rows.length === 0) return

  const payload = params.rows.map((row, index) =>
    legacyDispatchRowToDb(row, {
      factoryId: params.factoryId,
      dispatchEntryId: params.dispatchEntryId,
      ngay: params.ngay,
      dayChuyen: params.dayChuyen,
      sortOrder: index + 1,
      deliveryPoints: params.deliveryPoints,
    }),
  )

  const { error: insertError } = await supabase.from("dispatch_entry_rows").insert(payload)
  if (insertError) throw insertError
}

export async function loadDispatchEntriesWithResolvedRows<TExtra extends Record<string, unknown> = Record<string, never>>(
  supabase: SupabaseClient,
  params: {
    factoryId: string
    select?: string
    fromDate?: string
    toDate?: string
    entryIds?: string[]
    ascending?: boolean
  },
): Promise<Array<DispatchEntryWithResolvedRows<TExtra>>> {
  const headerSelect = stripRowsFromSelect(params.select || "id,ngay")
  // Luôn fetch "rows" (JSONB) để fallback cho dữ liệu trước migration 2026-06-01
  const fullSelect = headerSelect ? `${headerSelect},rows` : "id,ngay,rows"
  let query = supabase
    .from("dispatch_entries")
    .select(fullSelect)
    .eq("factory_id", params.factoryId)
    .order("ngay", { ascending: params.ascending ?? true })

  if (params.entryIds && params.entryIds.length > 0) query = query.in("id", params.entryIds)

  const { data: entries, error: entriesError } = await query
  if (entriesError) throw entriesError

  const rawEntries = ((entries || []) as unknown) as Array<TExtra & { id: string; ngay: string; rows?: unknown }>
  const entryIds = rawEntries.map((entry) => entry.id).filter(Boolean)
  if (entryIds.length === 0) {
    return rawEntries.map((entry) => ({
      ...entry,
      rows: [],
    }))
  }

  let physicalRowsQuery = supabase
    .from("dispatch_entry_rows")
    .select("*")
    .eq("factory_id", params.factoryId)
    .in("dispatch_entry_id", entryIds)
    .order("ngay", { ascending: params.ascending ?? true })
    .order("sort_order", { ascending: true })

  if (params.fromDate) physicalRowsQuery = physicalRowsQuery.gte("ngay", params.fromDate)
  if (params.toDate) physicalRowsQuery = physicalRowsQuery.lte("ngay", params.toDate)

  const { data: physicalRows, error: physicalError } = await physicalRowsQuery
  if (physicalError) throw physicalError

  const physicalRowsByEntry = new Map<string, LegacyDispatchRow[]>()
  for (const row of (physicalRows || []) as DispatchEntryRowRecord[]) {
    const list = physicalRowsByEntry.get(row.dispatch_entry_id) || []
    list.push(dispatchDbRowToLegacy(row))
    physicalRowsByEntry.set(row.dispatch_entry_id, list)
  }

  const filteredEntries =
    params.fromDate || params.toDate
      ? rawEntries.filter((entry) => {
          if (physicalRowsByEntry.has(entry.id)) return true
          // Fallback: kiểm tra date range cho entries chỉ có JSONB rows (pre-migration)
          const entryDate = toISODate(typeof entry.ngay === "string" ? entry.ngay : "")
          if (!entryDate) return false
          if (params.fromDate && entryDate < params.fromDate) return false
          if (params.toDate && entryDate > params.toDate) return false
          return Array.isArray(entry.rows) && (entry.rows as unknown[]).length > 0
        })
      : rawEntries

  return filteredEntries.map((entry) => {
    const physical = physicalRowsByEntry.get(entry.id) || []
    const jsonbRows = Array.isArray(entry.rows)
      ? (entry.rows as LegacyDispatchRow[]).filter(
          (r): r is LegacyDispatchRow => Boolean(r && typeof r === "object"),
        )
      : []

    if (physical.length === 0) {
      // Không có physical — dùng JSONB fallback (entries trước migration 2026-06-01)
      return { ...entry, rows: jsonbRows }
    }

    // Có physical — MERGE: bổ sung JSONB rows có uid chưa xuất hiện trong physical
    const physicalUids = new Set(physical.map((r) => r.uid).filter(Boolean))
    const extraJsonb = jsonbRows.filter((r) => r.uid && !physicalUids.has(r.uid))
    if (extraJsonb.length === 0) return { ...entry, rows: physical }
    return { ...entry, rows: [...physical, ...extraJsonb] }
  })
}

export async function syncDispatchEntriesLegacyRows(
  supabase: SupabaseClient,
  params: {
    factoryId: string
    entryIds: string[]
  },
) {
  const entryIds = [...new Set(params.entryIds.filter(Boolean))]
  if (entryIds.length === 0) return

  const { data: physicalRows, error: physicalError } = await supabase
    .from("dispatch_entry_rows")
    .select("*")
    .eq("factory_id", params.factoryId)
    .in("dispatch_entry_id", entryIds)
    .order("ngay", { ascending: true })
    .order("sort_order", { ascending: true })

  if (physicalError) throw physicalError

  const rowsByEntry = new Map<string, LegacyDispatchRow[]>()
  for (const row of (physicalRows || []) as DispatchEntryRowRecord[]) {
    const list = rowsByEntry.get(row.dispatch_entry_id) || []
    list.push(dispatchDbRowToLegacy(row))
    rowsByEntry.set(row.dispatch_entry_id, list)
  }

  await Promise.all(entryIds.map(async (entryId) => {
    const rows = rowsByEntry.get(entryId) || []
    const { error } = await supabase
      .from("dispatch_entries")
      .update({ rows })
      .eq("factory_id", params.factoryId)
      .eq("id", entryId)
    if (error) throw error
  }))
}
