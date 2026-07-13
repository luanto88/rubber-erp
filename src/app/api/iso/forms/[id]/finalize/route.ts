import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { jwtVerify } from "jose"
import { PDFDocument, rgb } from "pdf-lib"
import fontkit from "@pdf-lib/fontkit"
import QRCode from "qrcode"
import JSZip from "jszip"
import fs from "fs"
import path from "path"
import { convertOfficeUrlToPdfDocumentWithRetry } from "@/app/api/sign/_lib/cloud-convert"
import { SIGN_AS_OPTIONS, type SignAsType } from "@/app/dashboard/iso/_components/iso-types"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)
const BUCKET = "iso-documents"

type SignPlacement = {
  page: number
  x: number
  y: number
  width: number
  height: number
  showSignature?: boolean
  showSignerName?: boolean
  nameX?: number
  nameY?: number
  nameWidth?: number
  nameHeight?: number
  qrX?: number
  qrY?: number
  qrWidth?: number
  qrHeight?: number
  // Hộp tiền tố ký thay (KT./TM./TL./TUQ.) — chỉ dùng ở bước Phê duyệt, chỉ áp
  // dụng cho PDF (vẽ hộp riêng, không có khái niệm tương đương cho DOCX/XLSX).
  showPrefix?: boolean
  prefixX?: number
  prefixY?: number
  prefixWidth?: number
  prefixHeight?: number
}

function isValidSignAs(v: unknown): v is Exclude<SignAsType, "none"> {
  return typeof v === "string" && (SIGN_AS_OPTIONS as string[]).includes(v)
}

function loadSignerNameFont(): Buffer | null {
  try {
    return fs.readFileSync(path.join(process.cwd(), "public/fonts/TimesNewRoman.ttf"))
  } catch {
    return null
  }
}

async function getSigImage(factoryId: string, userId: string): Promise<ArrayBuffer | null> {
  const storagePath = `signatures/${factoryId}/${userId}/chu_ky.png`
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(storagePath)
  if (error || !data) return null
  return await data.arrayBuffer()
}

