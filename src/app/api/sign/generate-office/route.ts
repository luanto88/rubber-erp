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

function buildTextValues(doc: Record<string, unknown>, statusText: string): Record<string, string> {
  return {
    "{{MA_TAI_LIEU}}": String(doc.ma_tai_lieu || ""),
    "{{TEN_TAI_LIEU}}": String(doc.ten_tai_lieu || ""),
    "{{PHONG_BAN}}": String(doc.phong_ban || ""),
    "{{LOAI_TAI_LIEU}}": String(doc.loai_tai_lieu || ""),
    "{{LAN_BAN_HANH}}": String(doc.lan_ban_hanh ?? ""),
    "{{LAN_SUA_DOI}}": String(doc.lan_ban_hanh ?? ""),
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

function collectSimilarTags(text: string): string[] {
  const found = new Set<string>()
  for (const match of text.matchAll(/\{\{[^}]+\}\}/g)) {
    const tag = match[0]
    if (!ALL_TAGS.has(tag)) found.add(tag)
  }
  return [...found]
}

function replaceAllTextTags(text: string, values: Record<string, string>, diagnostics: OfficeDiagnostics): string {
  let next = text
  for (const [tag, value] of Object.entries(values)) {
    if (next.includes(tag)) diagnostics.tagsFound.push(tag)
    next = next.split(tag).join(xmlEscape(value))
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

async function renderDocx(
  bytes: ArrayBuffer,
  values: Record<string, string>,
  imageByTag: Record<string, Buffer>,
  requiredTags: string[],
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
    /^word\/(document|header\d+|footer\d+)\.xml$/.test(name)
  )

  const allTextParts: string[] = []
  for (const partPath of xmlFiles) {
    const file = zip.file(partPath)
    if (!file) continue
    let xml = await file.async("string")
    allTextParts.push(xml)
    xml = replaceAllTextTags(xml, values, diagnostics)
    for (const [tag, imagePath] of mediaEntries) {
      if (!xml.includes(tag)) continue
      diagnostics.tagsFound.push(tag)
      diagnostics.imagesInserted.push(tag)
      const relId = await ensureRel(zip, partPath, imagePath)
      const size = tag === "{{QR}}" ? { cx: 914400, cy: 914400 } : { cx: 1600200, cy: 685800 }
      const drawing = drawingXml(relId, size.cx, size.cy)
      const tagRe = new RegExp(`<w:r[^>]*>\\s*<w:t[^>]*>${tag.replace(/[{}]/g, "\\$&")}<\\/w:t>\\s*<\\/w:r>`, "g")
      xml = xml.replace(tagRe, drawing).split(tag).join("")
    }
    zip.file(partPath, xml)
  }

  const combined = allTextParts.join("\n")
  diagnostics.tagsSimilar = collectSimilarTags(combined)
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
): Promise<{ buffer: Buffer; diagnostics: OfficeDiagnostics }> {
  const diagnostics: OfficeDiagnostics = { tagsFound: [], tagsMissing: [], tagsSimilar: [], imagesInserted: [] }
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes)

  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        const text = typeof cell.value === "string" ? cell.value : null
        if (!text) return
        for (const similar of collectSimilarTags(text)) diagnostics.tagsSimilar.push(similar)
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

  diagnostics.tagsSimilar = [...new Set(diagnostics.tagsSimilar)]
  diagnostics.tagsMissing = requiredTags.filter((tag) => !diagnostics.tagsFound.includes(tag))
  if (diagnostics.tagsSimilar.length > 0 || diagnostics.tagsMissing.length > 0) {
    throw new Error(`Template XLSX chưa đúng tag. Thiếu: ${diagnostics.tagsMissing.join(", ") || "không"}. Tag gần giống/sai: ${diagnostics.tagsSimilar.join(", ") || "không"}.`)
  }

  return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), diagnostics }
}

function getFileUrl(doc: Record<string, unknown>, fileKind: FileKind): string | null {
  if (fileKind === "change_request") {
    return (doc.file_phieu_yeu_cau_thay_doi_signed_url || doc.file_phieu_yeu_cau_thay_doi_url) as string | null
  }
  if (fileKind === "review_request") {
    return (doc.file_de_nghi_soat_xet_signed_url || doc.file_de_nghi_soat_xet_url || doc.file_soat_xet_url) as string | null
  }
  return (doc.file_signed_office_url || doc.file_goc_url) as string | null
}

function updatePayload(fileKind: FileKind, publicUrl: string, ext: string): Record<string, string> {
  if (fileKind === "change_request") return { file_phieu_yeu_cau_thay_doi_signed_url: publicUrl }
  if (fileKind === "review_request") return { file_de_nghi_soat_xet_signed_url: publicUrl }
  return { file_signed_office_url: publicUrl, file_signed_office_type: ext }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { token, docId, docType, fileKind = "main" }: {
      token: string
      docId: string
      docType: string
      fileKind?: FileKind
    } = body
    if (!token || !docId || !docType) return NextResponse.json({ error: "Thiếu tham số" }, { status: 400 })

    const { payload } = await jwtVerify(token, JWT_SECRET)
    const userId = String(payload.userId || "")
    if (!userId || payload.docId !== docId || payload.docType !== docType) {
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

    const step = getStep(doc, userId)
    if (!step) return NextResponse.json({ error: "Người dùng không thuộc luồng ký tài liệu này" }, { status: 403 })

    const sourceUrl = getFileUrl(doc, fileKind)
    const ext = sourceUrl?.split("?")[0].split(".").pop()?.toLowerCase()
    if (ext !== "docx" && ext !== "xlsx") {
      return NextResponse.json({ error: "File không phải DOCX/XLSX" }, { status: 400 })
    }

    const statusText = doc.trang_thai === "co_hieu_luc" ? "Có hiệu lực" : "Chờ phê duyệt"
    const values = buildTextValues(doc, statusText)
    const stepTags = getStepTags(step)
    const qrBuffer = await QRCode.toBuffer(`${APP_URL}/dashboard/iso/documents/${docId}`, { width: 160, margin: 1 })
    const sigBuffer = await getSigImage(factoryId, userId)
    const imageByTag: Record<string, Buffer> = {
      "{{QR}}": qrBuffer,
      [stepTags.signatureTag]: sigBuffer,
    }
    const requiredTags = [stepTags.signatureTag, stepTags.nameTag]
    const bytes = await downloadStorageFile(sourceUrl)

    const result = ext === "docx"
      ? await renderDocx(bytes, values, imageByTag, requiredTags)
      : await renderXlsx(bytes, values, imageByTag, requiredTags)

    const outputPath = `${factoryId}/iso/office-signed/${docId}_${fileKind}_${Date.now()}.${ext}`
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
      .update(updatePayload(fileKind, urlData.publicUrl, ext))
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
