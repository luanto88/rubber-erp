import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib"
import { jwtVerify } from "jose"
import QRCode from "qrcode"
import fontkit from "@pdf-lib/fontkit"
import fs from "fs"
import path from "path"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const JWT_SECRET = new TextEncoder().encode(
  process.env.SIGN_JWT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://qlsxkpt.vercel.app"

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
}

type SignFileKind = "main" | "change_request" | "review_request"
type WorkflowAction = "gui_xem_xet" | "gui_phe_duyet" | "phe_duyet" | "tra_ve" | "khong_xem_xet" | "tu_choi_phe_duyet" | "gui_lai_phe_duyet" | "tra_ve_nhap"

type MetaMismatch = { found: string; expected: string }

type MetaFillResult = {
  filled: string[]
  notFound: string[]
  mismatched: MetaMismatch[]
  footerFilledPages: number[]
  error?: string
}

type PdfTextItem = {
  str: string
  transform: number[]
  width: number
  height: number
}

type SignerProfile = {
  id: string
  full_name: string | null
  username: string | null
}

const TRANG_THAI_LABEL_SERVER: Record<string, string> = {
  draft: "Nh\u00e1p",
  cho_xem_xet: "Ch\u1edd xem x\u00e9t",
  cho_phe_duyet: "Ch\u1edd ph\u00ea duy\u1ec7t",
  co_hieu_luc: "C\u00f3 hi\u1ec7u l\u1ef1c",
  het_hieu_luc: "H\u1ebft hi\u1ec7u l\u1ef1c",
  tra_ve: "Tr\u1ea3 v\u1ec1",
  bi_tu_choi_phe_duyet: "Ph\u00ea duy\u1ec7t t\u1eeb ch\u1ed1i",
}

const HEADER_VALUE_PLACEHOLDER_RE = /^[_\-\.\s/|:]*$/
const FOOTER_TEMPLATE_RE = /ma\s*tai\s*lieu.*lan\s*(ban\s*hanh|sua\s*doi|soat\s*xet).*(ngay\s*hieu\s*luc|ngay\s*ban\s*hanh|ngay\s*ap\s*dung).*(tinh\s*trang|trang\s*thai)/i
const FOOTER_FILLED_RE = /\b[A-Z]{2,}(?:-[A-Z0-9Đ]{2,})+\s*\(\d{2}-\d{2}\/\d{2}\/\d{4}\)\s*.+/i
const FOOTER_LABEL = "Footer mẫu"
const FOOTER_PARTIAL_TEMPLATE_RE = /ma\s*tai\s*lieu.*lan\s*(ban\s*hanh|sua\s*doi|soat\s*xet).*\d{1,2}\/\d{1,2}\/\d{4}.*(tinh\s*trang|trang\s*thai)/i
// Footer đã có mã và ngày, nhưng trạng thái vẫn là placeholder: "PHK-QT10 (Lần ban hành-01/06/2024) Tình trạng"
const FOOTER_PARTIAL_FILLED_STATUS_RE = /^[a-z]{2,}(?:-[a-z0-9]{2,})+\s*\(.*?\d{1,2}\/\d{1,2}\/\d{4}.*?\)\s*(tinh\s*trang|trang\s*thai)\s*$/i
const HEADER_FOOTER_FONT_SIZE = 11

function isLikelyFooterMismatchText(searchText: string): boolean {
  const hasDocumentCodeLabel = /ma\s*(tai\s*lieu|ho\s*so|hieu)\b/i.test(searchText)
  const hasFooterContext = /(lan\s*(ban\s*hanh|sua\s*doi|soat\s*xet)|ngay\s*(hieu\s*luc|ban\s*hanh|ap\s*dung)|tinh\s*trang|trang\s*thai|phien\s*ban)/i.test(searchText)
  const hasWrongFooterLabel = /(ma\s*ho\s*so|ma\s*hieu|phien\s*ban|ngay\s*ban\s*hanh|ngay\s*ap\s*dung|trang\s*thai)/i.test(searchText)
  return hasDocumentCodeLabel && hasFooterContext && hasWrongFooterLabel
}

