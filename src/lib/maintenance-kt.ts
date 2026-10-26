import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { fetchAllPaginated } from "@/lib/supabase-helpers"

// GĐ2g — Vật tư mua ngoài ("ben_ngoai") của biên bản Bảo trì đi qua kho:
// lập Đề nghị mua → nhập kho → ký biên bản → xuất kho (issueMaintenanceStock).
// Bước 2 (2026-10-18): kho KHÔNG còn ép cứng KT. Kho của 1 vật tư trong 1 biên bản
// (`resolveExternalWarehouses`) = kho của lần nhập kho gần nhất có vật tư đó thuộc phiếu đề nghị
// liên kết biên bản → kho chính của vật tư (rule is_primary) → Kho tạm KT.
// Chỉ chạy server (service role). Khả dụng của 1 biên bản = tồn kho đó − phần các biên bản
// khác CHƯA xuất kho tạo TRƯỚC nó đang giữ cùng (kho, vật tư).

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
  /** "vat_tu" = vật tư mua ngoài qua kho; "dich_vu" = gia công ngoài (không kho) — onHand/available =
   *  SL đã "Xác nhận hoàn thành" trên phiếu đề nghị liên kết biên bản. */
  kind: "vat_tu" | "dich_vu"
  /** Kho tính tồn / xuất của vật tư này (xem resolveExternalWarehouses). */
  warehouseId: string | null
  warehouseCode: string | null
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
  nguon: string
  line_id: string | null
  inventory_item_id: string | null
  ten_vat_tu: string | null
  dvt: string | null
  so_luong: number | null
  don_gia: number | null
  loai_tien: string | null
}

type WarehouseInfo = { id: string; code: string; name: string }

/**
 * Kho của từng (biên bản, vật tư mua ngoài) — key `${recordId}:${itemId}`.
 * Ưu tiên: kho phiếu nhập (đã ghi sổ) gần nhất có vật tư đó thuộc phiếu đề nghị liên kết biên bản
 * → kho chính (is_primary) của vật tư → Kho tạm KT. Không có gì → null.
 * Dùng chung cho trạng thái KT (computeKtStatuses) và xuất kho khi ký (issueMaintenanceStock)
 * để 2 nơi luôn cùng 1 kho.
 */
