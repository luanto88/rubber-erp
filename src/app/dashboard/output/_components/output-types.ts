import { toISODate } from "@/lib/dispatch-entry-rows"

export type WarnCode =
  | "NO_DISPATCH_DATE"
  | "VEHICLE_NOT_FOUND"
  | "CHUYEN_NOT_FOUND"
  | "DOI_MISMATCH"
  | "ZERO_KL"
  | "DUPLICATE_IN_FILE"
  | "DUPLICATE_IN_SYSTEM"

export interface ProductionRecord {
  id: string
  factory_id: string
  ngay: string           // ISO "YYYY-MM-DD"
  doi: number
  so_xe: string          // base vehicle code, e.g. "1A"
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
  created_at: string
  updated_at: string
}

// Dòng đã parse từ Excel, trước khi match dispatch
export interface ParsedSlRow {
  row_index: number      // vị trí dòng trong file (để báo lỗi)
  ngay: string           // ISO date
  doi: number
  base_xe: string        // after parseVehicleCode
  chuyen: number
  ghi_chu: string
  mn_tuoi: number; mn_drc: number; mn_kho: number
  ct_tuoi: number; ct_drc: number; ct_kho: number
  dct_tuoi: number; dct_drc: number; dct_kho: number
  dkt_tuoi: number; dkt_drc: number; dkt_kho: number
  dt_tuoi: number; dt_drc: number; dt_kho: number
}

// Sau khi chạy matching
export interface MatchedSlRow extends ParsedSlRow {
  dispatch_entry_id: string | null
  tai_xe: string | null
  warn_codes: WarnCode[]
}

// Dạng upsert gửi lên Supabase
export type ProductionRecordInsert = Omit<ProductionRecord, "id" | "created_at" | "updated_at">

// Tổng hợp KL cho thống kê
export interface OutputSummary {
  doi: number
  so_xe: string
  chuyen: number
  tai_xe: string | null
  tong_tuoi: number
  tong_kho: number
  so_ban_ghi: number
}

// Dùng trong form thêm/sửa thủ công
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
    ngay: new Date().toISOString().slice(0, 10),
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

// Parse mã xe trong file: "1A" → {base_xe:"1A", chuyen:1}, "1A2" → {base_xe:"1A", chuyen:2}
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
  return `${input.ngay}__${input.doi}__${input.so_xe.trim().toUpperCase()}__${input.chuyen}`
}

// Tổng KL tươi của một record
export function totalTuoi(r: Pick<ProductionRecord, "mn_tuoi"|"ct_tuoi"|"dct_tuoi"|"dkt_tuoi"|"dt_tuoi">): number {
  return (r.mn_tuoi ?? 0) + (r.ct_tuoi ?? 0) + (r.dct_tuoi ?? 0) + (r.dkt_tuoi ?? 0) + (r.dt_tuoi ?? 0)
}

// Tổng KL khô của một record
export function totalKho(r: Pick<ProductionRecord, "mn_kho"|"ct_kho"|"dct_kho"|"dkt_kho"|"dt_kho">): number {
  return (r.mn_kho ?? 0) + (r.ct_kho ?? 0) + (r.dct_kho ?? 0) + (r.dkt_kho ?? 0) + (r.dt_kho ?? 0)
}

export const WARN_LABELS: Record<string, string> = {
  NO_DISPATCH_DATE:  "Không có bảng điều xe ngày này",
  VEHICLE_NOT_FOUND: "Xe không có trong điều xe",
  CHUYEN_NOT_FOUND:  "Không tìm thấy chuyến này trong điều xe",
  DOI_MISMATCH:      "Đội không khớp điểm giao nhận",
  ZERO_KL:           "Tất cả KL bằng 0",
  DUPLICATE_IN_FILE: "Trùng xe+chuyến trong cùng file",
}

export const WARN_SEVERITY: Record<string, "red" | "amber" | "slate"> = {
  NO_DISPATCH_DATE:  "red",
  VEHICLE_NOT_FOUND: "red",
  CHUYEN_NOT_FOUND:  "amber",
  DOI_MISMATCH:      "amber",
  ZERO_KL:           "slate",
  DUPLICATE_IN_FILE: "amber",
}

WARN_LABELS.DUPLICATE_IN_SYSTEM = "Da co san luong trung trong he thong"
WARN_SEVERITY.DUPLICATE_IN_SYSTEM = "amber"

