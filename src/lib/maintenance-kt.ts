import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { fetchAllPaginated } from "@/lib/supabase-helpers"

// GĐ2g — Vật tư mua ngoài ("ben_ngoai") của biên bản Bảo trì đi qua kho:
// lập Đề nghị mua → nhập kho → ký biên bản → xuất kho (issueMaintenanceStock).
// Bước 2 (2026-10-18): kho KHÔNG còn ép cứng KT. Kho của 1 vật tư trong 1 biên bản
// (`resolveExternalWarehouses`) = kho của lần nhập kho gần nhất có vật tư đó từ DÒNG đề nghị gắn
// biên bản → kho chính của vật tư (rule is_primary) → Kho tạm KT.
// GĐ3 (2026-11-02): liên kết biên bản ↔ đề nghị đọc THEO DÒNG (purchase_request_lines.maintenance_record_id),
// "đang đề nghị" theo SL HIỆU LỰC (sau phiếu điều chỉnh), và hàng trong kho chia 2 tầng
// (`allocateGroup`): hàng nhập từ dòng gắn biên bản X giữ cho X trước, phần còn lại chia theo thứ tự
// tạo biên bản (gồm cả nhu cầu "Trong kho" của biên bản chưa duyệt).
// Chỉ chạy server (service role).

export const KT_WAREHOUSE_CODE = "KT"

/** Trạng thái biên bản đã xuất kho / bỏ — không còn giữ hàng. */
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
   *  SL đã "Xác nhận hoàn thành" trên các dòng đề nghị gắn biên bản. */
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
  /** Phiếu có ít nhất 1 dòng gắn biên bản này, hoặc phiếu lập từ biên bản này. */
  linkedRequests: KtLinkedRequest[]
  /** Phiếu gốc LẬP TỪ biên bản này đang NHÁP — "Lập đề nghị mua" sẽ cập nhật (chỉ tăng SL / thêm dòng) phiếu này. */
  draftRequest: KtLinkedRequest | null
  /** Phiếu gốc lập từ biên bản này đang BỊ TRẢ VỀ — người đề nghị tự sửa SL trên phiếu, không tạo/đồng bộ. */
  returnedRequest: KtLinkedRequest | null
}

type RecordRow = { id: string; ma_bb: string | null; bo_phan: string | null; trang_thai: string | null; created_at: string }
type MatRow = {
  record_id: string
  nguon: string
  inventory_item_id: string | null
  ten_vat_tu: string | null
  dvt: string | null
  so_luong: number | null
  don_gia: number | null
  loai_tien: string | null
}
type LinkedLine = { id: string; request_id: string; item_id: string | null; maintenance_record_id: string }
type RequestRow = { id: string; so: number; nam: number; trang_thai: string; loai: string; maintenance_record_id: string | null }
type WarehouseInfo = { id: string; code: string; name: string }

const CHUNK = 200

/** Dòng đề nghị gắn các biên bản (mọi phiếu, mọi trạng thái). */
async function loadLinkedLines(factoryId: string, recordIds: string[]): Promise<LinkedLine[]> {
  const sb = getSupabaseAdmin()
  const out: LinkedLine[] = []
  for (let i = 0; i < recordIds.length; i += CHUNK) {
    const rows = await fetchAllPaginated<LinkedLine>((from, to) =>
      sb
        .from("purchase_request_lines")
        .select("id, request_id, item_id, maintenance_record_id")
        .eq("factory_id", factoryId)
        .in("maintenance_record_id", recordIds.slice(i, i + CHUNK))
        .order("id")
        .range(from, to),
    )
    out.push(...rows)
  }
  return out
}

/**
 * Hàng ĐÃ NHẬP (phiếu nhập posted) từ các dòng gắn biên bản:
 *  - `earmark` `${rec}:${wh}:${item}` → SL (giữ chỗ tầng 1);
 *  - `latest` `${rec}:${item}` → kho của lần nhập gần nhất.
 */
