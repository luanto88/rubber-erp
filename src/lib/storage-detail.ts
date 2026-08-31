import type { SupabaseClient } from "@supabase/supabase-js"
import { loadDispatchEntriesWithResolvedRows } from "@/lib/dispatch-entry-rows"
import { supabase } from "@/lib/supabase"
import { normalizeDateInput } from "@/lib/date-utils"
import { getLoaiBanhConfig } from "@/lib/product-lot-config"

export type StorageNgan = {
  id: string
  factory_id: string
  ma_ngan: string
  ten_ngan: string
  loai_nl: string
  nguon_goc: string
  xu_ly: string
  chung_nhan: string
  ngay_bd: string
  ngay_kt: string | null
  xe_tu_ngay: string | null
  xe_den_ngay: string | null
  trang_thai: string
  tong_tuoi: number
  tong_kho: number
  trips: string[]
  lo_nguon_goc: string
  ghi_chu?: string | null
}

export type StorageTripItem = {
  ref: string
  uid: string
  row_id?: string
  dispatch_entry_id?: string
  _date: string
  so_xe: string
  chuyen: number
  tai_xe: string
  diem_gn: string[]
  phien: string[]
  lo_thu_hoach: string[]
  kl_ct: number
  kl_ck: number
  kl_dct: number
  kl_dck: number
  kl_dkt: number
  kl_dkk: number
  kl_dt: number
  kl_dk: number
  kl_mn: number
  kl_mnk: number
  ghi_chu: string
}

export type StorageProducedLot = {
  id: string
  lot_id?: string
  ma_lo: string
  ngay_sx: string
  ca: string
  loai_csr: string
  loai_banh: number
  boc: string
  tong_banh: number
  tong_kg: number
  trang_thai: string
  kien_a: number
  kien_b: number
  kien_c: number
  kien_d: number
}

export type StorageDetailData = {
  ngan: StorageNgan
  trips: StorageTripItem[]
  lots: StorageProducedLot[]
}

export type StorageGeoJsonFeature = {
  type: "Feature"
  properties?: Record<string, unknown>
  geometry?: unknown
}

export type StorageGeoJsonCollection = {
  type: "FeatureCollection"
  features: StorageGeoJsonFeature[]
  metadata: {
    ngan_id: string
    ten_ngan: string
    ma_ngan: string
    loai_nl: string
    trip_count: number
    total_plot_codes: number
  }
}

export function toISODate(value: string) {
  return normalizeDateInput(value) || value
}

export function buildDispatchTripRef(parts: {
  dispatchEntryId?: string | null
  rowId?: string | null
  uid?: string | null
}) {
  const dispatchEntryId = String(parts.dispatchEntryId || "").trim()
  const rowId = String(parts.rowId || parts.uid || "").trim()
  if (dispatchEntryId && rowId) return `${dispatchEntryId}::${rowId}`
  return String(parts.uid || "").trim()
}

function parseDispatchTripRef(value: string) {
  const raw = String(value || "").trim()
  if (!raw) return { raw: "", dispatchEntryId: "", rowId: "", uid: "" }
  if (!raw.includes("::")) return { raw, dispatchEntryId: "", rowId: "", uid: raw }
  const [dispatchEntryId, rowId] = raw.split("::", 2)
  return { raw, dispatchEntryId, rowId, uid: "" }
}

export function formatStorageDate(value?: string | null) {
  if (!value) return "—"
  const iso = toISODate(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!iso) return "—"
  return `${iso[3]}/${iso[2]}/${iso[1]}`
}

export function addDaysISO(value?: string | null, days = 1) {
  if (!value) return ""
  const [year, month, day] = toISODate(value).split("-").map(Number)
  const next = new Date(year, (month || 1) - 1, day || 1)
  next.setDate(next.getDate() + days)
  const nextYear = next.getFullYear()
  const nextMonth = `${next.getMonth() + 1}`.padStart(2, "0")
  const nextDay = `${next.getDate()}`.padStart(2, "0")
  return `${nextYear}-${nextMonth}-${nextDay}`
}

function normalizeStorageLookupValue(value?: string | null) {
  const raw = String(value || "").trim()
  if (!raw) return ""
  try {
    return decodeURIComponent(raw).trim()
  } catch {
    return raw
  }
}

export function buildStorageLookupPath(nganId?: string | null, nganCode?: string | null) {
  const params = new URLSearchParams()
  const normalizedId = normalizeStorageLookupValue(nganId)
  const normalizedCode = normalizeStorageLookupValue(nganCode)
  if (normalizedId) params.set("id", normalizedId)
  if (normalizedCode) params.set("code", normalizedCode)
  const query = params.toString()
  return query ? `/storage?${query}` : "/storage"
}

export function buildStorageLookupUrl(nganId?: string | null, nganCode?: string | null) {
  const path = buildStorageLookupPath(nganId, nganCode)
  const origin = typeof window !== "undefined" ? window.location.origin : ""
  return origin ? `${origin}${path}` : path
}

