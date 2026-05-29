import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { jwtVerify } from "jose"
import QRCode from "qrcode"
import JSZip from "jszip"
import ExcelJS from "exceljs"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const JWT_SECRET = new TextEncoder().encode(
  process.env.SIGN_JWT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://qlsxkpt.vercel.app"

type FileKind = "main" | "change_request" | "review_request"
type SignStep = "soan_thao" | "xem_xet" | "phe_duyet"
type WorkflowAction = "gui_xem_xet" | "gui_phe_duyet" | "phe_duyet" | "tra_ve" | "khong_xem_xet" | "tu_choi_phe_duyet" | "gui_lai_phe_duyet" | "tra_ve_nhap"

type OfficeDiagnostics = {
  tagsFound: string[]
  tagsMissing: string[]
  tagsSimilar: string[]
  imagesInserted: string[]
}

const TEXT_TAGS = [
  "{{MA_TAI_LIEU}}",
  "{{TEN_TAI_LIEU}}",
  "{{PHONG_BAN}}",
  "{{LOAI_TAI_LIEU}}",
  "{{LAN_BAN_HANH}}",
  "{{LAN_SUA_DOI}}",
  "{{NGAY_HIEU_LUC}}",
  "{{TINH_TRANG}}",
  "{{MA_TAI_LIEU_CU}}",
  "{{MA_TAI_LIEU_MOI}}",
  "{{LY_DO_SOAT_XET}}",
  "{{NOI_DUNG_SOAT_XET}}",
  "{{TEN_SOAN_THAO}}",
  "{{TEN_XEM_XET}}",
  "{{TEN_PHE_DUYET}}",
] as const

const IMAGE_TAGS = [
  "{{QR}}",
  "{{CHU_KY_SOAN_THAO}}",
  "{{CHU_KY_XEM_XET}}",
  "{{CHU_KY_PHE_DUYET}}",
] as const

const ALL_TAGS = new Set<string>([...TEXT_TAGS, ...IMAGE_TAGS])
const CHILD_OFFICE_TAG_SET = new Set<string>([...TEXT_TAGS, "{{QR}}"])

function fmtDate(d: unknown): string {
  if (!d || typeof d !== "string") return ""
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return d
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function safeDecodeUri(value: string): string {
  try { return decodeURIComponent(value) } catch { return value }
}

function sanitizeOutputName(value: string): string {
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

function getStoragePathCandidatesFromUrl(fileUrl: string | null, bucket: string): string[] {
  if (!fileUrl) return []
  const candidates: string[] = []
  const push = (value: string | null) => {
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
        push(rel); push(safeDecodeUri(rel))
      }
    }
  } catch {
    // fallback below
  }
  const marker = `/storage/v1/object/public/${bucket}/`
  const markerIndex = cleanUrl.indexOf(marker)
  if (markerIndex >= 0) {
    const rel = cleanUrl.slice(markerIndex + marker.length)
    push(rel); push(safeDecodeUri(rel))
  }
  if (!/^https?:\/\//i.test(cleanUrl)) {
    push(cleanUrl); push(safeDecodeUri(cleanUrl))
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
  throw new Error(`Không tải được file Office nguồn. ${errors.join("; ")}`)
}

async function getSigImage(factoryId: string, userId: string): Promise<Buffer> {
  const storagePath = `signatures/${factoryId}/${userId}/chu_ky.png`
  const { data, error } = await supabaseAdmin.storage.from("iso-documents").download(storagePath)
  if (error || !data) throw new Error("Người ký chưa có ảnh chữ ký. Vào Cài đặt -> Chữ ký cá nhân để upload.")
  return Buffer.from(await data.arrayBuffer())
}

function getStep(doc: Record<string, unknown>, userId: string): SignStep | null {
  if (userId === doc.soan_thao_user_id) return "soan_thao"
  if (userId === doc.xem_xet_user_id) return "xem_xet"
  if (userId === doc.phe_duyet_user_id) return "phe_duyet"
  return null
}

function getStepTags(step: SignStep): { signatureTag: string; nameTag: string; nameValue: string } {
  if (step === "soan_thao") return { signatureTag: "{{CHU_KY_SOAN_THAO}}", nameTag: "{{TEN_SOAN_THAO}}", nameValue: "" }
  if (step === "xem_xet") return { signatureTag: "{{CHU_KY_XEM_XET}}", nameTag: "{{TEN_XEM_XET}}", nameValue: "" }
  return { signatureTag: "{{CHU_KY_PHE_DUYET}}", nameTag: "{{TEN_PHE_DUYET}}", nameValue: "" }
}

function isChildOfficeDoc(doc: Record<string, unknown>): boolean {
  const loaiTaiLieu = String(doc.loai_tai_lieu || "")
  const phanLoaiTl = String(doc.phan_loai_tl || "")
  return loaiTaiLieu === "F" || ((loaiTaiLieu === "PL" || loaiTaiLieu === "HD") && phanLoaiTl === "con")
}

function getTargetStatusText(action: WorkflowAction | undefined, currentStatus: string, capTl?: string): string {
  if (action === "gui_xem_xet") return capTl === "Cấp 2" ? "Chờ phê duyệt" : "Chờ xem xét"
  if (action === "gui_phe_duyet" || action === "gui_lai_phe_duyet") return "Chờ phê duyệt"
  if (action === "phe_duyet") return "Có hiệu lực"
  if (action === "tra_ve" || action === "khong_xem_xet" || action === "tra_ve_nhap") return "Trả về"
  if (action === "tu_choi_phe_duyet") return "Phê duyệt từ chối"
  if (currentStatus === "co_hieu_luc") return "Có hiệu lực"
  if (currentStatus === "cho_xem_xet") return "Chờ xem xét"
  if (currentStatus === "cho_phe_duyet") return "Chờ phê duyệt"
  if (currentStatus === "tra_ve") return "Trả về"
  if (currentStatus === "bi_tu_choi_phe_duyet") return "Phê duyệt từ chối"
  return "Chờ phê duyệt"
}

function buildTextValues(doc: Record<string, unknown>, statusText: string): Record<string, string> {
  const revision = String(doc.lan_ban_hanh ?? "").padStart(2, "0")
  return {
    "{{MA_TAI_LIEU}}": String(doc.ma_tai_lieu || ""),
    "{{TEN_TAI_LIEU}}": String(doc.ten_tai_lieu || ""),
    "{{PHONG_BAN}}": String(doc.phong_ban || ""),
    "{{LOAI_TAI_LIEU}}": String(doc.loai_tai_lieu || ""),
    "{{LAN_BAN_HANH}}": revision,
    "{{LAN_SUA_DOI}}": revision,
    "{{NGAY_HIEU_LUC}}": fmtDate(doc.ngay_hieu_luc || doc.ky_phe_duyet_at || doc.updated_at),
    "{{TINH_TRANG}}": statusText,
    "{{MA_TAI_LIEU_CU}}": String(doc.ma_tai_lieu_cu || ""),
    "{{MA_TAI_LIEU_MOI}}": String(doc.ma_tai_lieu_moi || doc.ma_tai_lieu || ""),
    "{{LY_DO_SOAT_XET}}": String(doc.ly_do_soat_xet || ""),
    "{{NOI_DUNG_SOAT_XET}}": String(doc.noi_dung_soat_xet || ""),
    "{{TEN_SOAN_THAO}}": String(doc.soan_thao || ""),
    "{{TEN_XEM_XET}}": String(doc.xem_xet || ""),
    "{{TEN_PHE_DUYET}}": String(doc.phe_duyet || ""),
  }
}

function collectSimilarTags(text: string, allowedTags: Set<string> = ALL_TAGS): string[] {
  const found = new Set<string>()
  for (const match of text.matchAll(/\{\{[^}]+\}\}/g)) {
    const tag = match[0]
    if (!allowedTags.has(tag)) found.add(tag)
  }
  return [...found]
}

function xmlTextDecode(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

function docxVisibleText(xml: string): string {
  return [...xml.matchAll(/<(?:w|a):t\b[^>]*>([\s\S]*?)<\/(?:w|a):t>/g)]
    .map((match) => xmlTextDecode(match[1]))
    .join("")
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function flexibleDocxTagPattern(tag: string): RegExp {
  const betweenChars = "(?:<[^>]+>|\\s)*"
  return new RegExp(tag.split("").map(escapeRegExp).join(betweenChars), "g")
}

function replaceAllTextTags(text: string, values: Record<string, string>, diagnostics: OfficeDiagnostics): string {
  let next = text
  for (const [tag, value] of Object.entries(values)) {
    const directFound = next.includes(tag)
    const flexiblePattern = flexibleDocxTagPattern(tag)
    const flexibleFound = flexiblePattern.test(next)
    if (directFound || flexibleFound) diagnostics.tagsFound.push(tag)
    next = next.split(tag).join(xmlEscape(value))
    next = next.replace(flexibleDocxTagPattern(tag), xmlEscape(value))
  }
  return next
}

function ensureDocxPngContentType(contentTypesXml: string): string {
  if (contentTypesXml.includes('Extension="png"')) return contentTypesXml
  return contentTypesXml.replace("</Types>", '<Default Extension="png" ContentType="image/png"/></Types>')
}

function nextRelId(relsXml: string): string {
  const ids = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1])).filter((n) => Number.isFinite(n))
  return `rId${Math.max(0, ...ids) + 1}`
}

