import type { LegacyDispatchRow } from "@/lib/dispatch-entry-rows"
import type { DiemGN } from "@/lib/dispatch-master"
import { matchesNoteFilter } from "@/lib/note-filter"

export type DispatchAnalyticsEntry = {
  id: string
  ngay: string
  ma_dx?: string
  day_chuyen?: string
  chung_nhan?: string
  rows?: LegacyDispatchRow[]
}

export type DispatchMaterialTotals = {
  mnTuoi: number
  mnKho: number
  ctTuoi: number
  ctKho: number
  dctTuoi: number
  dctKho: number
  dktTuoi: number
  dktKho: number
  dtTuoi: number
  dtKho: number
}

export type DispatchFlatTrip = LegacyDispatchRow & {
  entryId: string
  maDx?: string
  ngay: string
  dayChuyen?: string
  chungNhan?: string
  dois: number[]
  totalTuoi: number
  totalKho: number
  totalKm: number
}

export type DispatchGroupSummary = DispatchMaterialTotals & {
  key: string
  label: string
  trips: number
  vehicles: Set<string>
  drivers: Set<string>
  km: number
  totalTuoi: number
  totalKho: number
}

export type DispatchAnalytics = {
  trips: DispatchFlatTrip[]
  totals: {
    entries: number
    trips: number
    vehicles: number
    drivers: number
    km: number
    totalTuoi: number
    totalKho: number
  } & DispatchMaterialTotals
  byDoi: DispatchGroupSummary[]
  byVehicle: DispatchGroupSummary[]
}

export const DISPATCH_MATERIAL_OPTIONS = [
  "Mủ nước",
  "Mủ chén",
  "Mủ đông chén",
  "Mủ đông khối",
  "Mủ dây",
] as const

export type DispatchMaterialOption = typeof DISPATCH_MATERIAL_OPTIONS[number]

const emptyMaterials = (): DispatchMaterialTotals => ({
  mnTuoi: 0,
  mnKho: 0,
  ctTuoi: 0,
  ctKho: 0,
  dctTuoi: 0,
  dctKho: 0,
  dktTuoi: 0,
  dktKho: 0,
  dtTuoi: 0,
  dtKho: 0,
})

const num = (value: unknown) => {
  const parsed = Number.parseFloat(String(value ?? ""))
  return Number.isFinite(parsed) ? parsed : 0
}

export function formatKg(value: number) {
  return Math.round(value).toLocaleString("vi-VN")
}

