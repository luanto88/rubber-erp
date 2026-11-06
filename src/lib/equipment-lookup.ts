// SERVER-ONLY (service role) — tra token QR thiết bị, dữ liệu công khai và lịch sử bảo trì.
// Không import từ component client. Kế hoạch: docs/qr-equipment-plan.md
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { fetchAllPaginated } from "@/lib/supabase-helpers"
import {
  isEquipmentQrToken,
  type EquipmentHistoryMaterial,
  type EquipmentHistoryRecord,
  type EquipmentPublicInfo,
} from "@/lib/equipment-qr"

const CHUNK = 200
/** Biên bản hiện cho người đã đăng nhập — bỏ "huy" và "tu_choi" (dữ liệu cũ). */
const HISTORY_STATUSES = ["da_duyet", "cho_duyet"]

export type EquipmentTarget = {
  factoryId: string
  assetId: string
}

/** Token còn hiệu lực → thiết bị. Token sai hình thức / không tồn tại / đã thu hồi ⇒ null (cùng 1 kết quả). */
export async function resolveEquipmentToken(token: string): Promise<EquipmentTarget | null> {
  if (!isEquipmentQrToken(token)) return null
  const { data, error } = await getSupabaseAdmin()
    .from("equipment_qr_tokens")
    .select("factory_id, asset_id, revoked_at")
    .eq("token", token)
    .maybeSingle()
  if (error) throw new Error(error.message)
  // GĐ1 chỉ máy móc — token trỏ xe (GĐ4) coi như không tồn tại.
  if (!data || data.revoked_at || !data.asset_id) return null
  return { factoryId: data.factory_id as string, assetId: data.asset_id as string }
}

type AssetRow = {
  ma_tb: string
  ten_tb: string
  loai: string
  bo_phan: string
  trang_thai: string
}

async function loadAsset(target: EquipmentTarget): Promise<AssetRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("maintenance_assets")
    .select("ma_tb, ten_tb, loai, bo_phan, trang_thai")
    .eq("id", target.assetId)
    .eq("factory_id", target.factoryId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as AssetRow | null) ?? null
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
}

async function loadAssetLines(target: EquipmentTarget): Promise<LineRow[]> {
  return fetchAllPaginated<LineRow>((from, to) =>
    getSupabaseAdmin()
      .from("maintenance_record_lines")
      .select("id, record_id, noi_dung, nguyen_nhan, cac_khac_phuc, loai_sua_chua, chi_phi_dk, cong_tho, loai_tien, sort_order")
      .eq("factory_id", target.factoryId)
      .eq("asset_id", target.assetId)
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
  const asset = await loadAsset(target)
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
    loai: asset.loai === "xe" ? "xe" : "may_moc",
    bo_phan: asset.bo_phan,
    last_maintenance: latest?.ngay ? { ngay: latest.ngay, hang_muc: latest.hang_muc } : null,
  }
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
): Promise<{ inactive: boolean; total: number; records: EquipmentHistoryRecord[] } | null> {
  const asset = await loadAsset(target)
  if (!asset) return null
  const lines = await loadAssetLines(target)
  const recordIds = [...new Set(lines.map((l) => l.record_id))]
  const records = recordIds.length
    ? await loadRecords(
        target.factoryId,
        recordIds,
        HISTORY_STATUSES,
        "id, ma_bb, ngay, hang_muc, trang_thai, bo_phan, nguoi_thuc_hien, noi_dung_chung, nguyen_nhan_chung, cac_khac_phuc_chung, created_at",
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
      materials: mats,
    }
    if (opts.canSeeCost) {
      rec.chi_phi_dk = l.chi_phi_dk
      rec.cong_tho = l.cong_tho
      rec.loai_tien = l.loai_tien
    }
    return rec
  })

  return { inactive: asset.trang_thai !== "active", total: entries.length, records: out }
}

/** Lấy (hoặc tạo) token còn hiệu lực của 1 máy móc. Thiết bị phải thuộc `factoryId`. */
export async function getOrCreateAssetToken(factoryId: string, assetId: string, actorId: string): Promise<string | null> {
  const admin = getSupabaseAdmin()
  const { data: asset, error: aErr } = await admin
    .from("maintenance_assets")
    .select("id")
    .eq("id", assetId)
    .eq("factory_id", factoryId)
    .maybeSingle()
  if (aErr) throw new Error(aErr.message)
  if (!asset) return null

  const findActive = async () => {
    const { data, error } = await admin
      .from("equipment_qr_tokens")
      .select("token")
      .eq("asset_id", assetId)
      .is("revoked_at", null)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return (data?.token as string | undefined) ?? null
  }

  const existing = await findActive()
  if (existing) return existing
  const { data, error } = await admin
    .from("equipment_qr_tokens")
    .insert({ factory_id: factoryId, asset_id: assetId, created_by: actorId })
    .select("token")
    .single()
  if (error) {
    // 23505: người khác vừa tạo song song ⇒ đọc lại token đó.
    if ((error as { code?: string }).code === "23505") return findActive()
    throw new Error(error.message)
  }
  return data.token as string
}
