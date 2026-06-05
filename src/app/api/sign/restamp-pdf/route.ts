import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { PDFDocument, rgb } from "pdf-lib"
import fontkit from "@pdf-lib/fontkit"
import { readFile } from "fs/promises"
import path from "path"
import JSZip from "jszip"
import ExcelJS from "exceljs"

// Polyfill DOMMatrix for pdfjs-dist v5 on Node.js (Vercel Node runtime lacks this Web API)
if (typeof globalThis.DOMMatrix === "undefined") {
  class DOMMatrixPolyfill {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0
    m11 = 1; m12 = 0; m21 = 0; m22 = 1; m41 = 0; m42 = 0
    is2D = true; isIdentity = true
    constructor(init?: number[]) {
      if (Array.isArray(init) && init.length >= 6) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = init
        this.m11 = init[0]; this.m12 = init[1]; this.m21 = init[2]
        this.m22 = init[3]; this.m41 = init[4]; this.m42 = init[5]
      }
    }
    multiply(o: DOMMatrixPolyfill) {
      return new DOMMatrixPolyfill([
        this.a * o.a + this.c * o.b, this.b * o.a + this.d * o.b,
        this.a * o.c + this.c * o.d, this.b * o.c + this.d * o.d,
        this.a * o.e + this.c * o.f + this.e, this.b * o.e + this.d * o.f + this.f,
      ])
    }
    inverse() {
      const det = this.a * this.d - this.b * this.c
      if (!det) return new DOMMatrixPolyfill()
      return new DOMMatrixPolyfill([
        this.d / det, -this.b / det, -this.c / det, this.a / det,
        (this.c * this.f - this.d * this.e) / det,
        (this.b * this.e - this.a * this.f) / det,
      ])
    }
    transformPoint(p: { x: number; y: number }) {
      return { x: this.a * p.x + this.c * p.y + this.e, y: this.b * p.x + this.d * p.y + this.f }
    }
    static fromMatrix(o: DOMMatrixPolyfill) {
      return new DOMMatrixPolyfill([o.a, o.b, o.c, o.d, o.e, o.f])
    }
  }
  ;(globalThis as Record<string, unknown>).DOMMatrix = DOMMatrixPolyfill
  ;(globalThis as Record<string, unknown>).DOMMatrixReadOnly = DOMMatrixPolyfill
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

type InvalidatedDoc = {
  id: string
  ma_tai_lieu: string | null
  lan_ban_hanh: string | null
  ngay_het_hieu_luc: string | null
  updated_at: string | null
  file_goc_url: string | null
  file_signed_pdf_url: string | null
  file_signed_office_url: string | null
  file_signed_office_type: string | null
}

type PdfjsTextItem = {
  str: string
  transform: number[]
  width: number
  height: number
}

