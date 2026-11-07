// SERVER-ONLY (service role) — tra token QR thiết bị, dữ liệu công khai và lịch sử bảo trì.
// Không import từ component client. Kế hoạch: docs/qr-equipment-plan.md
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { fetchAllPaginated } from "@/lib/supabase-helpers"
import {
  isEquipmentQrToken,
  normalizeMaterialName,
  type EquipmentHistoryMaterial,
  type EquipmentMaterialGroup,
  type EquipmentMaterialOccurrence,
  type EquipmentMaterialSort,
  type EquipmentHistoryRecord,
  type EquipmentPublicInfo,
  type EquipmentVehicleInfo,
  type EquipmentViewer,
} from "@/lib/equipment-qr"
import {
  OUTPUT_LABEL,
  outputKindForAsset,
  outputKindForVehicle,
  type EquipmentOutputKind,
  type EquipmentStatsEvent,
  type EquipmentStatsMaterialOption,
  type EquipmentStatsResponse,
} from "@/lib/equipment-stats"
import { getFactoryTodayISO } from "@/lib/date-utils"

const CHUNK = 200
/** Biên bản hiện cho người đã đăng nhập — bỏ "huy" và "tu_choi" (dữ liệu cũ). */
const HISTORY_STATUSES = ["da_duyet", "cho_duyet"]

/** Đích của tem QR: 1 máy móc (`maintenance_assets`) HOẶC 1 xe Đội xe (`dispatch_vehicles`, GĐ4a). */
export type EquipmentTarget = { factoryId: string } & ({ assetId: string } | { vehicleId: string })

export function isVehicleTarget(t: EquipmentTarget): t is { factoryId: string; vehicleId: string } {
  return "vehicleId" in t
}

/** Token còn hiệu lực → thiết bị / xe. Token sai hình thức / không tồn tại / đã thu hồi ⇒ null (cùng 1 kết quả). */
export async function resolveEquipmentToken(token: string): Promise<EquipmentTarget | null> {
  if (!isEquipmentQrToken(token)) return null
  const { data, error } = await getSupabaseAdmin()
    .from("equipment_qr_tokens")
    .select("factory_id, asset_id, dispatch_vehicle_id, revoked_at")
    .eq("token", token)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data || data.revoked_at) return null
  const factoryId = data.factory_id as string
  if (data.asset_id) return { factoryId, assetId: data.asset_id as string }
  if (data.dispatch_vehicle_id) return { factoryId, vehicleId: data.dispatch_vehicle_id as string }
  return null
}

/** Thông tin chung của máy móc / xe. Xe: mã = `code`, tên = `name`, bộ phận luôn "Đội xe". */
type EntityRow = {
  ma_tb: string
  ten_tb: string
  loai: "may_moc" | "xe"
  bo_phan: string
  active: boolean
  vehicle_type: string | null
  plate_number: string | null
}

async function loadEntity(target: EquipmentTarget): Promise<EntityRow | null> {
  const admin = getSupabaseAdmin()
  if (isVehicleTarget(target)) {
    const { data, error } = await admin
      .from("dispatch_vehicles")
      .select("code, name, vehicle_type, plate_number, is_active")
      .eq("id", target.vehicleId)
      .eq("factory_id", target.factoryId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return null
    return {
      ma_tb: (data.code as string) || "",
      ten_tb: (data.name as string) || (data.code as string) || "",
      loai: "xe",
      bo_phan: "Đội xe",
      active: data.is_active !== false,
      vehicle_type: (data.vehicle_type as string | null) || null,
      plate_number: (data.plate_number as string | null) || null,
    }
  }
  const { data, error } = await admin
    .from("maintenance_assets")
    .select("ma_tb, ten_tb, loai, bo_phan, trang_thai")
    .eq("id", target.assetId)
    .eq("factory_id", target.factoryId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  return {
    ma_tb: data.ma_tb as string,
    ten_tb: data.ten_tb as string,
    loai: data.loai === "xe" ? "xe" : "may_moc",
    bo_phan: data.bo_phan as string,
    active: data.trang_thai === "active",
    vehicle_type: null,
    plate_number: null,
  }
}

/** Tài xế chính hiện hành của xe (chỉ trả cho người đã đăng nhập). */
async function loadCurrentDriverName(factoryId: string, vehicleId: string): Promise<string | null> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from("dispatch_vehicle_driver_assignments")
    .select("driver_id")
    .eq("factory_id", factoryId)
    .eq("vehicle_id", vehicleId)
    .eq("is_current", true)
    .limit(1)
    .maybeSingle()
  if (error || !data?.driver_id) return null
  const { data: drv } = await admin
    .from("dispatch_drivers")
    .select("name")
    .eq("id", data.driver_id as string)
    .eq("factory_id", factoryId)
    .maybeSingle()
  return ((drv?.name as string | undefined) || "").trim() || null
}

/** Cột trên `maintenance_record_lines` trỏ tới đích. */
function lineTargetColumn(target: EquipmentTarget): ["asset_id" | "dispatch_vehicle_id", string] {
  return isVehicleTarget(target) ? ["dispatch_vehicle_id", target.vehicleId] : ["asset_id", target.assetId]
}

type LineRow = {
  id: string
  record_id: string
  noi_dung: string | null
  nguyen_nhan: string | null
  cac_khac_phuc: string | null
  loai_sua_chua: string | null
  chi_phi_dk: number | null
  cong_tho: number | null
  loai_tien: string | null
  sort_order: number | null
  image_urls: string[] | null
}

async function loadAssetLines(target: EquipmentTarget): Promise<LineRow[]> {
  const [col, id] = lineTargetColumn(target)
  return fetchAllPaginated<LineRow>((from, to) =>
    getSupabaseAdmin()
      .from("maintenance_record_lines")
      .select("id, record_id, noi_dung, nguyen_nhan, cac_khac_phuc, loai_sua_chua, chi_phi_dk, cong_tho, loai_tien, sort_order, image_urls")
      .eq("factory_id", target.factoryId)
      .eq(col, id)
      .order("id")
      .range(from, to),
  )
}

type RecordRow = {
  id: string
  ma_bb: string | null
  ngay: string | null
  hang_muc: string
  trang_thai: string
  bo_phan: string | null
  nguoi_thuc_hien: string[] | null
  noi_dung_chung: string | null
  nguyen_nhan_chung: string | null
  cac_khac_phuc_chung: string | null
  image_urls_chung?: string[] | null
  created_at: string | null
}

async function loadRecords(factoryId: string, ids: string[], statuses: string[], cols: string): Promise<RecordRow[]> {
  const out: RecordRow[] = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await getSupabaseAdmin()
      .from("maintenance_records")
      .select(cols)
      .eq("factory_id", factoryId)
      .in("id", ids.slice(i, i + CHUNK))
      .in("trang_thai", statuses)
    if (error) throw new Error(error.message)
    out.push(...((data || []) as unknown as RecordRow[]))
  }
  return out
}

