import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { PDFDocument, rgb, PDFImage } from "pdf-lib"
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

function normalizeRevisionText(value: unknown): string {
  const text = String(value ?? "").trim()
  return text || "00"
}

// Chuẩn hóa chuỗi để so sánh pattern (bỏ dấu, lowercase, bỏ dấu câu thừa)
function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

// Kiểm tra text đã chứa "Hết hiệu lực" chưa
function isAlreadyInvalidated(text: string): boolean {
  const norm = normalizeText(text)
  return norm.includes("het hieu luc")
}

// Stamp ảnh dấu "Hết hiệu lực" ở góc trên phải mỗi trang + đường kẻ separator footer
// Footer text được xử lý bởi replaceInvalidatedTags (tránh double-stamp)
function stampWatermark(
  page: ReturnType<PDFDocument["getPages"]>[number],
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  _maTl: string,
  _lsStr: string,
  _dateStr: string,
  stamImg: PDFImage,
) {
  const { width, height } = page.getSize()

  // Đường kẻ separator footer
  page.drawLine({
    start: { x: 28, y: 26 },
    end: { x: width - 28, y: 26 },
    thickness: 0.4, color: rgb(0.75, 0.8, 0.85),
  })

  // Ảnh dấu "HẾT HIỆU LỰC" căn giữa ngang header (tránh đè QR góc phải)
  const imgW = 108
  const imgH = 37
  page.drawImage(stamImg, {
    x: (width - imgW) / 2,
    y: height - imgH - 20,
    width: imgW,
    height: imgH,
    opacity: 1,
  })

  void font // giữ signature để không cần refactor caller
}

interface PdfjsTextItem {
  str: string
  transform: number[]
  width: number
  height: number
  fontName?: string
}