export async function resolveStorageLookupTarget(
  params: {
    nganId?: string | null
    nganCode?: string | null
  },
  client: SupabaseClient = supabase,
) {
  const nganId = normalizeStorageLookupValue(params.nganId)
  const nganCode = normalizeStorageLookupValue(params.nganCode)

  if (nganId) {
    const { data, error } = await client
      .from("ngans")
      .select("id,factory_id,ma_ngan,ten_ngan")
      .eq("id", nganId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (data) return data as Pick<StorageNgan, "id" | "factory_id" | "ma_ngan" | "ten_ngan">
  }

  if (nganCode) {
    const { data, error } = await client
      .from("ngans")
      .select("id,factory_id,ma_ngan,ten_ngan")
      .eq("ma_ngan", nganCode)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (data) return data as Pick<StorageNgan, "id" | "factory_id" | "ma_ngan" | "ten_ngan">
  }

  throw new Error("Khong tim thay ngan luu phu hop voi ma tra cuu.")
}

export function getKLFromTrip(trip: StorageTripItem, loaiNl: string) {
  switch (loaiNl) {
    case "Mủ chén":
      return { tuoi: trip.kl_ct, kho: trip.kl_ck }
    case "Mủ đông chén":
      return { tuoi: trip.kl_dct, kho: trip.kl_dck }
    case "Mủ đông khối":
      return { tuoi: trip.kl_dkt, kho: trip.kl_dkk }
    case "Mủ dây":
      return { tuoi: trip.kl_dt, kho: trip.kl_dk }
    case "Mủ nước":
      return { tuoi: trip.kl_mn, kho: trip.kl_mnk }
    default:
      return { tuoi: 0, kho: 0 }
  }
}

function mapTripRow(row: Record<string, string>, ngay: string, dispatchEntryId?: string): StorageTripItem {
  const date =
    row._date && /^\d{4}-\d{2}-\d{2}/.test(row._date)
      ? row._date.slice(0, 10)
      : toISODate(ngay)
  const uid = row.uid || ""
  const rowId = row.row_id || uid || ""
  return {
    ref: buildDispatchTripRef({ dispatchEntryId, rowId, uid }),
    uid,
    row_id: rowId || undefined,
    dispatch_entry_id: dispatchEntryId || row.dispatch_entry_id || undefined,
    _date: date,
    so_xe: row.so_xe || "",
    chuyen: Number(row.chuyen) || 1,
    tai_xe: row.tai_xe || "",
    diem_gn: Array.isArray(row.diem_gn) ? row.diem_gn.map((item) => String(item || "").trim()).filter(Boolean) : [],
    phien: Array.isArray(row.phien) ? row.phien.map((item) => String(item || "").trim()).filter(Boolean) : [],
    lo_thu_hoach: Array.isArray(row.lo_thu_hoach) ? row.lo_thu_hoach.map((item) => String(item || "").trim()).filter(Boolean) : [],
    kl_ct: Number(row.kl_ct) || 0,
    kl_ck: Number(row.kl_ck) || 0,
    kl_dct: Number(row.kl_dct) || 0,
    kl_dck: Number(row.kl_dck) || 0,
    kl_dkt: Number(row.kl_dkt) || 0,
    kl_dkk: Number(row.kl_dkk) || 0,
    kl_dt: Number(row.kl_dt) || 0,
    kl_dk: Number(row.kl_dk) || 0,
    kl_mn: Number(row.kl_mn) || 0,
    kl_mnk: Number(row.kl_mnk) || 0,
    ghi_chu: String(row.ghi_chu || "").trim(),
  }
}

function sortTrips(trips: StorageTripItem[]) {
  return trips.sort((a, b) => {
    const dateCompare = a._date.localeCompare(b._date)
    if (dateCompare !== 0) return dateCompare
    const vehicleCompare = a.so_xe.localeCompare(b.so_xe, "vi", { numeric: true, sensitivity: "base" })
    if (vehicleCompare !== 0) return vehicleCompare
    return a.chuyen - b.chuyen
  })
}

function resolveLegacyTripCandidateRefs(
  tripToken: string,
  entries: Array<{ id: string; ngay: string; rows: Record<string, string>[] }>,
  dateBounds?: { fromDate?: string | null; toDate?: string | null },
) {
  const parsed = parseDispatchTripRef(tripToken)
  if (!parsed.uid) return []

  const fromDate = normalizeDateInput(dateBounds?.fromDate)
  const toDate = normalizeDateInput(dateBounds?.toDate)
  const refs: string[] = []

  for (const entry of entries) {
    const entryDate = toISODate(entry.ngay)
    if (fromDate && entryDate < fromDate) continue
    if (toDate && entryDate > toDate) continue

    for (const row of entry.rows) {
      if (String(row.uid || "") !== parsed.uid) continue
      refs.push(
        buildDispatchTripRef({
          dispatchEntryId: entry.id,
          rowId: row.row_id || row.uid,
          uid: row.uid,
        }),
      )
    }
  }

  return [...new Set(refs.filter(Boolean))]
}

export async function loadDispatchTripsByUids(
  factoryId: string,
  tripRefs: string[],
  options?: { fromDate?: string | null; toDate?: string | null },
  client: SupabaseClient = supabase,
) {
  if (!factoryId || tripRefs.length === 0) return []
  const requestedRefs = new Set(tripRefs.filter(Boolean))
  const tripsByRef = new Map<string, StorageTripItem>()
  const entries = await loadDispatchEntriesWithResolvedRows(client, {
    factoryId,
    select: "id,ngay,rows",
    fromDate: options?.fromDate || undefined,
    toDate: options?.toDate || undefined,
    ascending: true,
  })

  const normalizedEntries = entries.map((entry) => ({
    id: entry.id,
    ngay: typeof entry.ngay === "string" ? entry.ngay : "",
    rows: Array.isArray(entry.rows) ? (entry.rows as Record<string, string>[]) : [],
  }))
  const legacyCandidateRefs = new Map(
    tripRefs
      .map((tripRef) => [
        tripRef,
        resolveLegacyTripCandidateRefs(tripRef, normalizedEntries, options),
      ] as const),
  )

  for (const entry of entries) {
    const ngay = typeof entry.ngay === "string" ? entry.ngay : ""
    const rows = Array.isArray(entry.rows) ? (entry.rows as Record<string, string>[]) : []
    for (const row of rows) {
      const trip = mapTripRow(row, ngay, entry.id)
      const matchesRequestedRef = requestedRefs.has(trip.ref)
      const matchesLegacyRef = tripRefs.some((tripRef) =>
        legacyCandidateRefs.get(tripRef)?.includes(trip.ref),
      )
      if (!matchesRequestedRef && !matchesLegacyRef) continue
      if (tripsByRef.has(trip.ref)) continue
      tripsByRef.set(trip.ref, trip)
    }
  }

  return sortTrips(Array.from(tripsByRef.values()))
}

function almostEqualStorageWeight(a: number, b: number) {
  return Math.abs((a || 0) - (b || 0)) < 0.0001
}

export async function resolveStorageNgansActualTotals(
  factoryId: string,
  ngans: StorageNgan[],
  options?: { persist?: boolean },
) {
  if (!factoryId || ngans.length === 0) return ngans

  const allTripUids = Array.from(
    new Set(
      ngans.flatMap((ngan) =>
        Array.isArray(ngan.trips) ? ngan.trips.filter(Boolean) : [],
      ),
    ),
  )

  const entries = await loadDispatchEntriesWithResolvedRows(supabase, {
    factoryId,
    select: "id,ngay,rows",
    ascending: true,
  })
  const normalizedEntries = entries.map((entry) => ({
    id: entry.id,
    ngay: typeof entry.ngay === "string" ? entry.ngay : "",
    rows: Array.isArray(entry.rows) ? (entry.rows as Record<string, string>[]) : [],
  }))
  const trips = await loadDispatchTripsByUids(factoryId, allTripUids)
  const tripsByRef = new Map(trips.map((trip) => [trip.ref, trip] as const))
  const updates: Array<{ id: string; tong_tuoi: number; tong_kho: number; trips: string[] }> = []

  const resolved = ngans.map((ngan) => {
    const currentTripRefs = Array.isArray(ngan.trips) ? ngan.trips.filter(Boolean) : []
    const persistedTripRefs = currentTripRefs.flatMap((tripRef) => {
      const parsed = parseDispatchTripRef(tripRef)
      if (parsed.dispatchEntryId && parsed.rowId) return [tripRef]
      return resolveLegacyTripCandidateRefs(tripRef, normalizedEntries, {
        fromDate: ngan.ngay_bd,
        toDate: ngan.ngay_kt || ngan.ngay_bd,
      })
    })
    const normalizedTrips = persistedTripRefs
      .map((tripRef) => tripsByRef.get(tripRef))
      .filter((trip): trip is StorageTripItem => Boolean(trip))

    const normalizedTripUids = normalizedTrips.map((trip) => trip.ref)
    const summary = summarizeStorageTrips(
      { ...ngan, trips: normalizedTripUids },
      normalizedTrips,
    )

    const tong_tuoi = Math.round(summary.tuoi * 100) / 100
    const tong_kho = Math.round(summary.kho * 100) / 100
    const currentTripUids = currentTripRefs
    const tripsChanged =
      currentTripUids.length !== normalizedTripUids.length ||
      currentTripUids.some((uid, index) => uid !== normalizedTripUids[index])

    if (
      tripsChanged ||
      !almostEqualStorageWeight(Number(ngan.tong_tuoi ?? 0), tong_tuoi) ||
      !almostEqualStorageWeight(Number(ngan.tong_kho ?? 0), tong_kho)
    ) {
      updates.push({ id: ngan.id, tong_tuoi, tong_kho, trips: normalizedTripUids })
    }

    return {
      ...ngan,
      trips: normalizedTripUids,
      tong_tuoi,
      tong_kho,
    }
  })

  if (options?.persist && updates.length > 0) {
    await Promise.all(
      updates.map((update) =>
        supabase
          .from("ngans")
          .update({ tong_tuoi: update.tong_tuoi, tong_kho: update.tong_kho, trips: update.trips })
          .eq("factory_id", factoryId)
          .eq("id", update.id),
      ),
    )
  }

  return resolved
}

export async function loadDispatchTripsByDateRange(factoryId: string, fromDate: string, toDate: string) {
  if (!factoryId || !fromDate || !toDate) return []
  const tripsByUid = new Map<string, StorageTripItem>()
  const entries = await loadDispatchEntriesWithResolvedRows(supabase, {
    factoryId,
    select: "id,ngay,rows",
    fromDate,
    toDate,
    ascending: true,
  })

  for (const entry of entries) {
    const ngay = typeof entry.ngay === "string" ? toISODate(entry.ngay) : ""
    const rows = Array.isArray(entry.rows) ? (entry.rows as Record<string, string>[]) : []
    for (const row of rows) {
      const trip = mapTripRow(row, ngay, entry.id)
      if (!trip.ref || tripsByUid.has(trip.ref)) continue
      tripsByUid.set(trip.ref, trip)
    }
  }

  return sortTrips(Array.from(tripsByUid.values()))
}

async function fetchStaticForestPlotGeoJson(): Promise<{ features?: StorageGeoJsonFeature[] }> {
  const res = await fetch("/geojson/Lo cao su - 2026_Full.geojson")
  if (!res.ok) throw new Error("Không tải được file GeoJSON gốc")
  return res.json() as Promise<{ features?: StorageGeoJsonFeature[] }>
}

export async function loadStorageGeoJson(
  factoryId: string,
  ngan: Pick<StorageNgan, "id" | "ten_ngan" | "ma_ngan" | "loai_nl" | "trips">,
  client: SupabaseClient = supabase,
  loadStaticFallback: () => Promise<{ features?: StorageGeoJsonFeature[] }> = fetchStaticForestPlotGeoJson,
) {
  const tripUids = Array.isArray(ngan.trips) ? ngan.trips.filter(Boolean) : []
  if (!factoryId || tripUids.length === 0) {
    return {
      type: "FeatureCollection",
      features: [],
      metadata: {
        ngan_id: ngan.id,
        ten_ngan: ngan.ten_ngan || "",
        ma_ngan: ngan.ma_ngan || "",
        loai_nl: ngan.loai_nl || "",
        trip_count: tripUids.length,
        total_plot_codes: 0,
      },
    } satisfies StorageGeoJsonCollection
  }

  const { data: dispatchRows, error: dispatchError } = await client
    .from("dispatch_entries")
    .select("id,ngay,rows")
    .eq("factory_id", factoryId)

  if (dispatchError) throw new Error(dispatchError.message)

  const tripUidSet = new Set(tripUids)
  const plotCodes = [...new Set((dispatchRows || []).flatMap((entry) =>
    Array.isArray(entry.rows)
      ? entry.rows.flatMap((row) => {
          const typedRow = row as Record<string, unknown>
          const tripRef = buildDispatchTripRef({
            dispatchEntryId: String((entry as { id?: string }).id || ""),
            rowId: String(typedRow.row_id ?? typedRow.uid ?? ""),
            uid: String(typedRow.uid ?? ""),
          })
          if (!tripUidSet.has(tripRef) && !tripUidSet.has(String(typedRow.uid ?? ""))) return []
          return Array.isArray(typedRow.lo_thu_hoach)
            ? typedRow.lo_thu_hoach.map((code) => String(code || "").trim()).filter(Boolean)
            : []
        })
      : [],
  ))]

  if (plotCodes.length === 0) {
    return {
      type: "FeatureCollection",
      features: [],
      metadata: {
        ngan_id: ngan.id,
        ten_ngan: ngan.ten_ngan || "",
        ma_ngan: ngan.ma_ngan || "",
        loai_nl: ngan.loai_nl || "",
        trip_count: tripUids.length,
        total_plot_codes: 0,
      },
    } satisfies StorageGeoJsonCollection
  }

  let features: StorageGeoJsonFeature[] = []
  const { data: plotRows } = await client
    .from("forest_plots")
    .select("ten, geometry, nong_truong, doi, dien_tich_ha")
    .eq("factory_id", factoryId)
    .eq("is_active", true)
    .in("ten", plotCodes)

  if (plotRows && plotRows.length > 0) {
    features = (plotRows as {
      ten: string
      geometry: unknown
      nong_truong: string | null
      doi: number | null
      dien_tich_ha: number | null
    }[]).map((plot) => ({
      type: "Feature",
      properties: {
        Ten: plot.ten,
        Nong_truong: plot.nong_truong ?? "",
        Doi_2026: plot.doi ?? null,
        Dtich2026_ha: plot.dien_tich_ha ?? null,
      },
      geometry: plot.geometry,
    }))
  } else {
    const full = await loadStaticFallback()
    features = (full.features || []).filter((feature) =>
      plotCodes.includes(String(feature.properties?.Ten || feature.properties?.ma_lo || "").trim()),
    )
  }

  return {
    type: "FeatureCollection",
    features,
    metadata: {
      ngan_id: ngan.id,
      ten_ngan: ngan.ten_ngan || "",
      ma_ngan: ngan.ma_ngan || "",
      loai_nl: ngan.loai_nl || "",
      trip_count: tripUids.length,
      total_plot_codes: plotCodes.length,
    },
  } satisfies StorageGeoJsonCollection
}

// Bản dùng cho luồng công khai `/storage` (`StorageDetailClient`'s bản đồ lô thu hoạch) — cùng
// lý do với `loadStorageDetailByLookup` ở trên: khách chưa đăng nhập không còn đọc thẳng
// `dispatch_entries` bằng anon key được nữa sau khi khóa RLS SELECT (2026-08-08). Trang dashboard
// đã đăng nhập (`storage/page.tsx`'s nút "Xuất GeoJSON") vẫn dùng thẳng `loadStorageGeoJson`
// (không đổi) vì RLS factory-scoped đã đủ bảo vệ trong ngữ cảnh đó.
export async function loadPublicStorageGeoJson(
  factoryId: string,
  ngan: Pick<StorageNgan, "id" | "ten_ngan" | "ma_ngan" | "loai_nl" | "trips">,
): Promise<StorageGeoJsonCollection> {
  const res = await fetch("/api/storage/geojson", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ factoryId, ngan }),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(json?.error || "Không tải được dữ liệu bản đồ của ngăn.")
  }
  return json as StorageGeoJsonCollection
}