export async function resolveExternalWarehouses(
  factoryId: string,
  pairs: { recordId: string; itemId: string }[],
  kt?: WarehouseInfo | null,
): Promise<{ map: Map<string, string | null>; warehouses: Map<string, WarehouseInfo> }> {
  const sb = getSupabaseAdmin()
  const ktWh = kt === undefined ? await findKtWarehouse(factoryId) : kt
  const map = new Map<string, string | null>()
  const warehouses = new Map<string, WarehouseInfo>()
  if (ktWh) warehouses.set(ktWh.id, ktWh)
  if (!pairs.length) return { map, warehouses }
  const recordIds = Array.from(new Set(pairs.map((p) => p.recordId)))
  const itemIds = Array.from(new Set(pairs.map((p) => p.itemId)))

  // 1. Phiếu nhập của các đề nghị liên kết biên bản.
  const reqToRecord = new Map<string, string>()
  for (let i = 0; i < recordIds.length; i += 200) {
    const { data, error } = await sb
      .from("purchase_requests")
      .select("id, maintenance_record_id")
      .eq("factory_id", factoryId)
      .in("maintenance_record_id", recordIds.slice(i, i + 200))
    if (error) throw new Error(error.message)
    for (const r of (data || []) as { id: string; maintenance_record_id: string }[]) reqToRecord.set(r.id, r.maintenance_record_id)
  }
  // latest[`rec:item`] = { warehouseId, at }
  const latest = new Map<string, { warehouseId: string; at: string }>()
  const reqIds = Array.from(reqToRecord.keys())
  for (let i = 0; i < reqIds.length; i += 200) {
    const { data: receipts, error } = await sb
      .from("purchase_receipts")
      .select("request_id, inventory_document_id, warehouse_id, created_at")
      .eq("factory_id", factoryId)
      .in("request_id", reqIds.slice(i, i + 200))
      .not("inventory_document_id", "is", null)
    if (error) throw new Error(error.message)
    const rows = (receipts || []) as { request_id: string; inventory_document_id: string; warehouse_id: string | null; created_at: string }[]
    if (!rows.length) continue
    const docIds = rows.map((r) => r.inventory_document_id)
    const [docsRes, linesRes] = await Promise.all([
      sb.from("inventory_documents").select("id, status").in("id", docIds),
      sb.from("inventory_document_lines").select("document_id, item_id").in("document_id", docIds),
    ])
    const posted = new Set(((docsRes.data || []) as { id: string; status: string | null }[]).filter((d) => d.status === "posted").map((d) => d.id))
    const itemsByDoc = new Map<string, Set<string>>()
    for (const l of (linesRes.data || []) as { document_id: string; item_id: string | null }[]) {
      if (!l.item_id) continue
      const set = itemsByDoc.get(l.document_id) || new Set<string>()
      set.add(l.item_id)
      itemsByDoc.set(l.document_id, set)
    }
    for (const r of rows) {
      if (!r.warehouse_id || !posted.has(r.inventory_document_id)) continue
      const rec = reqToRecord.get(r.request_id)!
      for (const itemId of itemsByDoc.get(r.inventory_document_id) || []) {
        const key = `${rec}:${itemId}`
        const cur = latest.get(key)
        if (!cur || r.created_at > cur.at) latest.set(key, { warehouseId: r.warehouse_id, at: r.created_at })
      }
    }
  }

  // 2. Kho chính của vật tư.
  const primary = new Map<string, string>()
  for (let i = 0; i < itemIds.length; i += 200) {
    const { data } = await sb
      .from("inventory_item_warehouse_rules")
      .select("item_id, warehouse_id")
      .eq("factory_id", factoryId)
      .eq("is_primary", true)
      .in("item_id", itemIds.slice(i, i + 200))
    for (const r of (data || []) as { item_id: string; warehouse_id: string }[]) primary.set(r.item_id, r.warehouse_id)
  }

  for (const p of pairs) {
    const key = `${p.recordId}:${p.itemId}`
    map.set(key, latest.get(key)?.warehouseId || primary.get(p.itemId) || ktWh?.id || null)
  }

  const whIds = Array.from(new Set(Array.from(map.values()).filter((v): v is string => !!v && !warehouses.has(v))))
  if (whIds.length) {
    const { data } = await sb.from("inventory_warehouses").select("id, code, name").eq("factory_id", factoryId).in("id", whIds)
    for (const w of (data || []) as WarehouseInfo[]) warehouses.set(w.id, w)
  }
  return { map, warehouses }
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
      .select("record_id, nguon, line_id, inventory_item_id, ten_vat_tu, dvt, so_luong, don_gia, loai_tien")
      .eq("factory_id", factoryId)
      .in("nguon", ["ben_ngoai", "gia_cong"])
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

  // Kho của từng (biên bản, vật tư) — tính cho MỌI biên bản đang giữ hàng (để trừ phần giữ chỗ
  // đúng kho) và cho biên bản đích.
  const scopeIds = new Set([...active.map((r) => r.id), ...target.map((r) => r.id)])
  const pairKeys = new Set<string>()
  const pairs: { recordId: string; itemId: string }[] = []
  for (const m of materials) {
    if (m.nguon !== "ben_ngoai" || !scopeIds.has(m.record_id)) continue
    const key = `${m.record_id}:${m.inventory_item_id}`
    if (pairKeys.has(key)) continue
    pairKeys.add(key)
    pairs.push({ recordId: m.record_id, itemId: m.inventory_item_id as string })
  }
  const { map: whByPair, warehouses: whInfo } = await resolveExternalWarehouses(factoryId, pairs, kt)

  const itemIds = Array.from(new Set(materials.map((m) => m.inventory_item_id as string)))
  const usedWhIds = Array.from(new Set(Array.from(whByPair.values()).filter((v): v is string => !!v)))
  const onHand = new Map<string, number>() // key `${warehouseId}:${itemId}`
  const itemInfo = new Map<string, { code: string | null; name: string; unit: string | null }>()
  for (let i = 0; i < itemIds.length; i += 200) {
    const chunk = itemIds.slice(i, i + 200)
    const [items, bal] = await Promise.all([
      sb.from("inventory_items").select("id, code, name, unit").eq("factory_id", factoryId).in("id", chunk),
      usedWhIds.length
        ? sb.from("inventory_stock_balances").select("warehouse_id, item_id, on_hand").eq("factory_id", factoryId).in("warehouse_id", usedWhIds).in("item_id", chunk)
        : Promise.resolve({ data: [] as { warehouse_id: string; item_id: string; on_hand: number }[] }),
    ])
    for (const it of (items.data || []) as { id: string; code: string | null; name: string; unit: string | null }[]) {
      itemInfo.set(it.id, { code: it.code, name: it.name, unit: it.unit })
    }
    for (const b of (bal.data || []) as { warehouse_id: string; item_id: string; on_hand: number | null }[]) {
      onHand.set(`${b.warehouse_id}:${b.item_id}`, Number(b.on_hand) || 0)
    }
  }

  // Nhu cầu theo biên bản → vật tư (vật tư qua kho và dịch vụ gia công tách riêng).
  const serviceKeys = new Set<string>() // `${recordId}:${itemId}` là dịch vụ gia công
  for (const m of materials) if (m.nguon === "gia_cong") serviceKeys.add(`${m.record_id}:${m.inventory_item_id}`)
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
  const completedByRecord = new Map<string, Map<string, number>>()
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
    // Dịch vụ gia công: đã "Xác nhận hoàn thành" trên phiếu gốc liên kết (mọi trạng thái — phiếu đã
    // hoàn tất/đóng vẫn giữ phần đã xong).
    const gocReqs = reqRows.filter((r) => r.loai === "goc")
    if (gocReqs.length) {
      const gocToRecord = new Map(gocReqs.map((r) => [r.id, r.maintenance_record_id]))
      const { data: comps } = await sb
        .from("purchase_service_completions")
        .select("request_id, item_id, so_luong")
        .in("request_id", gocReqs.map((r) => r.id))
      for (const c of (comps || []) as { request_id: string; item_id: string | null; so_luong: number | null }[]) {
        if (!c.item_id) continue
        const rec = gocToRecord.get(c.request_id)!
        const map = completedByRecord.get(rec) || new Map<string, number>()
        map.set(c.item_id, (map.get(c.item_id) || 0) + (Number(c.so_luong) || 0))
        completedByRecord.set(rec, map)
      }
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
      const mat0 = firstMat.get(`${rec.id}:${itemId}`)
      if (serviceKeys.has(`${rec.id}:${itemId}`)) {
        // Dịch vụ gia công: không kho, không giữ chỗ giữa các biên bản.
        const completed = completedByRecord.get(rec.id)?.get(itemId) || 0
        const info = itemInfo.get(itemId)
        items.push({
          itemId,
          kind: "dich_vu",
          warehouseId: null,
          warehouseCode: null,
          itemCode: info?.code || null,
          name: info?.name || mat0?.ten_vat_tu || "—",
          unit: info?.unit || mat0?.dvt || null,
          need: qty,
          onHand: completed,
          reservedByOthers: 0,
          available: completed,
          shortage: Math.max(0, qty - completed),
          pendingRequested: pendingByRecord.get(rec.id)?.get(itemId) || 0,
          donGia: Number(mat0?.don_gia) || 0,
          loaiTien: mat0?.loai_tien || "USD",
        })
        continue
      }
      const whId = whByPair.get(`${rec.id}:${itemId}`) || null
      let reserved = 0
      for (const e of earlier) {
        if ((whByPair.get(`${e.id}:${itemId}`) || null) !== whId) continue
        reserved += needByRecord.get(e.id)?.get(itemId) || 0
      }
      const stock = whId ? onHand.get(`${whId}:${itemId}`) || 0 : 0
      const available = Math.max(0, stock - reserved)
      const mat = firstMat.get(`${rec.id}:${itemId}`)
      const info = itemInfo.get(itemId)
      items.push({
        itemId,
        kind: "vat_tu",
        warehouseId: whId,
        warehouseCode: whId ? whInfo.get(whId)?.code || null : null,
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
