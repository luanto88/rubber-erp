import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { fetchAllPaginated } from "@/lib/supabase-helpers"

// GĐ2g — Vật tư mua ngoài ("ben_ngoai") của biên bản Bảo trì đi qua Kho tạm KT:
// lập Đề nghị mua → nhập KT → ký biên bản → xuất KT (issueMaintenanceStock).
// Chỉ chạy server (service role). Khả dụng của 1 biên bản = tồn KT − phần các biên bản
// khác CHƯA xuất kho tạo TRƯỚC nó đang giữ (giữ hàng theo thứ tự tạo, tránh 2 biên bản
// cùng dựa vào 1 số dư).

export const KT_WAREHOUSE_CODE = "KT"

/** Trạng thái biên bản đã xuất kho / bỏ — không còn giữ hàng ở KT. */
const RECORD_DONE = new Set(["da_duyet", "huy"])
/** Phiếu đề nghị liên kết còn hiệu lực (chưa nhập đủ thì còn "đang đề nghị"). */
export const PURCHASE_ACTIVE_FOR_KT = ["nhap", "cho_ky", "tra_ve", "da_duyet", "dang_mua"]

export async function findKtWarehouse(factoryId: string): Promise<{ id: string; code: string; name: string } | null> {
  const { data } = await getSupabaseAdmin()
    .from("inventory_warehouses")
    .select("id, code, name")
    .eq("factory_id", factoryId)
    .eq("code", KT_WAREHOUSE_CODE)
    .maybeSingle()
  return (data as { id: string; code: string; name: string } | null) || null
}

export type KtItemStatus = {
  itemId: string
  itemCode: string | null
  name: string
  unit: string | null
  need: number
  onHand: number
  reservedByOthers: number
  available: number
  shortage: number
  pendingRequested: number
  /** Đơn giá + loại tiền lấy từ dòng vật tư biên bản (gợi ý khi lập đề nghị). */
  donGia: number
  loaiTien: string
}

export type KtLinkedRequest = { id: string; so: number; nam: number; trangThai: string; loai: string }

export type KtRecordStatus = {
  recordId: string
  maBb: string | null
  boPhan: string | null
  trangThai: string | null
  ktWarehouse: { id: string; code: string; name: string } | null
  items: KtItemStatus[]
  totalShortage: number
  /** Thiếu sau khi trừ phần đang đề nghị — > 0 thì cần lập (thêm) đề nghị mua. */
  needsRequest: boolean
  linkedRequests: KtLinkedRequest[]
}

type RecordRow = { id: string; ma_bb: string | null; bo_phan: string | null; trang_thai: string | null; created_at: string }
type MatRow = {
  record_id: string
  line_id: string | null
  inventory_item_id: string | null
  ten_vat_tu: string | null
  dvt: string | null
  so_luong: number | null
  don_gia: number | null
  loai_tien: string | null
}

function recordOrder(a: RecordRow, b: RecordRow) {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1
  return a.id < b.id ? -1 : 1
}

/**
 * Trạng thái vật tư mua ngoài theo biên bản. `recordId` có → chỉ trả biên bản đó (vẫn tính phần
 * biên bản khác giữ). Không có → mọi biên bản chưa xuất kho có vật tư mua ngoài.
 */
