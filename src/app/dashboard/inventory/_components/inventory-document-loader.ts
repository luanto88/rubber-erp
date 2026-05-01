"use client"

import { supabase } from "@/lib/supabase"

type InventoryDocumentType = "import" | "export" | "transfer"

type InventoryDocumentHeader = {
  id: string
  document_code: string
  document_date: string
  source_warehouse_id: string | null
  target_warehouse_id: string | null
  source_name: string | null
  recipient_name: string | null
  requester_name: string | null
  status: "draft" | "posted" | "cancelled"
  notes: string | null
}

type InventoryDocumentLine = {
  id: string
  item_id: string
  item_code: string
  item_name: string
  unit: string
  specification: string | null
  quantity: number
  lot_no: string | null
  expiry_date: string | null
  line_notes: string | null
  image_urls: string[] | null
}

export async function fetchInventoryDocumentByReference(
  factoryId: string,
  documentType: InventoryDocumentType,
  reference: { documentId?: string | null; code?: string | null },
) {
  const documentId = reference.documentId?.trim() || null
  const code = reference.code?.trim() || null

  if (!documentId && !code) {
    return null
  }

  let query = supabase
    .from("inventory_documents")
    .select(
      "id, document_code, document_date, source_warehouse_id, target_warehouse_id, source_name, recipient_name, requester_name, status, notes",
    )
    .eq("factory_id", factoryId)
    .eq("document_type", documentType)

  query = documentId ? query.eq("id", documentId) : query.eq("document_code", code as string)

  const documentResult = await query.maybeSingle()
  if (documentResult.error || !documentResult.data) {
    return null
  }

  const lineResult = await supabase
    .from("inventory_document_lines")
    .select("id, item_id, item_code, item_name, unit, specification, quantity, lot_no, expiry_date, line_notes, image_urls")
    .eq("factory_id", factoryId)
    .eq("document_id", documentResult.data.id)
    .order("created_at", { ascending: true })

  if (lineResult.error) {
    return null
  }

  return {
    document: documentResult.data as InventoryDocumentHeader,
    lines: (lineResult.data || []) as InventoryDocumentLine[],
  }
}
