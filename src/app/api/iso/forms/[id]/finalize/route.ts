import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { jwtVerify } from "jose"
import { PDFDocument } from "pdf-lib"
import fontkit from "@pdf-lib/fontkit"
import QRCode from "qrcode"
import JSZip from "jszip"
import { randomUUID } from "crypto"
import { convertOfficeUrlToPdfDocumentWithRetry } from "@/app/api/sign/_lib/cloud-convert"
import { mintSignedUrlForPath } from "@/lib/secure-file-url"
import { SIGN_AS_OPTIONS, type SignAsType, type ThuTuKyStep, stepSignerUserId, type IsoFormInstanceStatus } from "@/app/dashboard/iso/_components/iso-types"
import { clampRectToBox, findRoleBoxForStep } from "@/lib/signing/template-layout"
import { getSignatureImage } from "@/lib/signing/signature-image"
import { computeIntegrityHash } from "@/lib/signing/hash"
import { sealPdfWithVerifyLink, sealPdfWithVerifyLinks, type VerifyLinkGroup, type VerifyLinkTarget } from "@/lib/signing/verify-link"
import {
  loadSignerNameFont,
  drawSignatureImage,
  drawSignerName,
  drawSignPrefix,
  drawExtraPlacements,
  drawChucVu,
  drawMetaTextBoxes,
  ISO_SIGNER_NAME_STYLE,
} from "@/lib/signing/stamp-pdf"

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://qlsxkpt.vercel.app"

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
  // Khối CHỨC VỤ — khối thứ 3, độc lập với chữ ký và tên (người ký tự bật/tắt và kéo riêng).
  // `chucVuText` nằm THẲNG trong placement thay vì tra lại DB lúc stamp: bước `phe_duyet` vẽ
  // lại CẢ 3 placement (soạn thảo + xem xét + phê duyệt) từ file gốc, nên chức vụ của 2 bước
  // trước phải tự mang theo dữ liệu của chính nó mới sống sót qua lần vẽ cuối.
  showChucVu?: boolean
  chucVuText?: string | null
  cvX?: number
  cvY?: number
  cvWidth?: number
  cvHeight?: number
  // Khung "Ngày ký" / "Ghi chú" của mẫu vị trí — chỉ gắn vào placement của ĐÚNG một bước
  // (ngày ký: phê duyệt; ghi chú: soạn thảo), xem comment ở `drawMetaTextBoxes`.
  ngayKyText?: string | null
  ngayKyX?: number
  ngayKyY?: number
  ngayKyWidth?: number
  ngayKyHeight?: number
  ghiChuTat?: boolean
  ghiChuText?: string | null
  ghiChuX?: number
  ghiChuY?: number
  ghiChuWidth?: number
  ghiChuHeight?: number
  kyNhayX?: number
  kyNhayY?: number
  kyNhayWidth?: number
  kyNhayHeight?: number
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
  extraPlacements?: Array<{
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
  }>
}

function isValidSignAs(v: unknown): v is Exclude<SignAsType, "none"> {
  return typeof v === "string" && (SIGN_AS_OPTIONS as string[]).includes(v)
}

