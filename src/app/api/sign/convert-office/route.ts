import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { convertOfficeUrlToPdfDocumentWithRetry } from "../_lib/cloud-convert"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      docId?: string
      factoryId?: string
      fileKind?: "main" | "change_request" | "review_request"
    }
    const { docId, factoryId, fileKind = "main" } = body

    if (!docId || !factoryId) {
      return NextResponse.json({ ok: false, error: "Thieu docId hoac factoryId" }, { status: 400 })
    }

    const { data: doc, error: docErr } = await supabaseAdmin
      .from("iso_documents")
      .select("id, factory_id, file_goc_url, file_phieu_yeu_cau_thay_doi_url, file_de_nghi_soat_xet_url")
      .eq("id", docId)
      .eq("factory_id", factoryId)
      .single()

    if (docErr || !doc) {
      return NextResponse.json({ ok: false, error: "Khong tim thay tai lieu" }, { status: 404 })
    }

    const fileUrl: string | null =
      fileKind === "change_request"
        ? (doc.file_phieu_yeu_cau_thay_doi_url as string | null)
        : fileKind === "review_request"
          ? (doc.file_de_nghi_soat_xet_url as string | null)
          : (doc.file_goc_url as string | null)

    if (!fileUrl) {
      return NextResponse.json({ ok: false, error: "Tai lieu chua co file de convert" }, { status: 400 })
    }

    const cleanUrl = fileUrl.split("?")[0]
    const ext = cleanUrl.split(".").pop()?.toLowerCase()

    if (ext === "pdf") {
      return NextResponse.json({ ok: true, skipped: true, reason: "already-pdf", pdfUrl: fileUrl })
    }

    if (ext !== "docx" && ext !== "xlsx") {
      return NextResponse.json({ ok: false, error: "Chi ho tro convert DOCX hoac XLSX sang PDF" }, { status: 400 })
    }

    const pdfDoc = await convertOfficeUrlToPdfDocumentWithRetry(fileUrl)
    const pdfBytes = await pdfDoc.save()

    const ts = Date.now()
    const storagePath = `${factoryId}/iso/converted/${docId}_${ts}.pdf`

    const { error: uploadErr } = await supabaseAdmin.storage
      .from("iso-documents")
      .upload(storagePath, Buffer.from(pdfBytes), {
        contentType: "application/pdf",
        upsert: true,
      })

    if (uploadErr) {
      return NextResponse.json({ ok: false, error: `Upload PDF that bai: ${uploadErr.message}` }, { status: 500 })
    }

    const { data: publicData } = supabaseAdmin.storage.from("iso-documents").getPublicUrl(storagePath)
    const pdfUrl = publicData.publicUrl

    const updateField: Record<string, string> =
      fileKind === "change_request"
        ? { file_phieu_yeu_cau_thay_doi_url: pdfUrl }
        : fileKind === "review_request"
          ? { file_de_nghi_soat_xet_url: pdfUrl }
          : { file_goc_url: pdfUrl }

    const { error: updateErr } = await supabaseAdmin
      .from("iso_documents")
      .update(updateField)
      .eq("id", docId)
      .eq("factory_id", factoryId)

    if (updateErr) {
      return NextResponse.json({ ok: false, error: `Cap nhat DB that bai: ${updateErr.message}` }, { status: 500 })
    }

    return NextResponse.json({ ok: true, pdfUrl })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