function safeDecodeUri(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function cloneArrayBuffer(buf: ArrayBuffer): ArrayBuffer {
  return buf.slice(0)
}

function isValidStorageKey(value: string): boolean {
  return /^[\x20-\x7E]+$/.test(value) && !/[\\?#]/.test(value)
}

function getStoragePathCandidatesFromUrl(fileUrl: string | null, bucket: string): string[] {
  if (!fileUrl) return []

  const candidates: string[] = []
  const pushCandidate = (value: string | null) => {
    if (!value) return
    const trimmed = value.replace(/^\/+/, "").trim()
    if (!trimmed) return
    if (!isValidStorageKey(trimmed)) return
    if (!candidates.includes(trimmed)) candidates.push(trimmed)
  }

  const cleanUrl = fileUrl.split("?")[0]

  try {
    const parsed = new URL(cleanUrl)
    const pathname = parsed.pathname
    const marker = "/storage/v1/object/"
    const markerIndex = pathname.indexOf(marker)
    if (markerIndex >= 0) {
      const afterObject = pathname.slice(markerIndex + marker.length)
      const parts = afterObject.split("/").filter(Boolean)
      if (parts.length >= 3 && ["public", "sign", "authenticated"].includes(parts[0]) && parts[1] === bucket) {
        const rel = parts.slice(2).join("/")
        pushCandidate(rel)
        pushCandidate(safeDecodeUri(rel))
      }
      if (parts.length >= 2 && parts[0] === bucket) {
        const rel = parts.slice(1).join("/")
        pushCandidate(rel)
        pushCandidate(safeDecodeUri(rel))
      }
    }
  } catch {
    // ignore URL parse errors and fallback below
  }

  const marker = `/storage/v1/object/public/${bucket}/`
  const markerIndex = cleanUrl.indexOf(marker)
  if (markerIndex >= 0) {
    const rel = cleanUrl.slice(markerIndex + marker.length)
    pushCandidate(rel)
    pushCandidate(safeDecodeUri(rel))
  }

  const bucketMarker = `/${bucket}/`
  const bucketIndex = cleanUrl.indexOf(bucketMarker)
  if (bucketIndex >= 0) {
    const rel = cleanUrl.slice(bucketIndex + bucketMarker.length)
    pushCandidate(rel)
    pushCandidate(safeDecodeUri(rel))
  }

  if (!/^https?:\/\//i.test(cleanUrl)) {
    pushCandidate(cleanUrl)
    pushCandidate(safeDecodeUri(cleanUrl))
  }

  return candidates
}

function getStoragePathFromUrl(fileUrl: string | null, bucket: string): string | null {
  const candidates = getStoragePathCandidatesFromUrl(fileUrl, bucket)
  return candidates[0] ?? null
}

function isSkippedLabel(skipLabels: string[], label: string): boolean {
  if (skipLabels.includes(label)) return true
  const normalizedLabel = normalizeTagText(label)
  const normalizedSkips = skipLabels.map((x) => normalizeTagText(x))
  if (normalizedSkips.includes(normalizedLabel)) return true

  const revisionAliases = new Set([
    normalizeTagText("Lần ban hành"),
    normalizeTagText("Lần sửa đổi"),
    normalizeTagText("Lần soát xét"),
    normalizeTagText("Lần ban hành / Lần sửa đổi"),
  ])
  if (revisionAliases.has(normalizedLabel)) {
    return normalizedSkips.some((x) => revisionAliases.has(x))
  }
  return false
}

function isConDoc(loaiTaiLieu: string | null, phanLoaiTl: string | null): boolean {
  if (loaiTaiLieu === "F") return true
  if ((loaiTaiLieu === "PL" || loaiTaiLieu === "HD") && phanLoaiTl === "con") return true
  return false
}

async function getSigImage(factoryId: string, userId: string): Promise<ArrayBuffer | null> {
  const storagePath = `signatures/${factoryId}/${userId}/chu_ky.png`
  const { data, error } = await supabaseAdmin.storage.from("iso-documents").download(storagePath)
  if (error || !data) return null
  return await data.arrayBuffer()
}

async function getProfile(userId: string | null): Promise<SignerProfile | null> {
  if (!userId) return null
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, username")
    .eq("id", userId)
    .single()
  return (data as SignerProfile | null) ?? null
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ""
  const date = new Date(iso)
  if (isNaN(date.getTime())) return iso
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`
}

function loadViFont(): Buffer | null {
  try {
    return fs.readFileSync(path.join(process.cwd(), "public/fonts/NotoSans-Regular.ttf"))
  } catch {
    return null
  }
}

function loadSignerNameFont(): Buffer | null {
  try {
    return fs.readFileSync(path.join(process.cwd(), "public/fonts/TimesNewRoman.ttf"))
  } catch {
    return null
  }
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeTagText(value: string): string {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
}

function textOfLine(line: PdfTextItem[]): string {
  return normalizeText(line.map((item) => item.str).join(" "))
}

function getLineBounds(line: PdfTextItem[]) {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const item of line) {
    const x = item.transform[4]
    const y = item.transform[5]
    const width = item.width ?? 0
    const height = item.height ?? 10
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + width)
    maxY = Math.max(maxY, y + height)
  }

  return { minX, minY, maxX, maxY }
}

function hasRealHeaderValue(value: string): boolean {
  const normalized = normalizeText(value)
  if (!normalized) return false
  return !HEADER_VALUE_PLACEHOLDER_RE.test(normalized)
}

function extractHeaderValueFromAnchorText(anchorText: string, expected: string): string {
  const text = normalizeText(anchorText)
  const colonIndex = text.indexOf(":")
  if (colonIndex >= 0) return normalizeText(text.slice(colonIndex + 1))

  const normalizedAnchor = normalizeTagText(anchorText)
  const labelCandidatesByExpected: Record<string, string[]> = {
    "Mã tài liệu": ["ma tai lieu"],
    "Ngày hiệu lực": ["ngay hieu luc"],
    "Lần ban hành / Lần sửa đổi": ["lan ban hanh / lan sua doi", "lan ban hanh", "lan sua doi", "lan soat xet"],
    "Tình trạng": ["tinh trang"],
    QR: ["qr"],
  }
  const labelCandidates = labelCandidatesByExpected[expected] ?? [normalizeTagText(expected)]
  for (const label of labelCandidates) {
    if (normalizedAnchor === label) return ""
    if (normalizedAnchor.startsWith(`${label} `)) return normalizeText(normalizedAnchor.slice(label.length))
  }
  return ""
}

function inferRevisionLabel(doc: Record<string, unknown>): string {
  return doc.chon_quy_trinh === "Soát xét" ? "Lần sửa đổi" : "Lần ban hành"
}

function buildFooterValue(maTl: string, lsStr: string, dateStr: string, statusText: string): string {
  return `${maTl} (${lsStr}-${dateStr}) ${statusText}`.trim()
}

function getTargetStatusText(action: WorkflowAction | undefined, currentStatus: string): string {
  if (action === "gui_xem_xet") return "Chờ xem xét"
  if (action === "gui_phe_duyet" || action === "gui_lai_phe_duyet") return "Chờ phê duyệt"
  if (action === "phe_duyet") return "Có hiệu lực"
  if (action === "tra_ve" || action === "khong_xem_xet" || action === "tra_ve_nhap") return "Trả về"
  if (action === "tu_choi_phe_duyet") return "Phê duyệt từ chối"
  return TRANG_THAI_LABEL_SERVER[currentStatus] || "Chờ phê duyệt"
}

function drawFooterOnAllPages(pdfDoc: PDFDocument, font: PDFFont, footerText: string, skipPageIndexes: number[] = []) {
  const skip = new Set(skipPageIndexes)
  for (const [pageIndex, page] of pdfDoc.getPages().entries()) {
    if (skip.has(pageIndex)) continue
    const fontSize = HEADER_FOOTER_FONT_SIZE
    const marginX = 30
    const y = 18
    const maxWidth = page.getWidth() - marginX * 2
    let size = fontSize
    while (size > 8 && font.widthOfTextAtSize(footerText, size) > maxWidth) size -= 0.5
    const textWidth = font.widthOfTextAtSize(footerText, size)
    page.drawRectangle({
      x: marginX - 2,
      y: y - 3,
      width: maxWidth + 4,
      height: size + 8,
      color: rgb(1, 1, 1),
    })
    page.drawText(footerText, {
      x: marginX + Math.max((maxWidth - textWidth) / 2, 0),
      y,
      size,
      font,
      color: rgb(0, 0, 0),
    })
  }
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

function extractDateFromText(value: string): string | null {
  const match = value.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/)
  if (!match) return null
  return `${match[1].padStart(2, "0")}/${match[2].padStart(2, "0")}/${match[3]}`
}

function buildFooterValueForLine(lineText: string, maTl: string, lsStr: string, dateStr: string, statusText: string): string {
  return buildFooterValue(maTl, lsStr, extractDateFromText(lineText) || dateStr, statusText)
}

function isFooterFillCandidate(lineText: string, searchText: string): boolean {
  return FOOTER_FILLED_RE.test(lineText) || FOOTER_TEMPLATE_RE.test(searchText) || FOOTER_PARTIAL_TEMPLATE_RE.test(searchText) || FOOTER_PARTIAL_FILLED_STATUS_RE.test(searchText)
}

async function drawDefaultChildQr(pdfDoc: PDFDocument, page: PDFPage, qrBuffer: Buffer) {
  const qrSize = 34
  const qrMargin = 18
  const qrImage = await pdfDoc.embedPng(qrBuffer)
  page.drawImage(qrImage, {
    x: page.getWidth() - qrMargin - qrSize,
    y: page.getHeight() - qrMargin - qrSize,
    width: qrSize,
    height: qrSize,
  })
}

function buildSignerNamePlacement(placement: SignPlacement) {
  return {
    xCenter: typeof placement.nameX === "number"
      ? placement.nameX + (placement.nameWidth ?? placement.width) / 2
      : placement.x + placement.width / 2,
    y: typeof placement.nameY === "number"
      ? placement.nameY
      : Math.max(placement.y - 18, 8),
    maxWidth: Math.max(
      typeof placement.nameWidth === "number" ? placement.nameWidth : placement.width + 24,
      110,
    ),
  }
}

function extractHeaderValueFromPageItems(items: PdfTextItem[], anchor: PdfTextItem): string {
  const anchorEndX = anchor.transform[4] + (anchor.width ?? 0)
  const sameRowItems = items
    .filter((item) =>
      Math.abs(item.transform[5] - anchor.transform[5]) < 4 &&
      item.transform[4] >= anchorEndX + 2 &&
      normalizeText(item.str).length > 0,
    )
    .sort((a, b) => a.transform[4] - b.transform[4])
  return normalizeText(sameRowItems.map((item) => item.str).join(" ").replace(/^:\s*/, ""))
}

function findNearbyText(
  lines: PdfTextItem[][],
  xCenter: number,
  yBottom: number,
): boolean {
  return lines.some((line) => {
    const bounds = getLineBounds(line)
    const centerX = (bounds.minX + bounds.maxX) / 2
    const sameColumn = Math.abs(centerX - xCenter) < 95
    const nearbyY = bounds.minY >= yBottom - 22 && bounds.maxY <= yBottom + 26
    return sameColumn && nearbyY && textOfLine(line).length > 0
  })
}

async function extractTextLinesByPage(pdfBytes: ArrayBuffer): Promise<PdfTextItem[][][]> {
  try {
    const pdfjsDoc = await openPdfjsDocument(pdfBytes)
    const result: PdfTextItem[][][] = []

    for (let pageIdx = 0; pageIdx < pdfjsDoc.numPages; pageIdx++) {
      const pdfjsPage = await pdfjsDoc.getPage(pageIdx + 1)
      const textContent = await pdfjsPage.getTextContent()
      const items = (textContent.items as unknown[]).filter((item): item is PdfTextItem => {
        if (!item || typeof item !== "object") return false
        const maybeItem = item as Partial<PdfTextItem>
        return typeof maybeItem.str === "string" && Array.isArray(maybeItem.transform)
      })

      items.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4])
      const lines: PdfTextItem[][] = []
      for (const item of items) {
        const existing = lines.find((line) => Math.abs(line[0].transform[5] - item.transform[5]) < 3)
        if (existing) {
          existing.push(item)
          existing.sort((a, b) => a.transform[4] - b.transform[4])
        } else {
          lines.push([item])
        }
      }
      result.push(lines)
    }

    return result
  } catch {
    return []
  }
}

function getHeaderPatterns(doc: Record<string, unknown>, maTl: string, lsStr: string, dateStr: string, statusText: string) {
  return [
    {
      label: "Mã tài liệu",
      expected: "Mã tài liệu",
      pattern: /^ma\s*tai\s*lieu\b/i,
      value: (doc.ma_tai_lieu as string) || maTl,
    },
    {
      label: "Ngày hiệu lực",
      expected: "Ngày hiệu lực",
      pattern: /^ngay\s*hieu\s*luc\b/i,
      value: dateStr,
    },
    {
      label: inferRevisionLabel(doc),
      expected: "Lần ban hành / Lần sửa đổi",
      pattern: /^lan\s*(ban\s*hanh|sua\s*doi|soat\s*xet)\b/i,
      value: lsStr,
    },
    {
      label: "Tình trạng",
      expected: "Tình trạng",
      pattern: /^tinh\s*trang\b/i,
      value: statusText,
    },
    {
      label: "QR",
      expected: "QR",
      pattern: /^qr\b/i,
      value: "QR",
    },
  ] as const
}

function getMismatchPatterns(chonQuyTrinh: string | null) {
  const base = [
    { pattern: /^ma\s*ho\s*so\b/i, expected: "Mã tài liệu" },
    { pattern: /^ma\s*hieu\b/i, expected: "Mã tài liệu" },
    { pattern: /^so\s*hieu(\s*tai\s*lieu)?\b/i, expected: "Mã tài liệu" },
    { pattern: /^ngay\s*ban\s*hanh\b/i, expected: "Ngày hiệu lực" },
    { pattern: /^ngay\s*ap\s*dung\b/i, expected: "Ngày hiệu lực" },
    { pattern: /^phien\s*ban\b/i, expected: "Lần ban hành / Lần sửa đổi" },
    { pattern: /^trang\s*thai\b/i, expected: "Tình trạng" },
  ]
  // Không cảnh báo với các alias hợp lệ của revision label
  // ("Lần ban hành", "Lần sửa đổi", "Lần soát xét", "Lần ban hành / Lần sửa đổi")
  // vì hệ thống đã hỗ trợ fill cùng một giá trị cho nhóm nhãn này.
  void chonQuyTrinh
  return base
}

async function loadPdfjs() {
  return await import("pdfjs-dist/legacy/build/pdf.mjs")
}

async function openPdfjsDocument(pdfBytes: ArrayBuffer) {
  const pdfjsLib = await loadPdfjs()
  return await pdfjsLib.getDocument({
    data: new Uint8Array(pdfBytes),
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false,
    cMapUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/standard_fonts/`,
  } as never).promise
}