function drawingXml(relId: string, cx: number, cy: number): string {
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${Date.now() % 100000}" name="ISO signature"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="signature.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
}

function textRunXml(text: string, runProperties = ""): string {
  return text ? `<w:r>${runProperties}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>` : ""
}

function replaceDocxImageTag(xml: string, tag: string, drawing: string): { xml: string; replaced: boolean } {
  let replaced = false
  let next = xml.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, (run) => {
    const textMatch = run.match(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/)
    if (!textMatch) return run
    const rawText = xmlTextDecode(textMatch[1])
    if (!rawText.includes(tag)) return run
    replaced = true
    const [before, after] = rawText.split(tag)
    const runProperties = run.match(/<w:rPr\b[\s\S]*?<\/w:rPr>/)?.[0] || ""
    return `${textRunXml(before, runProperties)}${drawing}${textRunXml(after, runProperties)}`
  })
  if (!replaced && next.includes(tag)) {
    replaced = true
    next = next.split(tag).join(drawing)
  }
  return { xml: next, replaced }
}

function anchoredDrawingXml(relId: string, cx: number, cy: number): string {
  const offset = 228600
  return `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251659264" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:align>right</wp:align></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>${offset}</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="bothSides"/><wp:docPr id="${Date.now() % 100000}" name="ISO QR"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="qr.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`
}

