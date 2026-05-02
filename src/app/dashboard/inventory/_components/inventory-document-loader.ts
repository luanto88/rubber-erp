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
  posted_by: string | null
  posted_at: string | null
  posted_by_name: string | null
  cancelled_by: string | null
  cancelled_at: string | null
  cancel_reason: string | null
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
      "id, document_code, document_date, source_warehouse_id, target_warehouse_id, source_name, recipient_name, requester_name, status, notes, posted_by, posted_at, cancelled_by, cancelled_at, cancel_reason",
    )
    .eq("factory_id", factoryId)
    .eq("document_type", documentType)

  query = documentId ? query.eq("id", documentId) : query.eq("document_code", code as string)

  const documentResult = await query.maybeSingle()
  if (documentResult.error || !documentResult.data) {
    return null
  }

  const docData = documentResult.data as InventoryDocumentHeader & { posted_by_name?: string | null }

  if (docData.posted_by) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", docData.posted_by)
      .maybeSingle()
    docData.posted_by_name = profile?.full_name ?? null
  } else {
    docData.posted_by_name = null
  }

  const lineResult = await supabase
    .from("inventory_document_lines")
    .select("id, item_id, item_code, item_name, unit, specification, quantity, lot_no, expiry_date, line_notes, image_urls")
    .eq("factory_id", factoryId)
    .eq("document_id", docData.id)
    .order("created_at", { ascending: true })

  if (lineResult.error) {
    return null
  }

  return {
    document: docData,
    lines: (lineResult.data || []) as InventoryDocumentLine[],
  }
}