async function fillMetadataPlaceholders(
  pdfDoc: PDFDocument,
  pdfBytes: ArrayBuffer,
  doc: Record<string, unknown>,
  font: PDFFont,
  qrBuffer: Buffer,
  manualQrPlacement: { x: number; y: number; width: number; height: number } | null,
  maTl: string,
  lsStr: string,
  dateStr: string,
  statusText: string,
  skipLabels: string[] = [],
  chonQuyTrinh: string | null = null,
): Promise<MetaFillResult> {
  const filled = new Set<string>()
  const found = new Set<string>()
  const footerFilledPages = new Set<number>()
  const mismatched: MetaMismatch[] = []
  const headerPatterns = getHeaderPatterns(doc, maTl, lsStr, dateStr, statusText)
  const mismatchPatterns = getMismatchPatterns(chonQuyTrinh)
  const shouldDrawDefaultChildQr = isConDoc(
    (doc.loai_tai_lieu as string | null) ?? null,
    (doc.phan_loai_tl as string | null) ?? null,
  )

  try {
    const pdfjsDoc = await openPdfjsDocument(pdfBytes)
    const pages = pdfDoc.getPages()

    for (let pageIdx = 0; pageIdx < Math.min(pdfjsDoc.numPages, pages.length); pageIdx++) {
      const pdfjsPage = await pdfjsDoc.getPage(pageIdx + 1)
      const viewport = pdfjsPage.getViewport({ scale: 1 })
      const textContent = await pdfjsPage.getTextContent()
      const page = pages[pageIdx]

      const items = (textContent.items as unknown[]).filter((item): item is PdfTextItem => {
        if (!item || typeof item !== "object") return false
        const maybeItem = item as Partial<PdfTextItem>
        return typeof maybeItem.str === "string" && Array.isArray(maybeItem.transform)
      })

      items.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4])

      const lines: PdfTextItem[][] = []
      for (const item of items) {
        const existing = lines.find((line) => Math.abs(line[0].transform[5] - item.transform[5]) < 3)
        if (existing) {
          existing.push(item)
          existing.sort((a, b) => a.transform[4] - b.transform[4])
        } else {
          lines.push([item])
        }
      }

      const headerThreshold = viewport.height * 0.6
      const footerThreshold = viewport.height * 0.15
      const pageFound = new Set<string>()

      const headerItems = items.filter((item) => item.transform[5] > headerThreshold)
      for (const item of headerItems) {
        const normalizedItem = normalizeTagText(item.str)
        if (!normalizedItem) continue

        let isMismatched = false
        for (const { pattern, expected } of mismatchPatterns) {
          if (isSkippedLabel(skipLabels, expected)) continue
          if (pattern.test(normalizedItem) && !mismatched.some((entry) => entry.expected === expected && entry.found === item.str)) {
            mismatched.push({ found: item.str, expected })
            isMismatched = true
          }
        }
        // Không fill tag bị phát hiện là mismatch - yêu cầu người dùng sửa template
        if (isMismatched) continue

        for (const header of headerPatterns) {
          if (
            pageFound.has(header.expected) ||
            isSkippedLabel(skipLabels, header.expected) ||
            !header.value ||
            !header.pattern.test(normalizedItem)
          ) {
            continue
          }

          found.add(header.expected)
          pageFound.add(header.expected)

          const existingValue = normalizeText([
            extractHeaderValueFromAnchorText(item.str, header.expected),
            extractHeaderValueFromPageItems(headerItems, item),
          ].filter(Boolean).join(" "))
          if (hasRealHeaderValue(existingValue)) break

          if (header.label === "QR") {
            const qrImage = await pdfDoc.embedPng(qrBuffer)
            if (manualQrPlacement) {
              page.drawImage(qrImage, {
                x: manualQrPlacement.x,
                y: manualQrPlacement.y,
                width: manualQrPlacement.width,
                height: manualQrPlacement.height,
              })
              filled.add(header.expected)
            } else {
              const qrX = item.transform[4] + (item.width ?? 0) + 4
              const qrSize = Math.max((item.height ?? 10) * 2.64, 26)
              const maxWidth = Math.max(viewport.width - qrX - 12, 18)
              const drawSize = Math.min(qrSize, maxWidth)
              if (drawSize > 18) {
                page.drawImage(qrImage, {
                  x: qrX,
                  y: item.transform[5] - drawSize + (item.height ?? 10),
                  width: drawSize,
                  height: drawSize,
                })
                filled.add(header.expected)
              }
            }
            break
          }

          const hasColon = item.str.includes(":")
          const fontSize = HEADER_FOOTER_FONT_SIZE
          page.drawText(`${hasColon ? "" : ":"} ${String(header.value)}`, {
            x: item.transform[4] + (item.width ?? 0) + 4,
            y: item.transform[5],
            size: fontSize,
            font,
            color: rgb(0, 0, 0),
          })
          filled.add(header.expected)
          break
        }
      }

      // Draw manual QR on every page (header QR tag xuất hiện ở mọi trang).
      // Dùng pageFound (per-page) thay filled (cross-page) để QR được vẽ trên mọi trang mà không bị chặn sau trang 1.
      if (manualQrPlacement && !pageFound.has("QR")) {
        const qrImage = await pdfDoc.embedPng(qrBuffer)
        page.drawImage(qrImage, {
          x: manualQrPlacement.x,
          y: manualQrPlacement.y,
          width: manualQrPlacement.width,
          height: manualQrPlacement.height,
        })
        pageFound.add("QR")
        filled.add("QR")
        found.add("QR")
      }

      if (shouldDrawDefaultChildQr && !manualQrPlacement && !pageFound.has("QR")) {
        await drawDefaultChildQr(pdfDoc, page, qrBuffer)
        pageFound.add("QR")
        found.add("QR")
      }

      for (const line of lines) {
        const lineText = textOfLine(line)
        if (!lineText) continue
        const searchText = normalizeTagText(lineText)

        const bounds = getLineBounds(line)
        const isHeader = line[0].transform[5] > headerThreshold
        const isFooter = bounds.maxY < footerThreshold

        if (isHeader) {
          for (const { pattern, expected } of mismatchPatterns) {
            if (isSkippedLabel(skipLabels, expected)) continue
            if (pattern.test(searchText) && !mismatched.some((entry) => entry.expected === expected && entry.found === lineText)) {
              mismatched.push({ found: lineText, expected })
            }
          }
        }

        if (isFooter) {
          if (isFooterFillCandidate(lineText, searchText)) {
            found.add(FOOTER_LABEL)
            pageFound.add(FOOTER_LABEL)
            if (isSkippedLabel(skipLabels, FOOTER_LABEL)) continue

            page.drawRectangle({
              x: Math.max(bounds.minX - 2, 0),
              y: Math.max(bounds.minY - 2, 0),
              width: bounds.maxX - bounds.minX + 8,
              height: bounds.maxY - bounds.minY + 6,
              color: rgb(1, 1, 1),
            })

            const fontSize = HEADER_FOOTER_FONT_SIZE
            page.drawText(buildFooterValueForLine(lineText, maTl, lsStr, dateStr, statusText), {
              x: bounds.minX,
              y: line[0].transform[5],
              size: fontSize,
              font,
              color: rgb(0, 0, 0),
            })
            filled.add(FOOTER_LABEL)
            footerFilledPages.add(pageIdx)
            continue
          }

          if (
            !isSkippedLabel(skipLabels, FOOTER_LABEL) &&
            isLikelyFooterMismatchText(searchText) &&
            !mismatched.some((entry) => entry.expected === FOOTER_LABEL && entry.found === lineText)
          ) {
            mismatched.push({ found: lineText, expected: FOOTER_LABEL })
          }
        }
      }

      void pageFound
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.warn("[generate-pdf] fillMetadataPlaceholders error:", errMsg)
    const notFoundOnError = [
      ...headerPatterns
        .map((entry) => entry.expected)
        .filter((label, index, all) => all.indexOf(label) === index)
        .filter((label) => !found.has(label) && !isSkippedLabel(skipLabels, label)),
      ...(found.has(FOOTER_LABEL) || isSkippedLabel(skipLabels, FOOTER_LABEL) ? [] : [FOOTER_LABEL]),
    ]
    return { filled: [...filled], notFound: notFoundOnError, mismatched, footerFilledPages: [...footerFilledPages], error: errMsg }
  }

  const notFound = [
    ...headerPatterns
      .map((entry) => entry.expected)
      .filter((label, index, all) => all.indexOf(label) === index)
      .filter((label) => !found.has(label) && !isSkippedLabel(skipLabels, label)),
    ...(found.has(FOOTER_LABEL) || isSkippedLabel(skipLabels, FOOTER_LABEL) ? [] : [FOOTER_LABEL]),
  ]

  return { filled: [...filled], notFound, mismatched, footerFilledPages: [...footerFilledPages] }
}