export async function loadStorageLots(factoryId: string, nganId: string, client: SupabaseClient = supabase) {
  const { data, error } = await client
    .from("lot_transactions")
    .select(`
      id,
      ngan_id,
      ca,
      ngay_nhap,
      kien_a,
      kien_b,
      kien_c,
      kien_d,
      so_banh,
      so_kg,
      created_at,
      lots!inner(
        id,
        ma_lo,
        loai_csr,
        loai_banh,
        boc,
        trang_thai,
        kien_a,
        kien_b,
        kien_c,
        kien_d,
        tong_banh,
        tong_kg
      )
    `)
    .eq("ngan_id", nganId)
    .eq("lots.factory_id", factoryId)
  if (error) throw new Error(error.message)

  const rows = ((data || []) as unknown as Array<{
    id: string
    ngan_id: string
    ca: string
    ngay_nhap: string
    kien_a?: number | null
    kien_b?: number | null
    kien_c?: number | null
    kien_d?: number | null
    so_banh: number
    so_kg: number
    created_at?: string | null
    lots?: {
      id: string
      ma_lo: string
      loai_csr: string
      loai_banh: number
      boc: string
      trang_thai: string
      kien_a: number
      kien_b: number
      kien_c: number
      kien_d: number
    } | null
  }>)
    .filter((tx) => Boolean(tx.lots))
    .map((tx) => {
      const kA = Number(tx.kien_a ?? 0)
      const kB = Number(tx.kien_b ?? 0)
      const kC = Number(tx.kien_c ?? 0)
      const kD = Number(tx.kien_d ?? 0)
      const calculatedBanh = kA + kB + kC + kD
      const tongBanh = Number(tx.so_banh || (calculatedBanh > 0 ? calculatedBanh : 0))

      return {
        id: tx.id,
        lot_id: tx.lots?.id,
        ma_lo: tx.lots?.ma_lo || "",
        ngay_sx: tx.ngay_nhap,
        ca: tx.ca,
        loai_csr: tx.lots?.loai_csr || "",
        loai_banh: Number(tx.lots?.loai_banh || 0),
        boc: tx.lots?.boc || "",
        tong_banh: tongBanh,
        tong_kg: Number(tx.so_kg || 0),
        trang_thai: tx.lots?.trang_thai || "",
        kien_a: kA,
        kien_b: kB,
        kien_c: kC,
        kien_d: kD,
      }
    })

  // Fallback: một số lô cũ (vd lô bị ghi trực tiếp vào `lots` ngoài luồng app — xem
  // ".claude/rules/06-module-production.md" mục "Invariant bắt buộc... lot_transactions
  // backing") không có bản ghi `lot_transactions` nào dù `lots.ngan_id` đã trỏ đúng ngăn.
  // Không có lot_transactions thì query trên bỏ sót hoàn toàn — bù bằng cách đọc thẳng
  // `lots` theo `ngan_id`, chỉ lấy các lô CHƯA có transaction nào ở trên để tránh trùng.
  const coveredLotIds = new Set(rows.map((r) => r.lot_id).filter(Boolean))
  const { data: fallbackLots, error: fallbackError } = await client
    .from("lots")
    .select("id, ma_lo, ngay_sx, ca, loai_csr, loai_banh, boc, tong_banh, tong_kg, trang_thai, kien_a, kien_b, kien_c, kien_d")
    .eq("factory_id", factoryId)
    .eq("ngan_id", nganId)
  if (fallbackError) throw new Error(fallbackError.message)

  const fallbackRows = (fallbackLots || [])
    .filter((lot) => !coveredLotIds.has(lot.id))
    .map((lot) => ({
      id: `lot-${lot.id}`,
      lot_id: lot.id,
      ma_lo: lot.ma_lo || "",
      ngay_sx: (lot.ngay_sx || "").slice(0, 10),
      ca: lot.ca || "",
      loai_csr: lot.loai_csr || "",
      loai_banh: Number(lot.loai_banh || 0),
      boc: lot.boc || "",
      tong_banh: Number(lot.tong_banh || 0),
      tong_kg: Number(lot.tong_kg || 0),
      trang_thai: lot.trang_thai || "",
      kien_a: Number(lot.kien_a || 0),
      kien_b: Number(lot.kien_b || 0),
      kien_c: Number(lot.kien_c || 0),
      kien_d: Number(lot.kien_d || 0),
    }))

  return [...rows, ...fallbackRows].sort((a, b) =>
    b.ngay_sx.localeCompare(a.ngay_sx) ||
    a.ma_lo.localeCompare(b.ma_lo, "vi", { numeric: true, sensitivity: "base" }),
  )
}

