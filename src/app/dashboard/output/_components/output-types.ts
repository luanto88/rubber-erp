import { buildDispatchTripRef, getKLFromTrip, loadDispatchTripsByUids } from "@/lib/storage-detail"
import { formatDateDisplay, getTodayISODate, normalizeDateInput } from "@/lib/date-utils"

export type WarnCode =
  | "NO_DISPATCH_DATE"
  | "VEHICLE_NOT_FOUND"
  | "CHUYEN_NOT_FOUND"
  | "DOI_MISMATCH"
  | "ZERO_KL"
  | "DUPLICATE_IN_FILE"
  | "DUPLICATE_IN_SYSTEM"
  | "UNKNOWN_NOTE"

export interface ProductionRecord {
  id: string
  factory_id: string
  ngay: string
  doi: number
  so_xe: string
  chuyen: number
  tai_xe: string | null
  mn_tuoi: number; mn_drc: number; mn_kho: number
  ct_tuoi: number; ct_drc: number; ct_kho: number
  dct_tuoi: number; dct_drc: number; dct_kho: number
  dkt_tuoi: number; dkt_drc: number; dkt_kho: number
  dt_tuoi: number; dt_drc: number; dt_kho: number
  dispatch_entry_id: string | null
  warn_codes: WarnCode[]
  import_batch_id: string | null
  ghi_chu: string | null
  created_by: string | null
  nguoi_upload: string | null
  created_at: string
  updated_at: string
}

export interface ParsedSlRow {
  row_index: number
  ngay: string
  doi: number
  base_xe: string
  chuyen: number
  ghi_chu: string
  mn_tuoi: number; mn_drc: number; mn_kho: number
  ct_tuoi: number; ct_drc: number; ct_kho: number
  dct_tuoi: number; dct_drc: number; dct_kho: number
  dkt_tuoi: number; dkt_drc: number; dkt_kho: number
  dt_tuoi: number; dt_drc: number; dt_kho: number
}

export interface MatchedSlRow extends ParsedSlRow {
  dispatch_entry_id: string | null
  tai_xe: string | null
  warn_codes: WarnCode[]
}

export type ProductionRecordInsert = Omit<ProductionRecord, "id" | "created_at" | "updated_at">

export interface OutputSummary {
  doi: number
  so_xe: string
  chuyen: number
  tai_xe: string | null
  tong_tuoi: number
  tong_kho: number
  so_ban_ghi: number
}

export interface OutputFormState {
  ngay: string
  doi: number | ""
  so_xe: string
  chuyen: number | ""
  tai_xe: string
  mn_tuoi: string; mn_drc: string; mn_kho: string
  ct_tuoi: string; ct_drc: string; ct_kho: string
  dct_tuoi: string; dct_drc: string; dct_kho: string
  dkt_tuoi: string; dkt_drc: string; dkt_kho: string
  dt_tuoi: string; dt_drc: string; dt_kho: string
  ghi_chu: string
}

export function emptyOutputForm(): OutputFormState {
  return {
    ngay: getTodayISODate(),
    doi: "",
    so_xe: "",
    chuyen: 1,
    tai_xe: "",
    mn_tuoi: "", mn_drc: "", mn_kho: "",
    ct_tuoi: "", ct_drc: "", ct_kho: "",
    dct_tuoi: "", dct_drc: "", dct_kho: "",
    dkt_tuoi: "", dkt_drc: "", dkt_kho: "",
    dt_tuoi: "", dt_drc: "", dt_kho: "",
    ghi_chu: "",
  }
}

export function parseVehicleCode(raw: string): { base_xe: string; chuyen: number } {
  const s = raw.trim().toUpperCase().replace(/^0+(\d)/, "$1")
  const m = s.match(/^(\d+[A-Z]+)(\d+)?$/)
  if (!m) return { base_xe: s, chuyen: 1 }
  return { base_xe: m[1], chuyen: m[2] ? parseInt(m[2]) : 1 }
}

export function buildProductionRecordKey(input: {
  ngay: string
  doi: number
  so_xe: string
  chuyen: number
}) {
  return `${normalizeDateInput(input.ngay)}__${input.doi}__${input.so_xe.trim().toUpperCase()}__${input.chuyen}`
}

export function totalTuoi(r: Pick<ProductionRecord, "mn_tuoi"|"ct_tuoi"|"dct_tuoi"|"dkt_tuoi"|"dt_tuoi">): number {
  return (r.mn_tuoi ?? 0) + (r.ct_tuoi ?? 0) + (r.dct_tuoi ?? 0) + (r.dkt_tuoi ?? 0) + (r.dt_tuoi ?? 0)
}