export function formatTon(value: number, digits = 1) {
  return (value / 1000).toLocaleString("vi-VN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function formatKm(value: number) {
  return value.toLocaleString("vi-VN", { maximumFractionDigits: 1 })
}

export function formatDateVi(value?: string | null) {
  if (!value) return "-"
  const iso = value.includes("/") ? value.split("/").reverse().join("-") : value
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString("vi-VN")
}

export function getTripDois(row: Pick<LegacyDispatchRow, "diem_gn" | "doi">, deliveryPoints: DiemGN[]) {
  if (Array.isArray(row.doi) && row.doi.length > 0) return [...new Set(row.doi)].sort((a, b) => a - b)
  return [...new Set((row.diem_gn || [])
    .map((pointCode) => deliveryPoints.find((point) => point.ma_lo === pointCode)?.doi || 0)
    .filter((doi) => doi > 0))]
    .sort((a, b) => a - b)
}

export function getTripMaterials(row: LegacyDispatchRow): DispatchMaterialTotals {
  return {
    mnTuoi: num(row.kl_mn),
    mnKho: num(row.kl_mnk),
    ctTuoi: num(row.kl_ct),
    ctKho: num(row.kl_ck),
    dctTuoi: num(row.kl_dct),
    dctKho: num(row.kl_dck),
    dktTuoi: num(row.kl_dkt),
    dktKho: num(row.kl_dkk),
    dtTuoi: num(row.kl_dt),
    dtKho: num(row.kl_dk),
  }
}

export function getTripTotals(row: LegacyDispatchRow) {
  const materials = getTripMaterials(row)
  const totalTuoi = materials.mnTuoi + materials.ctTuoi + materials.dctTuoi + materials.dktTuoi + materials.dtTuoi
  const totalKho = materials.mnKho + materials.ctKho + materials.dctKho + materials.dktKho + materials.dtKho
  return { materials, totalTuoi, totalKho }
}

export function getTripMaterialFlags(row: LegacyDispatchRow) {
  const materials = getTripMaterials(row)
  return {
    "Mủ nước": materials.mnTuoi > 0 || materials.mnKho > 0,
    "Mủ chén": materials.ctTuoi > 0 || materials.ctKho > 0,
    "Mủ đông chén": materials.dctTuoi > 0 || materials.dctKho > 0,
    "Mủ đông khối": materials.dktTuoi > 0 || materials.dktKho > 0,
    "Mủ dây": materials.dtTuoi > 0 || materials.dtKho > 0,
  } as const
}

function addMaterials(target: DispatchMaterialTotals, source: DispatchMaterialTotals) {
  target.mnTuoi += source.mnTuoi
  target.mnKho += source.mnKho
  target.ctTuoi += source.ctTuoi
  target.ctKho += source.ctKho
  target.dctTuoi += source.dctTuoi
  target.dctKho += source.dctKho
  target.dktTuoi += source.dktTuoi
  target.dktKho += source.dktKho
  target.dtTuoi += source.dtTuoi
  target.dtKho += source.dtKho
}

function makeSummary(key: string, label: string): DispatchGroupSummary {
  return {
    key,
    label,
    trips: 0,
    vehicles: new Set<string>(),
    drivers: new Set<string>(),
    km: 0,
    totalTuoi: 0,
    totalKho: 0,
    ...emptyMaterials(),
  }
}

function addTrip(summary: DispatchGroupSummary, trip: DispatchFlatTrip) {
  summary.trips += 1
  if (trip.so_xe) summary.vehicles.add(trip.so_xe)
  if (trip.tai_xe) summary.drivers.add(trip.tai_xe)
  summary.km += trip.totalKm
  summary.totalTuoi += trip.totalTuoi
  summary.totalKho += trip.totalKho
  addMaterials(summary, getTripMaterials(trip))
}

export function buildDispatchAnalytics(
  entries: DispatchAnalyticsEntry[],
  deliveryPoints: DiemGN[],
  filters?: { dois?: string[]; vehicles?: string[]; note?: string; materials?: string[] },
): DispatchAnalytics {
  const vehicleFilters = new Set((filters?.vehicles || []).map((v) => v.trim().toLowerCase()).filter(Boolean))
  const doiFilters = (filters?.dois || []).map(Number).filter((d) => Number.isFinite(d) && d > 0)
  const noteFilter = (filters?.note || "").trim()
  const selectedMaterials = filters?.materials || []
  const trips: DispatchFlatTrip[] = []
  const vehicles = new Set<string>()
  const drivers = new Set<string>()
  const totals = {
    entries: entries.length,
    trips: 0,
    vehicles: 0,
    drivers: 0,
    km: 0,
    totalTuoi: 0,
    totalKho: 0,
    ...emptyMaterials(),
  }

  for (const entry of entries) {
    for (const row of entry.rows || []) {
      const dois = getTripDois(row, deliveryPoints)
      if (!matchesNoteFilter(row.ghi_chu, noteFilter)) continue
      if (doiFilters.length > 0 && !dois.some((d) => doiFilters.includes(d))) continue
      if (vehicleFilters.size > 0 && !vehicleFilters.has((row.so_xe || "").toLowerCase())) continue
      if (selectedMaterials.length > 0) {
        const flags = getTripMaterialFlags(row)
        if (!selectedMaterials.some((material) => flags[material as DispatchMaterialOption])) continue
      }

      const { materials, totalTuoi, totalKho } = getTripTotals(row)
      const trip: DispatchFlatTrip = {
        ...row,
        entryId: entry.id,
        maDx: entry.ma_dx,
        ngay: entry.ngay,
        dayChuyen: entry.day_chuyen,
        chungNhan: entry.chung_nhan,
        dois,
        totalTuoi,
        totalKho,
        totalKm: num(row.so_km),
      }
      trips.push(trip)
      totals.trips += 1
      totals.km += trip.totalKm
      totals.totalTuoi += totalTuoi
      totals.totalKho += totalKho
      addMaterials(totals, materials)
      if (row.so_xe) vehicles.add(row.so_xe)
      if (row.tai_xe) drivers.add(row.tai_xe)
    }
  }

  totals.vehicles = vehicles.size
  totals.drivers = drivers.size

  const byDoiMap = new Map<string, DispatchGroupSummary>()
  const byVehicleMap = new Map<string, DispatchGroupSummary>()

  for (const trip of trips) {
    const dois = trip.dois.length > 0 ? trip.dois : [0]
    for (const doi of dois) {
      const key = String(doi || "Khác")
      const summary = byDoiMap.get(key) || makeSummary(key, doi ? `Đội ${doi}` : "Chưa rõ đội")
      addTrip(summary, trip)
      byDoiMap.set(key, summary)
    }

    const vehicleKey = trip.so_xe || "Chưa rõ xe"
    const vehicleSummary = byVehicleMap.get(vehicleKey) || makeSummary(vehicleKey, vehicleKey)
    addTrip(vehicleSummary, trip)
    byVehicleMap.set(vehicleKey, vehicleSummary)
  }

  const byDoi = [...byDoiMap.values()].sort((a, b) => b.totalKho - a.totalKho)
  const byVehicle = [...byVehicleMap.values()].sort((a, b) => b.km - a.km)

  return { trips, totals, byDoi, byVehicle }
}
