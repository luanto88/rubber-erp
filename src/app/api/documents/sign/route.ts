import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, supabaseAdmin, verifyCurrentPin } from "@/app/api/account/_lib/security"
import { resolveUserDeptCode } from "@/lib/documents-dept"
import { SIGN_AS_OPTIONS, type ThuTuKyStep, type SignAsType } from "@/app/dashboard/documents/_components/documents-types"
import { PDFDocument, rgb } from "pdf-lib"
import fontkit from "@pdf-lib/fontkit"
import JSZip from "jszip"
import QRCode from "qrcode"
import fs from "fs"
import path from "path"
import { computeIntegrityHash } from "@/lib/signing/hash"

const BUCKET = "iso-documents"
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://qlsxkpt.vercel.app"

// ── Types ─────────────────────────────────────────────────────────────────────

// Vị trí đặt chữ ký/tên trên PDF do người ký kéo-thả chọn (SignPlacementModal).
// showSignature/showSignerName + name*: giống hệt FullPlacement của ISO forms
// (src/app/dashboard/iso/forms/[id]/page.tsx) để tái dùng đúng công thức vẽ tên.
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
  // Hộp tiền tố ký thay (KT./TM./TL./TUQ.) — chỉ áp dụng cho PDF, vẽ tách biệt khỏi
  // tên người ký. Không có khái niệm tương đương cho DOCX/XLSX (theo yêu cầu nghiệp vụ).
  showPrefix?: boolean
  prefixX?: number
  prefixY?: number
  prefixWidth?: number
  prefixHeight?: number
  // Vị trí QR do người ký kéo-thả chọn — CHỈ có ý nghĩa khi showQr=true (lượt ký đầu
  // tiên của văn bản, xem hasQrPlacement ở documents/[id]/page.tsx). Server chỉ đọc
  // các trường này đúng 1 lần (lúc chưa có placement_ky.qr) rồi lưu lại làm nguồn sự
  // thật cho mọi lượt ký sau — không đọc lại qrX/qrY từ các lượt ký sau.
  showQr?: boolean
  qrX?: number
  qrY?: number
  qrWidth?: number
  qrHeight?: number
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

// Vị trí QR đã "chốt" cho cả văn bản — lưu tại placement_ky.qr, thiết lập đúng 1 lần
// ở lượt ký đầu tiên, tái dùng cho mọi lượt stamp tiếp theo (không đổi theo từng bước).
type QrBox = { x: number; y: number; width: number; height: number }

function isValidSignAs(v: unknown): v is Exclude<SignAsType, "none"> {
  return typeof v === "string" && (SIGN_AS_OPTIONS as string[]).includes(v)
}

// Nếu văn bản CHƯA từng có QR được chốt vị trí (`base.qr`) và request này gửi kèm
// tọa độ QR hợp lệ (`showQr: true` — chỉ SignPlacementModal gửi ở lượt ký đầu tiên
// của cả văn bản, xem `documents/[id]/page.tsx`'s `hasQrPlacement`), chốt vị trí đó
// vào key "qr" để mọi lượt ký/phê duyệt sau tái dùng, không đọc lại qrX/qrY của các
// lượt sau (tránh vẽ nhiều QR ở nhiều vị trí khác nhau qua các bước — xem
// performFileStamp/stampPdfStep).
function mergeQrBox(
  base: Record<string, SignPlacement | QrBox>,
  placement: SignPlacement | null | undefined,
): Record<string, SignPlacement | QrBox> {
  if (base.qr) return base
  if (!placement?.showQr) return base
  if (
    typeof placement.qrX !== "number" ||
    typeof placement.qrY !== "number" ||
    typeof placement.qrWidth !== "number" ||
    typeof placement.qrHeight !== "number"
  ) {
    return base
  }
  return {
    ...base,
    qr: { x: placement.qrX, y: placement.qrY, width: placement.qrWidth, height: placement.qrHeight },
  }
}

type VanBanRow = {
  id: string
  factory_id: string
  trang_thai: string
  cap_tl: string | null
  phan_loai: string | null   // 'Thuong' | 'Mat'
  thu_tu_ky_json: ThuTuKyStep[]
  buoc_hien_tai: number
  so_buoc_tong: number
  nguoi_ky: Record<string, { ten: string; chuc_vu: string; ky_at: string; is_kt?: boolean; sign_as?: string }>
  // Key theo số bước ("1","2",...) hoặc "phe_duyet" → SignPlacement của bước đó; key
  // "qr" (nếu đã có) → QrBox đã chốt vị trí QR chung cho cả văn bản.
  placement_ky: Record<string, SignPlacement | QrBox>
  soan_thao_user_id: string | null
  phe_duyet_user_id: string | null
  file_goc_url: string | null
  file_signed_pdf_url: string | null
  file_signed_office_url: string | null
  file_signed_office_type: string | null
  auto_convert_pdf: boolean
  ten_van_ban: string
  so_van_ban: string | null
  ma_van_ban: string | null
  loai_van_ban: string | null
  phong_ban: string | null
  nam: number | null
  nguoi_soan_thao_display: string | null
  phe_duyet: string | null
  phe_duyet_is_kt: boolean | null
  phe_duyet_sign_as: string | null
}