function byNewest(a: RecordRow, b: RecordRow) {
  const d = (b.ngay || "").localeCompare(a.ngay || "")
  return d !== 0 ? d : (b.created_at || "").localeCompare(a.created_at || "")
}

/** Phần CÔNG KHAI — chỉ đúng whitelist đã chốt (tên, mã, loại, bộ phận, lần bảo trì gần nhất). */
export async function loadPublicEquipment(target: EquipmentTarget): Promise<EquipmentPublicInfo | null> {
  const asset = await loadEntity(target)
  if (!asset) return null
  const lines = await loadAssetLines(target)
  const recordIds = [...new Set(lines.map((l) => l.record_id))]
  const records = recordIds.length
    ? await loadRecords(target.factoryId, recordIds, ["da_duyet"], "id, ngay, hang_muc, trang_thai, created_at")
    : []
  const latest = [...records].sort(byNewest)[0]
  return {
    ten_tb: asset.ten_tb,
    ma_tb: asset.ma_tb,
    loai: asset.loai,
    // Loại xe (Xe nâng / Xe vận chuyển…) là thông tin công khai; biển số + tài xế KHÔNG (chỉ /history).
    loai_xe: asset.vehicle_type,
    bo_phan: asset.bo_phan,
    last_maintenance: latest?.ngay ? { ngay: latest.ngay, hang_muc: latest.hang_muc } : null,
  }
}

