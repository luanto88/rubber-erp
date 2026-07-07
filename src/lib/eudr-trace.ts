import type { SupabaseClient } from "@supabase/supabase-js"
import { promises as fs } from "fs"
import path from "path"
import type { FeatureCollection } from "geojson"
import { DIEM_GN, buildLoThuHoach, normalizeDeliveryPoints } from "@/lib/dispatch-master"
import { loadDispatchEntriesWithResolvedRows } from "@/lib/dispatch-entry-rows"
import { loadDispatchTripsByUids, type StorageTripItem } from "@/lib/storage-detail"
import { dedupeLotsByMaLo, normalizeLotCode } from "@/app/dashboard/product/shared"
import {
  mergePlotProperties,
  buildStaticPlotFeatureMap,
  type ForestPlotRow,
} from "@/lib/eudr-plot-merge"

// Port thuần (không phụ thuộc React state) của traceGeoChain trong
// src/app/dashboard/eudr/EudrClient.tsx — dùng cho route customer-portal chạy server-side
// bằng service-role client. Trang EUDR nội bộ giữ nguyên bản gốc, không refactor lại để
// tránh rủi ro regression.

export type TraceOrderAssignment = {
  lot_id: string
  ma_lo: string
  kien_a: number
  kien_b: number
  kien_c: number
  kien_d: number
}

export type TraceOrderInput = {
  id: string
  factory_id: string
  assignments: TraceOrderAssignment[]
}

export type TraceLot = {
  id: string
  ma_lo: string
  factory_id?: string | null
  ngan_id: string | null
  ngay_sx?: string | null
  loai_banh?: number | null
  kien_a?: number | null
  kien_b?: number | null
  kien_c?: number | null
  kien_d?: number | null
  created_at?: string | null
  updated_at?: string | null
}

type TraceNgan = {
  id: string
  trips: string[] | null
  chung_nhan: string | null
  ngay_bd: string | null
  ngay_kt: string | null
}

export type TraceResult = {
  resolvedAssignments: TraceOrderAssignment[]
  lotDetails: TraceLot[]
  extractionDates: Record<string, string>
  lotCertMap: Record<string, string>
  diemGn: string[]
  geoData: FeatureCollection
  traceInfo: {
    lots: number
    ngans: number
    tripUids: number
    matchedRows: number
    diemGn: number
    features: number
    fallback?: boolean
  }
}

const EMPTY_GEO: FeatureCollection = { type: "FeatureCollection", features: [] }

async function loadStaticPlotFeatureCollection(): Promise<FeatureCollection | null> {
  try {
    const filePath = path.join(process.cwd(), "public", "geojson", "Lo cao su - 2026_Full.geojson")
    const raw = await fs.readFile(filePath, "utf-8")
    return JSON.parse(raw) as FeatureCollection
  } catch {
    return null
  }
}