function getStorageRelPath(fileUrl: string): string | null {
  const cleanUrl = fileUrl.split("?")[0]
  const marker = `/storage/v1/object/public/${BUCKET}/`
  const idx = cleanUrl.indexOf(marker)
  if (idx >= 0) return decodeURIComponent(cleanUrl.slice(idx + marker.length))
  if (!/^https?:\/\//i.test(cleanUrl)) return cleanUrl
  return null
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

    const sigImg = await getSignatureImage(factoryId, userId)
    if (!sigImg) continue

    const page = pdfDoc.getPage(pageIndex)

    await drawSignatureImage(pdfDoc, page, sigImg, placement)
    drawSignerName(page, signerName, placement, signerNameFont, ISO_SIGNER_NAME_STYLE)
    drawChucVu(page, placement, signerNameFont, ISO_SIGNER_NAME_STYLE)
    await drawMetaTextBoxes(page, placement, signerNameFont, ISO_SIGNER_NAME_STYLE, { pdfDoc, sigImg })
    drawSignPrefix(page, prefixText, placement, signerNameFont)
    await drawExtraPlacements(pdfDoc, placement.extraPlacements, sigImg, signerName, signerNameFont, ISO_SIGNER_NAME_STYLE)
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
    sigImgBuf: ArrayBuffer | Uint8Array | null
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
    void _contentType
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
      action: "soan_thao" | "xem_xet" | "phe_duyet" | "ky_buoc"
      step_index?: number
      placement: SignPlacement
      lyDo?: string
      cap_tl?: string
      sign_as?: SignAsType
    }
    const { token, action, step_index, placement, lyDo, cap_tl, sign_as } = body

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
    const soBuocTong = (instance.so_buoc_tong as number) || 0

    // =========================================================================
    // N-BƯỚC KÝ ĐỘNG (Dynamic N-step workflow khi so_buoc_tong > 0)
    // =========================================================================
    if (soBuocTong > 0) {
      const thuTuKy = (instance.thu_tu_ky_json as ThuTuKyStep[]) || []
      let buocHienTai = (instance.buoc_hien_tai as number) || 0

      // Nếu hồ sơ đang ở trạng thái trả về (tra_ve), nháp (draft) hoặc client ký bước 0 / soạn thảo:
      // Bước ký BẮT BUỘC là bước 0 (Người lập / Soạn thảo)
      const isResubmitOrDraft = instance.trang_thai === "tra_ve" || instance.trang_thai === "draft" || step_index === 0 || action === "soan_thao"
      if (isResubmitOrDraft) {
        buocHienTai = 0
      }

      const currentStep = thuTuKy[buocHienTai]
      if (!currentStep) {
        return NextResponse.json({ error: "Không tìm thấy bước ký hiện tại" }, { status: 400 })
      }

      // 1. Kiểm tra quyền ký bước này
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("full_name, username, role")
        .eq("id", userId)
        .single()
      const isAdmin = profile?.role === "admin"
      const signerId = stepSignerUserId(currentStep)
      const isCreator = instance.nguoi_tao === userId
      const isStepSigner = signerId ? signerId === userId : isCreator

      if (!isAdmin && !isStepSigner && (buocHienTai > 0 || !isCreator)) {
        return NextResponse.json({ error: "Bạn không phải người được chỉ định ký bước này" }, { status: 403 })
      }

      const signerName = profile?.full_name || profile?.username || ""
      const stepKey = String(buocHienTai + 1)
      const isFinalStep = buocHienTai + 1 >= soBuocTong

      // 2. Kẹp toạ độ server-side nếu có mẫu vị trí
      const effectivePlacement: SignPlacement = { ...placement }
      try {
        const templateDocId = instance.template_doc_id as string
        const { data: tmplDoc } = await supabaseAdmin
          .from("iso_documents")
          .select("ma_tai_lieu, loai_tai_lieu")
          .eq("id", templateDocId)
          .maybeSingle()
        if (tmplDoc) {
          const ma = tmplDoc.ma_tai_lieu
          const loai = tmplDoc.loai_tai_lieu
          const keys: string[] = []
          if (ma) keys.push(`iso:code:${ma}`, `iso:loai:${ma}`, ma)
          if (loai) keys.push(`iso:loai:${loai}`, `iso:${loai}`, loai)
          const { data: mauRows } = await supabaseAdmin
            .from("mau_vi_tri")
            .select("khung")
            .eq("factory_id", factoryId)
            .in("loai_tai_lieu", keys)
            .order("phien_ban", { ascending: false })
            .limit(1)
          const khung = (mauRows?.[0]?.khung as Array<Record<string, unknown>>) || []
          if (khung.length > 0) {
            const roleBox = findRoleBoxForStep(khung, {
              stepIndex: buocHienTai,
              totalSteps: soBuocTong,
              stepName: currentStep?.ten || null,
              stepKey,
              action,
            })
            if (roleBox && typeof roleBox.x_pt === "number") {
              const boxPt = {
                x: roleBox.x_pt as number,
                y: roleBox.y_pt as number,
                width: (roleBox.w_pt as number) || 160,
                height: (roleBox.h_pt as number) || 75,
              }
              const clampedSig = clampRectToBox({
                x: effectivePlacement.x,
                y: effectivePlacement.y,
                width: effectivePlacement.width,
                height: effectivePlacement.height,
              }, boxPt)
              effectivePlacement.x = clampedSig.x
              effectivePlacement.y = clampedSig.y
              effectivePlacement.width = clampedSig.width
              effectivePlacement.height = clampedSig.height

              const extendedBox = {
                x: boxPt.x - 15,
                y: Math.max(0, boxPt.y - 45),
                width: boxPt.width + 30,
                height: boxPt.height + 70,
              }

              if (typeof effectivePlacement.nameX === "number") {
                const clampedName = clampRectToBox({
                  x: effectivePlacement.nameX,
                  y: effectivePlacement.nameY ?? boxPt.y,
                  width: effectivePlacement.nameWidth ?? 120,
                  height: effectivePlacement.nameHeight ?? 20,
                }, extendedBox)
                effectivePlacement.nameX = clampedName.x
                effectivePlacement.nameY = clampedName.y
                effectivePlacement.nameWidth = clampedName.width
                effectivePlacement.nameHeight = clampedName.height
              }

              if (typeof effectivePlacement.cvX === "number") {
                const clampedCv = clampRectToBox({
                  x: effectivePlacement.cvX,
                  y: effectivePlacement.cvY ?? boxPt.y,
                  width: effectivePlacement.cvWidth ?? 120,
                  height: effectivePlacement.cvHeight ?? 20,
                }, extendedBox)
                effectivePlacement.cvX = clampedCv.x
                effectivePlacement.cvY = clampedCv.y
                effectivePlacement.cvWidth = clampedCv.width
                effectivePlacement.cvHeight = clampedCv.height
              }
            }
          }
        }
      } catch (clampErr) {
        console.warn("[finalize N-step] Clamp coordinates warning:", clampErr)
      }

      // 3. Xử lý tiền tố ký thay
      const signAsChosen: SignAsType = isValidSignAs(sign_as) ? sign_as : "none"

      // 4. Cập nhật nguoi_ky và placement_ky
      // Nếu là bước 0 (Soạn thảo / Người lập lại sau khi trả về): xoá sạch chữ ký cũ của các vòng trước
      const prevNguoiKy = (buocHienTai === 0 ? {} : (instance.nguoi_ky as Record<string, unknown>)) || {}
      const prevPlacementKy = (buocHienTai === 0 ? {} : (instance.placement_ky as Record<string, unknown>)) || {}

      const newNguoiKy = {
        ...prevNguoiKy,
        [stepKey]: {
          ten: signerName,
          chuc_vu: effectivePlacement.chucVuText || currentStep.chuc_vu || "",
          ky_at: new Date().toISOString(),
          sign_as: signAsChosen === "none" ? undefined : signAsChosen,
        },
      }

      const newPlacementKy: Record<string, unknown> = {
        ...prevPlacementKy,
        [stepKey]: effectivePlacement,
      }
      if (typeof effectivePlacement.qrX === "number") {
        newPlacementKy.qr = {
          x: effectivePlacement.qrX,
          y: effectivePlacement.qrY,
          width: effectivePlacement.qrWidth ?? 54,
          height: effectivePlacement.qrHeight ?? 54,
          page: effectivePlacement.page ?? 1,
        }
      }

      const draftExt = (instance.draft_file_type as string | null) ?? "docx"
      const draftUrl = instance.draft_file_url as string | null
      if (!draftUrl) {
        return NextResponse.json({ error: "Hồ sơ chưa có file gốc" }, { status: 400 })
      }

      const originFromReq = req.headers.get("origin") || (req.headers.get("host") ? `${req.headers.get("x-forwarded-proto") || "https"}://${req.headers.get("host")}` : "")
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || originFromReq || "https://qlsxkpt.vercel.app"
      const qrUrl = `${appUrl}/dashboard/iso/forms/${instanceId}`
      const qrPlacement = (newPlacementKy.qr as { x: number; y: number; width: number; height: number; page: number } | undefined) ?? null

      if (!isFinalStep) {
        // ── Ký bước trung gian ──
        let signedBytes: Uint8Array
        let signedExt = draftExt

        if (draftExt === "pdf") {
          // Stamp các bước từ 0 đến buocHienTai lên file gốc
          const fileBytes = await downloadFile(draftUrl)
          const placementsToStamp: Array<{ userId: string; placement: SignPlacement; signerName: string; prefixText?: string | null }> = []
          for (let i = 0; i <= buocHienTai; i++) {
            const sk = String(i + 1)
            const p = (i === buocHienTai ? effectivePlacement : newPlacementKy[sk]) as SignPlacement
            const nk = (i === buocHienTai ? newNguoiKy[sk] : prevNguoiKy[sk]) as { ten?: string; sign_as?: SignAsType }
            const stp = thuTuKy[i]
            const uId = (i === buocHienTai ? userId : (stp?.user_id || instance.nguoi_tao)) as string
            const pfx = nk?.sign_as && nk.sign_as !== "none" ? `${nk.sign_as}.` : null
            if (p) {
              placementsToStamp.push({
                userId: uId,
                placement: p,
                signerName: nk?.ten || "",
                prefixText: pfx,
              })
            }
          }
          signedBytes = await stampPdf(fileBytes, placementsToStamp, factoryId, qrUrl, qrPlacement)
          signedExt = "pdf"
        } else {
          // Office: thay tag
          const sourceUrl = (instance.soan_thao_signed_url as string | null) || draftUrl
          const fileBytes = await downloadFile(sourceUrl)
          const sigImgBuf = await getSignatureImage(factoryId, userId)
          signedBytes = await replaceFormTags(fileBytes, draftExt, {
            step: buocHienTai === 0 ? "soan_thao" : "xem_xet",
            signerName,
            sigImgBuf,
            qrUrl: buocHienTai === 0 ? qrUrl : null,
          })
          signedExt = draftExt
        }

        const signedPath = `${factoryId}/iso/instances/${instanceId}/step_${stepKey}_signed.${signedExt}`
        const mimeType = signedExt === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        await supabaseAdmin.storage.from(BUCKET).upload(signedPath, new Blob([Buffer.from(signedBytes)], { type: mimeType }), { upsert: true })
        const { data: signedUrlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(signedPath)

        const nextBuoc = buocHienTai + 1
        const nextStatus: IsoFormInstanceStatus = (nextBuoc === soBuocTong - 1) ? "cho_phe_duyet" : "cho_xem_xet"

        const updates: Record<string, unknown> = {
          trang_thai: nextStatus,
          buoc_hien_tai: nextBuoc,
          nguoi_ky: newNguoiKy,
          placement_ky: newPlacementKy,
          soan_thao_signed_url: signedUrlData?.publicUrl,
          ly_do_tra_ve: null,
        }
        if (signedExt === "pdf") {
          updates.final_pdf_url = signedUrlData?.publicUrl
        }

        await supabaseAdmin.from("iso_form_instances").update(updates).eq("id", instanceId)

        await supabaseAdmin.from("iso_form_instance_logs").insert({
          instance_id: instanceId,
          factory_id: factoryId,
          user_id: userId,
          action: `ky_buoc_${stepKey}`,
          note: lyDo || null,
        })

        const nextSignerUserId = thuTuKy[nextBuoc]?.user_id
        if (nextSignerUserId) {
          try {
            await supabaseAdmin.from("notifications").insert({
              factory_id: factoryId,
              user_id: nextSignerUserId,
              type: "cho_ky",
              doc_id: instanceId,
              doc_type: "iso_form",
              title: "[ISO Forms] Hồ sơ ISO cần ký duyệt",
              body: `Hồ sơ "${instance.tieu_de || "Biểu mẫu ISO"}" đã được chuyển đến bạn để ký bước ${nextBuoc + 1} (${thuTuKy[nextBuoc]?.ten || `Bước ${nextBuoc + 1}`}).`,
              is_read: false,
              link: `${appUrl}/dashboard/iso/forms/${instanceId}`,
            })
          } catch (notifErr) {
            console.warn("[finalize] Notification error:", notifErr)
          }
        }

        // Vá bảo mật 2026-09-21: không trả `fileUrl` (URL public thô) — không có call site nào
        // ở client đọc field này (đã grep xác nhận), bucket `iso-documents` sẽ chuyển private.
        return NextResponse.json({
          success: true,
          trang_thai: nextStatus,
          buoc_hien_tai: nextBuoc,
        })
      } else {
        // ── Bước phê duyệt cuối cùng ──
        let finalBytes: Uint8Array
        let finalExt = draftExt
        const allPlacements: Array<{ userId: string; placement: SignPlacement; signerName: string; prefixText?: string | null }> = []

        if (draftExt === "pdf") {
          // Vẽ lại TẤT CẢ placement từ file gốc
          const fileBytes = await downloadFile(draftUrl)
          for (let i = 0; i < soBuocTong; i++) {
            const sk = String(i + 1)
            const p = (i === buocHienTai ? effectivePlacement : newPlacementKy[sk]) as SignPlacement
            const nk = (i === buocHienTai ? newNguoiKy[sk] : prevNguoiKy[sk]) as { ten?: string; sign_as?: SignAsType }
            const stp = thuTuKy[i]
            const uId = (i === buocHienTai ? userId : (stp?.user_id || instance.nguoi_tao)) as string
            const pfx = nk?.sign_as && nk.sign_as !== "none" ? `${nk.sign_as}.` : null
            if (p) {
              allPlacements.push({
                userId: uId,
                placement: p,
                signerName: nk?.ten || "",
                prefixText: pfx,
              })
            }
          }
          finalBytes = await stampPdf(fileBytes, allPlacements, factoryId, qrUrl, qrPlacement)
          finalExt = "pdf"
        } else {
          // Office: thay tag bước phê duyệt
          const sourceUrl = (instance.soan_thao_signed_url as string | null) || draftUrl
          const fileBytes = await downloadFile(sourceUrl)
          const sigImgBuf = await getSignatureImage(factoryId, userId)
          finalBytes = await replaceFormTags(fileBytes, draftExt, {
            step: "phe_duyet",
            signerName,
            sigImgBuf,
            qrUrl: null,
          })
          finalExt = draftExt

          if (instance.auto_convert_pdf) {
            try {
              const tempPath = `${factoryId}/iso/instances/${instanceId}/temp_final.${draftExt}`
              const mime = draftExt === "xlsx"
                ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              await supabaseAdmin.storage.from(BUCKET).upload(tempPath, new Blob([Buffer.from(finalBytes)], { type: mime }), { upsert: true })
              // Vá bảo mật 2026-09-21: CloudConvert (dịch vụ ngoài) tự fetch URL này qua
              // import/url — bucket private nên phải mint Signed URL, không dùng getPublicUrl().
              const tempSignedUrl = await mintSignedUrlForPath(tempPath, { bucket: BUCKET, ttlSeconds: 600 })
              if (!tempSignedUrl) throw new Error("Khong tao duoc duong dan file tam de convert CloudConvert")
              const pdfDoc = await convertOfficeUrlToPdfDocumentWithRetry(tempSignedUrl)
              const pdfBuf = await pdfDoc.save()
              finalBytes = new Uint8Array(pdfBuf)
              finalExt = "pdf"
            } catch (convErr) {
              console.error("[finalize N-step] CloudConvert lỗi:", convErr)
            }
          }
        }

        let padesSigIndex: number | null = null
        let padesError: string | null = null
        const logId = randomUUID()

        type StepLogEntry = {
          logId: string
          userId: string
          stepIndex: number
          action: string
          padesSigIndex?: number | null
        }
        const stepLogs: StepLogEntry[] = []

        if (finalExt === "pdf") {
          try {
            const linkGroups: VerifyLinkGroup[] = []
            allPlacements.forEach((item, idx) => {
              const p = item.placement
              if (!p) return
              const isFinalStep = idx === allPlacements.length - 1
              const stepLogId = isFinalStep ? logId : randomUUID()
              const actionName = isFinalStep ? "phe_duyet" : (idx === 0 ? "soan_thao" : "xem_xet")
              stepLogs.push({
                logId: stepLogId,
                userId: item.userId,
                stepIndex: idx + 1,
                action: actionName,
                padesSigIndex: isFinalStep ? 0 : null,
              })

              const targets: VerifyLinkTarget[] = []
              const pageIdx = (p.page ?? 1) - 1
              if (pageIdx >= 0) {
                targets.push({
                  pageIndex: pageIdx,
                  x: p.x,
                  y: p.y,
                  width: p.width,
                  height: p.height,
                })
              }
              for (const extra of p.extraPlacements ?? []) {
                const extraIdx = (extra.page ?? 1) - 1
                if (extraIdx >= 0) {
                  targets.push({
                    pageIndex: extraIdx,
                    x: extra.x,
                    y: extra.y,
                    width: extra.width,
                    height: extra.height,
                  })
                }
              }
              if (targets.length > 0) {
                linkGroups.push({
                  targets,
                  url: `${APP_URL}/van-ban-verify/${stepLogId}`,
                })
              }
            })

            const { data: userProfile } = await supabaseAdmin
              .from("profiles")
              .select("auth_email")
              .eq("id", userId)
              .maybeSingle()

            const sealSignerName = signerName || "Người phê duyệt"
            const sealedBuf = await sealPdfWithVerifyLinks(
              Buffer.from(finalBytes),
              linkGroups,
              sealSignerName,
              (userProfile?.auth_email as string) || "",
            )
            finalBytes = new Uint8Array(sealedBuf)
            padesSigIndex = 0
          } catch (sealErr) {
            console.warn("[finalize N-step] sealPdfWithVerifyLinks warning:", sealErr)
            padesError = sealErr instanceof Error ? sealErr.message : "Lỗi niêm phong chữ ký số"
          }
        }

        const signedContentHash = computeIntegrityHash(finalBytes)
        const finalPath = `${factoryId}/iso/instances/${instanceId}/final.${finalExt}`
        const finalMime = finalExt === "pdf" ? "application/pdf" : "application/octet-stream"
        await supabaseAdmin.storage.from(BUCKET).upload(finalPath, new Blob([Buffer.from(finalBytes)], { type: finalMime }), { upsert: true })
        const { data: finalUrlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(finalPath)

        const updates: Record<string, unknown> = {
          trang_thai: "da_phe_duyet" as IsoFormInstanceStatus,
          buoc_hien_tai: soBuocTong,
          nguoi_ky: newNguoiKy,
          placement_ky: newPlacementKy,
          phe_duyet: signerName,
          ky_phe_duyet_at: new Date().toISOString(),
          phe_duyet_sign_as: signAsChosen === "none" ? null : signAsChosen,
        }
        if (finalExt === "pdf") {
          updates.final_pdf_url = finalUrlData?.publicUrl
        } else {
          updates.final_office_url = finalUrlData?.publicUrl
        }

        await supabaseAdmin.from("iso_form_instances").update(updates).eq("id", instanceId)

        if (stepLogs.length > 0) {
          for (const sLog of stepLogs) {
            await supabaseAdmin.from("doc_approval_log").insert({
              id: sLog.logId,
              factory_id: factoryId,
              doc_id: instanceId,
              doc_type: "iso_form",
              user_id: sLog.userId,
              action: sLog.action,
              buoc_ky: sLog.stepIndex,
              content_hash: signedContentHash,
              pades_sig_index: sLog.padesSigIndex,
              pades_error: sLog.padesSigIndex !== null ? padesError : null,
            })
          }
        } else {
          await supabaseAdmin.from("doc_approval_log").insert({
            id: logId,
            factory_id: factoryId,
            doc_id: instanceId,
            doc_type: "iso_form",
            user_id: userId,
            action: "phe_duyet",
            buoc_ky: soBuocTong,
            content_hash: signedContentHash,
            pades_sig_index: padesSigIndex,
            pades_error: padesError,
          })
        }

        await supabaseAdmin.from("iso_form_instance_logs").insert({
          instance_id: instanceId,
          factory_id: factoryId,
          user_id: userId,
          action: "phe_duyet",
          note: lyDo || null,
        })

        if (instance.nguoi_tao && instance.nguoi_tao !== userId) {
          try {
            await supabaseAdmin.from("notifications").insert({
              factory_id: factoryId,
              user_id: instance.nguoi_tao,
              type: "cho_ky",
              doc_id: instanceId,
              doc_type: "iso_form",
              title: "[ISO Forms] Hồ sơ đã được phê duyệt",
              body: `Hồ sơ "${instance.tieu_de || "Biểu mẫu ISO"}" đã được ${signerName} phê duyệt hoàn tất.`,
              is_read: false,
              link: `${appUrl}/dashboard/iso/forms/${instanceId}`,
            })
          } catch (notifErr) {
            console.warn("[finalize] Notification error:", notifErr)
          }
        }

        // Vá bảo mật 2026-09-21: không trả `finalUrl` (URL public thô) — không có call site nào
        // ở client đọc field này (đã grep xác nhận), bucket `iso-documents` sẽ chuyển private.
        return NextResponse.json({
          success: true,
          trang_thai: "da_phe_duyet",
          buoc_hien_tai: soBuocTong,
        })
      }
    }

    // =========================================================================
    // LEGACY PATH: 3 vai trò cố định (Cấp 1 / Cấp 2, so_buoc_tong === 0)
    // Giữ nguyên 100% không đổi một nét cho các hồ sơ lịch sử.
    // =========================================================================
    // Kiểm tra quyền action
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name, username, role")
      .eq("id", userId)
      .single()
    const isAdmin = profile?.role === "admin"

    if (action === "soan_thao" && !isAdmin && instance.nguoi_tao !== userId) {
      return NextResponse.json({ error: "Bạn không phải người tạo hồ sơ này" }, { status: 403 })
    }
    if (action === "xem_xet" && !isAdmin && instance.xem_xet_user_id !== userId) {
      return NextResponse.json({ error: "Bạn không phải người xem xét hồ sơ này" }, { status: 403 })
    }
    if (action === "phe_duyet" && !isAdmin && instance.phe_duyet_user_id !== userId) {
      return NextResponse.json({ error: "Bạn không phải người phê duyệt hồ sơ này" }, { status: 403 })
    }

    // Lấy tên người ký
    const signerName = profile?.full_name || profile?.username || ""

    const draftExt = (instance.draft_file_type as string | null) ?? "docx"
    const auto_convert_pdf = instance.auto_convert_pdf as boolean
    const originFromReq = req.headers.get("origin") || (req.headers.get("host") ? `${req.headers.get("x-forwarded-proto") || "https"}://${req.headers.get("host")}` : "")
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || originFromReq || "https://qlsxkpt.vercel.app"
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
        const sigImgBuf = await getSignatureImage(factoryId, userId)
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
        ly_do_tra_ve: null,
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
        const sigImgBuf = await getSignatureImage(factoryId, userId)
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
        const sigImgBuf = await getSignatureImage(factoryId, userId)
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
            // Vá bảo mật 2026-09-21: CloudConvert (dịch vụ ngoài) tự fetch URL này qua
            // import/url — bucket private nên phải mint Signed URL, không dùng getPublicUrl().
            const tempSignedUrl = await mintSignedUrlForPath(tempPath, { bucket: BUCKET, ttlSeconds: 600 })
            if (!tempSignedUrl) throw new Error("Khong tao duoc duong dan file tam de convert CloudConvert")
            const pdfDoc = await convertOfficeUrlToPdfDocumentWithRetry(tempSignedUrl)
            const pdfBuf = await pdfDoc.save()
            finalBytes = new Uint8Array(pdfBuf)
            finalExt = "pdf"
          } catch (convErr) {
            console.error("[finalize] CloudConvert lỗi:", convErr)
            // Giữ DOCX đã tag làm final — không block workflow
          }
        }
      }

      let padesSigIndex: number | null = null
      let padesError: string | null = null
      const logId = randomUUID()

      type StepLogEntry = {
        logId: string
        userId: string
        stepIndex: number
        action: string
        padesSigIndex?: number | null
      }
      const stepLogs: StepLogEntry[] = []

      if (finalExt === "pdf") {
        try {
          const linkGroups: VerifyLinkGroup[] = []
          allPlacements.forEach((item, idx) => {
            const p = item.placement
            if (!p) return
            const isFinalStep = idx === allPlacements.length - 1
            const stepLogId = isFinalStep ? logId : randomUUID()
            const actionName = isFinalStep ? "phe_duyet" : (idx === 0 ? "soan_thao" : "xem_xet")
            stepLogs.push({
              logId: stepLogId,
              userId: item.userId,
              stepIndex: idx + 1,
              action: actionName,
              padesSigIndex: isFinalStep ? 0 : null,
            })

            const targets: VerifyLinkTarget[] = []
            const pageIdx = (p.page ?? 1) - 1
            if (pageIdx >= 0) {
              targets.push({
                pageIndex: pageIdx,
                x: p.x,
                y: p.y,
                width: p.width,
                height: p.height,
              })
            }
            for (const extra of p.extraPlacements ?? []) {
              const extraIdx = (extra.page ?? 1) - 1
              if (extraIdx >= 0) {
                targets.push({
                  pageIndex: extraIdx,
                  x: extra.x,
                  y: extra.y,
                  width: extra.width,
                  height: extra.height,
                })
              }
            }
            if (targets.length > 0) {
              linkGroups.push({
                targets,
                url: `${APP_URL}/van-ban-verify/${stepLogId}`,
              })
            }
          })

          const { data: userProfile } = await supabaseAdmin
            .from("profiles")
            .select("auth_email")
            .eq("id", userId)
            .maybeSingle()

          const sealSignerName = signerName || "Người phê duyệt"
          const sealedBuf = await sealPdfWithVerifyLinks(
            Buffer.from(finalBytes),
            linkGroups,
            sealSignerName,
            (userProfile?.auth_email as string) || "",
          )
          finalBytes = new Uint8Array(sealedBuf)
          padesSigIndex = 0
        } catch (sealErr) {
          console.warn("[finalize 3-step] sealPdfWithVerifyLinks warning:", sealErr)
          padesError = sealErr instanceof Error ? sealErr.message : "Lỗi niêm phong chữ ký số"
        }
      }

      const signedContentHash = computeIntegrityHash(finalBytes)
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

      if (stepLogs.length > 0) {
        for (const sLog of stepLogs) {
          await supabaseAdmin.from("doc_approval_log").insert({
            id: sLog.logId,
            factory_id: factoryId,
            doc_id: instanceId,
            doc_type: "iso_form",
            user_id: sLog.userId,
            action: sLog.action,
            buoc_ky: sLog.stepIndex,
            content_hash: signedContentHash,
            pades_sig_index: sLog.padesSigIndex,
            pades_error: sLog.padesSigIndex !== null ? padesError : null,
          })
        }
      } else {
        await supabaseAdmin.from("doc_approval_log").insert({
          id: logId,
          factory_id: factoryId,
          doc_id: instanceId,
          doc_type: "iso_form",
          user_id: userId,
          action: "phe_duyet",
          content_hash: signedContentHash,
          pades_sig_index: padesSigIndex,
          pades_error: padesError,
        })
      }

      await supabaseAdmin.from("iso_form_instance_logs").insert({
        instance_id: instanceId,
        factory_id: factoryId,
        user_id: userId,
        action: "phe_duyet",
        note: lyDo || null,
      })
      // Vá bảo mật 2026-09-21: không trả `finalUrl` (URL public thô) trong response nữa — bucket
      // `iso-documents` sẽ chuyển private, và không có call site nào ở client đọc field này
      // (đã grep xác nhận). Client mở/tải file sau khi ký qua route `[id]/file-url` (Signed URL).
      return NextResponse.json({ success: true, trang_thai: "da_phe_duyet" })
    }

    return NextResponse.json({ error: "Action không hợp lệ" }, { status: 400 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