/** Chỉ giữ URL http(s) (ảnh lưu ở bucket public `order-files`). */
function cleanImageUrls(urls: string[] | null | undefined): string[] {
  return (urls || []).filter((u) => typeof u === "string" && /^https?:\/\//i.test(u))
}

function mergeText(common: string | null, own: string | null) {
  const v = [common, own].map((s) => (s || "").trim()).filter(Boolean).join("\n")
  return v || null
}

type MaterialRow = {
  line_id: string
  ten_vat_tu: string
  dvt: string | null
  so_luong: number | null
  nguon: string
  don_gia: number | null
  thanh_tien: number | null
  loai_tien: string | null
  sort_order: number | null
}

/** Lịch sử cho người đã đăng nhập. `canSeeCost=false` ⇒ KHÔNG trả bất kỳ trường giá/chi phí nào. */
export async function loadEquipmentHistory(
  target: EquipmentTarget,
  opts: { canSeeCost: boolean; offset: number; limit: number; hangMuc?: string | null },
): Promise<{ inactive: boolean; total: number; records: EquipmentHistoryRecord[]; vehicle: EquipmentVehicleInfo | null } | null> {
  const asset = await loadEntity(target)
  if (!asset) return null
  const vehicle: EquipmentVehicleInfo | null = isVehicleTarget(target)
    ? { plate_number: asset.plate_number, driver_name: await loadCurrentDriverName(target.factoryId, target.vehicleId) }
    : null
  const lines = await loadAssetLines(target)
  const recordIds = [...new Set(lines.map((l) => l.record_id))]
  const records = recordIds.length
    ? await loadRecords(
        target.factoryId,
        recordIds,
        HISTORY_STATUSES,
        "id, ma_bb, ngay, hang_muc, trang_thai, bo_phan, nguoi_thuc_hien, noi_dung_chung, nguyen_nhan_chung, cac_khac_phuc_chung, image_urls_chung, created_at",
      )
    : []
  const recordById = new Map(records.map((r) => [r.id, r]))

  const entries = lines
    .filter((l) => {
      const r = recordById.get(l.record_id)
      return !!r && (!opts.hangMuc || r.hang_muc === opts.hangMuc)
    })
    .sort((a, b) => {
      const d = byNewest(recordById.get(a.record_id)!, recordById.get(b.record_id)!)
      return d !== 0 ? d : (a.sort_order ?? 0) - (b.sort_order ?? 0)
    })

  const page = entries.slice(opts.offset, opts.offset + opts.limit)
  const lineIds = page.map((l) => l.id)
  const materials: MaterialRow[] = []
  for (let i = 0; i < lineIds.length; i += CHUNK) {
    const { data, error } = await getSupabaseAdmin()
      .from("maintenance_materials")
      .select("line_id, ten_vat_tu, dvt, so_luong, nguon, don_gia, thanh_tien, loai_tien, sort_order")
      .eq("factory_id", target.factoryId)
      .in("line_id", lineIds.slice(i, i + CHUNK))
    if (error) throw new Error(error.message)
    materials.push(...((data || []) as MaterialRow[]))
  }
  const matsByLine = new Map<string, MaterialRow[]>()
  for (const m of materials) {
    const list = matsByLine.get(m.line_id) || []
    list.push(m)
    matsByLine.set(m.line_id, list)
  }

  const out: EquipmentHistoryRecord[] = page.map((l) => {
    const r = recordById.get(l.record_id)!
    const isBaoDuong = r.hang_muc === "Bảo dưỡng"
    const mats = (matsByLine.get(l.id) || [])
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map<EquipmentHistoryMaterial>((m) => {
        const base: EquipmentHistoryMaterial = {
          ten_vat_tu: m.ten_vat_tu,
          dvt: m.dvt,
          so_luong: Number(m.so_luong ?? 0),
          nguon: m.nguon,
        }
        return opts.canSeeCost
          ? { ...base, don_gia: m.don_gia, thanh_tien: m.thanh_tien, loai_tien: m.loai_tien }
          : base
      })
    const rec: EquipmentHistoryRecord = {
      line_id: l.id,
      id: r.id,
      ma_bb: r.ma_bb,
      ngay: r.ngay,
      hang_muc: r.hang_muc,
      trang_thai: r.trang_thai,
      bo_phan: r.bo_phan,
      nguoi_thuc_hien: r.nguoi_thuc_hien || [],
      noi_dung: isBaoDuong ? mergeText(r.noi_dung_chung, l.noi_dung) : l.noi_dung,
      nguyen_nhan: isBaoDuong ? mergeText(r.nguyen_nhan_chung, l.nguyen_nhan) : l.nguyen_nhan,
      cac_khac_phuc: isBaoDuong ? mergeText(r.cac_khac_phuc_chung, l.cac_khac_phuc) : l.cac_khac_phuc,
      loai_sua_chua: l.loai_sua_chua,
      images: cleanImageUrls(l.image_urls),
      images_chung: isBaoDuong ? cleanImageUrls(r.image_urls_chung) : [],
      materials: mats,
    }
    if (opts.canSeeCost) {
      rec.chi_phi_dk = l.chi_phi_dk
      rec.cong_tho = l.cong_tho
      rec.loai_tien = l.loai_tien
    }
    return rec
  })

  return { inactive: !asset.active, total: entries.length, records: out, vehicle }
}

type MaterialAggRow = MaterialRow & {
  record_id: string
  inventory_item_id: string | null
}

export type EquipmentMaterialsOptions = {
  canSeeCost: boolean
  q?: string | null
  from?: string | null
  to?: string | null
  hangMuc?: string | null
  minCount?: number
  sort?: EquipmentMaterialSort
}

const DAY_MS = 86_400_000

function dayNumber(iso: string) {
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)
  return Number.isFinite(t) ? Math.round(t / DAY_MS) : null
}

/** GĐ2 — vật tư đã thay của 1 thiết bị, gom theo `inventory_item_id`; dòng không có mã gom theo tên chuẩn
 *  hoá (và nhập vào nhóm có mã nếu tên chuẩn hoá trùng tên vật tư kho / tên đã ghi trong nhóm đó).
 *  Chỉ biên bản da_duyet + cho_duyet. `canSeeCost=false` ⇒ không trả trường giá nào. */
