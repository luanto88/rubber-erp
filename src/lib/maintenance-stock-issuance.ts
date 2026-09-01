import { getSupabaseAdmin } from "@/lib/supabase-admin"

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

  const { data: materials, error: matErr } = await supabase
    .from("maintenance_materials")
    .select("id, inventory_item_id, nguon, so_luong, ten_vat_tu")
    .eq("record_id", recordId)
  if (matErr) throw new Error(`Không tải được vật tư biên bản: ${matErr.message}`)

  const inStockMats = ((materials || []) as MaterialRow[]).filter(
    (m) => m.nguon === "trong_kho" && !!m.inventory_item_id,
  )
  if (inStockMats.length === 0) return { issueDocIds: [] }

  const itemIds = Array.from(new Set(inStockMats.map((m) => m.inventory_item_id as string)))
  const { data: items, error: itemsErr } = await supabase
    .from("inventory_items")
    .select("id, code, name, unit, specification, default_warehouse_ids, manages_lot")
    .eq("factory_id", factoryId)
    .in("id", itemIds)
  if (itemsErr) throw new Error(`Không tải được danh mục vật tư: ${itemsErr.message}`)

  const { data: primaryRules } = await supabase
    .from("inventory_item_warehouse_rules")
    .select("item_id, warehouse_id")
    .eq("factory_id", factoryId)
    .eq("is_primary", true)
    .in("item_id", itemIds)
  const primaryRuleMap = new Map<string, string>()
  for (const r of (primaryRules || []) as { item_id: string; warehouse_id: string }[]) {
    primaryRuleMap.set(r.item_id, r.warehouse_id)
  }

  type ResolvedItem = ItemRow & { primaryWarehouseId: string | null }
  const itemMap = new Map<string, ResolvedItem>()
  for (const item of (items || []) as ItemRow[]) {
    const primaryWarehouseId = primaryRuleMap.get(item.id) || (item.default_warehouse_ids || [])[0] || null
    itemMap.set(item.id, { ...item, primaryWarehouseId })
  }

  const issueGroups = new Map<string, Array<{ mat: MaterialRow; item: ResolvedItem }>>()
  for (const mat of inStockMats) {
    const item = itemMap.get(mat.inventory_item_id as string)
    if (!item) throw new Error(`Không tìm thấy vật tư "${mat.ten_vat_tu || "—"}" trong danh mục kho.`)
    if (item.manages_lot) {
      throw new Error(`Vật tư "${item.name}" đang quản lý theo lô nên chưa thể xuất tự động từ biên bản bảo trì.`)
    }
    if (!item.primaryWarehouseId) {
      throw new Error(`Vật tư "${item.name}" chưa được gán kho mặc định trong danh mục inventory.`)
    }
    const group = issueGroups.get(item.primaryWarehouseId) || []
    group.push({ mat, item })
    issueGroups.set(item.primaryWarehouseId, group)
  }

  const baseDocCode = `X-BT-${maBb}`
  const sourceWarehouseIds = Array.from(issueGroups.keys())

  const { data: sourceWarehouses, error: warehouseErr } = await supabase
    .from("inventory_warehouses")
    .select("id, code, name")
    .eq("factory_id", factoryId)
    .in("id", sourceWarehouseIds)
  if (warehouseErr) throw new Error(`Không tải được kho nguồn: ${warehouseErr.message}`)
  const warehouseMap = new Map<string, { id: string; code: string; name: string }>()
  for (const w of (sourceWarehouses || []) as { id: string; code: string; name: string }[]) warehouseMap.set(w.id, w)
  for (const warehouseId of sourceWarehouseIds) {
    if (!warehouseMap.has(warehouseId)) {
      throw new Error("Không tìm thấy một trong các kho nguồn mặc định của vật tư trong danh mục inventory.")
    }
  }

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

  for (const warehouseId of sourceWarehouseIds) {
    const sourceWarehouse = warehouseMap.get(warehouseId)!
    const issueLineDrafts = issueGroups.get(warehouseId) || []
    const requestedQtyByItem = new Map<string, number>()
    for (const entry of issueLineDrafts) {
      requestedQtyByItem.set(entry.item.id, (requestedQtyByItem.get(entry.item.id) || 0) + (entry.mat.so_luong || 0))
    }

    const { data: warehouseBalances, error: balanceErr } = await supabase
      .from("inventory_stock_balances")
      .select("item_id, on_hand")
      .eq("factory_id", factoryId)
      .eq("warehouse_id", sourceWarehouse.id)
      .in("item_id", Array.from(requestedQtyByItem.keys()))
    if (balanceErr) throw new Error(`Không kiểm tra được tồn kho nguồn: ${balanceErr.message}`)
    const warehouseStockMap = new Map<string, number>()
    for (const row of (warehouseBalances || []) as { item_id: string; on_hand: number | null }[]) {
      warehouseStockMap.set(row.item_id, row.on_hand || 0)
    }

    for (const [itemId, requestedQty] of requestedQtyByItem.entries()) {
      const item = issueLineDrafts.find((e) => e.item.id === itemId)?.item
      const stockInWarehouse = warehouseStockMap.get(itemId) || 0
      if (item && requestedQty > stockInWarehouse) {
        throw new Error(
          `Vật tư "${item.name}" không đủ tồn tại kho ${sourceWarehouse.code} (cần ${requestedQty} ${item.unit}, còn ${stockInWarehouse} ${item.unit}).`,
        )
      }
    }

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
    if (postErr) throw new Error(`Lỗi ghi sổ phiếu xuất: ${postErr.message}`)

    issueDocIdsCreated.push(currentIssueDocId)
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