export async function computeKtStatuses(factoryId: string, recordId?: string): Promise<KtRecordStatus[]> {
  const sb = getSupabaseAdmin()
  const kt = await findKtWarehouse(factoryId)

  const materials = await fetchAllPaginated<MatRow>((from, to) =>
    sb
      .from("maintenance_materials")
      .select("record_id, line_id, inventory_item_id, ten_vat_tu, dvt, so_luong, don_gia, loai_tien")
      .eq("factory_id", factoryId)
      .eq("nguon", "ben_ngoai")
      .not("inventory_item_id", "is", null)
      .order("id")
      .range(from, to),
  )
  const recordIds = Array.from(new Set(materials.map((m) => m.record_id)))
  if (recordId && !recordIds.includes(recordId)) recordIds.push(recordId)
  if (!recordIds.length) return []

  const records: RecordRow[] = []
  for (let i = 0; i < recordIds.length; i += 200) {
    const { data, error } = await sb
      .from("maintenance_records")
      .select("id, ma_bb, bo_phan, trang_thai, created_at")
      .eq("factory_id", factoryId)
      .in("id", recordIds.slice(i, i + 200))
    if (error) throw new Error(error.message)
    records.push(...((data || []) as RecordRow[]))
  }
  const active = records.filter((r) => !RECORD_DONE.has(r.trang_thai || "")).sort(recordOrder)
  const target = recordId ? records.filter((r) => r.id === recordId) : active
  if (!target.length) return []

  const itemIds = Array.from(new Set(materials.map((m) => m.inventory_item_id as string)))
  const onHand = new Map<string, number>()
  const itemInfo = new Map<string, { code: string | null; name: string; unit: string | null }>()
  for (let i = 0; i < itemIds.length; i += 200) {
    const chunk = itemIds.slice(i, i + 200)
    const [items, bal] = await Promise.all([
      sb.from("inventory_items").select("id, code, name, unit").eq("factory_id", factoryId).in("id", chunk),
      kt
        ? sb.from("inventory_stock_balances").select("item_id, on_hand").eq("factory_id", factoryId).eq("warehouse_id", kt.id).in("item_id", chunk)
        : Promise.resolve({ data: [] as { item_id: string; on_hand: number }[] }),
    ])
    for (const it of (items.data || []) as { id: string; code: string | null; name: string; unit: string | null }[]) {
      itemInfo.set(it.id, { code: it.code, name: it.name, unit: it.unit })
    }
    for (const b of (bal.data || []) as { item_id: string; on_hand: number | null }[]) onHand.set(b.item_id, Number(b.on_hand) || 0)
  }

  // Nhu cầu theo biên bản → vật tư.
  const needByRecord = new Map<string, Map<string, number>>()
  const firstMat = new Map<string, MatRow>()
  for (const m of materials) {
    const qty = Number(m.so_luong) || 0
    if (qty <= 0) continue
    const map = needByRecord.get(m.record_id) || new Map<string, number>()
    map.set(m.inventory_item_id as string, (map.get(m.inventory_item_id as string) || 0) + qty)
    needByRecord.set(m.record_id, map)
    const key = `${m.record_id}:${m.inventory_item_id}`
    if (!firstMat.has(key)) firstMat.set(key, m)
  }

  // Phiếu đề nghị liên kết.
  const targetIds = target.map((r) => r.id)
  const linkedByRecord = new Map<string, KtLinkedRequest[]>()
  const pendingByRecord = new Map<string, Map<string, number>>()
  for (let i = 0; i < targetIds.length; i += 200) {
    const { data: reqs } = await sb
      .from("purchase_requests")
      .select("id, so, nam, trang_thai, loai, maintenance_record_id")
      .eq("factory_id", factoryId)
      .in("maintenance_record_id", targetIds.slice(i, i + 200))
    const reqRows = (reqs || []) as { id: string; so: number; nam: number; trang_thai: string; loai: string; maintenance_record_id: string }[]
    for (const r of reqRows) {
      const list = linkedByRecord.get(r.maintenance_record_id) || []
      list.push({ id: r.id, so: r.so, nam: r.nam, trangThai: r.trang_thai, loai: r.loai })
      linkedByRecord.set(r.maintenance_record_id, list)
    }
    const activeReqs = reqRows.filter((r) => r.loai === "goc" && PURCHASE_ACTIVE_FOR_KT.includes(r.trang_thai))
    if (!activeReqs.length) continue
    const { data: lines } = await sb
      .from("purchase_request_lines")
      .select("request_id, item_id, so_luong, sl_da_mua")
      .in("request_id", activeReqs.map((r) => r.id))
    const reqToRecord = new Map(activeReqs.map((r) => [r.id, r.maintenance_record_id]))
    for (const l of (lines || []) as { request_id: string; item_id: string | null; so_luong: number; sl_da_mua: number | null }[]) {
      if (!l.item_id) continue
      const rec = reqToRecord.get(l.request_id)!
      const left = Math.max(0, (Number(l.so_luong) || 0) - (Number(l.sl_da_mua) || 0))
      const map = pendingByRecord.get(rec) || new Map<string, number>()
      map.set(l.item_id, (map.get(l.item_id) || 0) + left)
      pendingByRecord.set(rec, map)
    }
  }

  const result: KtRecordStatus[] = []
  for (const rec of target) {
    const need = needByRecord.get(rec.id) || new Map<string, number>()
    const earlier = active.filter((r) => r.id !== rec.id && recordOrder(r, rec) < 0)
    const items: KtItemStatus[] = []
    for (const [itemId, qty] of need) {
      let reserved = 0
      for (const e of earlier) reserved += needByRecord.get(e.id)?.get(itemId) || 0
      const stock = onHand.get(itemId) || 0
      const available = Math.max(0, stock - reserved)
      const mat = firstMat.get(`${rec.id}:${itemId}`)
      const info = itemInfo.get(itemId)
      items.push({
        itemId,
        itemCode: info?.code || null,
        name: info?.name || mat?.ten_vat_tu || "—",
        unit: info?.unit || mat?.dvt || null,
        need: qty,
        onHand: stock,
        reservedByOthers: reserved,
        available,
        shortage: Math.max(0, qty - available),
        pendingRequested: pendingByRecord.get(rec.id)?.get(itemId) || 0,
        donGia: Number(mat?.don_gia) || 0,
        loaiTien: mat?.loai_tien || "USD",
      })
    }
    const done = RECORD_DONE.has(rec.trang_thai || "")
    const totalShortage = done ? 0 : items.reduce((s, it) => s + it.shortage, 0)
    result.push({
      recordId: rec.id,
      maBb: rec.ma_bb,
      boPhan: rec.bo_phan,
      trangThai: rec.trang_thai,
      ktWarehouse: kt,
      items: done ? items.map((it) => ({ ...it, shortage: 0 })) : items,
      totalShortage,
      needsRequest: !done && items.some((it) => it.shortage > it.pendingRequested),
      linkedRequests: linkedByRecord.get(rec.id) || [],
    })
  }
  return result
}
