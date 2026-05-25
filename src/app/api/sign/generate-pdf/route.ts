import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { PDFDocument, PDFFont, rgb, StandardFonts } from "pdf-lib"
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
  showSignerName?: boolean
  nameX?: number
  nameY?: number
  nameWidth?: number
  nameHeight?: number
}

type MetaMismatch = { found: string; expected: string }

type MetaFillResult = {
  filled: string[]
  notFound: string[]
  mismatched: MetaMismatch[]
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
  draft: "Nháp",
  cho_xem_xet: "Chờ xem xét",
  cho_phe_duyet: "Chờ phê duyệt",
  co_hieu_luc: "Có hiệu lực",
  het_hieu_luc: "Hết hiệu lực",
  tra_ve: "Trả về",
  bi_tu_choi_phe_duyet: "Phê duyệt từ chối",
}

const HEADER_VALUE_PLACEHOLDER_RE = /^[_\-\.\s/|:]*$/
const FOOTER_TEMPLATE_RE = /ma\s*tai\s*lieu.*lan\s*(ban\s*hanh|sua\s*doi|soat\s*xet).*(ngay\s*hieu\s*luc|ngay\s*ban\s*hanh|ngay\s*ap\s*dung).*(tinh\s*trang|trang\s*thai)/i
const FOOTER_FILLED_RE = /\b[A-Z]{2,}(?:-[A-Z0-9Đ]{2,})+\s*\(\d{2}-\d{2}\/\d{2}\/\d{4}\)\s*.+/i
const FOOTER_LABEL = "Footer mẫu"

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

function inferRevisionLabel(doc: Record<string, unknown>): string {
  return doc.chon_quy_trinh === "Soát xét" ? "Lần sửa đổi" : "Lần ban hành"
}