export async function loadStorageLotsByNgans(
  factoryId: string,
  nganIds: string[],
  client: SupabaseClient = supabase,
) {
  const uniqueNganIds = [...new Set(nganIds.filter(Boolean))]
  if (!factoryId || uniqueNganIds.length === 0) return {} as Record<string, StorageProducedLot[]>
  const grouped: Record<string, StorageProducedLot[]> = {}

  const results = await Promise.allSettled(
    uniqueNganIds.map(async (nganId) => ({
      nganId,
      lots: await loadStorageLots(factoryId, nganId, client),
    })),
  )

  results.forEach((result) => {
    if (result.status !== "fulfilled") {
      console.error("[storage-detail] loadStorageLotsByNgans failed", result.reason)
      return
    }
    if (result.value.lots.length === 0) return
    grouped[result.value.nganId] = result.value.lots
  })

  return grouped
}

export async function loadStorageDetail(
  factoryId: string,
  nganId: string,
  client: SupabaseClient = supabase,
): Promise<StorageDetailData> {
  const { data: ngan, error: nganError } = await client
    .from("ngans")
    .select("id,factory_id,ma_ngan,ten_ngan,loai_nl,nguon_goc,xu_ly,chung_nhan,ngay_bd,ngay_kt,xe_tu_ngay,xe_den_ngay,trang_thai,tong_tuoi,tong_kho,trips,lo_nguon_goc,ghi_chu")
    .eq("factory_id", factoryId)
    .eq("id", nganId)
    .single()
  if (nganError) throw new Error(nganError.message)
  if (!ngan) throw new Error("Không tìm thấy ngăn lưu")

  const [trips, lots] = await Promise.all([
    loadDispatchTripsByUids(
      factoryId,
      Array.isArray(ngan.trips) ? (ngan.trips as string[]) : [],
      {
        fromDate: (ngan.ngay_bd as string | null) || undefined,
        toDate: (ngan.ngay_kt as string | null) || (ngan.ngay_bd as string | null) || undefined,
      },
      client,
    ),
    loadStorageLots(factoryId, nganId, client),
  ])

  const tripSummary = summarizeStorageTrips(
    {
      ...(ngan as StorageNgan),
      trips: Array.isArray(ngan.trips) ? (ngan.trips as string[]) : [],
    },
    trips,
  )
  const tong_tuoi = Math.round(tripSummary.tuoi * 100) / 100
  const tong_kho = Math.round(tripSummary.kho * 100) / 100
  const normalizedTrips = trips
  const normalizedTripUids = normalizedTrips.map((trip) => trip.ref)
  const currentTripUids = Array.isArray(ngan.trips) ? (ngan.trips as string[]).filter(Boolean) : []
  const tripsChanged =
    currentTripUids.length !== normalizedTripUids.length ||
    currentTripUids.some((uid, index) => uid !== normalizedTripUids[index])

  if (
    tripsChanged ||
    !almostEqualStorageWeight(Number(ngan.tong_tuoi ?? 0), tong_tuoi) ||
    !almostEqualStorageWeight(Number(ngan.tong_kho ?? 0), tong_kho)
  ) {
    await client
      .from("ngans")
      .update({ tong_tuoi, tong_kho, trips: normalizedTripUids })
      .eq("factory_id", factoryId)
      .eq("id", nganId)
  }

  return {
    ngan: {
      ...(ngan as StorageNgan),
      trips: normalizedTripUids,
      xe_tu_ngay: (ngan.xe_tu_ngay as string | null) || addDaysISO((ngan.ngay_bd as string | null) || "", 1) || null,
      xe_den_ngay: (ngan.xe_den_ngay as string | null) || addDaysISO((ngan.ngay_kt as string | null) || "", 1) || null,
      tong_tuoi,
      tong_kho,
    },
    trips: normalizedTrips,
    lots,
  }
}

