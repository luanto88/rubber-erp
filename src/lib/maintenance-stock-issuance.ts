import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { resolveExternalWarehouses } from "@/lib/maintenance-kt"

// Tách từ `handleApprove()` cũ (client, `records/[id]/page.tsx`) để gọi được server-side
// khi ký số hoàn tất (thay thế nút "Phê duyệt" thủ công — xem Giai đoạn Thay thế Phê duyệt
// bằng ký số dùng chung). Giữ nguyên 100% logic nghiệp vụ: nhóm vật tư "trong_kho" theo kho
// nguồn (primaryWarehouseId), kiểm tồn CHÍNH XÁC theo tổng nhu cầu mỗi kho (không dùng số tồn
// đơn lẻ đã cache như bước tiền kiểm cũ — bước đó dùng `currentStock` per-material-line nên có
// thể lọt qua trường hợp nhiều dòng cùng vật tư cộng dồn vượt tồn; bước kiểm chính xác theo
// warehouseBalances vẫn giữ nguyên, chỉ bỏ bước tiền kiểm dư thừa), tạo/reset
// `inventory_documents` (draft) + insert lines + post qua RPC `inventory_post_export_document`.

type MaterialRow = {
  id: string
  inventory_item_id: string | null
  nguon: string | null
  so_luong: number | null
  ten_vat_tu: string | null
}

type ItemRow = {
  id: string
  code: string
  name: string
  unit: string
  specification: string | null
  default_warehouse_ids: string[] | null
  manages_lot: boolean | null
}

export type IssueMaintenanceStockResult = { issueDocIds: string[] }

type ResolvedItem = ItemRow & { primaryWarehouseId: string | null }
type WarehouseRow = { id: string; code: string; name: string }

export type MaintenanceStockShortage = {
  itemId: string
  itemCode: string
  itemName: string
  unit: string
  warehouseCode: string
  /** Nguồn dòng biên bản cộng vào nhu cầu (có thể cả hai nếu cùng mã, cùng kho). */
  nguon: Array<"trong_kho" | "ben_ngoai">
  need: number
  onHand: number
}

export type MaintenanceStockCheck = {
  ok: boolean
  shortages: MaintenanceStockShortage[]
  /** Lỗi chặn xuất kho không phải do thiếu SL (chưa có mã, quản lý lô, chưa có kho...). */
  problems: string[]
  /** Câu tiếng Việt gộp — null khi ok. */
  message: string | null
}

type IssuePlan = {
  groups: Map<string, Array<{ mat: MaterialRow; item: ResolvedItem }>>
  warehouseMap: Map<string, WarehouseRow>
  shortages: MaintenanceStockShortage[]
  problems: string[]
}

/**
 * Bước dùng chung của kiểm tồn + xuất kho: gom vật tư "Trong kho" + "Mua ngoài" của biên bản theo
 * kho nguồn, CỘNG DỒN số lượng theo (kho, vật tư) qua mọi dòng thiết bị, rồi so tồn thật
 * (`inventory_stock_balances.on_hand`). Không ghi gì vào DB, không ném lỗi nghiệp vụ — gom lại.
 * "Gia công ngoài" là dịch vụ, không qua kho (thiếu gia công do maintenance-kt.ts chặn riêng).
 */
