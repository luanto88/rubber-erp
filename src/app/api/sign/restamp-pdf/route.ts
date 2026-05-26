import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { PDFDocument, rgb } from "pdf-lib"
import fontkit from "@pdf-lib/fontkit"
import { readFile } from "fs/promises"
import path from "path"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`
}

async function stampFooterHetHieuLuc(
  page: ReturnType<PDFDocument["getPages"]>[number],
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  maTl: string,
  lsStr: string,
  dateStr: string,
) {
  const { width } = page.getSize()
  const text = `${maTl} (${lsStr}-${dateStr})`
  const status = "Hết hiệu lực"
  const fontSize = 9

  page.drawText(text, {
    x: 28, y: 16,
    size: fontSize, font, color: rgb(0.35, 0.38, 0.42),
  })

  const textWidth = font.widthOfTextAtSize(text, fontSize)
  page.drawText(` ${status}`, {
    x: 28 + textWidth + 5, y: 16,
    size: fontSize, font, color: rgb(0.85, 0, 0),
  })

  page.drawLine({
    start: { x: 28, y: 26 },
    end: { x: width - 28, y: 26 },
    thickness: 0.4, color: rgb(0.75, 0.8, 0.85),
  })

  const statusWidth = font.widthOfTextAtSize(status, fontSize + 1)
  page.drawText(status, {
    x: Math.max(28, width - statusWidth - 36),
    y: page.getSize().height - 34,
    size: fontSize + 1,
    font,
    color: rgb(0.85, 0, 0),
  })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { docIds, factoryId }: { docIds: string[]; factoryId: string } = body

    if (!docIds || !Array.isArray(docIds) || docIds.length === 0 || !factoryId) {
      return NextResponse.json({ error: "Thiếu tham số" }, { status: 400 })
    }

    // Verify factoryId by checking at least one doc belongs to it
    const { data: checkData } = await supabaseAdmin
      .from("iso_documents")
      .select("id")
      .eq("factory_id", factoryId)
      .in("id", docIds)
      .limit(1)
    if (!checkData || checkData.length === 0) {
      return NextResponse.json({ error: "Không có quyền truy cập" }, { status: 403 })
    }

    // Fetch all docs
    const { data: docs, error: docsErr } = await supabaseAdmin
      .from("iso_documents")
      .select("id, ma_tai_lieu, lan_ban_hanh, ngay_het_hieu_luc, updated_at, file_goc_url, file_signed_pdf_url")
      .eq("factory_id", factoryId)
      .in("id", docIds)
    if (docsErr || !docs) {
      return NextResponse.json({ error: "Lỗi truy vấn tài liệu" }, { status: 500 })
    }

    const results: { id: string; ok: boolean; error?: string }[] = []

    for (const doc of docs) {
      try {
        const maTl = (doc.ma_tai_lieu as string) || "—"
        const lanSuaDoi = (doc.lan_ban_hanh as number) ?? 0
        const lsStr = String(lanSuaDoi).padStart(2, "0")
        const effectiveDate = (doc.ngay_het_hieu_luc as string) || (doc.updated_at as string)
        const dateStr = fmtDate(effectiveDate)

        // Dùng file_signed_pdf_url nếu có, fallback về file_goc_url
        const sourceUrl = (doc.file_signed_pdf_url as string) || (doc.file_goc_url as string)
        if (!sourceUrl) {
          results.push({ id: doc.id, ok: false, error: "Không có file PDF" })
          continue
        }
        if (!sourceUrl.split("?")[0].toLowerCase().endsWith(".pdf")) {
          results.push({ id: doc.id, ok: true })
          continue
        }

        // Extract storage path
        const urlParts = sourceUrl.split("/storage/v1/object/public/iso-documents/")
        const storagePath = urlParts.length === 2 ? urlParts[1] : null
        if (!storagePath) {
          results.push({ id: doc.id, ok: false, error: "Không parse được storage path" })
          continue
        }

        const { data: pdfData, error: pdfErr } = await supabaseAdmin.storage
          .from("iso-documents")
          .download(decodeURIComponent(storagePath))
        if (pdfErr || !pdfData) {
          results.push({ id: doc.id, ok: false, error: "Không tải được PDF" })
          continue
        }

        const pdfBytes = await pdfData.arrayBuffer()
        const pdfDoc = await PDFDocument.load(pdfBytes)
        pdfDoc.registerFontkit(fontkit)
        const fontBytes = await readFile(path.join(process.cwd(), "public", "fonts", "TimesNewRoman.ttf"))
        const font = await pdfDoc.embedFont(fontBytes)

        for (const page of pdfDoc.getPages()) {
          await stampFooterHetHieuLuc(page, font, maTl, lsStr, dateStr)
        }

        const signedBytes = await pdfDoc.save()
        const outputPath = `${factoryId}/iso/signed/${doc.id}_signed.pdf`

        const { error: uploadErr } = await supabaseAdmin.storage
          .from("iso-documents")
          .upload(outputPath, signedBytes, { contentType: "application/pdf", upsert: true })

        if (uploadErr) {
          results.push({ id: doc.id, ok: false, error: uploadErr.message })
          continue
        }

        const { data: urlData } = supabaseAdmin.storage
          .from("iso-documents")
          .getPublicUrl(outputPath)

        await supabaseAdmin
          .from("iso_documents")
          .update({ file_signed_pdf_url: urlData.publicUrl })
          .eq("id", doc.id)
          .eq("factory_id", factoryId)

        results.push({ id: doc.id, ok: true })
      } catch (e) {
        results.push({ id: doc.id, ok: false, error: e instanceof Error ? e.message : "Lỗi không xác định" })
      }
    }

    const allOk = results.every((r) => r.ok)
    return NextResponse.json({ ok: allOk, results }, { status: allOk ? 200 : 207 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi server" },
      { status: 500 },
    )
  }
}