function getStorageRelPath(fileUrl: string): string | null {
  const cleanUrl = fileUrl.split("?")[0]
  const marker = `/storage/v1/object/public/${BUCKET}/`
  const idx = cleanUrl.indexOf(marker)
  if (idx >= 0) return decodeURIComponent(cleanUrl.slice(idx + marker.length))
  if (!/^https?:\/\//i.test(cleanUrl)) return cleanUrl
  return null
}

function buildSignerNamePlacement(p: SignPlacement) {
  return {
    xCenter: typeof p.nameX === "number" ? p.nameX + (p.nameWidth ?? p.width) / 2 : p.x + p.width / 2,
    y: typeof p.nameY === "number" ? p.nameY : Math.max(p.y - 18, 8),
    maxWidth: Math.max(typeof p.nameWidth === "number" ? p.nameWidth : p.width + 24, 110),
  }
}

async function downloadFile(fileUrl: string): Promise<ArrayBuffer> {
  const relPath = getStorageRelPath(fileUrl)
  if (relPath) {
    const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(relPath)
    if (data && !error) return await data.arrayBuffer()
  }
  const res = await fetch(fileUrl, { cache: "no-store" })
  if (!res.ok) throw new Error(`Không tải được file: HTTP ${res.status}`)
  return await res.arrayBuffer()
}

async function stampPdf(
  pdfBytes: ArrayBuffer,
  placements: Array<{ userId: string; placement: SignPlacement; signerName: string; prefixText?: string | null }>,
  factoryId: string,
  qrUrl: string | null,
  qrPlacementOverride?: { x: number; y: number; width: number; height: number; page: number } | null,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes)
  pdfDoc.registerFontkit(fontkit)

  const fontBytes = loadSignerNameFont()
  let signerNameFont = await pdfDoc.embedFont(
    fontBytes ? fontBytes : (await pdfDoc.embedFont("Helvetica" as never)) as never,
  )
  if (fontBytes) {
    signerNameFont = await pdfDoc.embedFont(fontBytes)
  }

  // Stamp QR nếu có
  if (qrUrl) {
    try {
      const qrBuffer = await QRCode.toBuffer(qrUrl, { width: 100, margin: 1 })
      const qrImage = await pdfDoc.embedPng(qrBuffer)

      if (qrPlacementOverride) {
        // Stamp QR ở vị trí người dùng đặt trên TẤT CẢ trang
        for (const page of pdfDoc.getPages()) {
          page.drawImage(qrImage, {
            x: qrPlacementOverride.x,
            y: qrPlacementOverride.y,
            width: qrPlacementOverride.width,
            height: qrPlacementOverride.height,
          })
        }
      } else {
        // Fallback: góc trên phải trang đầu
        const firstPage = pdfDoc.getPage(0)
        const qrSize = 54
        const qrMargin = 12
        firstPage.drawImage(qrImage, {
          x: firstPage.getWidth() - qrMargin - qrSize,
          y: firstPage.getHeight() - qrMargin - qrSize,
          width: qrSize,
          height: qrSize,
        })
      }
    } catch { /* bỏ qua nếu QR thất bại */ }
  }

  for (const { userId, placement, signerName, prefixText } of placements) {
    const pageIndex = placement.page - 1
    if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) continue

    const sigImg = await getSigImage(factoryId, userId)
    if (!sigImg) continue

    const page = pdfDoc.getPage(pageIndex)

    if (placement.showSignature !== false) {
      try {
        const embedded = await pdfDoc.embedPng(sigImg).catch(() => pdfDoc.embedJpg(sigImg))
        page.drawImage(embedded, {
          x: placement.x,
          y: placement.y,
          width: placement.width,
          height: placement.height,
          opacity: 0.92,
        })
      } catch { /* bỏ qua nếu embed thất bại */ }
    }

    if (signerName && placement.showSignerName !== false) {
      try {
        const slot = buildSignerNamePlacement(placement)
        let nameFontSize = 13
        while (nameFontSize > 9 && signerNameFont.widthOfTextAtSize(signerName, nameFontSize) > slot.maxWidth) {
          nameFontSize -= 0.5
        }
        const nameWidth = signerNameFont.widthOfTextAtSize(signerName, nameFontSize)
        page.drawText(signerName, {
          x: slot.xCenter - nameWidth / 2,
          y: slot.y,
          size: nameFontSize,
          font: signerNameFont,
          color: rgb(0, 0, 0),
        })
      } catch { /* bỏ qua nếu vẽ tên thất bại */ }
    }

    if (
      prefixText &&
      placement.showPrefix &&
      typeof placement.prefixX === "number" &&
      typeof placement.prefixY === "number"
    ) {
      try {
        page.drawText(prefixText, {
          x: placement.prefixX,
          y: placement.prefixY,
          size: 10,
          font: signerNameFont,
          color: rgb(0, 0, 0),
        })
      } catch { /* bỏ qua nếu vẽ tiền tố thất bại */ }
    }
  }

  return await pdfDoc.save()
}