async function buildIssuePlan(factoryId: string, recordId: string): Promise<IssuePlan> {
  const supabase = getSupabaseAdmin()
  const plan: IssuePlan = { groups: new Map(), warehouseMap: new Map(), shortages: [], problems: [] }

  const { data: materials, error: matErr } = await supabase
    .from("maintenance_materials")
    .select("id, inventory_item_id, nguon, so_luong, ten_vat_tu")
    .eq("record_id", recordId)
  if (matErr) throw new Error(`Không tải được vật tư biên bản: ${matErr.message}`)

  // GĐ2g + Bước 2: vật tư "Bên ngoài" (mua ngoài) xuất từ kho phiếu Đề nghị mua liên kết biên bản đã
  // nhập hàng về (resolveExternalWarehouses: kho nhập gần nhất → kho mặc định). "Trong kho" theo kho chính.
  const inStockMats = ((materials || []) as MaterialRow[]).filter(
    (m) => (m.nguon === "trong_kho" || m.nguon === "ben_ngoai") && !!m.inventory_item_id && Number(m.so_luong) > 0,
  )
  if (inStockMats.length === 0) return plan
  const extPairs = inStockMats
    .filter((m) => m.nguon === "ben_ngoai")
    .map((m) => ({ recordId, itemId: m.inventory_item_id as string }))
  const extWarehouse = extPairs.length ? (await resolveExternalWarehouses(factoryId, extPairs)).map : new Map<string, string | null>()

  const itemIds = Array.from(new Set(inStockMats.map((m) => m.inventory_item_id as string)))
  const { data: items, error: itemsErr } = await supabase
    .from("inventory_items")
    .select("id, code, name, unit, specification, default_warehouse_ids, manages_lot")
    .eq("factory_id", factoryId)
    .in("id", itemIds)
  if (itemsErr) throw new Error(`Không tải được danh mục vật tư: ${itemsErr.message}`)

  const { data: primaryRules, error: rulesErr } = await supabase
    .from("inventory_item_warehouse_rules")
    .select("item_id, warehouse_id")
    .eq("factory_id", factoryId)
    .eq("is_primary", true)
    .in("item_id", itemIds)
  if (rulesErr) throw new Error(`Không tải được kho chính của vật tư: ${rulesErr.message}`)
  const primaryRuleMap = new Map<string, string>()
  for (const r of (primaryRules || []) as { item_id: string; warehouse_id: string }[]) {
    primaryRuleMap.set(r.item_id, r.warehouse_id)
  }

  const itemMap = new Map<string, ResolvedItem>()
  for (const item of (items || []) as ItemRow[]) {
    const primaryWarehouseId = primaryRuleMap.get(item.id) || (item.default_warehouse_ids || [])[0] || null
    itemMap.set(item.id, { ...item, primaryWarehouseId })
  }

  for (const mat of inStockMats) {
    const item = itemMap.get(mat.inventory_item_id as string)
    if (!item) {
      plan.problems.push(`Không tìm thấy vật tư "${mat.ten_vat_tu || "—"}" trong danh mục kho.`)
      continue
    }
    if (item.manages_lot) {
      plan.problems.push(`Vật tư "${item.name}" đang quản lý theo lô nên chưa thể xuất tự động từ biên bản bảo trì.`)
      continue
    }
    const sourceWarehouseId =
      mat.nguon === "ben_ngoai" ? extWarehouse.get(`${recordId}:${item.id}`) || null : item.primaryWarehouseId
    if (!sourceWarehouseId) {
      plan.problems.push(
        mat.nguon === "ben_ngoai"
          ? `Vật tư mua ngoài "${item.name}" chưa xác định được kho xuất (chưa nhập kho và chưa có kho mặc định).`
          : `Vật tư "${item.name}" chưa được gán kho mặc định trong danh mục kho.`,
      )
      continue
    }
    const group = plan.groups.get(sourceWarehouseId) || []
    group.push({ mat, item })
    plan.groups.set(sourceWarehouseId, group)
  }

  const sourceWarehouseIds = Array.from(plan.groups.keys())
  if (!sourceWarehouseIds.length) return plan

  const { data: sourceWarehouses, error: warehouseErr } = await supabase
    .from("inventory_warehouses")
    .select("id, code, name")
    .eq("factory_id", factoryId)
    .in("id", sourceWarehouseIds)
  if (warehouseErr) throw new Error(`Không tải được kho nguồn: ${warehouseErr.message}`)
  for (const w of (sourceWarehouses || []) as WarehouseRow[]) plan.warehouseMap.set(w.id, w)
  for (const warehouseId of sourceWarehouseIds) {
    if (!plan.warehouseMap.has(warehouseId)) {
      plan.problems.push("Không tìm thấy một trong các kho nguồn mặc định của vật tư trong danh mục kho.")
    }
  }

  // Cộng dồn nhu cầu theo (kho, vật tư) — bắt cả trường hợp nhiều thiết bị cùng dùng 1 mã.
  const { data: balances, error: balanceErr } = await supabase
    .from("inventory_stock_balances")
    .select("warehouse_id, item_id, on_hand")
    .eq("factory_id", factoryId)
    .in("warehouse_id", sourceWarehouseIds)
    .in("item_id", itemIds)
  if (balanceErr) throw new Error(`Không kiểm tra được tồn kho nguồn: ${balanceErr.message}`)
  const onHandMap = new Map<string, number>()
  for (const row of (balances || []) as { warehouse_id: string; item_id: string; on_hand: number | null }[]) {
    onHandMap.set(`${row.warehouse_id}:${row.item_id}`, Number(row.on_hand) || 0)
  }

  // Phiếu xuất cũ ĐÃ GHI SỔ của chính biên bản (X-BT-<mã>...) sẽ bị huỷ trước khi xuất lại ⇒ phần
  // tồn nó đang giữ được trả lại. Cộng vào để "thử xuất lại" biên bản kẹt không báo thiếu nhầm.
  const { data: rec, error: recErr } = await supabase
    .from("maintenance_records")
    .select("ma_bb")
    .eq("id", recordId)
    .eq("factory_id", factoryId)
    .maybeSingle()
  if (recErr) throw new Error(`Không tải được biên bản: ${recErr.message}`)
  if (rec?.ma_bb) {
    const { data: oldDocs, error: oldErr } = await supabase
      .from("inventory_documents")
      .select("id, source_warehouse_id")
      .eq("factory_id", factoryId)
      .eq("status", "posted")
      .like("document_code", `X-BT-${rec.ma_bb}%`)
    if (oldErr) throw new Error(`Không tải được phiếu xuất cũ: ${oldErr.message}`)
    const oldDocRows = (oldDocs || []) as { id: string; source_warehouse_id: string | null }[]
    if (oldDocRows.length) {
      const whByDoc = new Map(oldDocRows.map((d) => [d.id, d.source_warehouse_id]))
      const { data: oldLines, error: oldLinesErr } = await supabase
        .from("inventory_document_lines")
        .select("document_id, item_id, quantity")
        .in("document_id", oldDocRows.map((d) => d.id))
      if (oldLinesErr) throw new Error(`Không tải được dòng phiếu xuất cũ: ${oldLinesErr.message}`)
      for (const l of (oldLines || []) as { document_id: string; item_id: string | null; quantity: number | null }[]) {
        const wh = whByDoc.get(l.document_id)
        if (!wh || !l.item_id) continue
        const key = `${wh}:${l.item_id}`
        onHandMap.set(key, (onHandMap.get(key) || 0) + (Number(l.quantity) || 0))
      }
    }
  }

  for (const [warehouseId, entries] of plan.groups) {
    const warehouse = plan.warehouseMap.get(warehouseId)
    if (!warehouse) continue
    const byItem = new Map<string, { item: ResolvedItem; need: number; nguon: Set<"trong_kho" | "ben_ngoai"> }>()
    for (const { mat, item } of entries) {
      const cur = byItem.get(item.id) || { item, need: 0, nguon: new Set<"trong_kho" | "ben_ngoai">() }
      cur.need += Number(mat.so_luong) || 0
      cur.nguon.add(mat.nguon === "ben_ngoai" ? "ben_ngoai" : "trong_kho")
      byItem.set(item.id, cur)
    }
    for (const { item, need, nguon } of byItem.values()) {
      const onHand = onHandMap.get(`${warehouseId}:${item.id}`) || 0
      if (need > onHand + 1e-9) {
        plan.shortages.push({
          itemId: item.id, itemCode: item.code, itemName: item.name, unit: item.unit,
          warehouseCode: warehouse.code, nguon: Array.from(nguon), need, onHand,
        })
      }
    }
  }
  return plan
}