async function ensureRel(zip: JSZip, partPath: string, imagePath: string): Promise<string> {
  const dir = partPath.split("/").slice(0, -1).join("/")
  const file = partPath.split("/").pop() || "document.xml"
  const relPath = `${dir}/_rels/${file}.rels`
  let relsXml = await zip.file(relPath)?.async("string")
  if (!relsXml) {
    relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
  }
  const relId = nextRelId(relsXml)
  const relTarget = imagePath.replace(/^word\//, "")
  relsXml = relsXml.replace("</Relationships>", `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${relTarget}"/></Relationships>`)
  zip.file(relPath, relsXml)
  return relId
}

async function insertDefaultDocxQr(zip: JSZip, imagePath: string, diagnostics: OfficeDiagnostics): Promise<void> {
  const partPath = "word/document.xml"
  const file = zip.file(partPath)
  if (!file) return

  const relId = await ensureRel(zip, partPath, imagePath)
  const qrDrawing = anchoredDrawingXml(relId, 432000, 432000)
  const paragraph = `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${qrDrawing}</w:p>`
  const xml = await file.async("string")
  if (!xml.includes("<w:body>")) return

  zip.file(partPath, xml.replace("<w:body>", `<w:body>${paragraph}`))
  diagnostics.tagsFound.push("{{QR}}")
  diagnostics.imagesInserted.push("{{QR}}:default-top-right")
}

async function renderDocx(
  bytes: ArrayBuffer,
  values: Record<string, string>,
  imageByTag: Record<string, Buffer>,
  requiredTags: string[],
  defaultQrWhenMissing: boolean,
  allowedTags: Set<string> = ALL_TAGS,
): Promise<{ buffer: Buffer; diagnostics: OfficeDiagnostics }> {
  const zip = await JSZip.loadAsync(bytes)
  const diagnostics: OfficeDiagnostics = { tagsFound: [], tagsMissing: [], tagsSimilar: [], imagesInserted: [] }
  const contentTypes = await zip.file("[Content_Types].xml")?.async("string")
  if (contentTypes) zip.file("[Content_Types].xml", ensureDocxPngContentType(contentTypes))

  const mediaEntries = new Map<string, string>()
  let imageIndex = 1
  for (const [tag, img] of Object.entries(imageByTag)) {
    const path = `word/media/iso_${imageIndex++}.png`
    zip.file(path, img)
    mediaEntries.set(tag, path)
  }

  const xmlFiles = Object.keys(zip.files).filter((name) =>
    /^word\/.+\.xml$/.test(name)
  )

  const allTextParts: string[] = []
  for (const partPath of xmlFiles) {
    const file = zip.file(partPath)
    if (!file) continue
    let xml = await file.async("string")
    allTextParts.push(docxVisibleText(xml))
    xml = replaceAllTextTags(xml, values, diagnostics)
    for (const [tag, imagePath] of mediaEntries) {
      const directImageTagFound = xml.includes(tag)
      const flexibleImageTagFound = flexibleDocxTagPattern(tag).test(xml)
      if (!directImageTagFound && !flexibleImageTagFound) continue
      diagnostics.tagsFound.push(tag)
      diagnostics.imagesInserted.push(tag)
      const relId = await ensureRel(zip, partPath, imagePath)
      const size = tag === "{{QR}}" ? { cx: 432000, cy: 432000 } : { cx: 1600200, cy: 685800 }
      const drawing = drawingXml(relId, size.cx, size.cy)
      const tagRe = new RegExp(`<w:r[^>]*>\\s*<w:t[^>]*>${tag.replace(/[{}]/g, "\\$&")}<\\/w:t>\\s*<\\/w:r>`, "g")
      xml = xml.replace(tagRe, drawing)
      const replaced = replaceDocxImageTag(xml, tag, drawing)
      xml = replaced.xml
      if (!replaced.replaced) xml = xml.replace(flexibleDocxTagPattern(tag), drawing)
    }
    zip.file(partPath, xml)
  }

  if (defaultQrWhenMissing && !diagnostics.tagsFound.includes("{{QR}}")) {
    const qrImagePath = mediaEntries.get("{{QR}}")
    if (qrImagePath) await insertDefaultDocxQr(zip, qrImagePath, diagnostics)
  }

  const combined = allTextParts.join("\n")
  diagnostics.tagsSimilar = collectSimilarTags(combined, allowedTags)
  diagnostics.tagsMissing = requiredTags.filter((tag) => !diagnostics.tagsFound.includes(tag))
  if (diagnostics.tagsSimilar.length > 0 || diagnostics.tagsMissing.length > 0) {
    throw new Error(`Template DOCX chưa đúng tag. Thiếu: ${diagnostics.tagsMissing.join(", ") || "không"}. Tag gần giống/sai: ${diagnostics.tagsSimilar.join(", ") || "không"}.`)
  }

  return { buffer: await zip.generateAsync({ type: "nodebuffer" }), diagnostics }
}

async function renderXlsx(
  bytes: ArrayBuffer,
  values: Record<string, string>,
  imageByTag: Record<string, Buffer>,
  requiredTags: string[],
  defaultQrWhenMissing: boolean,
  allowedTags: Set<string> = ALL_TAGS,
): Promise<{ buffer: Buffer; diagnostics: OfficeDiagnostics }> {
  const diagnostics: OfficeDiagnostics = { tagsFound: [], tagsMissing: [], tagsSimilar: [], imagesInserted: [] }
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes)

  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        const text = typeof cell.value === "string" ? cell.value : null
        if (!text) return
        for (const similar of collectSimilarTags(text, allowedTags)) diagnostics.tagsSimilar.push(similar)
        if (imageByTag[text]) {
          diagnostics.tagsFound.push(text)
          diagnostics.imagesInserted.push(text)
          cell.value = ""
          const imageId = workbook.addImage({ base64: imageByTag[text].toString("base64"), extension: "png" })
          sheet.addImage(imageId, {
            tl: { col: Number(cell.col) - 1, row: Number(cell.row) - 1 },
            ext: text === "{{QR}}" ? { width: 96, height: 96 } : { width: 160, height: 72 },
          })
          return
        }
        let next = text
        for (const [tag, value] of Object.entries(values)) {
          if (next.includes(tag)) diagnostics.tagsFound.push(tag)
          next = next.split(tag).join(value)
        }
        cell.value = next
      })
    })
  })

  if (defaultQrWhenMissing && !diagnostics.tagsFound.includes("{{QR}}")) {
    const qrBuffer = imageByTag["{{QR}}"]
    const firstSheet = workbook.worksheets[0]
    if (qrBuffer && firstSheet) {
      const imageId = workbook.addImage({ base64: qrBuffer.toString("base64"), extension: "png" })
      firstSheet.addImage(imageId, {
        tl: { col: 7, row: 0 },
        ext: { width: 45, height: 45 },
      })
      diagnostics.tagsFound.push("{{QR}}")
      diagnostics.imagesInserted.push("{{QR}}:default-top-right")
    }
  }

  diagnostics.tagsSimilar = [...new Set(diagnostics.tagsSimilar)]
  diagnostics.tagsMissing = requiredTags.filter((tag) => !diagnostics.tagsFound.includes(tag))
  if (diagnostics.tagsSimilar.length > 0 || diagnostics.tagsMissing.length > 0) {
    throw new Error(`Template XLSX chưa đúng tag. Thiếu: ${diagnostics.tagsMissing.join(", ") || "không"}. Tag gần giống/sai: ${diagnostics.tagsSimilar.join(", ") || "không"}.`)
  }

  return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), diagnostics }
}