async function loadLinkedReceipts(factoryId: string, lines: LinkedLine[]) {
  const sb = getSupabaseAdmin()
  const earmark = new Map<string, number>()
  const latest = new Map<string, { warehouseId: string; at: string }>()
  const recByLine = new Map(lines.map((l) => [l.id, l.maintenance_record_id]))
  const lineIds = lines.map((l) => l.id)
  for (let i = 0; i < lineIds.length; i += CHUNK) {
    const { data: docLines, error } = await sb
      .from("inventory_document_lines")
      .select("document_id, item_id, quantity, purchase_request_line_id")
      .in("purchase_request_line_id", lineIds.slice(i, i + CHUNK))
    if (error) throw new Error(error.message)
    const dl = (docLines || []) as { document_id: string; item_id: string | null; quantity: number | null; purchase_request_line_id: string }[]
    if (!dl.length) continue
    const docIds = Array.from(new Set(dl.map((d) => d.document_id)))
    const [docsRes, recRes] = await Promise.all([
      sb.from("inventory_documents").select("id, status").in("id", docIds),
      sb.from("purchase_receipts").select("inventory_document_id, warehouse_id, created_at").eq("factory_id", factoryId).in("inventory_document_id", docIds),
    ])
    if (docsRes.error) throw new Error(docsRes.error.message)
    if (recRes.error) throw new Error(recRes.error.message)
    const posted = new Set(((docsRes.data || []) as { id: string; status: string | null }[]).filter((d) => d.status === "posted").map((d) => d.id))
    const receiptByDoc = new Map(
      ((recRes.data || []) as { inventory_document_id: string; warehouse_id: string | null; created_at: string }[]).map((r) => [r.inventory_document_id, r]),
    )
    for (const d of dl) {
      const rcpt = receiptByDoc.get(d.document_id)
      const rec = recByLine.get(d.purchase_request_line_id)
      if (!d.item_id || !rec || !rcpt?.warehouse_id || !posted.has(d.document_id)) continue
      const ek = `${rec}:${rcpt.warehouse_id}:${d.item_id}`
      earmark.set(ek, (earmark.get(ek) || 0) + (Number(d.quantity) || 0))
      const lk = `${rec}:${d.item_id}`
      const cur = latest.get(lk)
      if (!cur || rcpt.created_at > cur.at) latest.set(lk, { warehouseId: rcpt.warehouse_id, at: rcpt.created_at })
    }
  }
  return { earmark, latest }
}

/** Kho chính của vật tư: rule is_primary → default_warehouse_ids[0] (mirror maintenance-stock-issuance). */
async function loadPrimaryWarehouses(factoryId: string, itemIds: string[]) {
  const sb = getSupabaseAdmin()
  const rule = new Map<string, string>()
  const fallback = new Map<string, string>()
  for (let i = 0; i < itemIds.length; i += CHUNK) {
    const chunk = itemIds.slice(i, i + CHUNK)
    const [rules, items] = await Promise.all([
      sb.from("inventory_item_warehouse_rules").select("item_id, warehouse_id").eq("factory_id", factoryId).eq("is_primary", true).in("item_id", chunk),
      sb.from("inventory_items").select("id, default_warehouse_ids").eq("factory_id", factoryId).in("id", chunk),
    ])
    for (const r of (rules.data || []) as { item_id: string; warehouse_id: string }[]) rule.set(r.item_id, r.warehouse_id)
    for (const it of (items.data || []) as { id: string; default_warehouse_ids: string[] | null }[]) {
      const first = (it.default_warehouse_ids || [])[0]
      if (first) fallback.set(it.id, first)
    }
  }
  return { rule, fallback }
}

/**
 * Kho của từng (biên bản, vật tư mua ngoài) — key `${recordId}:${itemId}`.
 * Ưu tiên: kho phiếu nhập (đã ghi sổ) gần nhất có vật tư đó từ dòng đề nghị gắn biên bản
 * → kho chính (is_primary) của vật tư → Kho tạm KT. Không có gì → null.
 * Dùng chung cho trạng thái kho (computeKtStatuses) và xuất kho khi ký (issueMaintenanceStock)
 * để 2 nơi luôn cùng 1 kho.
 */
export async function resolveExternalWarehouses(
  factoryId: string,
  pairs: { recordId: string; itemId: string }[],
  kt?: WarehouseInfo | null,
): Promise<{ map: Map<string, string | null>; warehouses: Map<string, WarehouseInfo> }> {
  const ktWh = kt === undefined ? await findKtWarehouse(factoryId) : kt
  if (!pairs.length) {
    const warehouses = new Map<string, WarehouseInfo>()
    if (ktWh) warehouses.set(ktWh.id, ktWh)
    return { map: new Map(), warehouses }
  }
  const recordIds = Array.from(new Set(pairs.map((p) => p.recordId)))
  const lines = await loadLinkedLines(factoryId, recordIds)
  const { latest } = await loadLinkedReceipts(factoryId, lines)
  return resolveWithLatest(factoryId, pairs, latest, ktWh)
}