type PdfTextLine = {
  text: string
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`
}

function normalizeRevisionText(value: unknown): string {
  const text = String(value ?? "").trim()
  return text || "00"
}

function normalizeSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeOutputName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 140) || "ISO"
}

function safeDecodeUri(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function xmlTextDecode(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

function textRunXml(text: string, runProperties = ""): string {
  return text ? `<w:r>${runProperties}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>` : ""
}

function getStoragePathCandidatesFromUrl(fileUrl: string | null, bucket: string): string[] {
  if (!fileUrl) return []

  const candidates: string[] = []
  const pushCandidate = (value: string | null) => {
    if (!value) return
    const clean = value.replace(/^\/+/, "").trim()
    if (!clean || /[\\?#]/.test(clean)) return
    if (!candidates.includes(clean)) candidates.push(clean)
  }

  const cleanUrl = fileUrl.split("?")[0]
  try {
    const parsed = new URL(cleanUrl)
    const marker = "/storage/v1/object/"
    const markerIndex = parsed.pathname.indexOf(marker)
    if (markerIndex >= 0) {
      const parts = parsed.pathname.slice(markerIndex + marker.length).split("/").filter(Boolean)
      if (parts.length >= 3 && ["public", "sign", "authenticated"].includes(parts[0]) && parts[1] === bucket) {
        const rel = parts.slice(2).join("/")
        pushCandidate(rel)
        pushCandidate(safeDecodeUri(rel))
      }
    }
  } catch {
    // fallback below
  }

  const marker = `/storage/v1/object/public/${bucket}/`
  const markerIndex = cleanUrl.indexOf(marker)
  if (markerIndex >= 0) {
    const rel = cleanUrl.slice(markerIndex + marker.length)
    pushCandidate(rel)
    pushCandidate(safeDecodeUri(rel))
  }

  if (!/^https?:\/\//i.test(cleanUrl)) {
    pushCandidate(cleanUrl)
    pushCandidate(safeDecodeUri(cleanUrl))
  }

  return candidates
}

async function downloadStorageFile(fileUrl: string | null): Promise<ArrayBuffer> {
  const errors: string[] = []
  for (const candidate of getStoragePathCandidatesFromUrl(fileUrl, "iso-documents")) {
    const { data, error } = await supabaseAdmin.storage.from("iso-documents").download(candidate)
    if (data && !error) return await data.arrayBuffer()
    errors.push(`${candidate}: ${error?.message || "empty data"}`)
  }

  if (fileUrl) {
    const res = await fetch(fileUrl, { cache: "no-store" })
    if (res.ok) return await res.arrayBuffer()
    errors.push(`fetch: HTTP ${res.status}`)
  }

  throw new Error(`Không tải được file cần đóng dấu hết hiệu lực. ${errors.join("; ")}`)
}

function groupTextItemsIntoLines(items: PdfjsTextItem[]): PdfTextLine[] {
  const sorted = [...items]
    .filter((item) => item.str && item.str.trim())
    .sort((a, b) => {
      const dy = b.transform[5] - a.transform[5]
      if (Math.abs(dy) > 2) return dy
      return a.transform[4] - b.transform[4]
    })

  const lines: Array<PdfTextLine & { items: PdfjsTextItem[] }> = []
  for (const item of sorted) {
    const y = item.transform[5]
    const x = item.transform[4]
    const width = item.width || 0
    const height = item.height || 10
    const line = lines.find((candidate) => Math.abs(candidate.items[0].transform[5] - y) <= 2)
    if (!line) {
      lines.push({
        items: [item],
        text: item.str,
        minX: x,
        minY: y,
        maxX: x + width,
        maxY: y + height,
      })
      continue
    }

    line.items.push(item)
    line.items.sort((a, b) => a.transform[4] - b.transform[4])
    line.text = line.items.map((part) => part.str).join(" ").replace(/\s+/g, " ").trim()
    line.minX = Math.min(line.minX, x)
    line.minY = Math.min(line.minY, y)
    line.maxX = Math.max(line.maxX, x + width)
    line.maxY = Math.max(line.maxY, y + height)
  }

  return lines.map((line) => ({
    text: line.text,
    minX: line.minX,
    minY: line.minY,
    maxX: line.maxX,
    maxY: line.maxY,
  }))
}

function getInvalidatedReplacement(lineText: string, maTl: string, revision: string, expiredDate: string): { text: string; color: ReturnType<typeof rgb> } | null {
  const normalizedLine = normalizeSearchText(lineText)
  if (!normalizedLine || normalizedLine.includes("het hieu luc")) return null

  if (normalizedLine.startsWith("ngay hieu luc") || normalizedLine.startsWith("ngay het hieu luc")) {
    return { text: `Ngày hết hiệu lực: ${expiredDate}`, color: rgb(0.15, 0.15, 0.15) }
  }

  if (normalizedLine.includes("tinh trang")) {
    return { text: "Tình trạng: Hết hiệu lực", color: rgb(0.85, 0, 0) }
  }

  if (/\d{2}\/\d{2}\/\d{4}/.test(lineText) && /(co hieu luc|cho xem xet|cho phe duyet|tra ve|phe duyet tu choi)/.test(normalizedLine)) {
    return { text: `${maTl} (${revision}-${expiredDate}) Hết hiệu lực`, color: rgb(0.85, 0, 0) }
  }

  return null
}

async function replaceInvalidatedPdfText(
  pdfDoc: PDFDocument,
  pdfBytes: ArrayBuffer,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  maTl: string,
  revision: string,
  expiredDate: string,
) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfjsLib: any = await import("pdfjs-dist/legacy/build/pdf.mjs")
    const loadingTask = pdfjsLib.getDocument({ data: pdfBytes })
    const pdfJsDoc = await loadingTask.promise
    const pages = pdfDoc.getPages()

    for (let pageIdx = 0; pageIdx < pdfJsDoc.numPages; pageIdx++) {
      const pdfJsPage = await pdfJsDoc.getPage(pageIdx + 1)
      const textContent = await pdfJsPage.getTextContent()
      const pdfLibPage = pages[pageIdx]
      if (!pdfLibPage) continue

      const { width: pageWidth, height: pageHeight } = pdfLibPage.getSize()
      const viewport = pdfJsPage.getViewport({ scale: 1 })
      const scaleX = viewport.width / pageWidth
      const scaleY = viewport.height / pageHeight
      const lines = groupTextItemsIntoLines(textContent.items as PdfjsTextItem[])

      for (const line of lines) {
        const replacement = getInvalidatedReplacement(line.text, maTl, revision, expiredDate)
        if (!replacement) continue

        const x = line.minX / scaleX
        const y = line.minY / scaleY
        const lineWidth = (line.maxX - line.minX) / scaleX
        const lineHeight = Math.max((line.maxY - line.minY) / scaleY, 10)
        const fontSize = Math.max(lineHeight * 0.9, 8)
        const coverWidth = Math.max(lineWidth, font.widthOfTextAtSize(replacement.text, fontSize)) + 8

        pdfLibPage.drawRectangle({
          x: x - 2,
          y: y - 2,
          width: coverWidth,
          height: lineHeight + 5,
          color: rgb(1, 1, 1),
          opacity: 1,
        })
        pdfLibPage.drawText(replacement.text, {
          x,
          y,
          size: fontSize,
          font,
          color: replacement.color,
        })
      }
    }
  } catch {
    // best effort only
  }
}

function stampPdfInvalidatedMark(
  pdfDoc: PDFDocument,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
) {
  for (const page of pdfDoc.getPages()) {
    const { width, height } = page.getSize()
    const stampText = "HẾT HIỆU LỰC"
    let fontSize = 22
    while (fontSize > 14 && font.widthOfTextAtSize(stampText, fontSize) > width - 120) {
      fontSize -= 1
    }
    const textWidth = font.widthOfTextAtSize(stampText, fontSize)

    page.drawLine({
      start: { x: 28, y: 26 },
      end: { x: width - 28, y: 26 },
      thickness: 0.4,
      color: rgb(0.75, 0.8, 0.85),
    })
    page.drawText(stampText, {
      x: (width - textWidth) / 2,
      y: height - 42,
      size: fontSize,
      font,
      color: rgb(0.85, 0, 0),
    })
  }
}

function docxParagraphVisibleText(paragraphXml: string): string {
  return [...paragraphXml.matchAll(/<(?:w|a):t\b[^>]*>([\s\S]*?)<\/(?:w|a):t>/g)]
    .map((match) => xmlTextDecode(match[1]))
    .join("")
}

function replaceInvalidationVisibleText(text: string, maTl: string, revision: string, expiredDate: string): string {
  let next = text
  next = next.replace(/(?:Ngày hiệu lực|Ngày hết hiệu lực)\s*:\s*.*/iu, `Ngày hết hiệu lực: ${expiredDate}`)
  next = next.replace(/(?:Tình trạng|Trạng thái)\s*:\s*.*/iu, "Tình trạng: Hết hiệu lực")

  const normalizedLine = normalizeSearchText(next)
  if (/\d{2}\/\d{2}\/\d{4}/.test(next) && /(co hieu luc|cho xem xet|cho phe duyet|tra ve|phe duyet tu choi|tinh trang)/.test(normalizedLine)) {
    const footerLike = /^(?:[A-Z]{2,}(?:-[A-Z0-9Đ]+)+|Mã\s+(?:tài\s+liệu|hồ\s+sơ))\s*\([^)]*\)\s*.*$/u
    if (footerLike.test(next.trim())) {
      next = `${maTl} (${revision}-${expiredDate}) Hết hiệu lực`
    }
  }

  if (next.trim() === "Có hiệu lực") return "Hết hiệu lực"
  return next
}

function replaceDocxParagraphText(
  xml: string,
  replacer: (text: string) => string,
): string {
  return xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paragraphXml) => {
    const visibleText = docxParagraphVisibleText(paragraphXml)
    if (!visibleText) return paragraphXml

    const nextText = replacer(visibleText)
    if (nextText === visibleText) return paragraphXml

    const paragraphProps = paragraphXml.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)?.[0] || ""
    const runProps = paragraphXml.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/)?.[0] || ""
    return `<w:p>${paragraphProps}${textRunXml(nextText, runProps)}</w:p>`
  })
}

function ensureDocxPngContentType(contentTypesXml: string): string {
  if (contentTypesXml.includes('Extension="png"')) return contentTypesXml
  return contentTypesXml.replace("</Types>", '<Default Extension="png" ContentType="image/png"/></Types>')
}

function buildInvalidatedStampParagraph(): string {
  const runProperties = [
    "<w:rPr>",
    "<w:b/>",
    '<w:color w:val="C00000"/>',
    '<w:sz w:val="28"/>',
    '<w:szCs w:val="28"/>',
    "</w:rPr>",
  ].join("")

  return [
    "<w:p>",
    "<w:pPr>",
    '<w:jc w:val="center"/>',
    '<w:spacing w:after="120"/>',
    "</w:pPr>",
    textRunXml("HẾT HIỆU LỰC", runProperties),
    "</w:p>",
  ].join("")
}

async function renderInvalidatedDocx(
  bytes: ArrayBuffer,
  maTl: string,
  revision: string,
  expiredDate: string,
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(bytes)
  const contentTypes = await zip.file("[Content_Types].xml")?.async("string")
  if (contentTypes) zip.file("[Content_Types].xml", ensureDocxPngContentType(contentTypes))

  const xmlParts = Object.keys(zip.files).filter((name) => /^word\/(?:document|header\d+|footer\d+)\.xml$/.test(name))
  for (const partPath of xmlParts) {
    const file = zip.file(partPath)
    if (!file) continue
    const xml = await file.async("string")
    zip.file(partPath, replaceDocxParagraphText(xml, (text) => replaceInvalidationVisibleText(text, maTl, revision, expiredDate)))
  }

  const documentXmlFile = zip.file("word/document.xml")
  if (documentXmlFile) {
    const documentXml = await documentXmlFile.async("string")
    if (!normalizeSearchText(docxParagraphVisibleText(documentXml)).includes("het hieu luc")) {
      const stampParagraph = buildInvalidatedStampParagraph()
      zip.file("word/document.xml", documentXml.replace("<w:body>", `<w:body>${stampParagraph}`))
    }
  }

  return await zip.generateAsync({ type: "nodebuffer" })
}

async function renderInvalidatedXlsx(
  bytes: ArrayBuffer,
  maTl: string,
  revision: string,
  expiredDate: string,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes)

  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        const text = typeof cell.value === "string" ? cell.value : null
        if (!text) return
        cell.value = replaceInvalidationVisibleText(text, maTl, revision, expiredDate)
      })
    })
  })

  return Buffer.from(await workbook.xlsx.writeBuffer())
}

function getMainSourceUrl(doc: InvalidatedDoc): string | null {
  return doc.file_signed_pdf_url || doc.file_signed_office_url || doc.file_goc_url
}

function buildOfficeUpdatePayload(doc: InvalidatedDoc, publicUrl: string, ext: string): Record<string, string | null> {
  if (doc.file_signed_office_url) {
    return { file_signed_office_url: publicUrl, file_signed_office_type: ext }
  }
  return { file_goc_url: publicUrl, file_signed_office_url: null, file_signed_office_type: null }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { docIds, factoryId }: { docIds: string[]; factoryId: string } = body

    if (!docIds || !Array.isArray(docIds) || docIds.length === 0 || !factoryId) {
      return NextResponse.json({ error: "Thiếu tham số" }, { status: 400 })
    }

    const { data: docs, error: docsErr } = await supabaseAdmin
      .from("iso_documents")
      .select("id, ma_tai_lieu, lan_ban_hanh, ngay_het_hieu_luc, updated_at, file_goc_url, file_signed_pdf_url, file_signed_office_url, file_signed_office_type")
      .eq("factory_id", factoryId)
      .in("id", docIds)

    if (docsErr || !docs) {
      return NextResponse.json({ error: "Lỗi truy vấn tài liệu" }, { status: 500 })
    }

    const results: Array<{ id: string; ok: boolean; type?: string; error?: string }> = []
    const fontBytes = await readFile(path.join(process.cwd(), "public", "fonts", "TimesNewRoman.ttf"))

    for (const rawDoc of docs as InvalidatedDoc[]) {
      try {
        const maTl = rawDoc.ma_tai_lieu || "ISO"
        const revision = normalizeRevisionText(rawDoc.lan_ban_hanh)
        const expiredDate = fmtDate(rawDoc.ngay_het_hieu_luc || rawDoc.updated_at)
        const sourceUrl = getMainSourceUrl(rawDoc)
        if (!sourceUrl) {
          results.push({ id: rawDoc.id, ok: false, error: "Không có file chính để đóng dấu hết hiệu lực" })
          continue
        }

        const ext = sourceUrl.split("?")[0].split(".").pop()?.toLowerCase()
        if (!ext) {
          results.push({ id: rawDoc.id, ok: false, error: "Không xác định được định dạng file" })
          continue
        }

        const sourceBytes = await downloadStorageFile(sourceUrl)
        const outputBase = `${factoryId}/iso/invalidated/${normalizeOutputName(`${maTl}_${rawDoc.id}_${Date.now()}`)}`

        if (ext === "pdf") {
          const pdfDoc = await PDFDocument.load(sourceBytes)
          pdfDoc.registerFontkit(fontkit)
          const font = await pdfDoc.embedFont(fontBytes)
          await replaceInvalidatedPdfText(pdfDoc, sourceBytes, font, maTl, revision, expiredDate)
          stampPdfInvalidatedMark(pdfDoc, font)

          const outputPath = `${outputBase}.pdf`
          const { error: uploadErr } = await supabaseAdmin.storage
            .from("iso-documents")
            .upload(outputPath, await pdfDoc.save(), { contentType: "application/pdf", upsert: true })
          if (uploadErr) throw new Error(uploadErr.message)

          const { data: urlData } = supabaseAdmin.storage.from("iso-documents").getPublicUrl(outputPath)
          const { error: updateErr } = await supabaseAdmin
            .from("iso_documents")
            .update({ file_signed_pdf_url: urlData.publicUrl })
            .eq("id", rawDoc.id)
            .eq("factory_id", factoryId)
          if (updateErr) throw new Error(updateErr.message)

          results.push({ id: rawDoc.id, ok: true, type: "pdf" })
          continue
        }

        if (ext === "docx") {
          const outputPath = `${outputBase}.docx`
          const buffer = await renderInvalidatedDocx(sourceBytes, maTl, revision, expiredDate)
          const { error: uploadErr } = await supabaseAdmin.storage
            .from("iso-documents")
            .upload(outputPath, buffer, {
              contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              upsert: true,
            })
          if (uploadErr) throw new Error(uploadErr.message)

          const { data: urlData } = supabaseAdmin.storage.from("iso-documents").getPublicUrl(outputPath)
          const { error: updateErr } = await supabaseAdmin
            .from("iso_documents")
            .update(buildOfficeUpdatePayload(rawDoc, urlData.publicUrl, "docx"))
            .eq("id", rawDoc.id)
            .eq("factory_id", factoryId)
          if (updateErr) throw new Error(updateErr.message)

          results.push({ id: rawDoc.id, ok: true, type: "docx" })
          continue
        }

        if (ext === "xlsx") {
          const outputPath = `${outputBase}.xlsx`
          const buffer = await renderInvalidatedXlsx(sourceBytes, maTl, revision, expiredDate)
          const { error: uploadErr } = await supabaseAdmin.storage
            .from("iso-documents")
            .upload(outputPath, buffer, {
              contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              upsert: true,
            })
          if (uploadErr) throw new Error(uploadErr.message)

          const { data: urlData } = supabaseAdmin.storage.from("iso-documents").getPublicUrl(outputPath)
          const { error: updateErr } = await supabaseAdmin
            .from("iso_documents")
            .update(buildOfficeUpdatePayload(rawDoc, urlData.publicUrl, "xlsx"))
            .eq("id", rawDoc.id)
            .eq("factory_id", factoryId)
          if (updateErr) throw new Error(updateErr.message)

          results.push({ id: rawDoc.id, ok: true, type: "xlsx" })
          continue
        }

        results.push({ id: rawDoc.id, ok: true, type: ext })
      } catch (error) {
        results.push({
          id: rawDoc.id,
          ok: false,
          error: error instanceof Error ? error.message : "Lỗi không xác định",
        })
      }
    }

    const allOk = results.every((item) => item.ok)
    return NextResponse.json({ ok: allOk, results }, { status: allOk ? 200 : 207 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Lỗi server" },
      { status: 500 },
    )
  }
}
