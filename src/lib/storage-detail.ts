"use client"

import { loadDispatchEntriesWithResolvedRows } from "@/lib/dispatch-entry-rows"
import { supabase } from "@/lib/supabase"

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
  uid: string
  _date: string
  so_xe: string
  chuyen: number
  tai_xe: string
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
}

export type StorageProducedLot = {
  id: string
  ma_lo: string
  ngay_sx: string
  ca: string
  loai_csr: string
  loai_banh: number
  boc: string
  tong_banh: number
  tong_kg: number
  trang_thai: string
}

export type StorageDetailData = {
  ngan: StorageNgan
  trips: StorageTripItem[]
  lots: StorageProducedLot[]
}

type StorageGeoJsonFeature = {
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
  if (!value) return value
  if (value.includes("/")) {
    const [d, m, y] = value.split("/")
    return `${y}-${(m || "").padStart(2, "0")}-${(d || "").padStart(2, "0")}`
  }
  return value.slice(0, 10)
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

export function buildStorageLookupPath(nganId: string) {
  return `/dashboard/storage/${encodeURIComponent(nganId)}`
}

export function buildStorageLookupUrl(nganId: string) {
  const path = buildStorageLookupPath(nganId)
  const origin = typeof window !== "undefined" ? window.location.origin : ""
  return origin ? `${origin}${path}` : path
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

function mapTripRow(row: Record<string, string>, ngay: string): StorageTripItem {
  const date =
    row._date && /^\d{4}-\d{2}-\d{2}/.test(row._date)
      ? row._date.slice(0, 10)
      : toISODate(ngay)
  return {
    uid: row.uid || "",
    _date: date,
    so_xe: row.so_xe || "",
    chuyen: Number(row.chuyen) || 1,
    tai_xe: row.tai_xe || "",
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

export async function loadDispatchTripsByUids(factoryId: string, tripUids: string[]) {
  if (!factoryId || tripUids.length === 0) return []
  const uidSet = new Set(tripUids)
  const tripsByUid = new Map<string, StorageTripItem>()
  const entries = await loadDispatchEntriesWithResolvedRows(supabase, {
    factoryId,
    select: "id,ngay,rows",
    ascending: true,
  })

  for (const entry of entries) {
    const ngay = typeof entry.ngay === "string" ? entry.ngay : ""
    const rows = Array.isArray(entry.rows) ? (entry.rows as Record<string, string>[]) : []
    for (const row of rows) {
      if (!uidSet.has(row.uid || "")) continue
      if (tripsByUid.has(row.uid || "")) continue
      const trip = mapTripRow(row, ngay)
      if (!trip.uid) continue
      tripsByUid.set(trip.uid, trip)
    }
  }

  return sortTrips(Array.from(tripsByUid.values()))
}

function almostEqualStorageWeight(a: number, b: number) {
  return Math.abs((a || 0) - (b || 0)) < 0.0001
}

function isTripWithinNganRange(ngan: Pick<StorageNgan, "ngay_bd" | "ngay_kt">, trip: Pick<StorageTripItem, "_date">) {
  const from = (ngan.ngay_bd || "").slice(0, 10)
  const to = ((ngan.ngay_kt || ngan.ngay_bd || "")).slice(0, 10)
  const date = (trip._date || "").slice(0, 10)
  if (!from || !to || !date) return false
  return date >= from && date <= to
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

  const trips = await loadDispatchTripsByUids(factoryId, allTripUids)
  const tripsByUid = new Map(trips.map((trip) => [trip.uid, trip] as const))
  const updates: Array<{ id: string; tong_tuoi: number; tong_kho: number; trips: string[] }> = []

  const resolved = ngans.map((ngan) => {
    const normalizedTrips = (Array.isArray(ngan.trips) ? ngan.trips : [])
      .map((uid) => tripsByUid.get(uid))
      .filter((trip): trip is StorageTripItem => Boolean(trip))
      .filter((trip) => isTripWithinNganRange(ngan, trip))

    const normalizedTripUids = normalizedTrips.map((trip) => trip.uid)
    const summary = summarizeStorageTrips(
      { ...ngan, trips: normalizedTripUids },
      normalizedTrips,
    )

    const tong_tuoi = Math.round(summary.tuoi * 100) / 100
    const tong_kho = Math.round(summary.kho * 100) / 100
    const currentTripUids = Array.isArray(ngan.trips) ? ngan.trips.filter(Boolean) : []
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
      if (tripsByUid.has(row.uid || "")) continue
      const trip = mapTripRow(row, ngay)
      if (!trip.uid) continue
      tripsByUid.set(trip.uid, trip)
    }
  }

  return sortTrips(Array.from(tripsByUid.values()))
}

export async function loadStorageGeoJson(factoryId: string, ngan: Pick<StorageNgan, "id" | "ten_ngan" | "ma_ngan" | "loai_nl" | "trips">) {
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

  const { data: dispatchRows, error: dispatchError } = await supabase
    .from("dispatch_entry_rows")
    .select("uid_legacy,lo_thu_hoach")
    .eq("factory_id", factoryId)
    .in("uid_legacy", tripUids)

  if (dispatchError) throw new Error(dispatchError.message)

  const plotCodes = [...new Set(
    (dispatchRows || []).flatMap((row) =>
      Array.isArray(row.lo_thu_hoach)
        ? row.lo_thu_hoach.map((code) => String(code || "").trim()).filter(Boolean)
        : [],
    ),
  )]

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
  const { data: plotRows } = await supabase
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
    const res = await fetch("/geojson/Lo cao su - 2026_Full.geojson")
    if (!res.ok) throw new Error("Không tải được file GeoJSON gốc")
    const full = await res.json() as { features?: StorageGeoJsonFeature[] }
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

export async function loadStorageLots(factoryId: string, nganId: string) {
  const { data, error } = await supabase
    .from("lots")
    .select("id,ma_lo,ngay_sx,ca,loai_csr,loai_banh,boc,tong_banh,tong_kg,trang_thai")
    .eq("factory_id", factoryId)
    .eq("ngan_id", nganId)
    .order("ngay_sx", { ascending: false })
    .order("created_at", { ascending: false })
  if (error) throw new Error(error.message)
  return (data || []) as StorageProducedLot[]
}

export async function loadStorageDetail(factoryId: string, nganId: string): Promise<StorageDetailData> {
  const { data: ngan, error: nganError } = await supabase
    .from("ngans")
    .select("id,factory_id,ma_ngan,ten_ngan,loai_nl,nguon_goc,xu_ly,chung_nhan,ngay_bd,ngay_kt,xe_tu_ngay,xe_den_ngay,trang_thai,tong_tuoi,tong_kho,trips,lo_nguon_goc,ghi_chu")
    .eq("factory_id", factoryId)
    .eq("id", nganId)
    .single()
  if (nganError) throw new Error(nganError.message)
  if (!ngan) throw new Error("Không tìm thấy ngăn lưu")

  const [trips, lots] = await Promise.all([
    loadDispatchTripsByUids(factoryId, Array.isArray(ngan.trips) ? (ngan.trips as string[]) : []),
    loadStorageLots(factoryId, nganId),
  ])

  const tripSummary = summarizeStorageTrips(
    {
      ...(ngan as StorageNgan),
      trips: Array.isArray(ngan.trips) ? (ngan.trips as string[]) : [],
    },
    trips.filter((trip) =>
      isTripWithinNganRange(
        {
          ngay_bd: (ngan.ngay_bd as string) || "",
          ngay_kt: (ngan.ngay_kt as string | null) || null,
        },
        trip,
      ),
    ),
  )
  const tong_tuoi = Math.round(tripSummary.tuoi * 100) / 100
  const tong_kho = Math.round(tripSummary.kho * 100) / 100
  const normalizedTrips = trips.filter((trip) =>
    isTripWithinNganRange(
      {
        ngay_bd: (ngan.ngay_bd as string) || "",
        ngay_kt: (ngan.ngay_kt as string | null) || null,
      },
      trip,
    ),
  )
  const normalizedTripUids = normalizedTrips.map((trip) => trip.uid)
  const currentTripUids = Array.isArray(ngan.trips) ? (ngan.trips as string[]).filter(Boolean) : []
  const tripsChanged =
    currentTripUids.length !== normalizedTripUids.length ||
    currentTripUids.some((uid, index) => uid !== normalizedTripUids[index])

  if (
    tripsChanged ||
    !almostEqualStorageWeight(Number(ngan.tong_tuoi ?? 0), tong_tuoi) ||
    !almostEqualStorageWeight(Number(ngan.tong_kho ?? 0), tong_kho)
  ) {
    await supabase
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

export function summarizeStorageLots(lots: StorageProducedLot[]) {
  const thanhPhamKg = lots.reduce((sum, lot) => sum + (lot.tong_kg || 0), 0)
  const doDangCount = lots.filter((lot) => lot.trang_thai === "Dở dang").length
  return {
    totalLots: lots.length,
    doDangCount,
    thanhPhamKg,
  }
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