async function embedViFont(pdfDoc: PDFDocument, fontBytes: Buffer): Promise<PDFFont> {
  pdfDoc.registerFontkit(fontkit)
  return await pdfDoc.embedFont(fontBytes)
}

async function convertOfficeUrlToPdfDocument(fileUrl: string | null): Promise<PDFDocument> {
  const cleanUrl = fileUrl?.split("?")[0] || ""
  const ext = cleanUrl.split(".").pop()?.toLowerCase()
  if (ext !== "docx" && ext !== "xlsx") {
    throw new Error("File Office da xu ly khong phai DOCX/XLSX")
  }
  if (!fileUrl) throw new Error("Thieu URL file Office da xu ly")
  const apiKey = process.env.CLOUDCONVERT_API_KEY
  if (!apiKey) throw new Error("Thieu CLOUDCONVERT_API_KEY de convert DOCX/XLSX sang PDF")

  const createRes = await fetch("https://api.cloudconvert.com/v2/jobs", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tasks: {
        "import-office": {
          operation: "import/url",
          url: fileUrl,
        },
        "convert-office": {
          operation: "convert",
          input: "import-office",
          input_format: ext,
          output_format: "pdf",
          engine: "office",
        },
        "export-pdf": {
          operation: "export/url",
          input: "convert-office",
        },
      },
    }),
  })
  const createJson = await createRes.json().catch(() => ({}))
  if (!createRes.ok) {
    throw new Error(`CloudConvert tao job that bai: ${createJson.message || createRes.status}`)
  }
  const jobId = createJson.data?.id as string | undefined
  if (!jobId) throw new Error("CloudConvert khong tra ve job id")

  const MAX_WAIT_MS = 90_000
  const POLL_INTERVAL_MS = 2_000
  const deadline = Date.now() + MAX_WAIT_MS
  type CCTask = { name?: string; operation?: string; status?: string; message?: string; code?: string; result?: { files?: Array<{ url?: string }> } }
  type CCJobData = { status?: string; tasks?: CCTask[] }
  type CCPollJson = { data?: CCJobData; message?: string }
  let waitJson: CCPollJson = {}
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    const pollRes = await fetch(`https://api.cloudconvert.com/v2/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    waitJson = await pollRes.json().catch(() => ({})) as CCPollJson
    const status = waitJson.data?.status
    if (status === "finished") break
    if (status === "error") {
      const errTask = waitJson.data?.tasks?.find((t) => t.status === "error")
      throw new Error(`CloudConvert convert that bai: ${errTask?.message || "unknown error"}`)
    }
  }
  if (waitJson.data?.status !== "finished") {
    throw new Error(`CloudConvert timeout sau ${MAX_WAIT_MS / 1000}s - job ${jobId} chua hoan thanh`)
  }
  const exportTask = waitJson.data.tasks?.find((task) => task.name === "export-pdf" || task.operation === "export/url")
  const pdfUrl = exportTask?.result?.files?.[0]?.url
  if (!pdfUrl) throw new Error("CloudConvert khong tra ve URL PDF")

  const pdfRes = await fetch(pdfUrl, { cache: "no-store" })
  if (!pdfRes.ok) throw new Error(`Khong tai duoc PDF tu CloudConvert: HTTP ${pdfRes.status}`)
  return await PDFDocument.load(await pdfRes.arrayBuffer())
}

async function convertOfficeUrlToPdfDocumentWithRetry(fileUrl: string | null): Promise<PDFDocument> {
  try {
    return await convertOfficeUrlToPdfDocument(fileUrl)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("429") || msg.toLowerCase().includes("too many")) {
      await new Promise((r) => setTimeout(r, 3_000))
      return await convertOfficeUrlToPdfDocument(fileUrl)
    }
    throw err
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      token,
      docId,
      docType,
      fileKind,
      action,
      signaturePlacement,
      skipTagLabels,
    }: {
      token: string
      docId: string
      docType: string
      fileKind?: SignFileKind
      action?: WorkflowAction
      signaturePlacement?: SignPlacement
      skipTagLabels?: string[]
    } = body

    console.log("[generate-pdf] called - docId:", docId, "docType:", docType, "hasPlacement:", !!signaturePlacement)

    if (!token || !docId || !docType) {
      console.error("[generate-pdf] missing params - token:", !!token, "docId:", !!docId, "docType:", !!docType)
      return NextResponse.json({ error: "Thiếu tham số" }, { status: 400 })
    }

    let payload: { userId: string; docId: string; docType: string }
    try {
      const { payload: verifiedPayload } = await jwtVerify(token, JWT_SECRET)
      payload = verifiedPayload as typeof payload
    } catch {
      return NextResponse.json({ error: "Token không hợp lệ hoặc đã hết hạn" }, { status: 401 })
    }

    const { userId } = payload
    const signFileKind: SignFileKind = fileKind ?? "main"

    const { data: profileData } = await supabaseAdmin
      .from("profiles")
      .select("factory_id")
      .eq("id", userId)
      .single()
    const factoryId = profileData?.factory_id ?? ""
    if (!factoryId) return NextResponse.json({ error: "Không xác định được nhà máy" }, { status: 400 })

    const { data: docData, error: docErr } = await supabaseAdmin
      .from("iso_documents")
      .select("*")
      .eq("id", docId)
      .eq("factory_id", factoryId)
      .single()
    if (docErr || !docData) {
      return NextResponse.json({ error: "Không tìm thấy tài liệu" }, { status: 404 })
    }

    const doc = docData as Record<string, unknown>
    const maTl = (doc.ma_tai_lieu as string) || "-"
    const lanBanHanh = (doc.lan_ban_hanh as number) ?? 0
    const lsStr = String(lanBanHanh).padStart(2, "0")
    const trangThai = doc.trang_thai as string
    const statusText = getTargetStatusText(action, trangThai)
    const docIsConVal = isConDoc(
      (doc.loai_tai_lieu as string | null) ?? null,
      (doc.phan_loai_tl as string | null) ?? null,
    )
    const effectiveDate = action
      ? new Date().toISOString()
      : ((doc.ngay_hieu_luc as string) || (doc.ky_phe_duyet_at as string) || (doc.updated_at as string))
    const dateStr = fmtDate(effectiveDate)
    let currentSignerKey: string | null = null
    if (userId === (doc.soan_thao_user_id as string)) currentSignerKey = "soan_thao_placement"
    else if (userId === (doc.xem_xet_user_id as string)) currentSignerKey = "xem_xet_placement"
    else if (userId === (doc.phe_duyet_user_id as string)) currentSignerKey = "phe_duyet_placement"

    if (signFileKind === "main" && currentSignerKey && signaturePlacement) {
      const { error: placementSaveErr } = await supabaseAdmin
        .from("iso_documents")
        .update({ [currentSignerKey]: signaturePlacement })
        .eq("id", docId)
        .eq("factory_id", factoryId)
      if (placementSaveErr) {
        console.warn("[generate-pdf] placement save error (migration 20260524 chưa chạy?):", placementSaveErr.message)
      }
    }

    // Khi soạn thảo ký lại (resubmit từ draft/tra_ve): xóa placement cũ của xem xét và phê duyệt
    // để chữ ký vòng trước không bị embed lại vào PDF mới.
    if (signFileKind === "main" && currentSignerKey === "soan_thao_placement") {
      await supabaseAdmin
        .from("iso_documents")
        .update({ xem_xet_placement: null, phe_duyet_placement: null })
        .eq("id", docId)
        .eq("factory_id", factoryId)
    }

    const { data: docPlacements, error: placementLoadErr } = await supabaseAdmin
      .from("iso_documents")
      .select("soan_thao_placement, xem_xet_placement, phe_duyet_placement, soan_thao_user_id, xem_xet_user_id, phe_duyet_user_id")
      .eq("id", docId)
      .single()
    if (placementLoadErr) {
      return NextResponse.json(
        { error: "Không load được placements - migration 20260524_iso_signature_placement.sql chưa chạy: " + placementLoadErr.message },
        { status: 500 },
      )
    }

    const allPlacements: Array<{ signerUserId: string | null; placement: SignPlacement | null }> = [
      {
        signerUserId: (docPlacements?.soan_thao_user_id ?? null) as string | null,
        placement: (docPlacements?.soan_thao_placement ?? null) as SignPlacement | null,
      },
      {
        signerUserId: (docPlacements?.xem_xet_user_id ?? null) as string | null,
        placement: (docPlacements?.xem_xet_placement ?? null) as SignPlacement | null,
      },
      {
        signerUserId: (docPlacements?.phe_duyet_user_id ?? null) as string | null,
        placement: (docPlacements?.phe_duyet_placement ?? null) as SignPlacement | null,
      },
    ]

    if (signFileKind === "main" && currentSignerKey && signaturePlacement) {
      const keyToIndex: Record<string, number> = {
        soan_thao_placement: 0,
        xem_xet_placement: 1,
        phe_duyet_placement: 2,
      }
      const index = keyToIndex[currentSignerKey]
      if (index !== undefined && allPlacements[index].placement === null) {
        allPlacements[index] = { ...allPlacements[index], placement: signaturePlacement }
      }
    }
    if (signFileKind !== "main" && signaturePlacement) {
      // File phụ với placement cụ thể: chỉ nhúng chữ ký tại vị trí đó
      allPlacements.splice(0, allPlacements.length, { signerUserId: userId, placement: signaturePlacement })
    } else if (signFileKind !== "main") {
      // File phụ không có placement (Approach B auto-process): chỉ fill metadata, không nhúng chữ ký
      allPlacements.splice(0, allPlacements.length)
    }

    const soanPlacement = allPlacements[0]?.placement
    const manualQrPlacement = (
      soanPlacement &&
      typeof soanPlacement.qrX === "number" &&
      typeof soanPlacement.qrY === "number" &&
      typeof soanPlacement.qrWidth === "number" &&
      typeof soanPlacement.qrHeight === "number"
    )
      ? { x: soanPlacement.qrX, y: soanPlacement.qrY, width: soanPlacement.qrWidth, height: soanPlacement.qrHeight }
      : null

    const [pSoan, pXem, pPhe] = await Promise.all([
      getProfile(doc.soan_thao_user_id as string | null),
      getProfile(doc.xem_xet_user_id as string | null),
      getProfile(doc.phe_duyet_user_id as string | null),
    ])

    const docNameByUserId = new Map<string, string>()
    const soanUid = doc.soan_thao_user_id as string | null
    const xemUid = doc.xem_xet_user_id as string | null
    const pheUid = doc.phe_duyet_user_id as string | null
    if (soanUid && typeof doc.soan_thao === "string" && doc.soan_thao.trim()) docNameByUserId.set(soanUid, doc.soan_thao.trim())
    if (xemUid && typeof doc.xem_xet === "string" && doc.xem_xet.trim()) docNameByUserId.set(xemUid, doc.xem_xet.trim())
    if (pheUid && typeof doc.phe_duyet === "string" && doc.phe_duyet.trim()) docNameByUserId.set(pheUid, doc.phe_duyet.trim())

    const signerNames = new Map<string, string>()
    for (const profile of [pSoan, pXem, pPhe]) {
      if (!profile?.id) continue
      const snapshotName = docNameByUserId.get(profile.id)
      signerNames.set(profile.id, snapshotName || profile.full_name || profile.username || "")
    }

    const qrUrl = `${APP_URL}/dashboard/iso/documents/${docId}`
    const qrBuffer = await QRCode.toBuffer(qrUrl, { width: 120, margin: 1 })
    const viFontBytes = loadViFont()
    const signerNameFontBytes = loadSignerNameFont()
    if (!viFontBytes) {
      return NextResponse.json({ error: "Thiếu font tiếng Việt hợp lệ trong public/fonts." }, { status: 500 })
    }

    const sigImgNullFor: string[] = []
    const sigEmbedErrors: Array<{ userId: string; error: string }> = []
    let originalPages: PDFDocument | null = null
    let metaResult: MetaFillResult = { filled: [], notFound: [], mismatched: [], footerFilledPages: [] }
    let linesByPage: PdfTextItem[][][] = []
    let didApplyStamping = false
    let originalPdfBytesForTextScan: ArrayBuffer | null = null

    const fileGocUrl = (
      signFileKind === "change_request"
        ? doc.file_phieu_yeu_cau_thay_doi_url
        : signFileKind === "review_request"
          ? (doc.file_de_nghi_soat_xet_url || doc.file_soat_xet_url)
          : doc.file_goc_url
    ) as string | null
    console.log("[generate-pdf] file_goc_url:", fileGocUrl)

    // Non-PDF files: always skip - user must pre-convert via /api/sign/convert-office
    if (fileGocUrl && !originalPages) {
      const cleanUrl = fileGocUrl.split("?")[0]
      const ext = cleanUrl.split(".").pop()?.toLowerCase()
      if (ext !== "pdf") {
        console.log("[generate-pdf] non-PDF file, ext:", ext, "- skipping")
        return NextResponse.json({ ok: true, skipped: true, reason: "non-pdf" })
      }
    }

    const resolvedStoragePath = getStoragePathFromUrl(fileGocUrl, "iso-documents")
    const downloadErrors: string[] = []
    let downloadedByteLength = 0
    let pdfLoadError = ""

    if (fileGocUrl && !originalPages) {
      const storagePathCandidates = getStoragePathCandidatesFromUrl(fileGocUrl, "iso-documents")
      console.log("[generate-pdf] storagePath candidates:", storagePathCandidates)
      if (storagePathCandidates.length > 0) {
        let pdfData: Blob | null = null
        let downloadOkPath: string | null = null

        for (const candidate of storagePathCandidates) {
          const { data, error } = await supabaseAdmin.storage
            .from("iso-documents")
            .download(candidate)
          if (error || !data) {
            downloadErrors.push(`${candidate}: ${error?.message || "empty data"}`)
            continue
          }
          pdfData = data
          downloadOkPath = candidate
          break
        }

        if (!pdfData) {
          console.error("[generate-pdf] download file_goc failed all candidates:", downloadErrors)
        } else {
          console.log("[generate-pdf] resolved storagePath:", downloadOkPath)
          const pdfBytes = await pdfData.arrayBuffer()
          downloadedByteLength = pdfBytes.byteLength
          console.log("[generate-pdf] downloaded file_goc bytes:", pdfBytes.byteLength)
          const bytesForTextScan = cloneArrayBuffer(pdfBytes)
          const bytesForPdfLib = cloneArrayBuffer(pdfBytes)
          originalPdfBytesForTextScan = cloneArrayBuffer(pdfBytes)
          linesByPage = await extractTextLinesByPage(bytesForTextScan)

          try {
            originalPages = await PDFDocument.load(bytesForPdfLib)
            console.log("[generate-pdf] original page count:", originalPages.getPageCount())
          } catch (loadErr) {
            pdfLoadError = loadErr instanceof Error ? loadErr.message : String(loadErr)
            console.warn("[generate-pdf] PDFDocument.load failed:", pdfLoadError)
            originalPages = null
          }

          if (originalPages) {
            let stampFont: PDFFont
            let signerNameFont: PDFFont
            try {
              if (signerNameFontBytes) {
                stampFont = await embedViFont(originalPages, signerNameFontBytes)
                signerNameFont = stampFont
              } else {
                stampFont = await embedViFont(originalPages, viFontBytes)
                signerNameFont = stampFont
              }
            } catch (fontErr) {
              return NextResponse.json(
                { error: "Font tiếng Việt không hợp lệ: " + (fontErr instanceof Error ? fontErr.message : String(fontErr)) },
                { status: 500 },
              )
            }

            metaResult = await fillMetadataPlaceholders(
              originalPages,
              pdfBytes,
              doc,
              stampFont,
              qrBuffer,
              manualQrPlacement,
              maTl,
              lsStr,
              dateStr,
              statusText,
              skipTagLabels ?? [],
              (doc.chon_quy_trinh as string | null) ?? null,
            )
            if (docIsConVal || metaResult.footerFilledPages.length > 0) {
              drawFooterOnAllPages(originalPages, stampFont, buildFooterValue(maTl, lsStr, dateStr, statusText), metaResult.footerFilledPages)
            }
            // Fallback: nếu QR chưa được vẽ bởi fillMetadataPlaceholders (vd: PDF không có tag "QR:" trong header),
            // vẽ QR tại vị trí manual placement trên trang đầu tiên.
            if (manualQrPlacement && !metaResult.filled.includes("QR")) {
              try {
                const qrImgFallback = await originalPages.embedPng(qrBuffer)
                originalPages.getPage(0).drawImage(qrImgFallback, {
                  x: manualQrPlacement.x,
                  y: manualQrPlacement.y,
                  width: manualQrPlacement.width,
                  height: manualQrPlacement.height,
                })
              } catch { /* bỏ qua nếu embed thất bại */ }
            }

            for (const { signerUserId, placement } of allPlacements) {
              if (!signerUserId || !placement) continue
              const pageIndex = placement.page - 1
              if (pageIndex < 0 || pageIndex >= originalPages.getPageCount()) continue

              const sigImg = await getSigImage(factoryId, signerUserId)
              if (!sigImg) {
                sigImgNullFor.push(signerUserId)
                continue
              }

              try {
                if (placement.showSignature !== false) {
                  const embedded = await originalPages.embedPng(sigImg).catch(() => originalPages!.embedJpg(sigImg))
                  originalPages.getPage(pageIndex).drawImage(embedded, {
                    x: placement.x,
                    y: placement.y,
                    width: placement.width,
                    height: placement.height,
                    opacity: 0.92,
                  })
                }

                const signerName = signerNames.get(signerUserId)?.trim()
                if (signerName && placement.showSignerName !== false) {
                  const pageLines = linesByPage[pageIndex] ?? []
                  const signerSlot = buildSignerNamePlacement(placement)
                  const hasExistingName = findNearbyText(pageLines, signerSlot.xCenter, signerSlot.y)
                  if (!hasExistingName) {
                    const maxNameWidth = signerSlot.maxWidth
                    let nameFontSize = 13
                    while (nameFontSize > 9 && signerNameFont.widthOfTextAtSize(signerName, nameFontSize) > maxNameWidth) {
                      nameFontSize -= 0.5
                    }
                    const nameWidth = signerNameFont.widthOfTextAtSize(signerName, nameFontSize)
                    originalPages.getPage(pageIndex).drawText(signerName, {
                      x: signerSlot.xCenter - nameWidth / 2,
                      y: signerSlot.y,
                      size: nameFontSize,
                      font: signerNameFont,
                      color: rgb(0, 0, 0),
                    })
                  }
                }
              } catch (err) {
                sigEmbedErrors.push({ userId: signerUserId, error: err instanceof Error ? err.message : String(err) })
              }
            }
            didApplyStamping = true
          }
        }
      } else {
        console.error("[generate-pdf] cannot resolve storagePath from file_goc_url:", fileGocUrl)
      }
    }

    if (!originalPages && fileGocUrl) {
      try {
        const fallbackRes = await fetch(fileGocUrl, { cache: "no-store" })
        if (!fallbackRes.ok) {
          downloadErrors.push(`fetch(fileGocUrl): HTTP ${fallbackRes.status}`)
        } else {
          const fallbackBytes = await fallbackRes.arrayBuffer()
          downloadedByteLength = fallbackBytes.byteLength
          const fallbackForTextScan = cloneArrayBuffer(fallbackBytes)
          const fallbackForPdfLib = cloneArrayBuffer(fallbackBytes)
          originalPdfBytesForTextScan = cloneArrayBuffer(fallbackBytes)
          linesByPage = await extractTextLinesByPage(fallbackForTextScan)
          try {
            originalPages = await PDFDocument.load(fallbackForPdfLib)
            console.log("[generate-pdf] fallback load page count:", originalPages.getPageCount())
          } catch (fallbackLoadErr) {
            const fallbackMsg = fallbackLoadErr instanceof Error ? fallbackLoadErr.message : String(fallbackLoadErr)
            if (!pdfLoadError) pdfLoadError = fallbackMsg
            console.warn("[generate-pdf] fallback PDFDocument.load failed:", fallbackMsg)
          }
        }
      } catch (fallbackErr) {
        downloadErrors.push(`fetch(fileGocUrl): ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`)
      }
    }

    if (originalPages && !didApplyStamping) {
      let stampFont: PDFFont
      let signerNameFont: PDFFont
      try {
        if (signerNameFontBytes) {
          stampFont = await embedViFont(originalPages, signerNameFontBytes)
          signerNameFont = stampFont
        } else {
          stampFont = await embedViFont(originalPages, viFontBytes)
          signerNameFont = stampFont
        }
      } catch (fontErr) {
        return NextResponse.json(
          { error: "Font tiếng Việt không hợp lệ: " + (fontErr instanceof Error ? fontErr.message : String(fontErr)) },
          { status: 500 },
        )
      }

      metaResult = await fillMetadataPlaceholders(
        originalPages,
        originalPdfBytesForTextScan ?? new ArrayBuffer(0),
        doc,
        stampFont,
        qrBuffer,
        manualQrPlacement,
        maTl,
        lsStr,
        dateStr,
        statusText,
        skipTagLabels ?? [],
        (doc.chon_quy_trinh as string | null) ?? null,
      )
      if (docIsConVal || metaResult.footerFilledPages.length > 0) {
        drawFooterOnAllPages(originalPages, stampFont, buildFooterValue(maTl, lsStr, dateStr, statusText), metaResult.footerFilledPages)
      }
      if (manualQrPlacement && !metaResult.filled.includes("QR")) {
        try {
          const qrImgFallback = await originalPages.embedPng(qrBuffer)
          originalPages.getPage(0).drawImage(qrImgFallback, {
            x: manualQrPlacement.x,
            y: manualQrPlacement.y,
            width: manualQrPlacement.width,
            height: manualQrPlacement.height,
          })
        } catch { /* bỏ qua nếu embed thất bại */ }
      }

      for (const { signerUserId, placement } of allPlacements) {
        if (!signerUserId || !placement) continue
        const pageIndex = placement.page - 1
        if (pageIndex < 0 || pageIndex >= originalPages.getPageCount()) continue

        const sigImg = await getSigImage(factoryId, signerUserId)
        if (!sigImg) {
          sigImgNullFor.push(signerUserId)
          continue
        }

        try {
          if (placement.showSignature !== false) {
            const embedded = await originalPages.embedPng(sigImg).catch(() => originalPages!.embedJpg(sigImg))
            originalPages.getPage(pageIndex).drawImage(embedded, {
              x: placement.x,
              y: placement.y,
              width: placement.width,
              height: placement.height,
              opacity: 0.92,
            })
          }

          const signerName = signerNames.get(signerUserId)?.trim()
          if (signerName && placement.showSignerName !== false) {
            const pageLines = linesByPage[pageIndex] ?? []
            const signerSlot = buildSignerNamePlacement(placement)
            const hasExistingName = findNearbyText(pageLines, signerSlot.xCenter, signerSlot.y)
            if (!hasExistingName) {
              const maxNameWidth = signerSlot.maxWidth
              let nameFontSize = 13
              while (nameFontSize > 9 && signerNameFont.widthOfTextAtSize(signerName, nameFontSize) > maxNameWidth) {
                nameFontSize -= 0.5
              }
              const nameWidth = signerNameFont.widthOfTextAtSize(signerName, nameFontSize)
              originalPages.getPage(pageIndex).drawText(signerName, {
                x: signerSlot.xCenter - nameWidth / 2,
                y: signerSlot.y,
                size: nameFontSize,
                font: signerNameFont,
                color: rgb(0, 0, 0),
              })
            }
          }
        } catch (err) {
          sigEmbedErrors.push({ userId: signerUserId, error: err instanceof Error ? err.message : String(err) })
        }
      }
      didApplyStamping = true
    }

    if (!originalPages || originalPages.getPageCount() === 0) {
      console.error("[generate-pdf] original PDF not loaded; aborting to avoid uploading blank PDF", {
        docId,
        hasFileGocUrl: !!fileGocUrl,
      })
      return NextResponse.json(
        {
          error: "Không tải được file PDF gốc để tạo PDF ký. Kiểm tra file_goc_url/storagePath trong log server.",
          diagnostics: {
            fileGocUrl,
            fileGocLoaded: false,
            resolvedStoragePath,
            downloadErrors,
            downloadedByteLength,
            pdfLoadError,
          },
        },
        { status: 500 },
      )
    }

    const finalDoc = await PDFDocument.create()

    const copiedOriginalPages = await finalDoc.copyPages(originalPages, originalPages.getPageIndices())
    copiedOriginalPages.forEach((copiedPage) => finalDoc.addPage(copiedPage))

    const signedPdfBytes = await finalDoc.save()
    const namePrefix = sanitizeOutputName(`${maTl} ${String(doc.ten_tai_lieu || "tai_lieu")}`)
    const outputPath = `${factoryId}/iso/signed/${namePrefix}_${signFileKind}_signed_${Date.now()}.pdf`
    const { error: uploadErr } = await supabaseAdmin.storage
      .from("iso-documents")
      .upload(outputPath, signedPdfBytes, { contentType: "application/pdf", upsert: true })

    if (uploadErr) {
      console.error("[generate-pdf] upload failed:", uploadErr.message)
      return NextResponse.json({ error: "Upload PDF lỗi: " + uploadErr.message }, { status: 500 })
    }

    const { data: urlData } = supabaseAdmin.storage
      .from("iso-documents")
      .getPublicUrl(outputPath)

    console.log("[generate-pdf] upload OK - public URL:", urlData.publicUrl)

    const updateUrlPayload =
      signFileKind === "change_request"
        ? { file_phieu_yeu_cau_thay_doi_url: urlData.publicUrl }
        : signFileKind === "review_request"
          ? { file_de_nghi_soat_xet_url: urlData.publicUrl, file_soat_xet_url: urlData.publicUrl }
          : { file_signed_pdf_url: urlData.publicUrl }

    const { error: updateUrlErr } = await supabaseAdmin
      .from("iso_documents")
      .update(updateUrlPayload)
      .eq("id", docId)
    if (updateUrlErr) {
      console.error("[generate-pdf] DB update file_signed_pdf_url failed:", updateUrlErr.message)
      return NextResponse.json({ error: "Lưu URL PDF thất bại: " + updateUrlErr.message }, { status: 500 })
    }
    console.log("[generate-pdf] DB update OK - docId:", docId)

    await supabaseAdmin.from("doc_approval_log").insert({
      factory_id: factoryId,
      doc_id: docId,
      doc_type: docType,
      user_id: userId,
      action: "generate_pdf",
      ip_address: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "",
      user_agent: req.headers.get("user-agent") || "",
    })

    const bodySignaturesEmbedded = allPlacements.filter((entry) => entry.signerUserId && entry.placement).length
    const signerNameResolved = allPlacements
      .filter((entry) => !!entry.signerUserId)
      .map((entry) => ({
        userId: entry.signerUserId as string,
        name: signerNames.get(entry.signerUserId as string) || "",
      }))
    const signerImagePath = allPlacements
      .filter((entry) => !!entry.signerUserId)
      .map((entry) => ({
        userId: entry.signerUserId as string,
        storagePath: `signatures/${factoryId}/${entry.signerUserId as string}/chu_ky.png`,
      }))

    return NextResponse.json({
      ok: true,
      signedPdfUrl: urlData.publicUrl,
      storagePath: outputPath,
      metaFilled: metaResult.filled,
      metaNotFound: metaResult.notFound,
      metaMismatched: metaResult.mismatched,
      diagnostics: {
        fileGocLoaded: !!originalPages,
        placementSaved: !!(signFileKind === "main" && currentSignerKey && signaturePlacement),
        fileKind: signFileKind,
        placementColumnsExist: !placementLoadErr,
        bodySignaturesEmbedded,
        allPlacementsRaw: allPlacements.map((entry) => ({
          userId: entry.signerUserId,
          hasPlacement: !!entry.placement,
        })),
        signerNameResolved,
        signerImagePath,
        sigImgLoadFailed: sigImgNullFor,
        sigEmbedErrors,
        metaFillError: metaResult.error ?? null,
      },
    })
  } catch (err) {
    console.error("[generate-pdf] unhandled error:", err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi server" },
      { status: 500 },
    )
  }
}