type ProfileRow = {
  id: string
  full_name: string | null
  username: string | null
  role: string | null
  department: string | null
  department_id: string | null
}

type PermissionRow = { permission_code: string }

const DOC_SELECT =
  "id, factory_id, trang_thai, cap_tl, phan_loai, thu_tu_ky_json, buoc_hien_tai, so_buoc_tong, nguoi_ky, placement_ky, soan_thao_user_id, phe_duyet_user_id, file_goc_url, file_signed_pdf_url, file_signed_office_url, file_signed_office_type, auto_convert_pdf, ten_van_ban, so_van_ban, ma_van_ban, loai_van_ban, phong_ban, nam, nguoi_soan_thao_display, phe_duyet, phe_duyet_is_kt, phe_duyet_sign_as"

// ── Auth helpers ──────────────────────────────────────────────────────────────

async function getUserDeptCode(profile: ProfileRow): Promise<string | null> {
  return resolveUserDeptCode(supabaseAdmin, profile)
}

async function getProfileAndPermissions(userId: string) {
  const [{ data: profile }, { data: perms }] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("id, full_name, username, role, department, department_id")
      .eq("id", userId)
      .single(),
    supabaseAdmin
      .from("user_permissions")
      .select("permission_code")
      .eq("user_id", userId),
  ])
  if (!profile) throw new Error("Không tìm thấy hồ sơ người dùng")
  const permissions = (perms || []).map((p: PermissionRow) => p.permission_code)
  const isAdmin = (profile as ProfileRow).role === "admin"
  const hasPermission = (code: string) => isAdmin || permissions.includes(code)
  return { profile: profile as ProfileRow, permissions, isAdmin, hasPermission }
}

// ── Stamp helpers ─────────────────────────────────────────────────────────────

function getFileExt(url: string | null, officeType?: string | null): string | null {
  if (!url) return officeType || null
  const clean = url.split("?")[0].toLowerCase()
  if (clean.endsWith(".pdf")) return "pdf"
  if (clean.endsWith(".docx")) return "docx"
  if (clean.endsWith(".xlsx")) return "xlsx"
  return officeType || null
}

async function downloadStorageFile(fileUrl: string): Promise<Buffer | null> {
  try {
    const clean = fileUrl.split("?")[0]
    const marker = `/storage/v1/object/public/${BUCKET}/`
    const idx = clean.indexOf(marker)
    if (idx >= 0) {
      const relPath = decodeURIComponent(clean.slice(idx + marker.length))
      const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(relPath)
      if (!error && data) return Buffer.from(await data.arrayBuffer())
    }
    const res = await fetch(fileUrl, { cache: "no-store" })
    if (!res.ok) return null
    return Buffer.from(await res.arrayBuffer())
  } catch {
    return null
  }
}

async function getSigImage(factoryId: string, userId: string): Promise<Buffer | null> {
  try {
    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .download(`signatures/${factoryId}/${userId}/chu_ky.png`)
    if (error || !data) return null
    return Buffer.from(await data.arrayBuffer())
  } catch {
    return null
  }
}

function buildStepTags(
  stepKey: string,
  signerName: string,
  chucVu: string,
  dateStr: string,
): { textTags: Record<string, string>; imageTagName: string } {
  if (stepKey === "phe_duyet") {
    return {
      textTags: {
        "{{TEN_PHE_DUYET}}": signerName,
        "{{CHUC_VU_PHE_DUYET}}": chucVu,
        "{{NGAY_BAN_HANH}}": dateStr,
      },
      imageTagName: "{{CHU_KY_PHE_DUYET}}",
    }
  }
  return {
    textTags: {
      [`{{TEN_BUOC_${stepKey}}}`]: signerName,
      [`{{CHUC_VU_BUOC_${stepKey}}}`]: chucVu,
      [`{{NGAY_KY_BUOC_${stepKey}}}`]: dateStr,
    },
    imageTagName: `{{CHU_KY_BUOC_${stepKey}}}`,
  }
}