export async function loadEquipmentMaterials(
  target: EquipmentTarget,
  opts: EquipmentMaterialsOptions,
): Promise<{ recordCount: number; groups: EquipmentMaterialGroup[] } | null> {
  const asset = await loadEntity(target)
  if (!asset) return null
  const lines = await loadAssetLines(target)
  const recordIds = [...new Set(lines.map((l) => l.record_id))]
  const records = recordIds.length
    ? await loadRecords(target.factoryId, recordIds, HISTORY_STATUSES, "id, ma_bb, ngay, hang_muc, trang_thai, created_at")
    : []
  const recordById = new Map(
    records
      .filter((r) => {
        if (opts.hangMuc && r.hang_muc !== opts.hangMuc) return false
        const d = (r.ngay || "").slice(0, 10)
        if (opts.from && (!d || d < opts.from)) return false
        if (opts.to && (!d || d > opts.to)) return false
        return true
      })
      .map((r) => [r.id, r]),
  )
  const lineIds = lines.filter((l) => recordById.has(l.record_id)).map((l) => l.id)

  const mats: MaterialAggRow[] = []
  for (let i = 0; i < lineIds.length; i += CHUNK) {
    const { data, error } = await getSupabaseAdmin()
      .from("maintenance_materials")
      .select("line_id, record_id, inventory_item_id, ten_vat_tu, dvt, so_luong, nguon, don_gia, thanh_tien, loai_tien, sort_order")
      .eq("factory_id", target.factoryId)
      .in("line_id", lineIds.slice(i, i + CHUNK))
    if (error) throw new Error(error.message)
    mats.push(...((data || []) as MaterialAggRow[]))
  }
  const usable = mats.filter((m) => recordById.has(m.record_id) && (m.inventory_item_id || normalizeMaterialName(m.ten_vat_tu)))

  // Tên + mã vật tư kho của các nhóm có mã.
  const itemIds = [...new Set(usable.map((m) => m.inventory_item_id).filter((v): v is string => !!v))]
  const itemById = new Map<string, { code: string | null; name: string | null }>()
  for (let i = 0; i < itemIds.length; i += CHUNK) {
    const { data, error } = await getSupabaseAdmin()
      .from("inventory_items")
      .select("id, code, name")
      .eq("factory_id", target.factoryId)
      .in("id", itemIds.slice(i, i + CHUNK))
    if (error) throw new Error(error.message)
    for (const it of (data || []) as { id: string; code: string | null; name: string | null }[]) {
      itemById.set(it.id, { code: it.code, name: it.name })
    }
  }

  // Mã trỏ vật tư kho không còn / không tồn tại (dữ liệu cũ từng ghi id của bảng vật tư ngoài) ⇒ coi như
  // KHÔNG có mã, gom theo tên.
  const itemIdOf = (m: MaterialAggRow) => (m.inventory_item_id && itemById.has(m.inventory_item_id) ? m.inventory_item_id : null)

  // Tên chuẩn hoá → khoá nhóm có mã (để dòng KHÔNG mã nhập vào đúng nhóm).
  const keyByNorm = new Map<string, string>()
  for (const m of usable) {
    const itemId = itemIdOf(m)
    if (!itemId) continue
    const key = `i:${itemId}`
    for (const n of [normalizeMaterialName(itemById.get(itemId)?.name), normalizeMaterialName(m.ten_vat_tu)]) {
      if (n && !keyByNorm.has(n)) keyByNorm.set(n, key)
    }
  }

  type Acc = { itemId: string | null; rows: MaterialAggRow[] }
  const accs = new Map<string, Acc>()
  for (const m of usable) {
    const norm = normalizeMaterialName(m.ten_vat_tu)
    const itemId = itemIdOf(m)
    const key = itemId ? `i:${itemId}` : keyByNorm.get(norm) || `n:${norm || "?"}`
    const acc = accs.get(key) || { itemId: key.startsWith("i:") ? key.slice(2) : null, rows: [] }
    acc.rows.push(m)
    accs.set(key, acc)
  }

  const qNorm = normalizeMaterialName(opts.q)
  const minCount = Math.max(1, opts.minCount || 1)
  const groups: EquipmentMaterialGroup[] = []
  for (const [key, acc] of accs) {
    const item = acc.itemId ? itemById.get(acc.itemId) : undefined
    const nameCount = new Map<string, number>()
    for (const r of acc.rows) {
      const n = (r.ten_vat_tu || "").trim()
      if (n) nameCount.set(n, (nameCount.get(n) || 0) + 1)
    }
    const names = [...nameCount.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n)
    const name = (item?.name || "").trim() || names[0] || "(không tên)"

    if (qNorm) {
      const hay = [name, item?.code || "", ...names].map(normalizeMaterialName)
      if (!hay.some((h) => h.includes(qNorm))) continue
    }

    const recIds = [...new Set(acc.rows.map((r) => r.record_id))]
    if (recIds.length < minCount) continue

    // ĐVT gom không phân biệt hoa/thường/dấu câu ("Cái" = "cái." ); hiển thị cách viết dùng nhiều nhất.
    // Dòng KHÔNG ghi ĐVT nhập vào ĐVT duy nhất của nhóm (nếu nhóm chỉ có 1 ĐVT).
    const unitAcc = new Map<string, { qty: number; spellings: Map<string, number> }>()
    const costs = new Map<string, number>()
    const nguon = new Set<string>()
    for (const r of acc.rows) {
      const raw = (r.dvt || "").trim()
      const u = normalizeMaterialName(raw)
      const a = unitAcc.get(u) || { qty: 0, spellings: new Map<string, number>() }
      a.qty += Number(r.so_luong ?? 0)
      if (raw) a.spellings.set(raw, (a.spellings.get(raw) || 0) + 1)
      unitAcc.set(u, a)
      if (r.nguon) nguon.add(r.nguon)
      if (opts.canSeeCost && r.thanh_tien != null) {
        const lt = r.loai_tien || "USD"
        costs.set(lt, (costs.get(lt) || 0) + Number(r.thanh_tien))
      }
    }

    const namedUnits = [...unitAcc.keys()].filter(Boolean)
    const blank = unitAcc.get("")
    if (blank && namedUnits.length === 1) {
      unitAcc.get(namedUnits[0])!.qty += blank.qty
      unitAcc.delete("")
    }
    const totals = [...unitAcc.values()]
      .map((a) => ({
        dvt: [...a.spellings.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null,
        so_luong: Math.round(a.qty * 1000) / 1000,
      }))
      .sort((x, y) => y.so_luong - x.so_luong)

    const days = [...new Set(recIds.map((id) => recordById.get(id)?.ngay).filter((d): d is string => !!d))]
      .map(dayNumber)
      .filter((d): d is number => d != null)
      .sort((a, b) => a - b)
    const avgInterval = days.length >= 2 ? Math.round((days[days.length - 1] - days[0]) / (days.length - 1)) : null

    const occurrences = acc.rows
      .map<EquipmentMaterialOccurrence>((r) => {
        const rec = recordById.get(r.record_id)!
        const base: EquipmentMaterialOccurrence = {
          record_id: rec.id,
          ma_bb: rec.ma_bb,
          ngay: rec.ngay,
          hang_muc: rec.hang_muc,
          trang_thai: rec.trang_thai,
          ten_vat_tu: r.ten_vat_tu,
          dvt: r.dvt,
          so_luong: Number(r.so_luong ?? 0),
          nguon: r.nguon,
        }
        return opts.canSeeCost ? { ...base, don_gia: r.don_gia, thanh_tien: r.thanh_tien, loai_tien: r.loai_tien } : base
      })
      .sort((a, b) => byNewest(recordById.get(a.record_id)!, recordById.get(b.record_id)!))

    const group: EquipmentMaterialGroup = {
      key,
      item_code: item?.code || null,
      name,
      names,
      times: recIds.length,
      totals,
      last_date: occurrences[0]?.ngay ?? null,
      avg_interval_days: avgInterval,
      nguon: [...nguon],
      occurrences,
    }
    if (opts.canSeeCost) group.costs = [...costs.entries()].map(([loai_tien, thanh_tien]) => ({ loai_tien, thanh_tien }))
    groups.push(group)
  }

  const byLatest = (a: EquipmentMaterialGroup, b: EquipmentMaterialGroup) => (b.last_date || "").localeCompare(a.last_date || "")
  groups.sort((a, b) => {
    if (opts.sort === "latest") return byLatest(a, b) || b.times - a.times || a.name.localeCompare(b.name, "vi")
    return b.times - a.times || byLatest(a, b) || a.name.localeCompare(b.name, "vi")
  })

  const recordCount = new Set(usable.map((m) => m.record_id)).size
  return { recordCount, groups }
}

// ── GĐ3b: thống kê chu kỳ sửa chữa / bảo dưỡng ─────────────────────────────────────────

export type EquipmentStatsTarget = EquipmentTarget

type StatsLineRow = {
  id: string
  record_id: string
  km_dong_ho: number | null
  loai_sua_chua: string | null
  chi_phi_dk: number | null
  cong_tho: number | null
  loai_tien: string | null
}

/** Dữ liệu thống kê chu kỳ của 1 máy móc HOẶC 1 xe. Sản lượng theo ngày qua 2 RPC
 *  (migration 20261114). `canSeeCost=false` ⇒ không trả chi phí. Thiết bị khác nhà máy ⇒ null. */
export async function loadEquipmentStats(
  target: EquipmentStatsTarget,
  opts: { canSeeCost: boolean },
): Promise<EquipmentStatsResponse | null> {
  const admin = getSupabaseAdmin()
  const isVehicle = "vehicleId" in target
  let kind: EquipmentOutputKind = "none"
  let vehicleCode: string | null = null

  if (isVehicle) {
    const { data, error } = await admin
      .from("dispatch_vehicles")
      .select("code, vehicle_type")
      .eq("id", target.vehicleId)
      .eq("factory_id", target.factoryId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return null
    kind = outputKindForVehicle(data.vehicle_type as string | null)
    vehicleCode = (data.code as string | null) || null
  } else {
    const asset = await loadEntity(target)
    if (!asset) return null
    kind = outputKindForAsset(asset.bo_phan)
  }

  const lines = await fetchAllPaginated<StatsLineRow>((from, to) => {
    const q = admin
      .from("maintenance_record_lines")
      .select("id, record_id, km_dong_ho, loai_sua_chua, chi_phi_dk, cong_tho, loai_tien")
      .eq("factory_id", target.factoryId)
    return (isVehicle ? q.eq("dispatch_vehicle_id", target.vehicleId) : q.eq("asset_id", target.assetId))
      .order("id")
      .range(from, to)
  })
  const recordIds = [...new Set(lines.map((l) => l.record_id))]
  const records = recordIds.length
    ? await loadRecords(target.factoryId, recordIds, HISTORY_STATUSES, "id, ma_bb, ngay, hang_muc, trang_thai, created_at")
    : []
  const recordById = new Map(
    records
      .filter((r) => !!r.ngay && (r.hang_muc === "Sửa chữa" || r.hang_muc === "Bảo dưỡng"))
      .map((r) => [r.id, r]),
  )
  const usedLines = lines.filter((l) => recordById.has(l.record_id))

  // Vật tư của các dòng → khoá nhóm như tab Vật tư (mã vật tư kho, không có thì tên chuẩn hoá).
  const mats: { line_id: string; inventory_item_id: string | null; ten_vat_tu: string }[] = []
  const lineIds = usedLines.map((l) => l.id)
  for (let i = 0; i < lineIds.length; i += CHUNK) {
    const { data, error } = await admin
      .from("maintenance_materials")
      .select("line_id, inventory_item_id, ten_vat_tu")
      .eq("factory_id", target.factoryId)
      .in("line_id", lineIds.slice(i, i + CHUNK))
    if (error) throw new Error(error.message)
    mats.push(...((data || []) as typeof mats))
  }
  const itemIds = [...new Set(mats.map((m) => m.inventory_item_id).filter((v): v is string => !!v))]
  const itemName = new Map<string, string>()
  for (let i = 0; i < itemIds.length; i += CHUNK) {
    const { data, error } = await admin
      .from("inventory_items")
      .select("id, name")
      .eq("factory_id", target.factoryId)
      .in("id", itemIds.slice(i, i + CHUNK))
    if (error) throw new Error(error.message)
    for (const it of (data || []) as { id: string; name: string | null }[]) itemName.set(it.id, (it.name || "").trim())
  }
  const keyByNorm = new Map<string, string>()
  for (const m of mats) {
    if (!m.inventory_item_id || !itemName.has(m.inventory_item_id)) continue
    for (const n of [normalizeMaterialName(itemName.get(m.inventory_item_id)), normalizeMaterialName(m.ten_vat_tu)]) {
      if (n && !keyByNorm.has(n)) keyByNorm.set(n, `i:${m.inventory_item_id}`)
    }
  }
  const matsByLine = new Map<string, { key: string; name: string }[]>()
  const nameByKey = new Map<string, string>()
  for (const m of mats) {
    const n = normalizeMaterialName(m.ten_vat_tu)
    const key =
      m.inventory_item_id && itemName.has(m.inventory_item_id)
        ? `i:${m.inventory_item_id}`
        : keyByNorm.get(n) || (n ? `n:${n}` : null)
    if (!key) continue
    const name = (key.startsWith("i:") ? itemName.get(key.slice(2)) : "") || (m.ten_vat_tu || "").trim()
    if (!nameByKey.has(key) && name) nameByKey.set(key, name)
    const list = matsByLine.get(m.line_id) || []
    list.push({ key, name: (m.ten_vat_tu || "").trim() || name })
    matsByLine.set(m.line_id, list)
  }

  const linesByRecord = new Map<string, StatsLineRow[]>()
  for (const l of usedLines) {
    const list = linesByRecord.get(l.record_id) || []
    list.push(l)
    linesByRecord.set(l.record_id, list)
  }
  const events: EquipmentStatsEvent[] = []
  for (const [recordId, ls] of linesByRecord) {
    const r = recordById.get(recordId)!
    const meters = ls.map((l) => Number(l.km_dong_ho)).filter((v) => Number.isFinite(v) && v > 0)
    const lm = ls.flatMap((l) => matsByLine.get(l.id) || [])
    const ev: EquipmentStatsEvent = {
      record_id: recordId,
      ma_bb: r.ma_bb,
      ngay: (r.ngay || "").slice(0, 10),
      hang_muc: r.hang_muc as EquipmentStatsEvent["hang_muc"],
      trang_thai: r.trang_thai,
      loai_sua_chua: ls.some((l) => l.loai_sua_chua === "lon") ? "lon" : ls.find((l) => l.loai_sua_chua)?.loai_sua_chua ?? null,
      dong_ho: meters.length ? Math.max(...meters) : null,
      material_keys: [...new Set(lm.map((m) => m.key))],
      material_names: [...new Set(lm.map((m) => m.name).filter(Boolean))],
    }
    if (opts.canSeeCost) {
      const costs = new Map<string, number>()
      for (const l of ls) {
        const amount = Number(l.chi_phi_dk ?? 0) + Number(l.cong_tho ?? 0)
        if (amount > 0) costs.set(l.loai_tien || "USD", (costs.get(l.loai_tien || "USD") || 0) + amount)
      }
      ev.costs = [...costs.entries()].map(([loai_tien, amount]) => ({ loai_tien, amount }))
    }
    events.push(ev)
  }
  events.sort((a, b) => a.ngay.localeCompare(b.ngay))

  // Lựa chọn lọc "theo vật tư" — chỉ vật tư xuất hiện trên biên bản Sửa chữa.
  const matTimes = new Map<string, number>()
  for (const e of events) if (e.hang_muc === "Sửa chữa") for (const k of e.material_keys) matTimes.set(k, (matTimes.get(k) || 0) + 1)
  const materials: EquipmentStatsMaterialOption[] = [...matTimes.entries()]
    .map(([key, times]) => ({ key, name: nameByKey.get(key) || key.slice(2), times }))
    .sort((a, b) => b.times - a.times || a.name.localeCompare(b.name, "vi"))

  // Sản lượng theo ngày — từ lần Sửa chữa đầu tiên tới hôm nay.
  const today = getFactoryTodayISO()
  const firstRepair = events.find((e) => e.hang_muc === "Sửa chữa")?.ngay
  let daily: [string, number][] = []
  if (firstRepair && kind !== "none" && kind !== "xe_nang" && firstRepair <= today) {
    if (kind === "tp_mu_tap" || kind === "tp_mu_nuoc") {
      const dc = kind === "tp_mu_tap" ? "Mủ tạp" : "Mủ nước"
      const { data, error } = await admin.rpc("equipment_daily_product_output", {
        p_factory: target.factoryId,
        p_from: firstRepair,
        p_to: today,
      })
      if (error) throw new Error(error.message)
      daily = ((data || []) as { ngay: string; day_chuyen: string | null; so_kg: number | string }[])
        .filter((r) => r.day_chuyen === dc)
        .map((r) => [String(r.ngay).slice(0, 10), Number(r.so_kg) || 0])
    } else {
      const { data, error } = await admin.rpc("equipment_daily_dispatch_output", {
        p_factory: target.factoryId,
        p_from: firstRepair,
        p_to: today,
        p_so_xe: kind === "xe_van_chuyen" ? vehicleCode : null,
      })
      if (error) throw new Error(error.message)
      daily = ((data || []) as { ngay: string; kl_tuoi: number | string; kl_tuoi_mu_tap: number | string }[]).map((r) => [
        String(r.ngay).slice(0, 10),
        Number(kind === "xe_xuc" ? r.kl_tuoi_mu_tap : r.kl_tuoi) || 0,
      ])
    }
    daily = daily.filter(([, v]) => v !== 0)
  }

  return { kind, outputLabel: OUTPUT_LABEL[kind], today, events, daily, materials, canSeeCost: opts.canSeeCost }
}

// ── Token tem QR: máy móc (`asset`) hoặc xe Đội xe (`vehicle`, GĐ4a) ─────────────────────

export type EquipmentKind = "asset" | "vehicle"

const TOKEN_COL: Record<EquipmentKind, "asset_id" | "dispatch_vehicle_id"> = {
  asset: "asset_id",
  vehicle: "dispatch_vehicle_id",
}

/** Thiết bị / xe có thuộc nhà máy không (chặn tạo token cho id của nhà máy khác). */
async function equipmentBelongs(factoryId: string, kind: EquipmentKind, id: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from(kind === "asset" ? "maintenance_assets" : "dispatch_vehicles")
    .select("id")
    .eq("id", id)
    .eq("factory_id", factoryId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return !!data
}

/** Lấy (hoặc tạo) token còn hiệu lực của 1 máy móc / xe. Phải thuộc `factoryId`. */
export async function getOrCreateEquipmentToken(
  factoryId: string,
  kind: EquipmentKind,
  id: string,
  actorId: string,
): Promise<string | null> {
  const admin = getSupabaseAdmin()
  if (!(await equipmentBelongs(factoryId, kind, id))) return null
  const col = TOKEN_COL[kind]

  const findActive = async () => {
    const { data, error } = await admin
      .from("equipment_qr_tokens")
      .select("token")
      .eq(col, id)
      .is("revoked_at", null)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return (data?.token as string | undefined) ?? null
  }

  const existing = await findActive()
  if (existing) return existing
  const { data, error } = await admin
    .from("equipment_qr_tokens")
    .insert({ factory_id: factoryId, [col]: id, created_by: actorId })
    .select("token")
    .single()
  if (error) {
    // 23505: người khác vừa tạo song song ⇒ đọc lại token đó.
    if ((error as { code?: string }).code === "23505") return findActive()
    throw new Error(error.message)
  }
  return data.token as string
}

/** Nhãn in tem: `ma_tb` = mã thiết bị / mã xe, `ten_tb` = tên thiết bị / tên xe. */
export type EquipmentQrLabel = { id: string; ma_tb: string; ten_tb: string; bo_phan: string; token: string }

/** GĐ3/GĐ4a — lấy (tạo nếu thiếu) token còn hiệu lực cho NHIỀU máy móc HOẶC nhiều xe, để in tem hàng loạt.
 *  Id khác nhà máy / không tồn tại bị bỏ qua. Trả theo thứ tự `ids`. */
export async function getOrCreateEquipmentTokensBulk(
  factoryId: string,
  kind: EquipmentKind,
  inputIds: string[],
  actorId: string,
): Promise<EquipmentQrLabel[]> {
  const admin = getSupabaseAdmin()
  const col = TOKEN_COL[kind]
  const ids = [...new Set(inputIds)]
  const items = new Map<string, { ma_tb: string; ten_tb: string; bo_phan: string }>()
  const tokens = new Map<string, string>()

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    if (kind === "asset") {
      const { data, error } = await admin
        .from("maintenance_assets")
        .select("id, ma_tb, ten_tb, bo_phan")
        .eq("factory_id", factoryId)
        .in("id", chunk)
      if (error) throw new Error(error.message)
      for (const a of data || []) {
        items.set(a.id as string, { ma_tb: (a.ma_tb as string) || "", ten_tb: (a.ten_tb as string) || "", bo_phan: (a.bo_phan as string) || "" })
      }
    } else {
      const { data, error } = await admin
        .from("dispatch_vehicles")
        .select("id, code, name")
        .eq("factory_id", factoryId)
        .in("id", chunk)
      if (error) throw new Error(error.message)
      for (const v of data || []) {
        items.set(v.id as string, { ma_tb: (v.code as string) || "", ten_tb: (v.name as string) || (v.code as string) || "", bo_phan: "Đội xe" })
      }
    }
    const { data: tk, error: tErr } = await admin
      .from("equipment_qr_tokens")
      .select(`${col}, token`)
      .in(col, chunk)
      .is("revoked_at", null)
    if (tErr) throw new Error(tErr.message)
    for (const t of (tk || []) as unknown as Record<string, string>[]) tokens.set(t[col], t.token)
  }

  const missing = [...items.keys()].filter((id) => !tokens.has(id))
  for (let i = 0; i < missing.length; i += CHUNK) {
    const chunk = missing.slice(i, i + CHUNK)
    const { data, error } = await admin
      .from("equipment_qr_tokens")
      .insert(chunk.map((id) => ({ factory_id: factoryId, [col]: id, created_by: actorId })))
      .select(`${col}, token`)
    if (error) {
      // Có người tạo song song (23505) ⇒ xử lý từng thiết bị của lô này.
      if ((error as { code?: string }).code !== "23505") throw new Error(error.message)
      for (const id of chunk) {
        const token = await getOrCreateEquipmentToken(factoryId, kind, id, actorId)
        if (token) tokens.set(id, token)
      }
      continue
    }
    for (const t of (data || []) as unknown as Record<string, string>[]) tokens.set(t[col], t.token)
  }

  const out: EquipmentQrLabel[] = []
  for (const id of ids) {
    const it = items.get(id)
    const token = tokens.get(id)
    if (it && token) out.push({ id, ...it, token })
  }
  return out
}

/** GĐ3 — "Tạo lại QR": thu hồi token đang hiệu lực (tem cũ chết ngay) rồi tạo token mới.
 *  Chèn token mới lỗi ⇒ gỡ thu hồi token cũ để thiết bị không bị mất QR. */
export async function regenerateEquipmentToken(
  factoryId: string,
  kind: EquipmentKind,
  id: string,
  actorId: string,
): Promise<string | null> {
  const admin = getSupabaseAdmin()
  if (!(await equipmentBelongs(factoryId, kind, id))) return null
  const col = TOKEN_COL[kind]

  const { data: revoked, error: rErr } = await admin
    .from("equipment_qr_tokens")
    .update({ revoked_at: new Date().toISOString(), revoked_by: actorId })
    .eq(col, id)
    .eq("factory_id", factoryId)
    .is("revoked_at", null)
    .select("token")
  if (rErr) throw new Error(rErr.message)

  const { data, error } = await admin
    .from("equipment_qr_tokens")
    .insert({ factory_id: factoryId, [col]: id, created_by: actorId })
    .select("token")
    .single()
  if (error) {
    const oldTokens = (revoked || []).map((r) => r.token as string)
    if (oldTokens.length > 0) {
      await admin.from("equipment_qr_tokens").update({ revoked_at: null, revoked_by: null }).in("token", oldTokens)
    }
    throw new Error(error.message)
  }
  return data.token as string
}

/** Thông tin người đang đăng nhập cho góc phải trang QR: tên đăng nhập, họ tên, chức vụ
 *  (`maintenance_staff.chuc_vu_chinh_quyen || chuc_vu` theo profile_id — cùng nguồn màn quét QR Thành phẩm). */
export async function loadEquipmentViewer(userId: string): Promise<EquipmentViewer | null> {
  const admin = getSupabaseAdmin()
  const [{ data: profile }, { data: staff }] = await Promise.all([
    admin.from("profiles").select("username, full_name").eq("id", userId).maybeSingle(),
    admin
      .from("maintenance_staff")
      .select("chuc_vu, chuc_vu_chinh_quyen")
      .eq("profile_id", userId)
      .eq("active", true)
      .limit(1)
      .maybeSingle(),
  ])
  if (!profile) return null
  return {
    username: (profile.username as string) || "",
    full_name: (profile.full_name as string) || (profile.username as string) || "",
    chuc_vu: ((staff?.chuc_vu_chinh_quyen as string) || (staff?.chuc_vu as string) || "").trim() || null,
  }
}