function buildFooterValue(maTl: string, lsStr: string, dateStr: string, statusText: string): string {
  return `${maTl} (${lsStr}-${dateStr}) ${statusText}`.trim()
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
    const pdfjsLib = await loadPdfjs()
    const pdfjsDoc = await pdfjsLib.getDocument({
      data: new Uint8Array(pdfBytes),
      useWorkerFetch: false,
      isEvalSupported: false,
    } as never).promise
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

function getMismatchPatterns() {
  return [
    { pattern: /^ma\s*ho\s*so\b/i, expected: "Mã tài liệu" },
    { pattern: /^ma\s*hieu\b/i, expected: "Mã tài liệu" },
    { pattern: /^so\s*hieu(\s*tai\s*lieu)?\b/i, expected: "Mã tài liệu" },
    { pattern: /^ngay\s*ban\s*hanh\b/i, expected: "Ngày hiệu lực" },
    { pattern: /^ngay\s*ap\s*dung\b/i, expected: "Ngày hiệu lực" },
    { pattern: /^phien\s*ban\b/i, expected: "Lần ban hành / Lần sửa đổi" },
    { pattern: /^trang\s*thai\b/i, expected: "Tình trạng" },
  ] as const
}

async function loadPdfjs() {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs")
  pdfjsLib.GlobalWorkerOptions.workerSrc = ""
  return pdfjsLib
}

async function fillMetadataPlaceholders(
  pdfDoc: PDFDocument,
  pdfBytes: ArrayBuffer,
  doc: Record<string, unknown>,
  font: PDFFont,
  qrBuffer: Buffer,
  maTl: string,
  lsStr: string,
  dateStr: string,
  statusText: string,
  skipLabels: string[] = [],
): Promise<MetaFillResult> {
  const filled = new Set<string>()
  const found = new Set<string>()
  const mismatched: MetaMismatch[] = []
  const headerPatterns = getHeaderPatterns(doc, maTl, lsStr, dateStr, statusText)
  const mismatchPatterns = getMismatchPatterns()
  const footerValue = buildFooterValue(maTl, lsStr, dateStr, statusText)

  try {
    const pdfjsLib = await loadPdfjs()
    const pdfjsDoc = await pdfjsLib.getDocument({
      data: new Uint8Array(pdfBytes),
      useWorkerFetch: false,
      isEvalSupported: false,
    } as never).promise
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

        for (const { pattern, expected } of mismatchPatterns) {
          if (skipLabels.includes(expected)) continue
          if (pattern.test(normalizedItem) && !mismatched.some((entry) => entry.expected === expected && entry.found === item.str)) {
            mismatched.push({ found: item.str, expected })
          }
        }

        for (const header of headerPatterns) {
          if (
            pageFound.has(header.expected) ||
            skipLabels.includes(header.expected) ||
            !header.value ||
            !header.pattern.test(normalizedItem)
          ) {
            continue
          }

          found.add(header.expected)
          pageFound.add(header.expected)

          if (header.label === "QR") {
            const qrImage = await pdfDoc.embedPng(qrBuffer)
            const qrX = item.transform[4] + (item.width ?? 0) + 6
            const qrSize = Math.max((item.height ?? 10) * 2.5, 24)
            const maxWidth = Math.max(viewport.width - qrX - 12, 18)
            const drawSize = Math.min(qrSize, maxWidth)
            if (drawSize > 18) {
              page.drawImage(qrImage, {
                x: qrX,
                y: item.transform[5] - 4,
                width: drawSize,
                height: drawSize,
              })
              filled.add(header.expected)
            }
            break
          }

          const existingValue = extractHeaderValueFromPageItems(headerItems, item)
          if (hasRealHeaderValue(existingValue)) break

          const hasColon = item.str.includes(":")
          const fontSize = Math.max(Math.round((item.height ?? 10) * 0.85), 7)
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

      for (const line of lines) {
        const lineText = textOfLine(line)
        if (!lineText) continue
        const searchText = normalizeTagText(lineText)

        const bounds = getLineBounds(line)
        const isHeader = line[0].transform[5] > headerThreshold
        const isFooter = bounds.maxY < footerThreshold

        if (isHeader) {
          for (const { pattern, expected } of mismatchPatterns) {
            if (skipLabels.includes(expected)) continue
            if (pattern.test(searchText) && !mismatched.some((entry) => entry.expected === expected && entry.found === lineText)) {
              mismatched.push({ found: lineText, expected })
            }
          }
        }

        if (isFooter) {
          if (FOOTER_FILLED_RE.test(lineText)) {
            found.add(FOOTER_LABEL)
            pageFound.add(FOOTER_LABEL)
            continue
          }

          if (FOOTER_TEMPLATE_RE.test(searchText)) {
            found.add(FOOTER_LABEL)
            pageFound.add(FOOTER_LABEL)
            if (skipLabels.includes(FOOTER_LABEL)) continue

            page.drawRectangle({
              x: Math.max(bounds.minX - 2, 0),
              y: Math.max(bounds.minY - 2, 0),
              width: bounds.maxX - bounds.minX + 8,
              height: bounds.maxY - bounds.minY + 6,
              color: rgb(1, 1, 1),
            })

            const fontSize = Math.max(Math.round((line[0].height ?? 10) * 0.9), 7)
            page.drawText(footerValue, {
              x: bounds.minX,
              y: line[0].transform[5],
              size: fontSize,
              font,
              color: rgb(0, 0, 0),
            })
            filled.add(FOOTER_LABEL)
            continue
          }

          if (
            !skipLabels.includes(FOOTER_LABEL) &&
            /(ma\s*ho\s*so|ma\s*hieu|phien\s*ban|ngay\s*ban\s*hanh|ngay\s*ap\s*dung|trang\s*thai)/i.test(searchText) &&
            !mismatched.some((entry) => entry.expected === FOOTER_LABEL && entry.found === lineText)
          ) {
            mismatched.push({ found: lineText, expected: FOOTER_LABEL })
          }
        }
      }

      void pageFound
    }
  } catch (err) {
    console.warn("[generate-pdf] fillMetadataPlaceholders:", err instanceof Error ? err.message : err)
  }

  const notFound = [
    ...headerPatterns
      .map((entry) => entry.expected)
      .filter((label, index, all) => all.indexOf(label) === index)
      .filter((label) => !found.has(label) && !skipLabels.includes(label)),
    ...(found.has(FOOTER_LABEL) || skipLabels.includes(FOOTER_LABEL) ? [] : [FOOTER_LABEL]),
  ]

  return { filled: [...filled], notFound, mismatched }
}

async function embedViFont(pdfDoc: PDFDocument, fontBytes: Buffer): Promise<PDFFont> {
  pdfDoc.registerFontkit(fontkit)
  return await pdfDoc.embedFont(fontBytes)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      token,
      docId,
      docType,
      signaturePlacement,
      skipTagLabels,
    }: {
      token: string
      docId: string
      docType: string
      signaturePlacement?: SignPlacement
      skipTagLabels?: string[]
    } = body

    console.log("[generate-pdf] called — docId:", docId, "docType:", docType, "hasPlacement:", !!signaturePlacement)

    if (!token || !docId || !docType) {
      console.error("[generate-pdf] missing params — token:", !!token, "docId:", !!docId, "docType:", !!docType)
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
    const maTl = (doc.ma_tai_lieu as string) || "—"
    const lanBanHanh = (doc.lan_ban_hanh as number) ?? 0
    const lsStr = String(lanBanHanh).padStart(2, "0")
    const trangThai = doc.trang_thai as string
    const statusText = TRANG_THAI_LABEL_SERVER[trangThai] || "Chờ phê duyệt"
    const effectiveDate = (doc.ngay_hieu_luc as string) || (doc.ky_phe_duyet_at as string) || (doc.updated_at as string)
    const dateStr = fmtDate(effectiveDate)
    const loaiTaiLieu = doc.loai_tai_lieu as string | null
    const phanLoaiTl = doc.phan_loai_tl as string | null
    void isConDoc(loaiTaiLieu, phanLoaiTl)

    let currentSignerKey: string | null = null
    if (userId === (doc.soan_thao_user_id as string)) currentSignerKey = "soan_thao_placement"
    else if (userId === (doc.xem_xet_user_id as string)) currentSignerKey = "xem_xet_placement"
    else if (userId === (doc.phe_duyet_user_id as string)) currentSignerKey = "phe_duyet_placement"

    if (currentSignerKey && signaturePlacement) {
      const { error: placementSaveErr } = await supabaseAdmin
        .from("iso_documents")
        .update({ [currentSignerKey]: signaturePlacement })
        .eq("id", docId)
        .eq("factory_id", factoryId)
      if (placementSaveErr) {
        console.warn("[generate-pdf] placement save error (migration 20260524 chưa chạy?):", placementSaveErr.message)
      }
    }

    const { data: docPlacements, error: placementLoadErr } = await supabaseAdmin
      .from("iso_documents")
      .select("soan_thao_placement, xem_xet_placement, phe_duyet_placement, soan_thao_user_id, xem_xet_user_id, phe_duyet_user_id")
      .eq("id", docId)
      .single()
    if (placementLoadErr) {
      return NextResponse.json(
        { error: "Không load được placements — migration 20260524_iso_signature_placement.sql chưa chạy: " + placementLoadErr.message },
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

    if (currentSignerKey && signaturePlacement) {
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

    const [pSoan, pXem, pPhe] = await Promise.all([
      getProfile(doc.soan_thao_user_id as string | null),
      getProfile(doc.xem_xet_user_id as string | null),
      getProfile(doc.phe_duyet_user_id as string | null),
    ])
    const signerNames = new Map<string, string>()
    for (const profile of [pSoan, pXem, pPhe]) {
      if (!profile?.id) continue
      signerNames.set(profile.id, profile.full_name || profile.username || "")
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
    let metaResult: MetaFillResult = { filled: [], notFound: [], mismatched: [] }
    let linesByPage: PdfTextItem[][][] = []

    const fileGocUrl = doc.file_goc_url as string | null
    if (fileGocUrl) {
      const urlParts = fileGocUrl.split("/storage/v1/object/public/iso-documents/")
      const storagePath = urlParts.length === 2 ? urlParts[1] : null
      if (storagePath) {
        const { data: pdfData, error: pdfErr } = await supabaseAdmin.storage
          .from("iso-documents")
          .download(decodeURIComponent(storagePath))
        if (!pdfErr && pdfData) {
          const pdfBytes = await pdfData.arrayBuffer()
          linesByPage = await extractTextLinesByPage(pdfBytes)

          try {
            originalPages = await PDFDocument.load(pdfBytes)
          } catch (loadErr) {
            console.warn("[generate-pdf] PDFDocument.load failed:", loadErr instanceof Error ? loadErr.message : loadErr)
            originalPages = null
          }

          if (originalPages) {
            let stampFont: PDFFont
            let signerNameFont: PDFFont
            try {
              stampFont = await embedViFont(originalPages, viFontBytes)
              signerNameFont = signerNameFontBytes
                ? await embedViFont(originalPages, signerNameFontBytes)
                : stampFont
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
              maTl,
              lsStr,
              dateStr,
              statusText,
              skipTagLabels ?? [],
            )

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
                const embedded = await originalPages.embedPng(sigImg).catch(() => originalPages!.embedJpg(sigImg))
                originalPages.getPage(pageIndex).drawImage(embedded, {
                  x: placement.x,
                  y: placement.y,
                  width: placement.width,
                  height: placement.height,
                  opacity: 0.92,
                })

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
          }
        }
      }
    }

    const finalDoc = await PDFDocument.create()

    if (originalPages) {
      const copiedOriginalPages = await finalDoc.copyPages(originalPages, originalPages.getPageIndices())
      copiedOriginalPages.forEach((copiedPage) => finalDoc.addPage(copiedPage))
    }

    if (finalDoc.getPageCount() === 0) {
      const blankPage = finalDoc.addPage([595, 842])
      const font = await finalDoc.embedFont(StandardFonts.Helvetica)
      blankPage.drawText("Khong co file tai lieu", {
        x: 200,
        y: 400,
        size: 14,
        font,
        color: rgb(0.5, 0.5, 0.5),
      })
    }

    const signedPdfBytes = await finalDoc.save()
    const outputPath = `${factoryId}/iso/signed/${docId}_signed.pdf`
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

    console.log("[generate-pdf] upload OK — public URL:", urlData.publicUrl)

    const { error: updateUrlErr } = await supabaseAdmin
      .from("iso_documents")
      .update({ file_signed_pdf_url: urlData.publicUrl })
      .eq("id", docId)
    if (updateUrlErr) {
      console.error("[generate-pdf] DB update file_signed_pdf_url failed:", updateUrlErr.message)
      return NextResponse.json({ error: "Lưu URL PDF thất bại: " + updateUrlErr.message }, { status: 500 })
    }
    console.log("[generate-pdf] DB update OK — docId:", docId)

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
    return NextResponse.json({
      ok: true,
      signedPdfUrl: urlData.publicUrl,
      storagePath: outputPath,
      metaFilled: metaResult.filled,
      metaNotFound: metaResult.notFound,
      metaMismatched: metaResult.mismatched,
      diagnostics: {
        fileGocLoaded: !!originalPages,
        placementSaved: !!(currentSignerKey && signaturePlacement),
        placementColumnsExist: !placementLoadErr,
        bodySignaturesEmbedded,
        allPlacementsRaw: allPlacements.map((entry) => ({
          userId: entry.signerUserId,
          hasPlacement: !!entry.placement,
        })),
        sigImgLoadFailed: sigImgNullFor,
        sigEmbedErrors,
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