function getFileUrl(doc: Record<string, unknown>, fileKind: FileKind, preferOriginal = false): string | null {
  if (fileKind === "change_request") {
    return (doc.file_phieu_yeu_cau_thay_doi_signed_url || doc.file_phieu_yeu_cau_thay_doi_url) as string | null
  }
  if (fileKind === "review_request") {
    return (doc.file_de_nghi_soat_xet_signed_url || doc.file_de_nghi_soat_xet_url || doc.file_soat_xet_url) as string | null
  }
  if (preferOriginal) return (doc.file_template_url || doc.file_goc_url) as string | null
  return (doc.file_signed_office_url || doc.file_goc_url) as string | null
}

function updatePayload(fileKind: FileKind, publicUrl: string, ext: string, replaceOriginal = false): Record<string, string | null> {
  if (fileKind === "change_request") return { file_phieu_yeu_cau_thay_doi_signed_url: publicUrl }
  if (fileKind === "review_request") return { file_de_nghi_soat_xet_signed_url: publicUrl }
  if (replaceOriginal) {
    return { file_goc_url: publicUrl, file_signed_office_url: null, file_signed_office_type: null }
  }
  return { file_signed_office_url: publicUrl, file_signed_office_type: ext }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { token, docId, docType, fileKind = "main", action }: {
      token: string
      docId: string
      docType: string
      fileKind?: FileKind
      action?: WorkflowAction
    } = body
    if (!token || !docId || !docType) return NextResponse.json({ error: "Thiếu tham số" }, { status: 400 })

    let payload: Awaited<ReturnType<typeof jwtVerify>>["payload"]
    try {
      const verified = await jwtVerify(token, JWT_SECRET)
      payload = verified.payload
    } catch {
      return NextResponse.json({ error: "Token không hợp lệ hoặc đã hết hạn. Vui lòng ký lại." }, { status: 401 })
    }
    const userId = String(payload.userId || "")
    const tokenDocId = String(payload.docId || "")
    if (!userId || !tokenDocId || payload.docType !== docType) {
      return NextResponse.json({ error: "Token không hợp lệ" }, { status: 401 })
    }

    const { data: profile } = await supabaseAdmin.from("profiles").select("factory_id").eq("id", userId).single()
    const factoryId = profile?.factory_id as string | undefined
    if (!factoryId) return NextResponse.json({ error: "Không xác định được nhà máy" }, { status: 400 })

    const { data: doc, error: docErr } = await supabaseAdmin
      .from("iso_documents")
      .select("*")
      .eq("id", docId)
      .eq("factory_id", factoryId)
      .single()
    if (docErr || !doc) return NextResponse.json({ error: "Không tìm thấy tài liệu" }, { status: 404 })
    if (tokenDocId !== docId && doc.parent_doc_id !== tokenDocId) {
      const { data: tokenDoc } = await supabaseAdmin
        .from("iso_documents")
        .select("id, parent_doc_id")
        .eq("id", tokenDocId)
        .eq("factory_id", factoryId)
        .single()
      const sameChildBatch = !!tokenDoc?.parent_doc_id && tokenDoc.parent_doc_id === doc.parent_doc_id
      if (!sameChildBatch) return NextResponse.json({ error: "Token khong hop le" }, { status: 401 })
    }

    const step = getStep(doc, userId)
    if (!step) return NextResponse.json({ error: "Người dùng không thuộc luồng ký tài liệu này" }, { status: 403 })

    const isChildOffice = isChildOfficeDoc(doc)
    const sourceUrl = getFileUrl(doc, fileKind, isChildOffice && fileKind === "main")
    const ext = sourceUrl?.split("?")[0].split(".").pop()?.toLowerCase()
    if (ext !== "docx" && ext !== "xlsx") {
      return NextResponse.json({ error: "File không phải DOCX/XLSX" }, { status: 400 })
    }

    const statusText = getTargetStatusText(action, String(doc.trang_thai || ""), String(doc.cap_tl || ""))
    const values = buildTextValues(doc, statusText)
    const stepTags = getStepTags(step)
    const qrBuffer = await QRCode.toBuffer(`${APP_URL}/dashboard/iso/documents/${docId}`, { width: 160, margin: 1 })
    const imageByTag: Record<string, Buffer> = {
      "{{QR}}": qrBuffer,
    }
    if (!isChildOffice) {
      const sigBuffer = await getSigImage(factoryId, userId)
      imageByTag[stepTags.signatureTag] = sigBuffer
    }
    const requiredTags = isChildOffice
      ? []
      : [stepTags.signatureTag, stepTags.nameTag]
    const defaultQrWhenMissing = false
    const allowedTags = isChildOffice ? CHILD_OFFICE_TAG_SET : ALL_TAGS
    const bytes = await downloadStorageFile(sourceUrl)

    const result = ext === "docx"
      ? await renderDocx(bytes, values, imageByTag, requiredTags, defaultQrWhenMissing, allowedTags)
      : await renderXlsx(bytes, values, imageByTag, requiredTags, defaultQrWhenMissing, allowedTags)

    const namePrefix = sanitizeOutputName(`${String(doc.ma_tai_lieu || "ISO")} ${String(doc.ten_tai_lieu || "tai_lieu")}`)
    const outputPath = `${factoryId}/iso/office-signed/${namePrefix}_${Date.now()}.${ext}`
    const { error: uploadErr } = await supabaseAdmin.storage
      .from("iso-documents")
      .upload(outputPath, result.buffer, {
        contentType: ext === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        upsert: true,
      })
    if (uploadErr) return NextResponse.json({ error: "Upload file Office đã ký lỗi: " + uploadErr.message }, { status: 500 })

    const { data: urlData } = supabaseAdmin.storage.from("iso-documents").getPublicUrl(outputPath)
    const { error: updateErr } = await supabaseAdmin
      .from("iso_documents")
      .update(updatePayload(fileKind, urlData.publicUrl, ext, isChildOffice && fileKind === "main"))
      .eq("id", docId)
      .eq("factory_id", factoryId)
    if (updateErr) return NextResponse.json({ error: "Lưu URL Office đã ký thất bại: " + updateErr.message }, { status: 500 })

    await supabaseAdmin.from("doc_approval_log").insert({
      factory_id: factoryId,
      doc_id: docId,
      doc_type: docType,
      user_id: userId,
      action: `generate_office_${fileKind}`,
      ip_address: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "",
      user_agent: req.headers.get("user-agent") || "",
    })

    return NextResponse.json({
      ok: true,
      signedOfficeUrl: urlData.publicUrl,
      fileKind,
      outputType: ext,
      diagnostics: result.diagnostics,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi server" },
      { status: 500 },
    )
  }
}