// Dùng cho luồng công khai (`/storage` và `/dashboard/storage/[id]` — xem
// `dashboard/layout.tsx`'s `isPublicStorageLookup`, bypass hoàn toàn phiên đăng nhập). Sau khi
// khóa RLS SELECT của `ngans`/`lots`/`dispatch_entries` về `authenticated`-only (2026-08-08),
// khách quét QR chưa đăng nhập KHÔNG còn đọc thẳng các bảng này bằng anon key được nữa — hàm này
// gọi qua route service-role `/api/storage/public-lookup` thay vì query trực tiếp như trước.
// KHÔNG dùng cho luồng dashboard đã đăng nhập (dùng `loadStorageDetail(factoryId, nganId)` trực
// tiếp — vẫn hoạt động bình thường nhờ RLS factory-scoped).
export async function loadStorageDetailByLookup(params: {
  nganId?: string | null
  nganCode?: string | null
}): Promise<StorageDetailData> {
  const search = new URLSearchParams()
  const nganId = normalizeStorageLookupValue(params.nganId)
  const nganCode = normalizeStorageLookupValue(params.nganCode)
  if (nganId) search.set("id", nganId)
  if (nganCode) search.set("code", nganCode)

  const res = await fetch(`/api/storage/public-lookup?${search.toString()}`)
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(json?.error || "Không tải được chi tiết ngăn lưu.")
  }
  return json as StorageDetailData
}

