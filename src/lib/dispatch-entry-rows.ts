import type { SupabaseClient } from "@supabase/supabase-js"
import type { DiemGN } from "@/lib/dispatch-master"
import { getTodayISODate, isDateInRange, normalizeDateInput } from "@/lib/date-utils"

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
  ghi_chu_tu_do?: string
  locked?: boolean
  row_id?: string
  dispatch_entry_id?: string
  stops_detail?: Array<{ diem: string; phien: string[] }> | null
}

export type DispatchEntryRowRecord = never

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
  const normalized = normalizeDateInput(ngay)
  if (normalized) return normalized
  return String(ngay ?? "").trim() ? "" : getTodayISODate()
}

export function getDoisForDispatchRow(row: Pick<LegacyDispatchRow, "diem_gn" | "doi">, deliveryPoints: DiemGN[]) {
  if (Array.isArray(row.doi) && row.doi.length > 0) return [...new Set(row.doi)].sort((a, b) => a - b)
  return [...new Set(arr(row.diem_gn).map((pointCode) => deliveryPoints.find((point) => point.ma_lo === pointCode)?.doi ?? 0).filter(Boolean))]
    .sort((a, b) => a - b)
}

export function dispatchDbRowToLegacy(row: LegacyDispatchRow): LegacyDispatchRow {
  const legacy: LegacyDispatchRow = {
    row_id: row.row_id || row.uid || "",
    dispatch_entry_id: row.dispatch_entry_id,
    uid: row.uid || row.row_id || "",
    _date: toISODate(row._date || ""),
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
    ghi_chu_tu_do: row.ghi_chu_tu_do || "",
    locked: Boolean(row.locked),
    stops_detail: (row.stops_detail as Array<{ diem: string; phien: string[] }> | null | undefined) ?? null,
  }

  for (const field of NUM_FIELDS) {
    legacy[field] = stringifyNum(row[field])
  }

  return legacy
}

export function legacyDispatchRowToDb(
  row: LegacyDispatchRow,
  params: {
    dispatchEntryId: string
    ngay: string
    dayChuyen: string
    sortOrder: number
    deliveryPoints: DiemGN[]
  },
) {
  const payload: LegacyDispatchRow = {
    row_id: row.row_id || row.uid || `r_${Date.now()}_${params.sortOrder}`,
    dispatch_entry_id: params.dispatchEntryId,
    uid: row.uid || row.row_id || `r_${Date.now()}_${params.sortOrder}`,
    _date: toISODate(params.ngay),
    day_chuyen: params.dayChuyen || row.day_chuyen || "Mủ tạp",
    so_xe: row.so_xe || "",
    chuyen: Number(row.chuyen) || 1,
    tai_xe: row.tai_xe || "",
    diem_gn: arr(row.diem_gn),
    phien: arr(row.phien),
    lo_thu_hoach: arr(row.lo_thu_hoach),
    xu_ly: row.xu_ly || "Xé",
    lo_trinh: arr(row.lo_trinh),
    doi: getDoisForDispatchRow(row, params.deliveryPoints),
    so_km: parseNum(row.so_km),
    ngan_ref: arr(row.ngan_ref),
    ghi_chu: row.ghi_chu || "",
    ghi_chu_tu_do: row.ghi_chu_tu_do || "",
    locked: Boolean(row.locked),
    stops_detail: row.stops_detail ?? null,
  }

  for (const field of NUM_FIELDS) {
    payload[field] = stringifyNum(row[field])
  }

  return payload
}

export async function replaceDispatchEntryRows(
  supabase: SupabaseClient,
  params: {
    dispatchEntryId: string
    ngay: string
    dayChuyen: string
    rows: LegacyDispatchRow[]
    deliveryPoints: DiemGN[]
  },
) {
  const payload = params.rows.map((row, index) =>
    legacyDispatchRowToDb(row, {
      dispatchEntryId: params.dispatchEntryId,
      ngay: params.ngay,
      dayChuyen: params.dayChuyen,
      sortOrder: index + 1,
      deliveryPoints: params.deliveryPoints,
    }),
  )

  const { error } = await supabase
    .from("dispatch_entries")
    .update({ rows: payload })
    .eq("id", params.dispatchEntryId)

  if (error) throw error
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
  const fullSelect = headerSelect ? `${headerSelect},rows` : "id,ngay,rows"
  let query = supabase
    .from("dispatch_entries")
    .select(fullSelect)
    .eq("factory_id", params.factoryId)
    .order("ngay", { ascending: params.ascending ?? true })

  if (params.entryIds && params.entryIds.length > 0) query = query.in("id", params.entryIds)

  const { data: entries, error } = await query
  if (error) throw error

  const rawEntries = ((entries || []) as unknown) as Array<TExtra & { id: string; ngay: string; rows?: unknown }>
  return rawEntries
    .filter((entry) => isDateInRange(entry.ngay, params.fromDate, params.toDate))
    .map((entry) => ({
      ...entry,
      rows: Array.isArray(entry.rows)
        ? entry.rows
            .filter((row): row is LegacyDispatchRow => Boolean(row && typeof row === "object"))
            .map((row) => dispatchDbRowToLegacy({
              ...row,
              dispatch_entry_id: entry.id,
              _date: row._date || entry.ngay,
            }))
        : [],
    }))
}

export async function syncDispatchEntriesLegacyRows() {
  return
}