// Helper thay tag trong DOCX/XLSX (chỉ thay tag đúng bước, tag thiếu bỏ qua)
async function replaceFormTags(
  fileBytes: ArrayBuffer,
  ext: string,
  opts: {
    step: "soan_thao" | "xem_xet" | "phe_duyet"
    signerName: string
    sigImgBuf: ArrayBuffer | null
    qrUrl: string | null
  },
): Promise<Uint8Array> {
  const { step, signerName, sigImgBuf, qrUrl } = opts

  const stepTagMap: Record<string, { nameTag: string; sigTag: string }> = {
    soan_thao: { nameTag: "{{TEN_SOAN_THAO}}", sigTag: "{{CHU_KY_SOAN_THAO}}" },
    xem_xet: { nameTag: "{{TEN_XEM_XET}}", sigTag: "{{CHU_KY_XEM_XET}}" },
    phe_duyet: { nameTag: "{{TEN_PHE_DUYET}}", sigTag: "{{CHU_KY_PHE_DUYET}}" },
  }
  const { nameTag, sigTag } = stepTagMap[step]

  const zip = await JSZip.loadAsync(fileBytes)

  // Xây danh sách file XML cần quét
  const xmlFilePaths: string[] = []
  if (ext === "docx" || ext === "doc") {
    zip.forEach((relPath) => {
      if (
        relPath.startsWith("word/") &&
        relPath.endsWith(".xml") &&
        !relPath.includes("/_rels/") &&
        !relPath.endsWith(".rels")
      ) {
        xmlFilePaths.push(relPath)
      }
    })
  } else {
    // xlsx: sheet files
    zip.forEach((relPath) => {
      if (relPath.startsWith("xl/") && relPath.endsWith(".xml") && !relPath.includes("/_rels/")) {
        xmlFilePaths.push(relPath)
      }
    })
  }

  // Helper: replace text tag trong XML string (literal string, không dùng regex)
  function replaceTextTag(xml: string, tag: string, value: string): string {
    if (!xml.includes(tag)) return xml
    return xml.split(tag).join(value)
  }

  // Helper: thay image tag trong DOCX bằng embedded image
  // Scan cả document body, headers, footers để tìm tag
  async function replaceDocxImageTag(
    zip: JSZip,
    tag: string,
    imgBuf: ArrayBuffer | Uint8Array,
    mediaFilename: string,
    _contentType: string,
  ): Promise<void> {
    // Lấy tất cả XML trong word/ có thể chứa tag (body, headers, footers)
    const candidatePaths: string[] = []
    zip.forEach((relPath) => {
      if (
        relPath.startsWith("word/") &&
        relPath.endsWith(".xml") &&
        !relPath.includes("/_rels/") &&
        !relPath.endsWith(".rels")
      ) {
        const base = relPath.split("/").pop() ?? ""
        if (
          base === "document.xml" ||
          base.startsWith("header") ||
          base.startsWith("footer")
        ) {
          candidatePaths.push(relPath)
        }
      }
    })

    let imgAdded = false

    for (const docPath of candidatePaths) {
      const docFile = zip.file(docPath)
      if (!docFile) continue
      let docXml = await docFile.async("string")
      if (!docXml.includes(tag)) continue

      // Thêm ảnh vào media (chỉ một lần)
      if (!imgAdded) {
        zip.file(`word/media/${mediaFilename}`, Buffer.isBuffer(imgBuf) ? (imgBuf as Buffer) : Buffer.from(imgBuf as ArrayBuffer))
        imgAdded = true
      }

      // Tìm/tạo rels file tương ứng với docPath này
      const docFilename = docPath.split("/").pop()!
      const relsPath = `word/_rels/${docFilename}.rels`
      const relsFile = zip.file(relsPath)
      let relsXml = relsFile
        ? await relsFile.async("string")
        : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`

      const existingIds = [...relsXml.matchAll(/Id="(rId\d+)"/g)].map((m) => m[1])
      let maxId = 0
      for (const rid of existingIds) {
        const n = parseInt(rid.replace("rId", ""), 10)
        if (!isNaN(n) && n > maxId) maxId = n
      }
      const newRId = `rId${maxId + 1}`

      relsXml = relsXml.replace(
        "</Relationships>",
        `  <Relationship Id="${newRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${mediaFilename}"/>\n</Relationships>`,
      )
      zip.file(relsPath, relsXml)

      // Xây drawing XML
      const isQr = tag === "{{QR}}"
      const emuW = isQr ? 432000 : 900000
      const emuH = isQr ? 432000 : 450000
      // docPr id phải unique trong toàn document; tính từ XML đã có trước đó
      const existingDocPrIds = [...docXml.matchAll(/<wp:docPr[^>]*\bid="(\d+)"/g)].map(m => parseInt(m[1]))
      const newDocPrId = existingDocPrIds.length > 0 ? Math.max(...existingDocPrIds) + 1 : 1
      const drawingXml = `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="${emuW}" cy="${emuH}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${newDocPrId}" name="${mediaFilename}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="${mediaFilename}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${newRId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emuW}" cy="${emuH}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`

      // Thay tag trong paragraph: tìm <w:p> chứa tag và thay toàn bộ run bằng drawing
      docXml = docXml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (para) => {
        if (!para.includes(tag)) return para
        const pPrMatch = para.match(/(<w:pPr[\s\S]*?<\/w:pPr>)/)
        const pPr = pPrMatch ? pPrMatch[1] : ""
        return `<w:p>${pPr}<w:r><w:rPr/>${drawingXml}</w:r></w:p>`
      })

      zip.file(docPath, docXml)
    }
  }

  // Thay text tags trong tất cả XML files
  for (const xmlPath of xmlFilePaths) {
    const xmlFile = zip.file(xmlPath)
    if (!xmlFile) continue
    let xml = await xmlFile.async("string")
    xml = replaceTextTag(xml, nameTag, signerName)
    zip.file(xmlPath, xml)
  }

  // Thay image tag chữ ký
  if (sigImgBuf && ext === "docx") {
    await replaceDocxImageTag(zip, sigTag, sigImgBuf, `sig_${step}.png`, "image/png")
  }

  // Thay QR image (chỉ soan_thao)
  if (step === "soan_thao" && qrUrl && ext === "docx") {
    try {
      const qrBuffer = await QRCode.toBuffer(qrUrl, { width: 100, margin: 1 })
      await replaceDocxImageTag(zip, "{{QR}}", qrBuffer, "qr_form.png", "image/png")
    } catch { /* bỏ qua nếu QR thất bại */ }
  }

  const result = await zip.generateAsync({ type: "nodebuffer" })
  return new Uint8Array(result)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: instanceId } = await params
    const body = await req.json() as {
      token: string
      action: "soan_thao" | "xem_xet" | "phe_duyet"
      placement: SignPlacement
      lyDo?: string
      cap_tl?: string
      sign_as?: SignAsType
    }
    const { token, action, placement, lyDo, cap_tl, sign_as } = body

    if (!token || !action || !placement) {
      return NextResponse.json({ error: "Thiếu token, action hoặc placement" }, { status: 400 })
    }

    // Verify JWT
    const jwtSecret = process.env.SIGN_JWT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!jwtSecret) return NextResponse.json({ error: "Thiếu SIGN_JWT_SECRET" }, { status: 500 })

    let userId: string
    let tokenDocId: string
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(jwtSecret))
      userId = payload.userId as string
      tokenDocId = payload.docId as string
      if (!userId || tokenDocId !== instanceId) {
        return NextResponse.json({ error: "Token không hợp lệ cho instance này" }, { status: 403 })
      }
    } catch {
      return NextResponse.json({ error: "Token hết hạn hoặc không hợp lệ" }, { status: 401 })
    }

    // Lấy instance
    const { data: instance, error: instErr } = await supabaseAdmin
      .from("iso_form_instances")
      .select("*")
      .eq("id", instanceId)
      .single()

    if (instErr || !instance) {
      return NextResponse.json({ error: "Không tìm thấy hồ sơ" }, { status: 404 })
    }

    const factoryId = instance.factory_id as string

    // Kiểm tra quyền action
    if (action === "soan_thao" && instance.nguoi_tao !== userId) {
      return NextResponse.json({ error: "Bạn không phải người tạo hồ sơ này" }, { status: 403 })
    }
    if (action === "xem_xet" && instance.xem_xet_user_id !== userId) {
      return NextResponse.json({ error: "Bạn không phải người xem xét hồ sơ này" }, { status: 403 })
    }
    if (action === "phe_duyet" && instance.phe_duyet_user_id !== userId) {
      return NextResponse.json({ error: "Bạn không phải người phê duyệt hồ sơ này" }, { status: 403 })
    }

    // Lấy tên người ký
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name, username")
      .eq("id", userId)
      .single()
    const signerName = profile?.full_name || profile?.username || ""

    const draftExt = (instance.draft_file_type as string | null) ?? "docx"
    const auto_convert_pdf = instance.auto_convert_pdf as boolean
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || ""
    const qrUrl = `${appUrl}/dashboard/iso/forms/${instanceId}`

    // Trích QR placement từ soan_thao_placement nếu có
    const soanThaoPlacement = instance.soan_thao_placement as SignPlacement | null
    const qrPlacementFromSoanThao =
      soanThaoPlacement && typeof soanThaoPlacement.qrX === "number"
        ? {
            x: soanThaoPlacement.qrX!,
            y: soanThaoPlacement.qrY!,
            width: soanThaoPlacement.qrWidth ?? 54,
            height: soanThaoPlacement.qrHeight ?? 54,
            page: 1,
          }
        : null

    // ---- SOẠN THẢO: người tạo ký trước khi gửi ----
    if (action === "soan_thao") {
      const sourceUrl = (instance.draft_file_url as string | null)
      if (!sourceUrl) {
        return NextResponse.json({ error: "Hồ sơ chưa có file" }, { status: 400 })
      }

      const fileBytes = await downloadFile(sourceUrl)
      const qrFromCurrent =
        typeof placement.qrX === "number"
          ? { x: placement.qrX!, y: placement.qrY!, width: placement.qrWidth ?? 54, height: placement.qrHeight ?? 54, page: 1 }
          : null

      let signedBytes: Uint8Array
      let signedExt = draftExt

      if (draftExt === "pdf") {
        signedBytes = await stampPdf(
          fileBytes,
          [{ userId, placement, signerName }],
          factoryId,
          qrUrl,
          qrFromCurrent,
        )
      } else {
        // Office (DOCX/XLSX): luôn thay tag — bất kể auto_convert_pdf
        const sigImgBuf = await getSigImage(factoryId, userId)
        signedBytes = await replaceFormTags(fileBytes, draftExt, {
          step: "soan_thao",
          signerName,
          sigImgBuf,
          qrUrl,
        })
        signedExt = draftExt
      }

      // Upload soan_thao_signed
      const signedPath = `${factoryId}/iso/instances/${instanceId}/soan_thao_signed.${signedExt}`
      const mimeType = signedExt === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      const signedBlob = new Blob([Buffer.from(signedBytes)], { type: mimeType })
      await supabaseAdmin.storage.from(BUCKET).upload(signedPath, signedBlob, { upsert: true })
      const { data: signedUrlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(signedPath)

      const capTlValue = (cap_tl || (instance.cap_tl as string) || "Cấp 2") as string
      const nextStatus = capTlValue === "Cấp 1" ? "cho_xem_xet" : "cho_phe_duyet"

      const updates: Record<string, unknown> = {
        trang_thai: nextStatus,
        soan_thao: signerName,
        soan_thao_placement: placement,
        soan_thao_signed_url: signedUrlData?.publicUrl,
        ky_soan_thao_at: new Date().toISOString(),
      }
      if (signedExt === "pdf") {
        updates.final_pdf_url = signedUrlData?.publicUrl
      } else {
        // Xóa giá trị stale từ lần test cũ để phe_duyet không bị dẫn vào stampPdf path
        updates.final_pdf_url = null
        updates.final_office_url = null
      }

      await supabaseAdmin.from("iso_form_instances").update(updates).eq("id", instanceId)

      await supabaseAdmin.from("iso_form_instance_logs").insert({
        instance_id: instanceId,
        factory_id: factoryId,
        user_id: userId,
        action: capTlValue === "Cấp 1" ? "gui_xem_xet" : "gui_phe_duyet",
        note: lyDo || null,
      })
      return NextResponse.json({ success: true, trang_thai: nextStatus })
    }

    // ---- XEM XÉT: ký vào file ----
    if (action === "xem_xet") {
      const sourceUrl =
        (instance.soan_thao_signed_url as string | null) ||
        (instance.draft_file_url as string | null)
      if (!sourceUrl) {
        return NextResponse.json({ error: "Hồ sơ chưa có file" }, { status: 400 })
      }

      const fileBytes = await downloadFile(sourceUrl)
      let signedBytes: Uint8Array
      let signedExt = draftExt

      const sourceIsPdf = sourceUrl.toLowerCase().includes(".pdf") || draftExt === "pdf"

      if (sourceIsPdf) {
        signedBytes = await stampPdf(fileBytes, [{ userId, placement, signerName }], factoryId, null)
        signedExt = "pdf"
      } else {
        // Office (DOCX/XLSX): luôn thay tag — bất kể auto_convert_pdf
        const sigImgBuf = await getSigImage(factoryId, userId)
        signedBytes = await replaceFormTags(fileBytes, draftExt, {
          step: "xem_xet",
          signerName,
          sigImgBuf,
          qrUrl: null,
        })
        signedExt = draftExt
      }

      const signedPath = `${factoryId}/iso/instances/${instanceId}/xem_xet_signed.${signedExt}`
      const mimeType = signedExt === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      const signedBlob = new Blob([Buffer.from(signedBytes)], { type: mimeType })
      await supabaseAdmin.storage.from(BUCKET).upload(signedPath, signedBlob, { upsert: true })
      const { data: signedUrlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(signedPath)

      const updates: Record<string, unknown> = {
        trang_thai: "cho_phe_duyet",
        xem_xet: signerName,
        ky_xem_xet_at: new Date().toISOString(),
        xem_xet_placement: placement,
      }
      if (signedExt === "pdf") {
        updates.final_pdf_url = signedUrlData?.publicUrl
      } else {
        updates.soan_thao_signed_url = signedUrlData?.publicUrl // dùng lại slot cho chuỗi Office
      }

      await supabaseAdmin.from("iso_form_instances").update(updates).eq("id", instanceId)

      await supabaseAdmin.from("iso_form_instance_logs").insert({
        instance_id: instanceId,
        factory_id: factoryId,
        user_id: userId,
        action: "xem_xet",
        note: lyDo || null,
      })
      return NextResponse.json({ success: true, trang_thai: "cho_phe_duyet" })
    }

    // ---- PHÊ DUYỆT: ký + finalize ----
    if (action === "phe_duyet") {
      const sourceUrl = draftExt === "pdf"
        ? ((instance.final_pdf_url as string | null) ||
           (instance.soan_thao_signed_url as string | null) ||
           (instance.draft_file_url as string | null))
        : ((instance.soan_thao_signed_url as string | null) ||
           (instance.draft_file_url as string | null))

      if (!sourceUrl) {
        return NextResponse.json({ error: "Hồ sơ chưa có file" }, { status: 400 })
      }

      const fileBytes = await downloadFile(sourceUrl)
      const sourceIsPdf = sourceUrl.toLowerCase().includes(".pdf") || draftExt === "pdf"
      const allPlacements: Array<{ userId: string; placement: SignPlacement; signerName: string; prefixText?: string | null }> = []

      // Ký thay (KT./TM./TL./TUQ.) — chỉ áp dụng cho bước Phê duyệt, chỉ vẽ riêng
      // trên PDF (hộp draggable riêng), KHÔNG ghép vào signerName dùng cho tag
      // DOCX/XLSX (không có nhu cầu nghiệp vụ cho Office — đã xác nhận với người dùng).
      const signAsPD: SignAsType = isValidSignAs(sign_as) ? sign_as : "none"
      const prefixTextPD = signAsPD !== "none" ? `${signAsPD}.` : null

      // Thêm placement soạn thảo
      if (soanThaoPlacement && instance.nguoi_tao) {
        allPlacements.push({
          userId: instance.nguoi_tao as string,
          placement: soanThaoPlacement,
          signerName: (instance.soan_thao as string) || "",
        })
      }

      // Thêm placement xem xét nếu Cấp 1
      if (instance.cap_tl === "Cấp 1" && instance.xem_xet_user_id && instance.xem_xet_placement) {
        allPlacements.push({
          userId: instance.xem_xet_user_id as string,
          placement: instance.xem_xet_placement as SignPlacement,
          signerName: (instance.xem_xet as string) || "",
        })
      }

      // Thêm placement phê duyệt
      allPlacements.push({ userId, placement, signerName, prefixText: prefixTextPD })

      let finalBytes: Uint8Array
      let finalExt = "pdf"

      if (sourceIsPdf) {
        // Nguồn đã là PDF (backward compat hoặc upload PDF gốc) → stamp với tất cả placement
        finalBytes = await stampPdf(fileBytes, allPlacements, factoryId, qrUrl, qrPlacementFromSoanThao)
        finalExt = "pdf"
      } else {
        // Office: thay tag bước phê duyệt
        const sigImgBuf = await getSigImage(factoryId, userId)
        finalBytes = await replaceFormTags(fileBytes, draftExt, {
          step: "phe_duyet",
          signerName,
          sigImgBuf,
          qrUrl,
        })
        finalExt = draftExt

        // Nếu auto_convert_pdf: upload DOCX đã tag → CloudConvert → PDF
        if (auto_convert_pdf) {
          try {
            const tempPath = `${factoryId}/iso/instances/${instanceId}/temp_final.${draftExt}`
            const mime =
              draftExt === "xlsx"
                ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            await supabaseAdmin.storage
              .from(BUCKET)
              .upload(tempPath, new Blob([Buffer.from(finalBytes)], { type: mime }), { upsert: true })
            const { data: tempUrlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(tempPath)
            const pdfDoc = await convertOfficeUrlToPdfDocumentWithRetry(tempUrlData.publicUrl)
            const pdfBuf = await pdfDoc.save()
            finalBytes = new Uint8Array(pdfBuf)
            finalExt = "pdf"
          } catch (convErr) {
            console.error("[finalize] CloudConvert lỗi:", convErr)
            // Giữ DOCX đã tag làm final — không block workflow
          }
        }
      }

      const finalPath = `${factoryId}/iso/instances/${instanceId}/final.${finalExt}`
      const finalBlob = new Blob([Buffer.from(finalBytes)], {
        type: finalExt === "pdf" ? "application/pdf" : "application/octet-stream",
      })
      await supabaseAdmin.storage.from(BUCKET).upload(finalPath, finalBlob, { upsert: true })
      const { data: finalUrlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(finalPath)

      const updates: Record<string, unknown> = {
        trang_thai: "da_phe_duyet",
        phe_duyet: signerName,
        ky_phe_duyet_at: new Date().toISOString(),
        phe_duyet_placement: placement,
        phe_duyet_sign_as: signAsPD === "none" ? null : signAsPD,
      }
      if (finalExt === "pdf") {
        updates.final_pdf_url = finalUrlData?.publicUrl
      } else {
        updates.final_office_url = finalUrlData?.publicUrl
      }

      await supabaseAdmin.from("iso_form_instances").update(updates).eq("id", instanceId)

      await supabaseAdmin.from("iso_form_instance_logs").insert({
        instance_id: instanceId,
        factory_id: factoryId,
        user_id: userId,
        action: "phe_duyet",
        note: lyDo || null,
      })
      return NextResponse.json({ success: true, trang_thai: "da_phe_duyet", finalUrl: finalUrlData?.publicUrl })
    }

    return NextResponse.json({ error: "Action không hợp lệ" }, { status: 400 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