// Thay thế các tag header/footer trong PDF khi hủy hiệu lực
// Dùng pdfjs để lấy tọa độ text, pdf-lib để cover trắng và vẽ lại
async function replaceInvalidatedTags(
  pdfDoc: PDFDocument,
  pdfBytes: ArrayBuffer,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  maTl: string,
  lsStr: string,
  dateHetStr: string,
) {
  try {
    // Import pdfjs-dist (Node/server mode)
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

      const { height: pageHeight } = pdfLibPage.getSize()
      const viewport = pdfJsPage.getViewport({ scale: 1 })

      for (const item of textContent.items as PdfjsTextItem[]) {
        if (!item.str || !item.str.trim()) continue

        const normStr = normalizeText(item.str)
        if (isAlreadyInvalidated(item.str)) continue

        // Tính tọa độ pdf-lib từ pdfjs (transform: [scaleX, 0, 0, scaleY, x, y])
        const x = item.transform[4]
        const yPdfjs = item.transform[5]
        // pdfjs y tính từ bottom-left (giống pdf-lib), nhưng viewport có thể khác
        const scaleY = viewport.height / pageHeight
        const yPdf = yPdfjs / scaleY
        const itemWidth = item.width / (viewport.width / pdfLibPage.getSize().width)
        const itemHeight = (item.height || 10) / scaleY
        const fontSize = itemHeight > 0 ? itemHeight * 0.9 : 9

        let newText: string | null = null
        let textColor = rgb(0.15, 0.15, 0.15)

        // Pattern 1: "Ngày hiệu lực: ..." → "Ngày hết hiệu lực: [dateHet]"
        if (normStr.startsWith("ngay hieu luc")) {
          newText = `Ngày hết hiệu lực: ${dateHetStr}`
          textColor = rgb(0.15, 0.15, 0.15)
        }
        // Pattern 2: "Tình trạng: Có hiệu lực" → "Tình trạng: Hết hiệu lực"
        else if (normStr.includes("tinh trang") && normStr.includes("co hieu luc")) {
          newText = "Tình trạng: Hết hiệu lực"
          textColor = rgb(0.85, 0, 0)
        }
        // Pattern 3: footer "[mã] ([lần]-[date]) Có hiệu lực"
        // Nhận diện: có "co hieu luc" và có pattern ngày dd/mm/yyyy
        else if (
          normStr.includes("co hieu luc") &&
          /\d{2}\/\d{2}\/\d{4}/.test(item.str)
        ) {
          newText = `${maTl} (${lsStr}-${dateHetStr}) Hết hiệu lực`
          textColor = rgb(0.85, 0, 0)
        }

        if (newText) {
          // Cover text cũ bằng hình chữ nhật trắng
          const coverWidth = Math.max(itemWidth, font.widthOfTextAtSize(newText, fontSize)) + 6
          pdfLibPage.drawRectangle({
            x: x - 1,
            y: yPdf - 1,
            width: coverWidth,
            height: itemHeight + 3,
            color: rgb(1, 1, 1),
            opacity: 1,
          })
          // Vẽ text mới
          pdfLibPage.drawText(newText, {
            x: x,
            y: yPdf,
            size: Math.max(fontSize, 8),
            font,
            color: textColor,
          })
        }
      }
    }
  } catch {
    // pdfjs scan không bắt buộc — nếu lỗi, tiếp tục với watermark thôi
  }
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
      .select("id, ma_tai_lieu, lan_ban_hanh, ngay_hieu_luc, ngay_het_hieu_luc, updated_at, file_goc_url, file_signed_pdf_url, chon_quy_trinh, file_phieu_yeu_cau_thay_doi_url, file_de_nghi_soat_xet_url, file_soat_xet_url")
      .eq("factory_id", factoryId)
      .in("id", docIds)
    if (docsErr || !docs) {
      return NextResponse.json({ error: "Lỗi truy vấn tài liệu" }, { status: 500 })
    }

    const results: { id: string; ok: boolean; error?: string }[] = []

    for (const doc of docs) {
      try {
        const maTl = (doc.ma_tai_lieu as string) || "—"
        const lsStr = normalizeRevisionText(doc.lan_ban_hanh)
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

        // Bước 1: Thay thế tag "Ngày hiệu lực", "Tình trạng: Có hiệu lực", footer
        await replaceInvalidatedTags(pdfDoc, pdfBytes, font, maTl, lsStr, dateStr)

        // Bước 2: Stamp ảnh "Hết hiệu lực" ở góc trên phải mỗi trang
        const stamImgBytes = await readFile(path.join(process.cwd(), "cung_cap_dl", "iso", "HẾT HIỆU LỰC.jpg"))
        const stamImg = await pdfDoc.embedJpg(stamImgBytes)
        for (const page of pdfDoc.getPages()) {
          stampWatermark(page, font, maTl, lsStr, dateStr, stamImg)
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

        // Stamp file phụ soát xét nếu có
        if (doc.chon_quy_trinh === "Soát xét") {
          const attachments: Array<{ kind: string; url: string | null | undefined; updateCol: Record<string, string> }> = [
            { kind: "change_request", url: doc.file_phieu_yeu_cau_thay_doi_url as string | null, updateCol: { file_phieu_yeu_cau_thay_doi_url: "" } },
            { kind: "review_request", url: (doc.file_de_nghi_soat_xet_url || doc.file_soat_xet_url) as string | null, updateCol: { file_de_nghi_soat_xet_url: "", file_soat_xet_url: "" } },
          ]
          for (const att of attachments) {
            if (!att.url) continue
            if (!att.url.split("?")[0].toLowerCase().endsWith(".pdf")) continue
            try {
              const attUrlParts = att.url.split("/storage/v1/object/public/iso-documents/")
              const attPath = attUrlParts.length === 2 ? attUrlParts[1] : null
              if (!attPath) continue
              const { data: attData } = await supabaseAdmin.storage.from("iso-documents").download(decodeURIComponent(attPath))
              if (!attData) continue
              const attBytes = await attData.arrayBuffer()
              const attDoc = await PDFDocument.load(attBytes)
              attDoc.registerFontkit(fontkit)
              const attFontBytes = await readFile(path.join(process.cwd(), "public", "fonts", "TimesNewRoman.ttf"))
              const attFont = await attDoc.embedFont(attFontBytes)
              await replaceInvalidatedTags(attDoc, attBytes, attFont, maTl, lsStr, dateStr)
              const attStamImgBytes = await readFile(path.join(process.cwd(), "cung_cap_dl", "iso", "HẾT HIỆU LỰC.jpg"))
              const attStamImg = await attDoc.embedJpg(attStamImgBytes)
              for (const page of attDoc.getPages()) {
                stampWatermark(page, attFont, maTl, lsStr, dateStr, attStamImg)
              }
              const attSignedBytes = await attDoc.save()
              const attOutputPath = `${factoryId}/iso/signed/${doc.id}_${att.kind}_stamped.pdf`
              const { error: attUploadErr } = await supabaseAdmin.storage
                .from("iso-documents")
                .upload(attOutputPath, attSignedBytes, { contentType: "application/pdf", upsert: true })
              if (attUploadErr) continue
              const { data: attUrlData } = supabaseAdmin.storage.from("iso-documents").getPublicUrl(attOutputPath)
              const updatePayload: Record<string, string> = {}
              for (const col of Object.keys(att.updateCol)) {
                updatePayload[col] = attUrlData.publicUrl
              }
              await supabaseAdmin.from("iso_documents").update(updatePayload).eq("id", doc.id).eq("factory_id", factoryId)
            } catch {
              // Lỗi attachment không block kết quả chính
            }
          }
        }

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