export type AggregatedStorageLot = {
  lot_id: string
  ma_lo: string
  loai_csr: string
  loai_banh: number
  boc: string
  kien_a: number
  kien_b: number
  kien_c: number
  kien_d: number
  tong_banh: number
  tong_kg: number
  isTronLo: boolean
  isDoDang: boolean
  txCount: number
}

function storageLotDedupeKey(lot: StorageProducedLot) {
  return lot.lot_id || lot.ma_lo || ""
}

// `lots` truyền vào đây là danh sách theo TỪNG DÒNG `lot_transactions` (1 lô có thể có nhiều
// dòng nếu được quét QR theo từng kiện riêng lẻ hoặc nhiều ca).
// Hàm này tổng hợp lại theo từng mã lô của riêng ngăn này để xác định đúng sản lượng, số kiện
// phát sinh từ ngăn đó, và phân loại chính xác Lô tròn hay Lô dở dang theo từng ngăn.
export function aggregateStorageLotsByLot(lots: StorageProducedLot[]): AggregatedStorageLot[] {
  const map = new Map<string, {
    lot_id: string
    ma_lo: string
    loai_csr: string
    loai_banh: number
    boc: string
    kien_a: number
    kien_b: number
    kien_c: number
    kien_d: number
    tong_banh: number
    tong_kg: number
    trang_thai: string
    txCount: number
  }>()

  for (const item of lots) {
    const key = storageLotDedupeKey(item)
    if (!key) continue
    const existing = map.get(key)
    if (!existing) {
      map.set(key, {
        lot_id: item.lot_id || item.id || key,
        ma_lo: item.ma_lo || "",
        loai_csr: item.loai_csr || "",
        loai_banh: item.loai_banh || 0,
        boc: item.boc || "",
        kien_a: item.kien_a || 0,
        kien_b: item.kien_b || 0,
        kien_c: item.kien_c || 0,
        kien_d: item.kien_d || 0,
        tong_banh: item.tong_banh || 0,
        tong_kg: item.tong_kg || 0,
        trang_thai: item.trang_thai || "",
        txCount: 1,
      })
    } else {
      existing.kien_a += item.kien_a || 0
      existing.kien_b += item.kien_b || 0
      existing.kien_c += item.kien_c || 0
      existing.kien_d += item.kien_d || 0
      existing.tong_banh += item.tong_banh || 0
      existing.tong_kg += item.tong_kg || 0
      existing.txCount += 1
      if (item.loai_csr && !existing.loai_csr) existing.loai_csr = item.loai_csr
      if (item.loai_banh && !existing.loai_banh) existing.loai_banh = item.loai_banh
      if (item.boc && !existing.boc) existing.boc = item.boc
      if (item.trang_thai === "Dở dang") existing.trang_thai = "Dở dang"
    }
  }

  return Array.from(map.values()).map((agg) => {
    const cfg = getLoaiBanhConfig(agg.loai_csr || "", agg.loai_banh || 35)
    const loTronBanh = cfg.lo_tron || 144
    // 1 lô được coi là tròn lô trong ngăn này nếu tổng số bành sản xuất từ ngăn này đạt đủ tiêu chuẩn lô tròn (vd 144 bành)
    // và không bị đánh dấu dở dang.
    const isTronLo = agg.tong_banh >= loTronBanh && agg.trang_thai !== "Dở dang"
    const isDoDang = !isTronLo

    return {
      lot_id: agg.lot_id,
      ma_lo: agg.ma_lo,
      loai_csr: agg.loai_csr,
      loai_banh: agg.loai_banh,
      boc: agg.boc,
      kien_a: agg.kien_a,
      kien_b: agg.kien_b,
      kien_c: agg.kien_c,
      kien_d: agg.kien_d,
      tong_banh: agg.tong_banh,
      tong_kg: agg.tong_kg,
      isTronLo,
      isDoDang,
      txCount: agg.txCount,
    }
  })
}