export async function traceExportOrderGeoChain(
  client: SupabaseClient,
  order: TraceOrderInput,
): Promise<TraceResult> {
  const lotIds = [...new Set(order.assignments.map((a) => a.lot_id))]
  if (!lotIds.length) {
    return {
      resolvedAssignments: order.assignments,
      lotDetails: [],
      extractionDates: {},
      lotCertMap: {},
      diemGn: [],
      geoData: EMPTY_GEO,
      traceInfo: { lots: 0, ngans: 0, tripUids: 0, matchedRows: 0, diemGn: 0, features: 0 },
    }
  }

  // 1. Lấy lots → full details + ngan_ids (tự tra lại theo ma_lo nếu lot_id không resolve)
  const { data: lotsById } = await client
    .from("lots")
    .select("id,factory_id,ma_lo,ngay_sx,loai_banh,kien_a,kien_b,kien_c,kien_d,ngan_id,created_at,updated_at")
    .in("id", lotIds)
  const lotsByIdMap = new Map(((lotsById || []) as TraceLot[]).map((lot) => [lot.id, lot] as const))
  const missingLotCodes = [
    ...new Set(
      order.assignments
        .filter((assignment) => !lotsByIdMap.has(assignment.lot_id))
        .map((assignment) => assignment.ma_lo)
        .filter(Boolean),
    ),
  ]
  const { data: lotsByCode } = missingLotCodes.length
    ? await client
        .from("lots")
        .select("id,factory_id,ma_lo,ngay_sx,loai_banh,kien_a,kien_b,kien_c,kien_d,ngan_id,created_at,updated_at")
        .eq("factory_id", order.factory_id)
        .in("ma_lo", missingLotCodes)
    : { data: [] }
  const canonicalLotsByCode = new Map(
    dedupeLotsByMaLo((lotsByCode || []) as TraceLot[]).map((lot) => [normalizeLotCode(lot.ma_lo), lot] as const),
  )
  const resolvedAssignments = order.assignments.map((assignment) => {
    const resolvedLot = lotsByIdMap.get(assignment.lot_id) || canonicalLotsByCode.get(normalizeLotCode(assignment.ma_lo))
    return resolvedLot ? { ...assignment, lot_id: resolvedLot.id, ma_lo: resolvedLot.ma_lo } : assignment
  })
  const typedLotsMap = new Map<string, TraceLot>()
  resolvedAssignments.forEach((assignment) => {
    const resolvedLot = lotsByIdMap.get(assignment.lot_id) || canonicalLotsByCode.get(normalizeLotCode(assignment.ma_lo))
    if (resolvedLot) typedLotsMap.set(resolvedLot.id, resolvedLot)
  })
  const typedLots = Array.from(typedLotsMap.values())

  if (!typedLots.length) {
    return {
      resolvedAssignments,
      lotDetails: [],
      extractionDates: {},
      lotCertMap: {},
      diemGn: [],
      geoData: EMPTY_GEO,
      traceInfo: { lots: 0, ngans: 0, tripUids: 0, matchedRows: 0, diemGn: 0, features: 0 },
    }
  }

  const nganIds = [...new Set(typedLots.map((lot) => lot.ngan_id).filter((value): value is string => Boolean(value)))]
  if (!nganIds.length) {
    return {
      resolvedAssignments,
      lotDetails: typedLots,
      extractionDates: {},
      lotCertMap: {},
      diemGn: [],
      geoData: EMPTY_GEO,
      traceInfo: { lots: typedLots.length, ngans: 0, tripUids: 0, matchedRows: 0, diemGn: 0, features: 0 },
    }
  }

  // 2. Lấy ngans → trips + chung_nhan
  const { data: ngans } = await client.from("ngans").select("id,trips,chung_nhan,ngay_bd,ngay_kt").in("id", nganIds)
  const typedNgans = (ngans || []) as TraceNgan[]

  const certMap: Record<string, string> = {}
  for (const lot of typedLots) {
    const ngan = typedNgans.find((item) => item.id === lot.ngan_id)
    certMap[lot.id] = ngan?.chung_nhan ?? ""
  }

  const allTripUids = new Set<string>()
  typedNgans.forEach((ngan) => (ngan.trips || []).forEach((uid) => allTripUids.add(uid)))
  if (!allTripUids.size) {
    return {
      resolvedAssignments,
      lotDetails: typedLots,
      extractionDates: {},
      lotCertMap: certMap,
      diemGn: [],
      geoData: EMPTY_GEO,
      traceInfo: { lots: typedLots.length, ngans: nganIds.length, tripUids: 0, matchedRows: 0, diemGn: 0, features: 0 },
    }
  }

  // 3. Resolve trips qua helper dùng chung (chịu được cả ref ổn định lẫn uid token cũ)
  const nganTrips = await Promise.all(
    typedNgans.map(async (ngan) => {
      const trips = await loadDispatchTripsByUids(
        order.factory_id,
        Array.isArray(ngan.trips) ? ngan.trips : [],
        {
          fromDate: typeof ngan.ngay_bd === "string" ? ngan.ngay_bd : undefined,
          toDate: typeof ngan.ngay_kt === "string" ? ngan.ngay_kt : typeof ngan.ngay_bd === "string" ? ngan.ngay_bd : undefined,
        },
        client,
      )
      return [ngan.id as string, trips] as const
    }),
  )
  const tripsByNganId = new Map<string, StorageTripItem[]>(nganTrips)
  const resolvedTrips = [
    ...new Map(nganTrips.flatMap(([, trips]) => trips).map((trip: StorageTripItem) => [trip.ref, trip] as const)).values(),
  ]
  const { data: pointRows } = await client
    .from("dispatch_delivery_points")
    .select("ma_lo, lat, lng, doi, phien_a, phien_b, phien_c, phien_d")
    .eq("factory_id", order.factory_id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("ma_lo", { ascending: true })
  const deliveryPoints = normalizeDeliveryPoints(pointRows) || DIEM_GN

  const extractPlots = (trip: Pick<StorageTripItem, "lo_thu_hoach" | "diem_gn" | "phien">): string[] =>
    trip.lo_thu_hoach.length ? trip.lo_thu_hoach : buildLoThuHoach(trip.diem_gn, trip.phien, deliveryPoints)

  const diemGnSet = new Set<string>()
  let matchedRows = resolvedTrips.length
  for (const trip of resolvedTrips) {
    extractPlots(trip).forEach((code) => diemGnSet.add(code))
  }

  // Fallback cuối: khi trip tokens cũ không resolve được → dùng khoảng ngày ngăn
  let usedDateFallback = false
  if (matchedRows === 0 && allTripUids.size > 0) {
    usedDateFallback = true
    const dispatches = await loadDispatchEntriesWithResolvedRows(client, {
      factoryId: order.factory_id,
      select: "id,ngay,rows",
      ascending: true,
    })
    const today = new Date().toISOString().split("T")[0]
    for (const ngan of typedNgans) {
      if (!ngan.ngay_bd) continue
      const bd = ngan.ngay_bd
      const kt = ngan.ngay_kt || today
      for (const dispatch of dispatches) {
        const dn = String(dispatch.ngay || "")
        if (dn >= bd && dn <= kt) {
          for (const row of dispatch.rows || []) {
            matchedRows++
            const fallbackTrip = {
              lo_thu_hoach: Array.isArray(row.lo_thu_hoach) ? row.lo_thu_hoach.map((item: unknown) => String(item || "")) : [],
              diem_gn: Array.isArray(row.diem_gn) ? row.diem_gn.map((item: unknown) => String(item || "")) : [],
              phien: Array.isArray(row.phien) ? row.phien.map((item: unknown) => String(item || "")) : [],
            }
            extractPlots(fallbackTrip).forEach((c: string) => diemGnSet.add(c))
          }
        }
      }
    }
  }

  // Build extraction date map: lot_id → ngày điều xe sớm nhất của ngăn
  const extractionDates: Record<string, string> = {}
  for (const lot of typedLots) {
    const ngan = typedNgans.find((item) => item.id === lot.ngan_id)
    if (!ngan) continue
    const tripDates = (tripsByNganId.get(ngan.id) || [])
      .map((trip: StorageTripItem) => trip._date)
      .filter(Boolean)
      .sort()
    extractionDates[lot.id] = tripDates[0] || ngan.ngay_bd || ""
  }

  // 4. Lấy polygon lô vườn và ghép metadata đầy đủ từ GeoJSON chuẩn
  const tenList = [...diemGnSet]
  const full = await loadStaticPlotFeatureCollection()
  const staticPlotMap = buildStaticPlotFeatureMap(full)

  const { data: plotRows } = tenList.length
    ? await client
        .from("forest_plots")
        .select("ten, ma_lo_full, geometry, nong_truong, doi, giong, dien_tich_ha, nam_trong, nam_cao_up")
        .eq("factory_id", order.factory_id)
        .eq("is_active", true)
        .in("ten", tenList)
    : { data: null }

  const dbPlotMap = new Map(((plotRows || []) as ForestPlotRow[]).map((plot) => [plot.ten, plot] as const))

  const filteredFeatures = tenList.reduce<FeatureCollection["features"]>((acc, plotCode) => {
    const dbPlot = dbPlotMap.get(plotCode)
    const staticPlot = staticPlotMap.get(plotCode)
    const geometry =
      (dbPlot?.geometry as FeatureCollection["features"][number]["geometry"] | undefined) || staticPlot?.geometry

    if (!geometry) return acc

    acc.push({
      type: "Feature",
      properties: mergePlotProperties(plotCode, dbPlot, staticPlot),
      geometry,
    })

    return acc
  }, [])

  return {
    resolvedAssignments,
    lotDetails: typedLots,
    extractionDates,
    lotCertMap: certMap,
    diemGn: [...diemGnSet],
    geoData: { type: "FeatureCollection", features: filteredFeatures },
    traceInfo: {
      lots: typedLots.length,
      ngans: nganIds.length,
      tripUids: allTripUids.size,
      matchedRows,
      diemGn: diemGnSet.size,
      features: filteredFeatures.length,
      fallback: usedDateFallback,
    },
  }
}