async function resolveWithLatest(
  factoryId: string,
  pairs: { recordId: string; itemId: string }[],
  latest: Map<string, { warehouseId: string; at: string }>,
  ktWh: WarehouseInfo | null,
) {
  const sb = getSupabaseAdmin()
  const map = new Map<string, string | null>()
  const warehouses = new Map<string, WarehouseInfo>()
  if (ktWh) warehouses.set(ktWh.id, ktWh)
  const itemIds = Array.from(new Set(pairs.map((p) => p.itemId)))
  const primary = new Map<string, string>()
  for (let i = 0; i < itemIds.length; i += CHUNK) {
    const { data } = await sb
      .from("inventory_item_warehouse_rules")
      .select("item_id, warehouse_id")
      .eq("factory_id", factoryId)
      .eq("is_primary", true)
      .in("item_id", itemIds.slice(i, i + CHUNK))
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
 * Chia tồn 1 (kho, vật tư) cho các biên bản đang giữ hàng — hàm THUẦN.
 * Tầng 1: mỗi biên bản nhận trước phần hàng do chính nó đã mua về (≤ nhu cầu), theo thứ tự tạo.
 * Tầng 2: phần tồn còn lại chia theo thứ tự tạo cho nhu cầu chưa đủ.
 * `demands` phải đã sắp theo thứ tự tạo biên bản. Trả về SL được chia của từng biên bản.
 */
export function allocateGroup(
  onHand: number,
  demands: { recordId: string; demand: number; earmark: number }[],
): Map<string, number> {
  const alloc = new Map<string, number>()
  let rest = Math.max(0, onHand)
  for (const d of demands) {
    const t1 = Math.min(Math.max(0, d.demand), Math.max(0, d.earmark), rest)
    alloc.set(d.recordId, t1)
    rest -= t1
  }
  for (const d of demands) {
    const got = alloc.get(d.recordId) || 0
    const t2 = Math.min(Math.max(0, d.demand) - got, rest)
    if (t2 > 0) {
      alloc.set(d.recordId, got + t2)
      rest -= t2
    }
  }
  return alloc
}

/** SL hiệu lực + đã nhận của các dòng gốc (RPC purchase_effective_lines), gom nhiều phiếu. */
async function loadEffectiveByLine(requestIds: string[]) {
  const sb = getSupabaseAdmin()
  const out = new Map<string, { itemId: string | null; soLuong: number; received: number }>()
  for (let i = 0; i < requestIds.length; i += 10) {
    const results = await Promise.all(
      requestIds.slice(i, i + 10).map((id) => sb.rpc("purchase_effective_lines", { p_request_id: id })),
    )
    for (const { data, error } of results) {
      if (error) throw new Error(error.message)
      for (const e of (data || []) as { root_line_id: string; item_id: string | null; so_luong: number; received: number }[]) {
        out.set(e.root_line_id, { itemId: e.item_id, soLuong: Number(e.so_luong) || 0, received: Number(e.received) || 0 })
      }
    }
  }
  return out
}

/**
 * Trạng thái vật tư mua ngoài theo biên bản. `recordId` có → chỉ trả biên bản đó (vẫn tính phần
 * biên bản khác giữ). Không có → mọi biên bản chưa xuất kho có vật tư mua ngoài / gia công.
 */
export async function computeKtStatuses(factoryId: string, recordId?: string): Promise<KtRecordStatus[]> {
  const sb = getSupabaseAdmin()
  const kt = await findKtWarehouse(factoryId)

  // 1. Biên bản đang giữ hàng (chưa duyệt/huỷ) + biên bản đích.
  const activeRecords = await fetchAllPaginated<RecordRow>((from, to) =>
    sb
      .from("maintenance_records")
      .select("id, ma_bb, bo_phan, trang_thai, created_at")
      .eq("factory_id", factoryId)
      .or("trang_thai.is.null,trang_thai.not.in.(da_duyet,huy)")
      .order("id")
      .range(from, to),
  )
  const records = [...activeRecords]
  if (recordId && !records.some((r) => r.id === recordId)) {
    const { data } = await sb
      .from("maintenance_records")
      .select("id, ma_bb, bo_phan, trang_thai, created_at")
      .eq("factory_id", factoryId)
      .eq("id", recordId)
      .maybeSingle()
    if (data) records.push(data as RecordRow)
  }
  if (!records.length) return []
  const active = records.filter((r) => !RECORD_DONE.has(r.trang_thai || "")).sort(recordOrder)
  const scopeIds = records.map((r) => r.id)

  // 2. Vật tư của các biên bản đó (mua ngoài, gia công, trong kho).
  const materials: MatRow[] = []
  for (let i = 0; i < scopeIds.length; i += CHUNK) {
    const rows = await fetchAllPaginated<MatRow>((from, to) =>
      sb
        .from("maintenance_materials")
        .select("record_id, nguon, inventory_item_id, ten_vat_tu, dvt, so_luong, don_gia, loai_tien")
        .eq("factory_id", factoryId)
        .in("record_id", scopeIds.slice(i, i + CHUNK))
        .in("nguon", ["ben_ngoai", "gia_cong", "trong_kho"])
        .not("inventory_item_id", "is", null)
        .order("id")
        .range(from, to),
    )
    materials.push(...rows)
  }
  const extRecordIds = new Set(materials.filter((m) => m.nguon !== "trong_kho").map((m) => m.record_id))
  const target = recordId
    ? records.filter((r) => r.id === recordId)
    : active.filter((r) => extRecordIds.has(r.id))
  if (!target.length) return []

  // 3. Dòng đề nghị gắn biên bản + hàng đã nhập từ các dòng đó.
  const linkedLines = await loadLinkedLines(factoryId, scopeIds)
  const { earmark, latest } = await loadLinkedReceipts(factoryId, linkedLines)

  // 4. Kho: mua ngoài theo resolveExternalWarehouses, "Trong kho" theo kho chính.
  const extPairs: { recordId: string; itemId: string }[] = []
  const seenPair = new Set<string>()
  for (const m of materials) {
    if (m.nguon !== "ben_ngoai") continue
    const key = `${m.record_id}:${m.inventory_item_id}`
    if (seenPair.has(key)) continue
    seenPair.add(key)
    extPairs.push({ recordId: m.record_id, itemId: m.inventory_item_id as string })
  }
  const { map: whByPair, warehouses: whInfo } = await resolveWithLatest(factoryId, extPairs, latest, kt)
  const inKhoItemIds = Array.from(new Set(materials.filter((m) => m.nguon === "trong_kho").map((m) => m.inventory_item_id as string)))
  const primary = await loadPrimaryWarehouses(factoryId, inKhoItemIds)
  const inKhoWh = (itemId: string) => primary.rule.get(itemId) || primary.fallback.get(itemId) || null

  // 5. Nhu cầu: mua ngoài / gia công theo (biên bản, vật tư); nhu cầu chiếm kho theo (biên bản, kho, vật tư).
  const extNeed = new Map<string, number>() // `${rec}:${item}` (mua ngoài)
  const serviceNeed = new Map<string, number>() // `${rec}:${item}` (gia công)
  const inKhoNeed = new Map<string, number>() // `${rec}:${wh}:${item}`
  const firstMat = new Map<string, MatRow>()
  for (const m of materials) {
    const qty = Number(m.so_luong) || 0
    if (qty <= 0) continue
    const itemId = m.inventory_item_id as string
    const key = `${m.record_id}:${itemId}`
    if (m.nguon === "ben_ngoai") extNeed.set(key, (extNeed.get(key) || 0) + qty)
    else if (m.nguon === "gia_cong") serviceNeed.set(key, (serviceNeed.get(key) || 0) + qty)
    else {
      const wh = inKhoWh(itemId)
      if (wh) inKhoNeed.set(`${m.record_id}:${wh}:${itemId}`, (inKhoNeed.get(`${m.record_id}:${wh}:${itemId}`) || 0) + qty)
      continue
    }
    if (!firstMat.has(key)) firstMat.set(key, m)
  }
  const demand = new Map<string, number>() // `${rec}:${wh}:${item}` = mua ngoài + trong kho
  for (const [key, qty] of extNeed) {
    const wh = whByPair.get(key)
    if (!wh) continue
    const [rec, item] = key.split(":")
    const dk = `${rec}:${wh}:${item}`
    demand.set(dk, (demand.get(dk) || 0) + qty)
  }
  for (const [dk, qty] of inKhoNeed) demand.set(dk, (demand.get(dk) || 0) + qty)

  // 6. Tồn kho + thông tin vật tư.
  const groupKeys = new Set<string>() // `${wh}:${item}`
  for (const dk of demand.keys()) {
    const [, wh, item] = dk.split(":")
    groupKeys.add(`${wh}:${item}`)
  }
  const extItemIds = Array.from(new Set([...extNeed.keys(), ...serviceNeed.keys()].map((k) => k.split(":")[1])))
  const allItemIds = Array.from(new Set([...extItemIds, ...Array.from(groupKeys).map((g) => g.split(":")[1])]))
  const usedWhIds = Array.from(new Set(Array.from(groupKeys).map((g) => g.split(":")[0])))
  const onHand = new Map<string, number>() // `${wh}:${item}`
  const itemInfo = new Map<string, { code: string | null; name: string; unit: string | null }>()
  for (let i = 0; i < allItemIds.length; i += CHUNK) {
    const chunk = allItemIds.slice(i, i + CHUNK)
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

  // 7. Chia tồn từng (kho, vật tư) cho các biên bản đang giữ hàng.
  const allocByKey = new Map<string, number>() // `${rec}:${wh}:${item}`
  const allocTotal = new Map<string, number>() // `${wh}:${item}`
  for (const g of groupKeys) {
    const [wh, item] = g.split(":")
    const list = active
      .map((r) => ({ recordId: r.id, demand: demand.get(`${r.id}:${wh}:${item}`) || 0, earmark: earmark.get(`${r.id}:${wh}:${item}`) || 0 }))
      .filter((d) => d.demand > 0)
    const alloc = allocateGroup(onHand.get(g) || 0, list)
    let sum = 0
    for (const [rec, qty] of alloc) {
      allocByKey.set(`${rec}:${wh}:${item}`, qty)
      sum += qty
    }
    allocTotal.set(g, sum)
  }

  // 8. Phiếu đề nghị liên kết: đang đề nghị (SL hiệu lực − đã nhận), gia công đã xong.
  const reqIds = Array.from(new Set(linkedLines.map((l) => l.request_id)))
  const ownReqIds: string[] = []
  const targetIds = target.map((r) => r.id)
  for (let i = 0; i < targetIds.length; i += CHUNK) {
    const { data } = await sb
      .from("purchase_requests")
      .select("id")
      .eq("factory_id", factoryId)
      .in("maintenance_record_id", targetIds.slice(i, i + CHUNK))
    for (const r of (data || []) as { id: string }[]) ownReqIds.push(r.id)
  }
  const allReqIds = Array.from(new Set([...reqIds, ...ownReqIds]))
  const requests = new Map<string, RequestRow>()
  for (let i = 0; i < allReqIds.length; i += CHUNK) {
    const { data, error } = await sb
      .from("purchase_requests")
      .select("id, so, nam, trang_thai, loai, maintenance_record_id")
      .eq("factory_id", factoryId)
      .in("id", allReqIds.slice(i, i + CHUNK))
    if (error) throw new Error(error.message)
    for (const r of (data || []) as RequestRow[]) requests.set(r.id, r)
  }
  const rootLines = linkedLines.filter((l) => requests.get(l.request_id)?.loai === "goc")
  const activeReqIds = Array.from(new Set(rootLines.map((l) => l.request_id))).filter((id) =>
    PURCHASE_ACTIVE_FOR_KT.includes(requests.get(id)?.trang_thai || ""),
  )
  const effective = await loadEffectiveByLine(activeReqIds)
  const pendingByKey = new Map<string, number>() // `${rec}:${item hiệu lực}`
  for (const l of rootLines) {
    const eff = effective.get(l.id)
    if (!eff?.itemId) continue
    const key = `${l.maintenance_record_id}:${eff.itemId}`
    pendingByKey.set(key, (pendingByKey.get(key) || 0) + Math.max(0, eff.soLuong - eff.received))
  }
  const completedByKey = new Map<string, number>() // `${rec}:${item}` — dịch vụ đã xác nhận hoàn thành
  const rootIds = rootLines.map((l) => l.id)
  const recByRootLine = new Map(rootLines.map((l) => [l.id, l.maintenance_record_id]))
  for (let i = 0; i < rootIds.length; i += CHUNK) {
    const { data } = await sb
      .from("purchase_service_completions")
      .select("line_id, item_id, so_luong")
      .in("line_id", rootIds.slice(i, i + CHUNK))
    for (const c of (data || []) as { line_id: string; item_id: string | null; so_luong: number | null }[]) {
      const rec = recByRootLine.get(c.line_id)
      if (!c.item_id || !rec) continue
      const key = `${rec}:${c.item_id}`
      completedByKey.set(key, (completedByKey.get(key) || 0) + (Number(c.so_luong) || 0))
    }
  }
  const linkedByRecord = new Map<string, Map<string, KtLinkedRequest>>()
  const addLinked = (rec: string, r: RequestRow) => {
    const m = linkedByRecord.get(rec) || new Map<string, KtLinkedRequest>()
    m.set(r.id, { id: r.id, so: r.so, nam: r.nam, trangThai: r.trang_thai, loai: r.loai })
    linkedByRecord.set(rec, m)
  }
  for (const l of linkedLines) {
    const r = requests.get(l.request_id)
    if (r) addLinked(l.maintenance_record_id, r)
  }
  for (const r of requests.values()) if (r.maintenance_record_id) addLinked(r.maintenance_record_id, r)

  // 9. Kết quả.
  const result: KtRecordStatus[] = []
  for (const rec of target) {
    const done = RECORD_DONE.has(rec.trang_thai || "")
    const items: KtItemStatus[] = []
    const info = (itemId: string, mat?: MatRow) => {
      const it = itemInfo.get(itemId)
      return { itemCode: it?.code || null, name: it?.name || mat?.ten_vat_tu || "—", unit: it?.unit || mat?.dvt || null }
    }
    for (const [key, qty] of serviceNeed) {
      const [r, itemId] = key.split(":")
      if (r !== rec.id) continue
      const mat = firstMat.get(key)
      const completed = completedByKey.get(key) || 0
      items.push({
        itemId, kind: "dich_vu", warehouseId: null, warehouseCode: null, ...info(itemId, mat),
        need: qty, onHand: completed, reservedByOthers: 0, available: completed,
        shortage: Math.max(0, qty - completed),
        pendingRequested: pendingByKey.get(key) || 0,
        donGia: Number(mat?.don_gia) || 0, loaiTien: mat?.loai_tien || "USD",
      })
    }
    for (const [key, qty] of extNeed) {
      const [r, itemId] = key.split(":")
      if (r !== rec.id) continue
      const mat = firstMat.get(key)
      const whId = whByPair.get(key) || null
      const stock = whId ? onHand.get(`${whId}:${itemId}`) || 0 : 0
      let available: number
      let reserved: number
      if (done || !whId) {
        available = Math.min(qty, stock)
        reserved = 0
      } else {
        // Phần chia cho biên bản này dùng cho "Trong kho" cùng vật tư trước, còn lại cho mua ngoài.
        const alloc = allocByKey.get(`${rec.id}:${whId}:${itemId}`) || 0
        const inKho = inKhoNeed.get(`${rec.id}:${whId}:${itemId}`) || 0
        available = Math.max(0, alloc - inKho)
        reserved = Math.max(0, (allocTotal.get(`${whId}:${itemId}`) || 0) - alloc)
      }
      items.push({
        itemId, kind: "vat_tu", warehouseId: whId, warehouseCode: whId ? whInfo.get(whId)?.code || null : null,
        ...info(itemId, mat),
        need: qty, onHand: stock, reservedByOthers: reserved, available,
        shortage: Math.max(0, qty - available),
        pendingRequested: pendingByKey.get(key) || 0,
        donGia: Number(mat?.don_gia) || 0, loaiTien: mat?.loai_tien || "USD",
      })
    }
    const totalShortage = done ? 0 : items.reduce((s, it) => s + it.shortage, 0)
    const linked = Array.from(linkedByRecord.get(rec.id)?.values() || [])
    const own = linked.filter((r) => requests.get(r.id)?.maintenance_record_id === rec.id && r.loai === "goc")
    result.push({
      recordId: rec.id,
      maBb: rec.ma_bb,
      boPhan: rec.bo_phan,
      trangThai: rec.trang_thai,
      ktWarehouse: kt,
      items: done ? items.map((it) => ({ ...it, shortage: 0 })) : items,
      totalShortage,
      needsRequest: !done && items.some((it) => it.shortage > it.pendingRequested),
      linkedRequests: linked,
      draftRequest: own.find((r) => r.trangThai === "nhap") || null,
      returnedRequest: own.find((r) => r.trangThai === "tra_ve") || null,
    })
  }
  return result
}