export function summarizeStorageLots(lots: StorageProducedLot[]) {
  const thanhPhamKg = lots.reduce((sum, lot) => sum + (lot.tong_kg || 0), 0)
  const aggregatedLots = aggregateStorageLotsByLot(lots)
  const tronLoCount = aggregatedLots.filter((lot) => lot.isTronLo).length
  const doDangCount = aggregatedLots.filter((lot) => lot.isDoDang).length

  return {
    totalLots: aggregatedLots.length,
    tronLoCount,
    doDangCount,
    thanhPhamKg,
    aggregatedLots,
  }
}

// Dùng cho cột "Số lô chi tiết" của Báo cáo cân đối ngăn lưu theo kỳ — mỗi lô chỉ liệt kê
// đúng 1 lần. Lô đang "Dở dang" trong ngăn này hiển thị thêm breakdown số bành theo từng kiện (A/B/C/D)
// thực tế đã sản xuất từ nguyên liệu của ngăn đó (ví dụ: `1258cs/26 (D=36)`).
export function buildStorageLotDetailLines(lots: StorageProducedLot[]): string[] {
  const aggregatedLots = aggregateStorageLotsByLot(lots)

  return aggregatedLots
    .sort((a, b) => a.ma_lo.localeCompare(b.ma_lo, "vi", { numeric: true, sensitivity: "base" }))
    .map((lot) => {
      const maLo = lot.ma_lo || ""
      if (!maLo) return ""
      if (lot.isTronLo) return maLo

      const parts: string[] = []
      if (lot.kien_a > 0) parts.push(`A=${lot.kien_a}`)
      if (lot.kien_b > 0) parts.push(`B=${lot.kien_b}`)
      if (lot.kien_c > 0) parts.push(`C=${lot.kien_c}`)
      if (lot.kien_d > 0) parts.push(`D=${lot.kien_d}`)
      return parts.length > 0 ? `${maLo} (${parts.join(", ")})` : maLo
    })
    .filter(Boolean)
}