export function totalKho(r: Pick<ProductionRecord, "mn_kho"|"ct_kho"|"dct_kho"|"dkt_kho"|"dt_kho">): number {
  return (r.mn_kho ?? 0) + (r.ct_kho ?? 0) + (r.dct_kho ?? 0) + (r.dkt_kho ?? 0) + (r.dt_kho ?? 0)
}

export const WARN_LABELS: Record<string, string> = {
  NO_DISPATCH_DATE: "Không có bảng điều xe ngày này",
  VEHICLE_NOT_FOUND: "Xe không có trong điều xe",
  CHUYEN_NOT_FOUND: "Không tìm thấy chuyến này trong điều xe",
  DOI_MISMATCH: "Đội không khớp điểm giao nhận",
  ZERO_KL: "Tất cả KL bằng 0",
  DUPLICATE_IN_FILE: "Trùng xe+chuyến trong cùng file",
}

export const WARN_SEVERITY: Record<string, "red" | "amber" | "slate"> = {
  NO_DISPATCH_DATE: "red",
  VEHICLE_NOT_FOUND: "red",
  CHUYEN_NOT_FOUND: "amber",
  DOI_MISMATCH: "amber",
  ZERO_KL: "slate",
  DUPLICATE_IN_FILE: "amber",
}

WARN_LABELS.DUPLICATE_IN_SYSTEM = "Đã có sản lượng trùng trong hệ thống"
WARN_SEVERITY.DUPLICATE_IN_SYSTEM = "amber"

WARN_LABELS.UNKNOWN_NOTE = "Ghi chú lạ — chưa có trong danh mục"
WARN_SEVERITY.UNKNOWN_NOTE = "red"

// 2 mã DUY NHẤT thực sự chặn import (throw Error trong handleConfirm), khác với phần còn
// lại của warn_codes vốn chỉ là thông tin tham khảo, không chặn nghiệp vụ (xem
// .claude/rules/15-output-module.md). DUPLICATE_IN_FILE chặn toàn bộ file (lỗi cấu trúc,
// không thể bỏ qua từng dòng); UNKNOWN_NOTE chặn theo từng dòng, có thể "Nhập phần hợp lệ,
// bỏ qua phần lỗi" ở bước xem trước.
export const BLOCKING_WARN_CODES: ReadonlySet<WarnCode> = new Set(["DUPLICATE_IN_FILE", "UNKNOWN_NOTE"])

type DispatchKg = {
  mn_tuoi: number
  mn_kho: number
  ct_tuoi: number
  ct_kho: number
  dct_tuoi: number
  dct_kho: number
  dkt_tuoi: number
  dkt_kho: number
  dt_tuoi: number
  dt_kho: number
}

const ZERO_KG: DispatchKg = {
  mn_tuoi: 0,
  mn_kho: 0,
  ct_tuoi: 0,
  ct_kho: 0,
  dct_tuoi: 0,
  dct_kho: 0,
  dkt_tuoi: 0,
  dkt_kho: 0,
  dt_tuoi: 0,
  dt_kho: 0,
}

async function syncStorageTotalsFromTripUids(
  factoryId: string,
  tripRefs: string[],
  supabase: import("@supabase/supabase-js").SupabaseClient,
) {
  const uniqueUids = [...new Set(tripRefs.filter(Boolean))]
  if (uniqueUids.length === 0) return

  const { data: ngans, error: ngansError } = await supabase
    .from("ngans")
    .select("id, loai_nl, trips")
    .eq("factory_id", factoryId)

  if (ngansError) throw new Error(ngansError.message)

  const affected = (ngans ?? []).filter((ngan: { trips?: string[] }) =>
    (ngan.trips ?? []).some((uid) => uniqueUids.includes(uid)),
  )
  if (affected.length === 0) return

  const allTripUids = [...new Set(affected.flatMap((ngan: { trips?: string[] }) => ngan.trips ?? []))]
  const trips = await loadDispatchTripsByUids(factoryId, allTripUids)
  const tripMap = new Map(trips.map((trip) => [trip.ref, trip] as const))

  await Promise.all(
    affected.map(async (ngan: { id: string; loai_nl: string; trips?: string[] }) => {
      let tong_tuoi = 0
      let tong_kho = 0
      for (const uid of ngan.trips ?? []) {
        const trip = tripMap.get(uid)
        if (!trip) continue
        const kl = getKLFromTrip(trip, ngan.loai_nl)
        tong_tuoi += kl.tuoi
        tong_kho += kl.kho
      }
      const { error } = await supabase
        .from("ngans")
        .update({
          tong_tuoi: Math.round(tong_tuoi * 100) / 100,
          tong_kho: Math.round(tong_kho * 100) / 100,
        })
        .eq("id", ngan.id)
      if (error) throw new Error(error.message)
    }),
  )
}