// Ánh xạ kl_* của dispatch row sang tươi/khô theo loại nguyên liệu (đồng bộ với storage page)
function getNganKL(row: Record<string, number>, loai_nl: string): { tuoi: number; kho: number } {
  switch (loai_nl) {
    case "Mủ chén":      return { tuoi: row.kl_ct,  kho: row.kl_ck }
    case "Mủ đông chén": return { tuoi: row.kl_dct, kho: row.kl_dck }
    case "Mủ đông khối": return { tuoi: row.kl_dkt, kho: row.kl_dkk }
    case "Mủ dây":       return { tuoi: row.kl_dt,  kho: row.kl_dk }
    case "Mủ nước":      return { tuoi: row.kl_mn,  kho: row.kl_mnk }
    default:             return { tuoi: 0, kho: 0 }
  }
}

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

// ── Write-back tổng hợp KL từ production_records → dispatch_entries.rows[] ──
// Gọi sau khi import hoặc lưu/xóa thủ công để dispatch luôn phản ánh sản lượng thực tế.
export async function writeBackToDispatch(
  factoryId: string,
  ngay: string,
  supabase: import("@supabase/supabase-js").SupabaseClient
): Promise<void> {
  // 1. Tổng hợp production_records theo (so_xe, chuyen), cộng qua tất cả doi
  const { data: prods } = await supabase
    .from("production_records")
    .select("so_xe,chuyen,mn_tuoi,mn_kho,ct_tuoi,ct_kho,dct_tuoi,dct_kho,dkt_tuoi,dkt_kho,dt_tuoi,dt_kho")
    .eq("factory_id", factoryId)
    .eq("ngay", ngay)

  const groups = new Map<string, DispatchKg>()
  for (const p of prods as Array<Record<string, number>>) {
    const key = `${p.so_xe}:${p.chuyen}`
    const g = groups.get(key) ?? { ...ZERO_KG }
    g.mn_tuoi  += p.mn_tuoi  ?? 0; g.mn_kho  += p.mn_kho  ?? 0
    g.ct_tuoi  += p.ct_tuoi  ?? 0; g.ct_kho  += p.ct_kho  ?? 0
    g.dct_tuoi += p.dct_tuoi ?? 0; g.dct_kho += p.dct_kho ?? 0
    g.dkt_tuoi += p.dkt_tuoi ?? 0; g.dkt_kho += p.dkt_kho ?? 0
    g.dt_tuoi  += p.dt_tuoi  ?? 0; g.dt_kho  += p.dt_kho  ?? 0
    groups.set(key, g)
  }

  // 2. Tìm dispatch_entries cho ngày đó (hỗ trợ cả 2 format ngày)
  const ddmm = `${ngay.slice(8)}/${ngay.slice(5, 7)}/${ngay.slice(0, 4)}`
  const { data: entries } = await supabase
    .from("dispatch_entries")
    .select("id, rows")
    .eq("factory_id", factoryId)
    .or(`ngay.eq.${ngay},ngay.eq.${ddmm}`)
  if (!entries?.length) return

  // 3. Ghi ngược KL vào các dispatch row khớp xe + chuyến
  const fmt = (n: number) => String(Math.round(n * 100) / 100)
  const wdrc = (kho: number, tuoi: number) => tuoi > 0 ? String(Math.round(kho / tuoi * 10000) / 100) : "0"
  const buildDispatchPayload = (g: DispatchKg) => ({
    kl_mn:  fmt(g.mn_tuoi),  kl_mnk: fmt(g.mn_kho),  drc_mn: wdrc(g.mn_kho,  g.mn_tuoi),
    kl_ct:  fmt(g.ct_tuoi),  kl_ck:  fmt(g.ct_kho),  drc_c:  wdrc(g.ct_kho,  g.ct_tuoi),
    kl_dct: fmt(g.dct_tuoi), kl_dck: fmt(g.dct_kho), drc_dc: wdrc(g.dct_kho, g.dct_tuoi),
    kl_dkt: fmt(g.dkt_tuoi), kl_dkk: fmt(g.dkt_kho), drc_dk: wdrc(g.dkt_kho, g.dkt_tuoi),
    kl_dt:  fmt(g.dt_tuoi),  kl_dk:  fmt(g.dt_kho),  drc_d:  wdrc(g.dt_kho,  g.dt_tuoi),
  })

  for (const entry of entries as Array<{ id: string; rows: Array<Record<string, unknown>> }>) {
    let changed = false
    const newRows = (entry.rows ?? []).map(row => {
      const dxSoXe = parseVehicleCode(String(row.so_xe ?? "")).base_xe
      const dxChuyen = Number(row.chuyen ?? 1)
      const key = `${dxSoXe}:${dxChuyen}`
      const nextPayload = buildDispatchPayload(groups.get(key) ?? ZERO_KG)
      const samePayload =
        String(row.kl_mn ?? "0") === nextPayload.kl_mn &&
        String(row.kl_mnk ?? "0") === nextPayload.kl_mnk &&
        String(row.drc_mn ?? "0") === nextPayload.drc_mn &&
        String(row.kl_ct ?? "0") === nextPayload.kl_ct &&
        String(row.kl_ck ?? "0") === nextPayload.kl_ck &&
        String(row.drc_c ?? "0") === nextPayload.drc_c &&
        String(row.kl_dct ?? "0") === nextPayload.kl_dct &&
        String(row.kl_dck ?? "0") === nextPayload.kl_dck &&
        String(row.drc_dc ?? "0") === nextPayload.drc_dc &&
        String(row.kl_dkt ?? "0") === nextPayload.kl_dkt &&
        String(row.kl_dkk ?? "0") === nextPayload.kl_dkk &&
        String(row.drc_dk ?? "0") === nextPayload.drc_dk &&
        String(row.kl_dt ?? "0") === nextPayload.kl_dt &&
        String(row.kl_dk ?? "0") === nextPayload.kl_dk &&
        String(row.drc_d ?? "0") === nextPayload.drc_d
      if (samePayload) return row
      changed = true
      return {
        ...row,
        ...nextPayload,
      }
    })
    if (changed) {
      await supabase.from("dispatch_entries").update({ rows: newRows }).eq("id", entry.id)
    }
  }

  const entryIds = (entries as Array<{ id: string }>).map(entry => entry.id)
  if (entryIds.length > 0) {
    const { data: physicalRows } = await supabase
      .from("dispatch_entry_rows")
      .select("id, so_xe, chuyen")
      .eq("factory_id", factoryId)
      .eq("ngay", toISODate(ngay))
      .in("dispatch_entry_id", entryIds)

    await Promise.all((physicalRows ?? []).map(async (row: { id: string; so_xe: string; chuyen: number }) => {
      const key = `${parseVehicleCode(String(row.so_xe ?? "")).base_xe}:${Number(row.chuyen ?? 1)}`
      await supabase
        .from("dispatch_entry_rows")
        .update(buildDispatchPayload(groups.get(key) ?? ZERO_KG))
        .eq("id", row.id)
        .eq("factory_id", factoryId)
    }))
  }

  // 4. Đồng bộ KL ngăn lưu — cập nhật tong_tuoi/tong_kho cho ngăn có chuyến từ ngày này
  const uidsThisDate = new Set<string>()
  for (const entry of entries as Array<{ rows: Array<Record<string, unknown>> }>) {
    for (const row of entry.rows ?? []) {
      const uid = String(row.uid ?? "")
      if (uid) uidsThisDate.add(uid)
    }
  }
  if (!uidsThisDate.size) return

  const { data: ngans } = await supabase
    .from("ngans")
    .select("id, loai_nl, trips")
    .eq("factory_id", factoryId)

  const affected = (ngans ?? []).filter((n: { trips?: string[] }) =>
    (n.trips ?? []).some((uid: string) => uidsThisDate.has(uid))
  )
  if (!affected.length) return

  // Gom tất cả uid của các ngăn bị ảnh hưởng (bao gồm cả ngày khác trong cùng ngăn)
  const allUids = new Set<string>()
  for (const n of affected) for (const uid of (n as { trips?: string[] }).trips ?? []) allUids.add(uid)

  // Load toàn bộ dispatch để build uid→KL map (sau khi đã update ở bước 3, DB đã có giá trị mới)
  const { data: allDx } = await supabase
    .from("dispatch_entries")
    .select("rows")
    .eq("factory_id", factoryId)

  const uidKL = new Map<string, Record<string, number>>()
  for (const d of allDx ?? []) {
    for (const row of (d.rows ?? []) as Array<Record<string, string | number>>) {
      const uid = String(row.uid ?? "")
      if (allUids.has(uid)) {
        uidKL.set(uid, {
          kl_mn:  +row.kl_mn  || 0, kl_mnk: +row.kl_mnk || 0,
          kl_ct:  +row.kl_ct  || 0, kl_ck:  +row.kl_ck  || 0,
          kl_dct: +row.kl_dct || 0, kl_dck: +row.kl_dck || 0,
          kl_dkt: +row.kl_dkt || 0, kl_dkk: +row.kl_dkk || 0,
          kl_dt:  +row.kl_dt  || 0, kl_dk:  +row.kl_dk  || 0,
        })
      }
    }
  }

  await Promise.all(
    (affected as Array<{ id: string; loai_nl: string; trips?: string[] }>).map(async ngan => {
      let tong_tuoi = 0, tong_kho = 0
      for (const uid of ngan.trips ?? []) {
        const kl = uidKL.get(uid)
        if (!kl) continue
        const { tuoi, kho } = getNganKL(kl, ngan.loai_nl)
        tong_tuoi += tuoi
        tong_kho += kho
      }
      await supabase.from("ngans").update({ tong_tuoi, tong_kho }).eq("id", ngan.id)
    })
  )
}