export function summarizeStorageTrips(ngan: StorageNgan, trips: StorageTripItem[]) {
  const totals = trips.reduce(
    (acc, trip) => {
      const weight = getKLFromTrip(trip, ngan.loai_nl)
      return {
        tuoi: acc.tuoi + weight.tuoi,
        kho: acc.kho + weight.kho,
      }
    },
    { tuoi: 0, kho: 0 },
  )
  return {
    tripCount: trips.length,
    tuoi: totals.tuoi,
    kho: totals.kho,
    ratio: totals.tuoi > 0 ? (totals.kho / totals.tuoi) * 100 : 0,
  }
}

export function compactTripLabel(trip: StorageTripItem) {
  return `${formatStorageDate(trip._date)} · ${trip.so_xe || "—"} · C${trip.chuyen || 1}`
}

export function normalizeStorageNgan(raw: Partial<StorageNgan>, fallbackLoaiNl = "Mủ đông chén") {
  return {
    id: raw.id || "",
    factory_id: raw.factory_id || "",
    ma_ngan: raw.ma_ngan || "",
    ten_ngan: raw.ten_ngan || "",
    loai_nl: raw.loai_nl || fallbackLoaiNl,
    nguon_goc: raw.nguon_goc || "NT",
    xu_ly: raw.xu_ly || "Xé",
    chung_nhan: raw.chung_nhan || "PEFC CS",
    ngay_bd: raw.ngay_bd?.slice(0, 10) || "",
    ngay_kt: raw.ngay_kt?.slice(0, 10) || null,
    xe_tu_ngay: raw.xe_tu_ngay?.slice(0, 10) || null,
    xe_den_ngay: raw.xe_den_ngay?.slice(0, 10) || null,
    trang_thai: raw.trang_thai || "Đang nhận (Cần cập nhật)",
    tong_tuoi: raw.tong_tuoi || 0,
    tong_kho: raw.tong_kho || 0,
    trips: Array.isArray(raw.trips) ? raw.trips : [],
    lo_nguon_goc: raw.lo_nguon_goc || "",
    ghi_chu: raw.ghi_chu || "",
  } satisfies StorageNgan
}

export function hasStorageTripPayload(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object") return false
  return "uid" in value
}