export async function writeBackToDispatch(
  factoryId: string,
  ngay: string,
  supabase: import("@supabase/supabase-js").SupabaseClient,
): Promise<void> {
  const normalizedNgay = normalizeDateInput(ngay)
  if (!normalizedNgay) {
    throw new Error(`Ngày không hợp lệ: ${formatDateDisplay(ngay) || ngay}`)
  }

  const { data: prods, error: prodsError } = await supabase
    .from("production_records")
    .select("so_xe,chuyen,mn_tuoi,mn_kho,ct_tuoi,ct_kho,dct_tuoi,dct_kho,dkt_tuoi,dkt_kho,dt_tuoi,dt_kho")
    .eq("factory_id", factoryId)
    .eq("ngay", normalizedNgay)

  if (prodsError) throw new Error(prodsError.message)

  const groups = new Map<string, DispatchKg>()
  for (const p of (prods ?? []) as Array<Record<string, number>>) {
    const key = `${p.so_xe}:${p.chuyen}`
    const g = groups.get(key) ?? { ...ZERO_KG }
    g.mn_tuoi += p.mn_tuoi ?? 0; g.mn_kho += p.mn_kho ?? 0
    g.ct_tuoi += p.ct_tuoi ?? 0; g.ct_kho += p.ct_kho ?? 0
    g.dct_tuoi += p.dct_tuoi ?? 0; g.dct_kho += p.dct_kho ?? 0
    g.dkt_tuoi += p.dkt_tuoi ?? 0; g.dkt_kho += p.dkt_kho ?? 0
    g.dt_tuoi += p.dt_tuoi ?? 0; g.dt_kho += p.dt_kho ?? 0
    groups.set(key, g)
  }

  const { data: entries, error: entriesError } = await supabase
    .from("dispatch_entries")
    .select("id,ngay,rows")
    .eq("factory_id", factoryId)

  if (entriesError) throw new Error(entriesError.message)
  if (!entries?.length) return

  const fmt = (n: number) => String(Math.round(n * 100) / 100)
  const wdrc = (kho: number, tuoi: number) => tuoi > 0 ? String(Math.round(kho / tuoi * 10000) / 100) : "0"
  const buildDispatchPayload = (g: DispatchKg) => ({
    kl_mn: fmt(g.mn_tuoi), kl_mnk: fmt(g.mn_kho), drc_mn: wdrc(g.mn_kho, g.mn_tuoi),
    kl_ct: fmt(g.ct_tuoi), kl_ck: fmt(g.ct_kho), drc_c: wdrc(g.ct_kho, g.ct_tuoi),
    kl_dct: fmt(g.dct_tuoi), kl_dck: fmt(g.dct_kho), drc_dc: wdrc(g.dct_kho, g.dct_tuoi),
    kl_dkt: fmt(g.dkt_tuoi), kl_dkk: fmt(g.dkt_kho), drc_dk: wdrc(g.dkt_kho, g.dkt_tuoi),
    kl_dt: fmt(g.dt_tuoi), kl_dk: fmt(g.dt_kho), drc_d: wdrc(g.dt_kho, g.dt_tuoi),
  })

  const affectedTripUids = new Set<string>()

  await Promise.all(
    (entries as Array<{ id: string; ngay: string; rows?: Array<Record<string, unknown>> }>).map(async (entry) => {
      const nextRows = (entry.rows ?? []).map((row) => {
        const rowDate = normalizeDateInput(String(row._date ?? entry.ngay))
        if (rowDate !== normalizedNgay) return row
        const key = `${parseVehicleCode(String(row.so_xe ?? "")).base_xe}:${Number(row.chuyen ?? 1)}`
        const next = {
          ...(row as Record<string, unknown>),
          ...buildDispatchPayload(groups.get(key) ?? ZERO_KG),
          _date: rowDate,
        } as Record<string, unknown>
        const uid = String(next.uid ?? "")
        const ref = buildDispatchTripRef({
          dispatchEntryId: entry.id,
          rowId: String(next.row_id ?? next.uid ?? ""),
          uid,
        })
        if (ref) affectedTripUids.add(ref)
        if (uid) affectedTripUids.add(uid)
        return next
      })

      const { error } = await supabase
        .from("dispatch_entries")
        .update({ rows: nextRows })
        .eq("id", entry.id)

      if (error) throw new Error(error.message)
    }),
  )

  if (affectedTripUids.size > 0) {
    await syncStorageTotalsFromTripUids(factoryId, [...affectedTripUids], supabase)
  }
}