async function replaceDocxImageTag(
  zip: JSZip,
  tag: string,
  imgBuf: Buffer,
  mediaFilename: string,
): Promise<void> {
  const candidatePaths: string[] = []
  zip.forEach((relPath) => {
    if (relPath.startsWith("word/") && relPath.endsWith(".xml") && !relPath.includes("/_rels/")) {
      const base = relPath.split("/").pop() ?? ""
      if (base === "document.xml" || base.startsWith("header") || base.startsWith("footer")) {
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

    if (!imgAdded) {
      zip.file(`word/media/${mediaFilename}`, imgBuf)
      imgAdded = true
    }

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

    const existingDocPrIds = [...docXml.matchAll(/<wp:docPr[^>]*\bid="(\d+)"/g)].map((m) =>
      parseInt(m[1]),
    )
    const newDocPrId = existingDocPrIds.length > 0 ? Math.max(...existingDocPrIds) + 1 : 1
    const emuW = 900000
    const emuH = 450000
    const drawingXml =
      `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
      `<wp:extent cx="${emuW}" cy="${emuH}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
      `<wp:docPr id="${newDocPrId}" name="${mediaFilename}"/>` +
      `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
      `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
      `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="${mediaFilename}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${newRId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emuW}" cy="${emuH}"/></a:xfrm>` +
      `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`

    docXml = docXml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (para) => {
      if (!para.includes(tag)) return para
      const pPrMatch = para.match(/(<w:pPr[\s\S]*?<\/w:pPr>)/)
      const pPr = pPrMatch ? pPrMatch[1] : ""
      return `<w:p>${pPr}<w:r><w:rPr/>${drawingXml}</w:r></w:p>`
    })

    zip.file(docPath, docXml)
  }
}

async function stampOffice(
  fileBytes: Buffer,
  ext: string,
  textTags: Record<string, string>,
  imageTagName: string,
  sigBuf: Buffer | null,
  stepKey: string,
  qrBuf: Buffer | null,
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(fileBytes)

  const xmlPaths: string[] = []
  zip.forEach((relPath) => {
    if (ext === "docx") {
      if (
        relPath.startsWith("word/") &&
        relPath.endsWith(".xml") &&
        !relPath.includes("/_rels/") &&
        !relPath.endsWith(".rels")
      ) {
        xmlPaths.push(relPath)
      }
    } else {
      if (
        relPath.startsWith("xl/") &&
        relPath.endsWith(".xml") &&
        !relPath.includes("/_rels/")
      ) {
        xmlPaths.push(relPath)
      }
    }
  })

  for (const xmlPath of xmlPaths) {
    const file = zip.file(xmlPath)
    if (!file) continue
    let xml = await file.async("string")
    for (const [tag, value] of Object.entries(textTags)) {
      if (xml.includes(tag)) xml = xml.split(tag).join(value)
    }
    zip.file(xmlPath, xml)
  }

  if (ext === "docx" && sigBuf) {
    await replaceDocxImageTag(zip, imageTagName, sigBuf, `sig_vb_${stepKey}.png`)
  }
  // {{QR}} là tag ảnh tùy chọn (giống cơ chế các tag khác) — chỉ thay nếu template có
  // chứa tag này, bỏ qua an toàn nếu không có (mirror cách QR hoạt động ở module ISO).
  // XLSX chưa hỗ trợ thay ảnh trong route này (giống hạn chế sẵn có của imageTagName).
  if (ext === "docx" && qrBuf) {
    await replaceDocxImageTag(zip, "{{QR}}", qrBuf, `qr_vb_${stepKey}.png`)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await zip.generateAsync({ type: "nodebuffer" })) as any as Buffer
}

// Vị trí tên người ký: dùng box riêng (nameX/nameY/nameWidth/nameHeight) nếu
// SignPlacementModal đã đặt, fallback về căn giữa ngay dưới chữ ký như trước.
// Mirror buildSignerNamePlacement() của ISO forms finalize route.
function buildSignerNamePlacement(p: SignPlacement) {
  return {
    xCenter: typeof p.nameX === "number" ? p.nameX + (p.nameWidth ?? p.width) / 2 : p.x + p.width / 2,
    y: typeof p.nameY === "number" ? p.nameY : Math.max(p.y - 14, 4),
    maxWidth: Math.max(typeof p.nameWidth === "number" ? p.nameWidth : p.width + 20, 60),
  }
}

async function stampPdfStep(
  fileBytes: Buffer,
  sigBuf: Buffer | null,
  signerName: string,
  prefixText: string | null,
  placement: SignPlacement | null,
  defaultX: number,
  qrBuf: Buffer | null,
  qrBox: QrBox | null,
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(fileBytes)
  pdfDoc.registerFontkit(fontkit)

  let signerFont: ReturnType<typeof pdfDoc.embedFont> extends Promise<infer T> ? T : never
  try {
    const fontBytes = fs.readFileSync(path.join(process.cwd(), "public/fonts/TimesNewRoman.ttf"))
    signerFont = await pdfDoc.embedFont(fontBytes)
  } catch {
    signerFont = null as never
  }

  const pageIdx = Math.max(0, (placement?.page ?? 1) - 1)
  const pages = pdfDoc.getPages()
  if (pageIdx >= pages.length) return fileBytes

  const page = pages[pageIdx]
  const x = placement?.x ?? defaultX
  const y = placement?.y ?? 50
  const w = placement?.width ?? 120
  const h = placement?.height ?? 60

  if (sigBuf && placement?.showSignature !== false) {
    try {
      const embedded = await pdfDoc.embedPng(sigBuf).catch(() => pdfDoc.embedJpg(sigBuf))
      page.drawImage(embedded, { x, y, width: w, height: h, opacity: 0.92 })
    } catch { /* skip */ }
  }

  if (signerName && signerFont && placement?.showSignerName !== false) {
    try {
      const slot = buildSignerNamePlacement(placement ?? { page: 1, x, y, width: w, height: h })
      let size = 10
      while (size > 7 && signerFont.widthOfTextAtSize(signerName, size) > slot.maxWidth) size -= 0.5
      const tw = signerFont.widthOfTextAtSize(signerName, size)
      page.drawText(signerName, {
        x: slot.xCenter - tw / 2,
        y: slot.y,
        size,
        font: signerFont,
        color: rgb(0, 0, 0),
      })
    } catch { /* skip */ }
  }

  // Tiền tố ký thay (KT./TM./TL./TUQ.) — hộp riêng, chỉ vẽ khi có tọa độ thật do
  // SignPlacementModal đặt. Không có fallback vị trí mặc định như chữ ký/tên vì
  // đây là tính năng tùy chọn (không phải mọi lượt ký đều chọn ký thay).
  if (
    prefixText &&
    signerFont &&
    placement?.showPrefix &&
    typeof placement.prefixX === "number" &&
    typeof placement.prefixY === "number"
  ) {
    try {
      page.drawText(prefixText, {
        x: placement.prefixX,
        y: placement.prefixY,
        size: 10,
        font: signerFont,
        color: rgb(0, 0, 0),
      })
    } catch { /* skip */ }
  }

  // Draw extra duplicate signatures & names if provided
  if (placement?.extraPlacements?.length) {
    for (const extraP of placement.extraPlacements) {
      const extraPageIndex = (extraP.page ?? 1) - 1
      if (extraPageIndex < 0 || extraPageIndex >= pdfDoc.getPageCount()) continue
      const targetPage = pdfDoc.getPage(extraPageIndex)
      try {
        if (sigBuf && extraP.showSignature !== false) {
          const embedded = await pdfDoc.embedPng(sigBuf).catch(() => pdfDoc.embedJpg(sigBuf))
          targetPage.drawImage(embedded, {
            x: extraP.x,
            y: extraP.y,
            width: extraP.width,
            height: extraP.height,
            opacity: 0.92,
          })
        }
        if (signerName && signerFont && extraP.showSignerName !== false) {
          const extraSlot = buildSignerNamePlacement(extraP as SignPlacement)
          let size = 10
          while (size > 7 && signerFont.widthOfTextAtSize(signerName, size) > extraSlot.maxWidth) size -= 0.5
          const tw = signerFont.widthOfTextAtSize(signerName, size)
          targetPage.drawText(signerName, {
            x: extraSlot.xCenter - tw / 2,
            y: extraSlot.y,
            size,
            font: signerFont,
            color: rgb(0, 0, 0),
          })
        }
      } catch { /* skip */ }
    }
  }

  // QR trỏ về trang chi tiết văn bản — vẽ trên TẤT CẢ trang. Ưu tiên vị trí người
  // ký đã kéo-thả chọn ở lượt ký đầu tiên (qrBox, đã "chốt" trong placement_ky.qr —
  // xem SignPlacementModal); nếu chưa từng có (văn bản cũ trước khi có tính năng
  // này, hoặc trường hợp hiếm không xác định được), fallback góc trên-phải cố định
  // (54×54pt, mirror kích thước QR của ISO forms). Vẽ lại mỗi lượt ký là an
  // toàn/idempotent — luôn cùng tọa độ đã chốt, không chồng lấn hay tích lũy qua các bước.
  if (qrBuf) {
    try {
      const qrImage = await pdfDoc.embedPng(qrBuf)
      for (const p of pages) {
        const { width, height } = p.getSize()
        const qrSize = 54
        const margin = 20
        const x = qrBox?.x ?? width - qrSize - margin
        const y = qrBox?.y ?? height - qrSize - margin
        const w = qrBox?.width ?? qrSize
        const h = qrBox?.height ?? qrSize
        p.drawImage(qrImage, { x, y, width: w, height: h })
      }
    } catch { /* skip */ }
  }

  return Buffer.from(await pdfDoc.save())
}

async function performFileStamp(
  d: VanBanRow,
  factoryId: string,
  userId: string,
  signerName: string,
  chucVu: string,
  stepKey: string,
  // Tiền tố ký thay (vd "TM.") — chỉ ảnh hưởng file PDF (vẽ hộp riêng), KHÔNG ghép
  // vào signerName/textTags của DOCX/XLSX (không có nhu cầu nghiệp vụ cho Office).
  prefixText: string | null = null,
): Promise<void> {
  const sourceUrl = d.file_signed_office_url || d.file_signed_pdf_url || d.file_goc_url
  if (!sourceUrl) return

  const ext = getFileExt(
    sourceUrl,
    d.file_signed_office_url ? d.file_signed_office_type : null,
  )
  if (!ext) return

  const fileBytes = await downloadStorageFile(sourceUrl)
  if (!fileBytes) return

  const sigBuf = await getSigImage(factoryId, userId)
  // QR trỏ về trang chi tiết văn bản, mirror pattern module ISO. Lỗi sinh QR không
  // được chặn cả lượt ký — vẫn tiếp tục đóng dấu chữ ký/tên bình thường.
  const qrBuf = await QRCode.toBuffer(`${APP_URL}/dashboard/documents/${d.id}`, {
    width: 160,
    margin: 1,
  }).catch(() => null)
  const today = new Date().toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
  const { textTags, imageTagName } = buildStepTags(stepKey, signerName, chucVu, today)

  let stampedBytes: Buffer
  if (ext === "docx" || ext === "xlsx") {
    stampedBytes = await stampOffice(fileBytes, ext, textTags, imageTagName, sigBuf, stepKey, qrBuf)
  } else if (ext === "pdf") {
    const placement = (d.placement_ky?.[stepKey] as SignPlacement | undefined) ?? null
    const qrBox = (d.placement_ky?.qr as QrBox | undefined) ?? null
    const defaultX =
      stepKey === "phe_duyet" ? 460 : (parseInt(stepKey) - 1) * 120 + 30
    stampedBytes = await stampPdfStep(fileBytes, sigBuf, signerName, prefixText, placement, defaultX, qrBuf, qrBox)
  } else {
    return
  }

  // Vá bảo mật 2026-08-27 (Giai đoạn 0 mục 2): hash tính ngay sau khi stamp, trước khi upload.
  // Văn bản trước đây KHÔNG có bất kỳ audit log/hash nào — doc_approval_log tuy đã tồn tại từ
  // module ISO (doc_type hỗ trợ sẵn 'van_ban') nhưng route này chưa từng ghi vào đó.
  const signedContentHash = computeIntegrityHash(stampedBytes)

  const storagePath = `${factoryId}/vanban/signed/${d.id}/${stepKey}.${ext}`
  const mimeMap: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }
  const { error: uploadErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(storagePath, stampedBytes as Buffer, {
      contentType: mimeMap[ext] || "application/octet-stream",
      upsert: true,
    })
  if (uploadErr) return

  const { data: urlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(storagePath)
  if (!urlData?.publicUrl) return

  const dbPatch: Record<string, unknown> = {}
  if (ext === "pdf") {
    dbPatch.file_signed_pdf_url = urlData.publicUrl
  } else {
    dbPatch.file_signed_office_url = urlData.publicUrl
    dbPatch.file_signed_office_type = ext
  }
  await supabaseAdmin.from("van_ban_documents").update(dbPatch).eq("id", d.id)

  await supabaseAdmin.from("doc_approval_log").insert({
    factory_id: factoryId,
    doc_id: d.id,
    doc_type: "van_ban",
    user_id: userId,
    action: stepKey === "phe_duyet" ? "phe_duyet" : "ky_buoc",
    buoc_ky: stepKey === "phe_duyet" ? null : parseInt(stepKey, 10),
    content_hash: signedContentHash,
  })
}

// ── Notify helpers ────────────────────────────────────────────────────────────

// Giải quyết người nhận thông báo cho bước phong_ban theo phân loại Thường/Mật
function resolvePhongBanRecipients(
  step: ThuTuKyStep,
  phanLoai: string | null,
): { recipientUserIds: string[]; targetDeptCode: string | null } {
  if (phanLoai === "Mat") {
    // Mật: chỉ gửi đến đích danh đã chọn cho bước này
    const uid = step.mat_recipient_user_id
    return {
      recipientUserIds: uid ? [uid] : [],
      targetDeptCode: null,
    }
  }
  // Thường (mặc định): gửi đến toàn bộ trưởng/phó phòng ban
  // notify route sẽ resolve danh sách từ targetDeptCode
  return { recipientUserIds: [], targetDeptCode: step.phong_ban_code ?? null }
}

function getNextRecipients(
  d: VanBanRow,
  action: string,
  newBuoc: number,
): { recipientUserIds: string[]; targetDeptCode: string | null } {
  if (action === "gui_ky") {
    const isCap1WithSteps = d.cap_tl === "Cấp 1" && d.so_buoc_tong > 0
    if (isCap1WithSteps) {
      const firstStep = (d.thu_tu_ky_json || [])[0]
      if (!firstStep) return { recipientUserIds: [], targetDeptCode: null }
      if (firstStep.type === "ca_nhan" && firstStep.user_id) {
        return { recipientUserIds: [firstStep.user_id], targetDeptCode: null }
      }
      return resolvePhongBanRecipients(firstStep, d.phan_loai)
    }
    return {
      recipientUserIds: d.phe_duyet_user_id ? [d.phe_duyet_user_id] : [],
      targetDeptCode: null,
    }
  }

  if (action === "ky_buoc") {
    const done = newBuoc >= d.so_buoc_tong
    if (done) {
      return {
        recipientUserIds: d.phe_duyet_user_id ? [d.phe_duyet_user_id] : [],
        targetDeptCode: null,
      }
    }
    const nextStep = (d.thu_tu_ky_json || [])[newBuoc]
    if (!nextStep) return { recipientUserIds: [], targetDeptCode: null }
    if (nextStep.type === "ca_nhan" && nextStep.user_id) {
      return { recipientUserIds: [nextStep.user_id], targetDeptCode: null }
    }
    return resolvePhongBanRecipients(nextStep, d.phan_loai)
  }

  if (action === "phe_duyet" || action === "tra_ve") {
    return {
      recipientUserIds: d.soan_thao_user_id ? [d.soan_thao_user_id] : [],
      targetDeptCode: null,
    }
  }

  return { recipientUserIds: [], targetDeptCode: null }
}

function fireNotify(payload: {
  docId: string
  factoryId: string
  action: string
  recipientUserIds: string[]
  targetDeptCode?: string | null
  lyDo?: string
  actorUserId: string
  stepN?: number
}): void {
  if (!payload.recipientUserIds.length && !payload.targetDeptCode) return
  fetch(`${APP_URL}/api/documents/notify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {})
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const userId = authUser.id

    const body = (await req.json()) as {
      docId: string
      factoryId: string
      action: "gui_ky" | "ky_buoc" | "phe_duyet" | "tra_ve"
      pin?: string
      ly_do?: string
      placement?: SignPlacement
      sign_as?: string
    }
    const { docId, factoryId, action, pin, ly_do, placement, sign_as } = body

    if (!docId || !factoryId || !action) {
      return NextResponse.json({ error: "Thiếu thông tin bắt buộc" }, { status: 400 })
    }

    const { profile, isAdmin } = await getProfileAndPermissions(userId)
    const userName = profile.full_name || profile.username || "Người dùng"

    const { data: doc, error: docErr } = await supabaseAdmin
      .from("van_ban_documents")
      .select(DOC_SELECT)
      .eq("id", docId)
      .eq("factory_id", factoryId)
      .single()

    if (docErr || !doc) {
      return NextResponse.json({ error: "Không tìm thấy văn bản" }, { status: 404 })
    }
    const d = doc as VanBanRow

    // ── gui_ky ────────────────────────────────────────────────────────────────
    if (action === "gui_ky") {
      if (d.trang_thai !== "draft" && d.trang_thai !== "tra_ve") {
        return NextResponse.json(
          { error: `Không thể gửi ký: văn bản đang ở trạng thái "${d.trang_thai}"` },
          { status: 400 },
        )
      }
      if (!isAdmin && d.soan_thao_user_id !== userId) {
        return NextResponse.json(
          { error: "Chỉ người soạn thảo mới được gửi văn bản này đi ký" },
          { status: 403 },
        )
      }

      const hasSteps = d.so_buoc_tong > 0
      const isCap1 = d.cap_tl === "Cấp 1"
      const nextStatus = isCap1 && hasSteps ? "cho_ky_phong_ban" : "cho_phe_duyet"

      // Dọn sạch toàn bộ dữ liệu ký của vòng trước (nếu có) — bắt buộc kể cả khi văn bản
      // chưa từng được ký lần nào (draft → gui_ky lần đầu, các field này vốn đã rỗng nên
      // ghi đè không đổi gì). Nếu không dọn, timeline sẽ hiển thị nhầm các bước cũ (trước
      // khi bị trả về) là "đã ký" với tên/ngày cũ dù buoc_hien_tai đã reset về 0, và
      // file_signed_* có thể vẫn trỏ tới bản đã ký một phần của vòng trước.
      const { error: updateErr } = await supabaseAdmin
        .from("van_ban_documents")
        .update({
          trang_thai: nextStatus,
          buoc_hien_tai: 0,
          nguoi_ky: {},
          placement_ky: {},
          file_signed_pdf_url: null,
          file_signed_office_url: null,
          file_signed_office_type: null,
          tra_ve_step: null,
          tra_ve_ly_do: null,
          tra_ve_nguoi: null,
          tra_ve_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", docId)

      if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

      const { recipientUserIds, targetDeptCode } = getNextRecipients(d, "gui_ky", 0)
      fireNotify({ docId, factoryId, action: "gui_ky", recipientUserIds, targetDeptCode, actorUserId: userId })

      return NextResponse.json({ ok: true, trang_thai: nextStatus })
    }

    // ── ky_buoc ───────────────────────────────────────────────────────────────
    if (action === "ky_buoc") {
      if (d.trang_thai !== "cho_ky_phong_ban") {
        return NextResponse.json(
          { error: "Văn bản không ở trạng thái chờ ký phòng ban" },
          { status: 400 },
        )
      }
      if (!pin) {
        return NextResponse.json({ error: "Vui lòng nhập PIN ký duyệt" }, { status: 400 })
      }

      const pinOk = await verifyCurrentPin(userId, pin)
      if (!pinOk) {
        return NextResponse.json({ error: "PIN không đúng" }, { status: 401 })
      }

      const stepIndex = d.buoc_hien_tai
      const step = (d.thu_tu_ky_json || [])[stepIndex]
      if (!step) {
        return NextResponse.json({ error: "Không tìm thấy bước ký hiện tại" }, { status: 400 })
      }

      if (step.type === "ca_nhan") {
        if (!isAdmin && step.user_id !== userId) {
          return NextResponse.json({ error: "Bạn không được phép ký bước này" }, { status: 403 })
        }
      } else if (step.type === "phong_ban") {
        const deptCode = await getUserDeptCode(profile)
        if (!isAdmin && deptCode !== step.phong_ban_code) {
          return NextResponse.json(
            {
              error: `Bước này yêu cầu phòng ban ${step.phong_ban_code}. Phòng ban của bạn: ${deptCode || "(chưa thiết lập)"}`,
            },
            { status: 403 },
          )
        }
      }

      const chucVu = step.phong_ban_code || step.chuc_vu || ""
      // Chỉ áp dụng ký thay (KT./TM./TL./TUQ.) cho bước phong_ban (Phó ký thay) —
      // không áp dụng cho ca_nhân (đã đích danh 1 người, không có khái niệm "ký thay")
      const signAs: SignAsType = step.type === "phong_ban" && isValidSignAs(sign_as) ? sign_as : "none"
      const newNguoiKy = {
        ...d.nguoi_ky,
        [String(stepIndex + 1)]: {
          ten: userName,
          chuc_vu: chucVu,
          ky_at: new Date().toISOString(),
          sign_as: signAs === "none" ? undefined : signAs,
        },
      }
      const newBuoc = d.buoc_hien_tai + 1
      const done = newBuoc >= d.so_buoc_tong
      const nextStatus = done ? "cho_phe_duyet" : "cho_ky_phong_ban"
      const stepKey = String(stepIndex + 1)
      const newPlacementKy = placement
        ? mergeQrBox({ ...d.placement_ky, [stepKey]: placement }, placement)
        : d.placement_ky

      const { error: updateErr } = await supabaseAdmin
        .from("van_ban_documents")
        .update({
          nguoi_ky: newNguoiKy,
          buoc_hien_tai: newBuoc,
          trang_thai: nextStatus,
          placement_ky: newPlacementKy,
          updated_at: new Date().toISOString(),
        })
        .eq("id", docId)

      if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

      // Stamp file (best-effort — lỗi không block response). Tiền tố chỉ vẽ riêng
      // trên PDF (hộp draggable riêng) — KHÔNG ghép vào signerName, vì DOCX/XLSX
      // không cần hiển thị tiền tố ký thay (đã xác nhận với người dùng).
      d.placement_ky = newPlacementKy
      const prefixText = signAs !== "none" ? `${signAs}.` : null
      await performFileStamp(d, factoryId, userId, userName, chucVu, stepKey, prefixText).catch(() => {})

      const { recipientUserIds, targetDeptCode } = getNextRecipients(d, "ky_buoc", newBuoc)
      fireNotify({
        docId,
        factoryId,
        action: "ky_buoc",
        recipientUserIds,
        targetDeptCode,
        actorUserId: userId,
        stepN: stepIndex + 1,
      })

      return NextResponse.json({ ok: true, trang_thai: nextStatus, buoc_hien_tai: newBuoc })
    }

    // ── phe_duyet ─────────────────────────────────────────────────────────────
    if (action === "phe_duyet") {
      if (d.trang_thai !== "cho_phe_duyet") {
        return NextResponse.json(
          { error: "Văn bản không ở trạng thái chờ phê duyệt" },
          { status: 400 },
        )
      }
      // Chỉ đúng người được chỉ định phe_duyet_user_id (hoặc admin) mới được phê duyệt —
      // không dùng quyền chung documents.phe_duyet, vì quyền đó có thể được cấp cho
      // nhiều lãnh đạo/trưởng phòng khác không phải người được chỉ định trên văn bản này.
      if (!isAdmin && d.phe_duyet_user_id !== userId) {
        return NextResponse.json({ error: "Bạn không phải người được chỉ định phê duyệt văn bản này" }, { status: 403 })
      }
      if (!pin) {
        return NextResponse.json({ error: "Vui lòng nhập PIN ký duyệt" }, { status: 400 })
      }

      const pinOk = await verifyCurrentPin(userId, pin)
      if (!pinOk) {
        return NextResponse.json({ error: "PIN không đúng" }, { status: 401 })
      }

      // Ký thay được chọn ngay lúc ký (SignPlacementModal), không còn set lúc soạn
      // thảo — thay thế cơ chế cũ phe_duyet_is_kt (vẫn giữ cột đó cho văn bản cũ
      // hiển thị đúng lịch sử, nhưng không còn ghi thêm từ đây trở đi).
      const signAsPD: SignAsType = isValidSignAs(sign_as) ? sign_as : "none"

      const today = new Date().toISOString().slice(0, 10)
      const newPlacementKy = placement
        ? mergeQrBox({ ...d.placement_ky, phe_duyet: placement }, placement)
        : d.placement_ky

      const { error: updateErr } = await supabaseAdmin
        .from("van_ban_documents")
        .update({
          trang_thai: "da_phe_duyet",
          phe_duyet: userName,
          phe_duyet_user_id: userId,
          phe_duyet_sign_as: signAsPD === "none" ? null : signAsPD,
          ngay_phe_duyet: today,
          placement_ky: newPlacementKy,
          updated_at: new Date().toISOString(),
        })
        .eq("id", docId)

      if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

      // Chức vụ phê duyệt lấy từ department profile
      const chucVuPD = profile.department || profile.role || ""
      d.placement_ky = newPlacementKy
      // Tiền tố chỉ vẽ riêng trên PDF (hộp draggable riêng) — KHÔNG ghép vào tên
      // dùng cho tag DOCX/XLSX (không cần cho Office, đã xác nhận với người dùng).
      const prefixTextPD = signAsPD !== "none" ? `${signAsPD}.` : null
      await performFileStamp(d, factoryId, userId, userName, chucVuPD, "phe_duyet", prefixTextPD).catch(() => {})

      fireNotify({
        docId,
        factoryId,
        action: "phe_duyet",
        recipientUserIds: d.soan_thao_user_id ? [d.soan_thao_user_id] : [],
        actorUserId: userId,
      })

      return NextResponse.json({ ok: true, trang_thai: "da_phe_duyet" })
    }

    // ── tra_ve ────────────────────────────────────────────────────────────────
    if (action === "tra_ve") {
      if (d.trang_thai !== "cho_ky_phong_ban" && d.trang_thai !== "cho_phe_duyet") {
        return NextResponse.json(
          { error: "Chỉ có thể trả về khi văn bản đang chờ ký" },
          { status: 400 },
        )
      }

      // Cùng nguyên tắc với action "phe_duyet": chỉ đúng người được chỉ định
      // phe_duyet_user_id mới được trả về sớm (kể cả khi văn bản còn ở bước ký
      // phòng ban) — không dùng quyền chung documents.phe_duyet.
      let canReturn = isAdmin || d.phe_duyet_user_id === userId
      if (!canReturn && d.trang_thai === "cho_ky_phong_ban") {
        const step = (d.thu_tu_ky_json || [])[d.buoc_hien_tai]
        if (step?.type === "phong_ban") {
          const deptCode = await getUserDeptCode(profile)
          canReturn = deptCode === step.phong_ban_code
        } else if (step?.type === "ca_nhan") {
          canReturn = step.user_id === userId
        }
      }
      if (!canReturn) {
        return NextResponse.json(
          { error: "Bạn không có quyền trả về văn bản này" },
          { status: 403 },
        )
      }

      const { error: updateErr } = await supabaseAdmin
        .from("van_ban_documents")
        .update({
          trang_thai: "tra_ve",
          tra_ve_step: d.buoc_hien_tai,
          tra_ve_ly_do: ly_do || null,
          tra_ve_nguoi: userName,
          tra_ve_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", docId)

      if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

      fireNotify({
        docId,
        factoryId,
        action: "tra_ve",
        recipientUserIds: d.soan_thao_user_id ? [d.soan_thao_user_id] : [],
        lyDo: ly_do,
        actorUserId: userId,
      })

      return NextResponse.json({ ok: true, trang_thai: "tra_ve" })
    }

    return NextResponse.json({ error: "Action không hợp lệ" }, { status: 400 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Lỗi không xác định"
    const status = msg.includes("đăng nhập") ? 401 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