function describePlanIssues(plan: IssuePlan): string | null {
  const parts = [
    ...plan.problems,
    ...plan.shortages.map((s) => {
      const src = s.nguon.map((n) => (n === "ben_ngoai" ? "Mua ngoài" : "Trong kho")).join(" + ")
      return `"${s.itemName}" (${src}) không đủ tồn tại kho ${s.warehouseCode}: cần ${s.need} ${s.unit}, còn ${s.onHand} ${s.unit}.`
    }),
  ]
  return parts.length ? parts.join(" ") : null
}

/**
 * Kiểm biên bản có xuất kho được không — cộng dồn SL mọi dòng thiết bị, cả "Trong kho" lẫn
 * "Mua ngoài". Dùng khi gửi ký (`create-request`) và trước khi chốt chữ ký bước cuối (`signField`)
 * để biên bản không bao giờ kẹt "đã ký xong nhưng chưa xuất kho". Chỉ đọc.
 */
export async function checkMaintenanceStock(factoryId: string, recordId: string): Promise<MaintenanceStockCheck> {
  const plan = await buildIssuePlan(factoryId, recordId)
  const message = describePlanIssues(plan)
  return { ok: !message, shortages: plan.shortages, problems: plan.problems, message }
}

export async function issueMaintenanceStock(params: {
  recordId: string
  factoryId: string
  approverUserId: string
  approverName: string
  maBb: string
  ngay: string
}): Promise<IssueMaintenanceStockResult> {
  const supabase = getSupabaseAdmin()
  const { recordId, factoryId, approverUserId, approverName, maBb, ngay } = params

  if (!maBb.trim()) throw new Error("Biên bản chưa có mã — không tạo được phiếu xuất kho.")
  const plan = await buildIssuePlan(factoryId, recordId)
  // Kiểm TOÀN BỘ trước khi ghi bất kỳ phiếu nào (trước đây kiểm theo từng kho trong vòng lặp ⇒ kho 1
  // ghi sổ xong, kho 2 mới phát hiện thiếu).
  const issueMessage = describePlanIssues(plan)
  if (issueMessage) throw new Error(issueMessage)
  if (plan.groups.size === 0) return { issueDocIds: [] }

  const issueGroups = plan.groups
  const warehouseMap = plan.warehouseMap
  const baseDocCode = `X-BT-${maBb}`
  const sourceWarehouseIds = Array.from(issueGroups.keys())
  const groupCount = sourceWarehouseIds.length
  const desiredDocCodes = new Set(
    sourceWarehouseIds.map((wid) => (groupCount === 1 ? baseDocCode : `${baseDocCode}-${warehouseMap.get(wid)!.code}`)),
  )

  const { data: existingDocs, error: existingDocsErr } = await supabase
    .from("inventory_documents")
    .select("id, status, document_code")
    .eq("factory_id", factoryId)
    .like("document_code", `${baseDocCode}%`)
  if (existingDocsErr) throw new Error(`Không tải được phiếu xuất kho cũ: ${existingDocsErr.message}`)
  const existingDocMap = new Map<string, { id: string; status: string | null; document_code: string }>()
  for (const doc of (existingDocs || []) as { id: string; status: string | null; document_code: string }[]) {
    existingDocMap.set(doc.document_code, doc)
  }

  for (const doc of (existingDocs || []) as { id: string; status: string | null; document_code: string }[]) {
    if (desiredDocCodes.has(doc.document_code)) continue
    if (doc.status === "posted") {
      const { error: cancelExtraErr } = await supabase.rpc("inventory_cancel_document", {
        p_factory_id: factoryId,
        p_document_id: doc.id,
        p_cancelled_by: approverUserId,
        p_cancel_reason: `Làm mới phiếu xuất của biên bản ${maBb}`,
      })
      if (cancelExtraErr) throw new Error(`Lỗi dọn phiếu xuất kho cũ: ${cancelExtraErr.message}`)
    }
  }

  const issueDocIdsCreated: string[] = []

  // C1: kho thứ N lỗi ⇒ huỷ các phiếu đã ghi sổ trong CHÍNH lượt này rồi mới ném lỗi — không để
  // "phiếu xuất mồ côi" đã trừ tồn mà biên bản không lưu id. (Tồn đủ đã kiểm trước ở buildIssuePlan;
  // RPC inventory_post_export_document vẫn là chốt chặn cuối khi tồn đổi giữa chừng.)
  try {
  for (const warehouseId of sourceWarehouseIds) {
    const sourceWarehouse = warehouseMap.get(warehouseId)!
    const issueLineDrafts = issueGroups.get(warehouseId) || []

    const docCode = groupCount === 1 ? baseDocCode : `${baseDocCode}-${sourceWarehouse.code}`
    const existingDoc = existingDocMap.get(docCode)

    if (existingDoc?.status === "posted") {
      const { error: cancelErr } = await supabase.rpc("inventory_cancel_document", {
        p_factory_id: factoryId,
        p_document_id: existingDoc.id,
        p_cancelled_by: approverUserId,
        p_cancel_reason: `Làm mới phiếu xuất của biên bản ${maBb}`,
      })
      if (cancelErr) throw new Error(`Lỗi hoàn tác phiếu xuất cũ: ${cancelErr.message}`)
    }

    let currentIssueDocId: string
    if (existingDoc) {
      const { error: deleteLinesErr } = await supabase.from("inventory_document_lines").delete().eq("document_id", existingDoc.id)
      if (deleteLinesErr) throw new Error(`Lỗi xóa dòng phiếu xuất cũ: ${deleteLinesErr.message}`)

      const { error: resetDocErr } = await supabase
        .from("inventory_documents")
        .update({
          document_date: ngay,
          source_warehouse_id: sourceWarehouse.id,
          target_warehouse_id: null,
          source_name: sourceWarehouse.name,
          recipient_name: null,
          requester_name: approverName,
          created_by: approverUserId,
          status: "draft",
          notes: `Xuất kho cho biên bản sửa chữa/bảo trì số: ${maBb}`,
        })
        .eq("id", existingDoc.id)
      if (resetDocErr) throw new Error(`Lỗi cập nhật phiếu xuất kho: ${resetDocErr.message}`)
      currentIssueDocId = existingDoc.id
    } else {
      const { data: issueDoc, error: issueErr } = await supabase
        .from("inventory_documents")
        .insert({
          factory_id: factoryId,
          document_type: "export",
          document_code: docCode,
          document_date: ngay,
          source_warehouse_id: sourceWarehouse.id,
          target_warehouse_id: null,
          source_name: sourceWarehouse.name,
          recipient_name: null,
          status: "draft",
          notes: `Xuất kho cho biên bản sửa chữa/bảo trì số: ${maBb}`,
          requester_name: approverName,
          created_by: approverUserId,
        })
        .select("id")
        .single()
      if (issueErr || !issueDoc?.id) throw new Error(`Lỗi tạo phiếu xuất kho: ${issueErr?.message || "Không tạo được phiếu xuất"}`)
      currentIssueDocId = issueDoc.id
    }

    const issueLines = issueLineDrafts.map(({ mat, item }) => ({
      document_id: currentIssueDocId,
      factory_id: factoryId,
      item_id: item.id,
      item_code: item.code,
      item_name: item.name,
      unit: item.unit,
      specification: item.specification || null,
      quantity: mat.so_luong || 0,
      lot_no: null,
      expiry_date: null,
      location_code: sourceWarehouse.code,
      line_notes: mat.ten_vat_tu || item.name,
      image_urls: [],
    }))
    const { error: lineErr } = await supabase.from("inventory_document_lines").insert(issueLines)
    if (lineErr) throw new Error(`Lỗi thêm dòng phiếu xuất: ${lineErr.message}`)

    const { error: postErr } = await supabase.rpc("inventory_post_export_document", {
      p_factory_id: factoryId,
      p_document_id: currentIssueDocId,
      p_posted_by: approverUserId,
    })
    if (postErr) throw new Error(`Lỗi ghi sổ phiếu xuất kho ${sourceWarehouse.code}: ${postErr.message}`)

    issueDocIdsCreated.push(currentIssueDocId)
  }
  } catch (err) {
    const rollbackErrors: string[] = []
    for (const documentId of issueDocIdsCreated) {
      const { error: rbErr } = await supabase.rpc("inventory_cancel_document", {
        p_factory_id: factoryId,
        p_document_id: documentId,
        p_cancelled_by: approverUserId,
        p_cancel_reason: `Hoàn tác xuất kho dở dang của biên bản ${maBb}`,
      })
      if (rbErr) rollbackErrors.push(rbErr.message)
    }
    const base = err instanceof Error ? err.message : String(err)
    throw new Error(
      rollbackErrors.length
        ? `${base} — KHÔNG hoàn tác được ${rollbackErrors.length} phiếu xuất đã ghi sổ (${rollbackErrors.join("; ")}), báo admin kiểm tra kho.`
        : issueDocIdsCreated.length
          ? `${base} — đã hoàn tác ${issueDocIdsCreated.length} phiếu xuất ghi sổ trước đó.`
          : base,
    )
  }

  return { issueDocIds: issueDocIdsCreated }
}

/** Hoàn tồn kho toàn bộ phiếu xuất đã tạo cho 1 biên bản — dùng khi "Hủy sau khi hoàn tất". */
export async function reverseMaintenanceStockIssuance(params: {
  factoryId: string
  issueDocIds: string[]
  cancelledByUserId: string
  reason: string
}): Promise<void> {
  const supabase = getSupabaseAdmin()
  for (const documentId of params.issueDocIds) {
    const { error } = await supabase.rpc("inventory_cancel_document", {
      p_factory_id: params.factoryId,
      p_document_id: documentId,
      p_cancelled_by: params.cancelledByUserId,
      p_cancel_reason: params.reason,
    })
    if (error) throw new Error(`Lỗi hủy phiếu xuất kho: ${error.message}`)
  }
}
