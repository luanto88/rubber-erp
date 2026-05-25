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

// Types

type Profile = { id: string; full_name: string | null; username: string | null; role: string | null }

type SignPlacement = {
  page: number    // 1-based
  x: number       // pt (pdf-lib bottom-left origin)
  y: number
  width: number
  height: number
}

type MetaMismatch = { found: string; expected: string }

const TRANG_THAI_LABEL_SERVER: Record<string, string> = {
  draft: "Nháp",
  cho_xem_xet: "Chờ xem xét",
  cho_phe_duyet: "Chờ phê duyệt",
  co_hieu_luc: "Có hiệu lực",
  het_hieu_luc: "Hết hiệu lực",
  tra_ve: "Trả về",
  bi_tu_choi_phe_duyet: "Phê duyệt từ chối",
}

// Con types: F always; PL and HD when phan_loai_tl === "con"
function isConDoc(loaiTaiLieu: string | null, phanLoaiTl: string | null): boolean {
  if (loaiTaiLieu === "F") return true
  if ((loaiTaiLieu === "PL" || loaiTaiLieu === "HD") && phanLoaiTl === "con") return true
  return false
}

async function getProfile(userId: string | null): Promise<Profile | null> {
  if (!userId) return null
  const { data } = await supabaseAdmin.from("profiles").select("id, full_name, username, role").eq("id", userId).single()
  return data as Profile | null
}

async function getSigImage(factoryId: string, userId: string): Promise<ArrayBuffer | null> {
  const path = `signatures/${factoryId}/${userId}/chu_ky.png`
  const { data, error } = await supabaseAdmin.storage.from("iso-documents").download(path)
  if (error || !data) return null
  return await data.arrayBuffer()
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`
}

function loadViFont(): Buffer | null {
  try {
    return fs.readFileSync(path.join(process.cwd(), "public/fonts/NotoSans-Regular.ttf"))
  } catch {
    return null
  }
}

// Scan PDF header area (top 40% of first page) and fill blank metadata placeholders
async function fillMetadataPlaceholders(
  pdfDoc: PDFDocument,
  pdfBytes: ArrayBuffer,
  doc: Record<string, unknown>,
  fallbackFont: PDFFont,
  viFont: Buffer | null,
  skipLabels: string[] = [],
): Promise<{ filled: string[]; notFound: string[]; mismatched: MetaMismatch[] }> {
  const filledSet = new Set<string>()
  const notFound: string[] = []
  const mismatched: MetaMismatch[] = []
  try {
    // Embed Vietnamese-capable font if available; fall back to Helvetica for ASCII
    let drawFont = fallbackFont
    if (viFont) {
      pdfDoc.registerFontkit(fontkit)
      drawFont = await pdfDoc.embedFont(viFont)
    }

    // Labels that should exist in the header info box (correct names)
    const FILL_MAP = [
      { label: "Mã tài liệu", pattern: /m[aã]\s*t[àa]i\s*li[eệ]u\s*:/i, value: (doc.ma_tai_lieu as string) || "" },
      { label: "Lần ban hành / Lần sửa đổi", pattern: /l[aầ]n\s+(ban\s*h[àa]nh|s[uửa]+a?\s*đ[oổ]i)\s*:/i, value: String((doc.lan_ban_hanh as number) ?? 1) },
      { label: "Tình trạng", pattern: /t[iì]nh\s*tr[aạ]ng\s*:/i, value: TRANG_THAI_LABEL_SERVER[doc.trang_thai as string] || "" },
      { label: "Ngày hiệu lực", pattern: /ng[aà]y\s*hi[eệ]u\s*l[uực]*\s*:/i, value: doc.ngay_hieu_luc ? fmtDate(doc.ngay_hieu_luc as string) : "" },
    ]

    // Similar-but-wrong labels → warn user to fix the template file
    const MISMATCH_MAP: Array<{ pattern: RegExp; expected: string }> = [
      { pattern: /tr[aạ]ng\s*th[aá]i\s*:/i,                      expected: "Tình trạng" },
      { pattern: /m[aã]\s*h[oồ]\s*s[oơ]\s*:/i,                   expected: "Mã tài liệu" },
      { pattern: /s[oố]\s*hi[eệ]u\s*(t[aà]i\s*li[eệ]u\s*)?:/i,  expected: "Mã tài liệu" },
      { pattern: /phi[eê]n\s*b[aả]n\s*:/i,                        expected: "Lần ban hành / Lần sửa đổi" },
      { pattern: /ng[aà]y\s*ban\s*h[aà]nh\s*:/i,                  expected: "Ngày hiệu lực" },
      { pattern: /ng[aà]y\s*[aá]p\s*d[uụ]ng\s*:/i,               expected: "Ngày hiệu lực" },
    ]

    const pdfjsLib = await import("pdfjs-dist")
    pdfjsLib.GlobalWorkerOptions.workerSrc = ""
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfjsDoc = await pdfjsLib.getDocument({
      data: new Uint8Array(pdfBytes),
      useWorkerFetch: false,
      isEvalSupported: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).promise

    const pdfLibPages = pdfDoc.getPages()

    // Local shape for pdfjs text items (to avoid clash with pdfjs-dist's exported TextItem)
    type PdfTextItem = { str: string; transform: number[]; width: number; height: number }

    // Track found/filled across ALL pages so labels on page 1 don't show up in notFound from page 2+
    const foundLabels = new Set<string>()

    for (let pageIdx = 0; pageIdx < Math.min(pdfjsDoc.numPages, pdfLibPages.length); pageIdx++) {
      // Only fill labels on the first page to avoid modifying body content on subsequent pages
      const shouldFill = pageIdx === 0

      const pdfjsPage = await pdfjsDoc.getPage(pageIdx + 1)
      const viewport = pdfjsPage.getViewport({ scale: 1.0 })
      const textContent = await pdfjsPage.getTextContent()
      const pdfLibPage = pdfLibPages[pageIdx]

      // Only consider items in the top 40% of the page (header info box area)
      // pdfjs uses bottom-left origin, so y > 60% of height = top 40%
      const headerThreshold = viewport.height * 0.60
      const items = (textContent.items as unknown[]).filter((item): item is PdfTextItem =>
        typeof item === "object" && item !== null &&
        "str" in item && typeof (item as { str?: unknown }).str === "string" &&
        "transform" in item && Array.isArray((item as { transform?: unknown }).transform) &&
        ((item as { transform: number[] }).transform[5]) > headerThreshold
      )

      // Sort top-to-bottom then left-to-right
      items.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4])

      // Group items into lines (within 3pt on y-axis)
      const lines: PdfTextItem[][] = []
      for (const item of items) {
        const y = item.transform[5]
        const existing = lines.find((l) => Math.abs(l[0].transform[5] - y) < 3)
        if (existing) {
          existing.push(item)
          existing.sort((a, b) => a.transform[4] - b.transform[4])
        } else {
          lines.push([item])
        }
      }

      for (const line of lines) {
        const lineText = line.map((i) => i.str).join(" ")

        // Detect QR: label — stampHeader handles the actual QR placement
        if (/\bqr\s*:/i.test(lineText)) {
          foundLabels.add("QR")
        }

        // Check for similar-but-wrong labels before checking correct ones
        for (const { pattern, expected } of MISMATCH_MAP) {
          if (skipLabels.includes(expected)) continue
          if (pattern.test(lineText)) {
            const foundStr = line.map((i) => i.str).join("").trim()
            if (!mismatched.some((m) => m.expected === expected)) {
              mismatched.push({ found: foundStr, expected })
            }
          }
        }

        // Fill correct labels (only on first page)
        for (const { label, pattern, value } of FILL_MAP) {
          if (skipLabels.includes(label)) continue
          if (!pattern.test(lineText) || !value || !shouldFill) continue
          foundLabels.add(label)

          const colonIdx = line.findIndex((item) => item.str.includes(":"))
          if (colonIdx === -1) continue

          const afterColon = line.slice(colonIdx + 1)
          const existingText = afterColon.map((i) => i.str).join("").trim()
          // Skip if field already has real content (not just dashes/underscores/spaces)
          if (existingText && !/^[_\-\.\s]+$/.test(existingText)) continue

          const colonItem = line[colonIdx]
          const x = colonItem.transform[4] + (colonItem.width ?? 0) + 3
          const y = colonItem.transform[5]
          const fontSize = Math.max(Math.round((colonItem.height ?? 10) * 0.85), 7)
          try {
            pdfLibPage.drawText(value, { x, y, size: fontSize, font: drawFont, color: rgb(0, 0, 0) })
            filledSet.add(label)
          } catch { /* skip this field if font/encoding fails; continue with others */ }
          break
        }
      }

      // Track labels not found in header of first page only
      if (shouldFill) {
        for (const { label } of FILL_MAP) {
          if (!foundLabels.has(label) && !notFound.includes(label)) notFound.push(label)
        }
      }
    }
  } catch (err) {
    console.warn("[generate-pdf] fillMetadataPlaceholders:", err instanceof Error ? err.message : err)
  }
  return { filled: [...filledSet], notFound, mismatched }
}

// Footer stamp on each page
async function stampFooter(
  page: ReturnType<PDFDocument["getPages"]>[number],
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  maTl: string,
  lsStr: string,
  dateStr: string,
  statusText: string,
  isActive: boolean,
) {
  const { width } = page.getSize()
  const text = `${maTl} (${lsStr}-${dateStr})`
  const fontSize = 7.5
  const boxSize = 7

  page.drawText(text, {
    x: 28, y: 16,
    size: fontSize, font, color: rgb(0.45, 0.5, 0.55),
  })

  const textWidth = font.widthOfTextAtSize(text, fontSize)
  const boxX = 28 + textWidth + 5
  page.drawRectangle({
    x: boxX, y: 14,
    width: boxSize, height: boxSize,
    color: isActive ? rgb(0.1, 0.72, 0.36) : rgb(0.85, 0.2, 0.2),
  })

  page.drawText(` ${statusText}`, {
    x: boxX + boxSize + 2, y: 16,
    size: fontSize, font, color: rgb(0.45, 0.5, 0.55),
  })

  page.drawLine({
    start: { x: 28, y: 26 },
    end: { x: width - 28, y: 26 },
    thickness: 0.4, color: rgb(0.75, 0.8, 0.85),
  })
}

// Header stamp (QR + info box) on each page of original doc
async function stampHeader(
  page: ReturnType<PDFDocument["getPages"]>[number],
  pdfDoc: PDFDocument,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  fontBold: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  qrBuffer: Buffer,
  maTl: string,
  lsStr: string,
  dateStr: string,
  statusText: string,
  isCha: boolean,
  isActive: boolean,
) {
  const { width, height } = page.getSize()
  const qrImage = await pdfDoc.embedPng(qrBuffer)

  // QR top-right corner
  page.drawImage(qrImage, {
    x: width - 65,
    y: height - 65,
    width: 48,
    height: 48,
  })

  // Info box (only for Cha docs — not for Con)
  if (isCha) {
    const infoX = width - 65 - 130
    const infoLines = [
      `${maTl}`,
      `LS: ${lsStr}`,
      `${dateStr || "---"}`,
      statusText,
    ]
    infoLines.forEach((line, i) => {
      const isStatus = i === 3
      page.drawText(line, {
        x: infoX,
        y: height - 18 - i * 11,
        size: 7,
        font: isStatus ? fontBold : font,
        color: isStatus
          ? isActive ? rgb(0.1, 0.72, 0.36) : rgb(0.85, 0.2, 0.2)
          : rgb(0.3, 0.3, 0.3),
      })
    })
  }
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

    if (!token || !docId || !docType) {
      return NextResponse.json({ error: "Thiếu tham số" }, { status: 400 })
    }

    // Xác thực JWT
    let payload: { userId: string; docId: string; docType: string }
    try {
      const { payload: p } = await jwtVerify(token, JWT_SECRET)
      payload = p as typeof payload
    } catch {
      return NextResponse.json({ error: "Token không hợp lệ hoặc đã hết hạn" }, { status: 401 })
    }

    const { userId } = payload

    // Lấy factory_id
    const { data: profileData } = await supabaseAdmin
      .from("profiles")
      .select("factory_id")
      .eq("id", userId)
      .single()
    const factoryId = profileData?.factory_id ?? ""
    if (!factoryId) return NextResponse.json({ error: "Không xác định được nhà máy" }, { status: 400 })

    // Lấy tài liệu ISO
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
    const lanSuaDoi = (doc.lan_ban_hanh as number) ?? 0
    const lsStr = String(lanSuaDoi).padStart(2, "0")
    const trangThai = doc.trang_thai as string
    const isActive = trangThai === "co_hieu_luc"
    const statusText = isActive ? "Có hiệu lực" : trangThai === "het_hieu_luc" ? "Hết hiệu lực" : "Chờ phê duyệt"

    const effectiveDate = (doc.ngay_hieu_luc as string) || (doc.ky_phe_duyet_at as string) || (doc.updated_at as string)
    const dateStr = fmtDate(effectiveDate)

    // Con/Cha detection
    const loaiTaiLieu = doc.loai_tai_lieu as string | null
    const phanLoaiTl = doc.phan_loai_tl as string | null
    const isCon = isConDoc(loaiTaiLieu, phanLoaiTl)

    // ─── Signature persistence: save current user's placement ───────────────
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

    // Reload doc placements after save so we have all accumulated placements
    const { data: docPlacements, error: placementLoadErr } = await supabaseAdmin
      .from("iso_documents")
      .select("soan_thao_placement, xem_xet_placement, phe_duyet_placement, soan_thao_user_id, xem_xet_user_id, phe_duyet_user_id")
      .eq("id", docId)
      .single()
    if (placementLoadErr) {
      console.warn("[generate-pdf] placement load error (migration 20260524 chưa chạy?):", placementLoadErr.message)
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

    // Lấy tên công ty
    const { data: factoryData } = await supabaseAdmin
      .from("factories")
      .select("name")
      .eq("id", factoryId)
      .single()
    const companyName = (factoryData?.name as string) || ""

    // Lấy profile 3 người ký
    const [pSoan, pXem, pPheDuyet] = await Promise.all([
      getProfile(doc.soan_thao_user_id as string | null),
      getProfile(doc.xem_xet_user_id as string | null),
      getProfile(doc.phe_duyet_user_id as string | null),
    ])

    // Lấy ảnh chữ ký cho phiếu ký duyệt (chỉ người đã ký chính thức)
    const [sigSoan, sigXem, sigPhe] = await Promise.all([
      doc.ky_soan_thao_at && doc.soan_thao_user_id
        ? getSigImage(factoryId, doc.soan_thao_user_id as string)
        : Promise.resolve(null),
      doc.ky_xem_xet_at && doc.xem_xet_user_id
        ? getSigImage(factoryId, doc.xem_xet_user_id as string)
        : Promise.resolve(null),
      doc.ky_phe_duyet_at && doc.phe_duyet_user_id
        ? getSigImage(factoryId, doc.phe_duyet_user_id as string)
        : Promise.resolve(null),
    ])

    // Tạo QR code PNG
    const qrUrl = `${APP_URL}/dashboard/iso/documents/${docId}`
    const qrBuffer = await QRCode.toBuffer(qrUrl, { width: 120, margin: 1 })

    // ─── Load và stamp file gốc ───
    const viFont = loadViFont()
    const sigImgNullFor: string[] = []
    const sigEmbedErrors: Array<{ userId: string; error: string }> = []
    let originalPages: PDFDocument | null = null
    let metaResult: { filled: string[]; notFound: string[]; mismatched: MetaMismatch[] } = { filled: [], notFound: [], mismatched: [] }
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

          // Only PDFDocument.load failure resets originalPages — remaining steps run independently
          try {
            originalPages = await PDFDocument.load(pdfBytes)
          } catch (loadErr) {
            console.warn("[generate-pdf] PDFDocument.load failed:", loadErr instanceof Error ? loadErr.message : loadErr)
            originalPages = null
          }

          if (originalPages) {
            const origFont = await originalPages.embedFont(StandardFonts.Helvetica)
            const origFontBold = await originalPages.embedFont(StandardFonts.HelveticaBold)

            // Embed Vietnamese font for stamps if available; fall back to Helvetica
            let stampFont = origFont as PDFFont
            let stampFontBold = origFontBold as PDFFont
            if (viFont) {
              try {
                originalPages.registerFontkit(fontkit)
                const origViFont = await originalPages.embedFont(viFont)
                stampFont = origViFont
                stampFontBold = origViFont
              } catch { /* fall back to Helvetica */ }
            }

            // Fill metadata placeholders — pass already-embedded font so no double-embed
            metaResult = await fillMetadataPlaceholders(originalPages, pdfBytes, doc, stampFont, null, skipTagLabels ?? [])

            // Stamp header/footer on all pages — each page guarded independently
            for (const page of originalPages.getPages()) {
              try { await stampFooter(page, stampFont, maTl, lsStr, dateStr, statusText, isActive) } catch { }
              try { await stampHeader(page, originalPages, stampFont, stampFontBold, qrBuffer, maTl, lsStr, dateStr, statusText, !isCon, isActive) } catch { }
            }

            // Embed ALL accumulated body signatures — each guarded independently
            for (const { signerUserId, placement } of allPlacements) {
              if (!signerUserId || !placement) continue
              const pageIdx = placement.page - 1
              if (pageIdx < 0 || pageIdx >= originalPages.getPageCount()) continue
              const sigImg = await getSigImage(factoryId, signerUserId)
              if (!sigImg) {
                sigImgNullFor.push(signerUserId)
                continue
              }
              try {
                const embedded = await originalPages.embedPng(sigImg)
                  .catch(() => originalPages!.embedJpg(sigImg!))
                originalPages.getPage(pageIdx).drawImage(embedded, {
                  x: placement.x,
                  y: placement.y,
                  width: placement.width,
                  height: placement.height,
                  opacity: 0.92,
                })
              } catch (e) {
                sigEmbedErrors.push({ userId: signerUserId, error: e instanceof Error ? e.message : String(e) })
              }
            }
          }
        }
      }
    }

    // ─── Build final PDF ───
    const finalDoc = await PDFDocument.create()

    if (!isCon) {
      // ── Cha: build phiếu ký duyệt ──
      const phieuDoc = await PDFDocument.create()
      const phieuPage = phieuDoc.addPage([595, 842])

      // Embed Vietnamese font (NotoSans) if available for person names + Vietnamese labels
      let phieuFont: PDFFont
      let phieuFontBold: PDFFont
      if (viFont) {
        try {
          phieuDoc.registerFontkit(fontkit)
          const embeddedVi = await phieuDoc.embedFont(viFont)
          phieuFont = embeddedVi
          phieuFontBold = embeddedVi
        } catch {
          phieuFont = await phieuDoc.embedFont(StandardFonts.Helvetica)
          phieuFontBold = await phieuDoc.embedFont(StandardFonts.HelveticaBold)
        }
      } else {
        phieuFont = await phieuDoc.embedFont(StandardFonts.Helvetica)
        phieuFontBold = await phieuDoc.embedFont(StandardFonts.HelveticaBold)
      }

      const { height: pH } = phieuPage.getSize()
      const margin = 40
      const colW = (595 - margin * 2) / 3

      // Header: tên công ty + info box
      phieuPage.drawText(companyName.toUpperCase(), {
        x: margin, y: pH - 50,
        size: 9, font: phieuFontBold, color: rgb(0, 0, 0),
      })

      const infoX = 595 - margin - 180
      const infoStartY = pH - 38
      const infoLines = [
        `Mã tài liệu: ${maTl}`,
        `Ngày hiệu lực: ${dateStr || "---"}`,
        `Tình trạng: ${statusText}`,
        `Lần sửa đổi: ${lsStr}`,
      ]
      infoLines.forEach((line, i) => {
        phieuPage.drawText(line, {
          x: infoX, y: infoStartY - i * 13,
          size: 8, font: phieuFont, color: rgb(0.2, 0.2, 0.2),
        })
      })

      // QR code top-right on phiếu
      const qrImage = await phieuDoc.embedPng(qrBuffer)
      phieuPage.drawImage(qrImage, {
        x: 595 - margin - 50, y: pH - 90,
        width: 48, height: 48,
      })

      // Tiêu đề
      const titleY = pH - 120
      const titleText = "PHIẾU XÁC NHẬN KÝ DUYỆT"
      const titleWidth = phieuFontBold.widthOfTextAtSize(titleText, 13)
      phieuPage.drawText(titleText, {
        x: (595 - titleWidth) / 2, y: titleY,
        size: 13, font: phieuFontBold, color: rgb(0, 0, 0),
      })

      phieuPage.drawLine({
        start: { x: margin, y: titleY - 6 },
        end: { x: 595 - margin, y: titleY - 6 },
        thickness: 0.8, color: rgb(0.6, 0.6, 0.6),
      })

      const colHeaders = ["Soạn thảo", "Xem xét", "Phê duyệt"]
      const colStartY = titleY - 22
      colHeaders.forEach((label, i) => {
        const cx = margin + i * colW + colW / 2
        const lw = phieuFontBold.widthOfTextAtSize(label, 9)
        phieuPage.drawText(label, {
          x: cx - lw / 2, y: colStartY,
          size: 9, font: phieuFontBold, color: rgb(0.2, 0.25, 0.35),
        })
      })

      phieuPage.drawLine({
        start: { x: margin, y: colStartY - 4 },
        end: { x: 595 - margin, y: colStartY - 4 },
        thickness: 0.5, color: rgb(0.8, 0.8, 0.8),
      })

      for (let i = 1; i < 3; i++) {
        phieuPage.drawLine({
          start: { x: margin + i * colW, y: colStartY - 4 },
          end: { x: margin + i * colW, y: colStartY - 4 - 145 },
          thickness: 0.4, color: rgb(0.85, 0.85, 0.85),
        })
      }

      const sigAreaY = colStartY - 16
      const sigAreaH = 65
      const sigData = [
        { sig: sigSoan, profile: pSoan, at: doc.ky_soan_thao_at as string | null },
        { sig: sigXem, profile: pXem, at: doc.ky_xem_xet_at as string | null },
        { sig: sigPhe, profile: pPheDuyet, at: doc.ky_phe_duyet_at as string | null },
      ]

      for (let i = 0; i < 3; i++) {
        const { sig, profile, at } = sigData[i]
        const cx = margin + i * colW
        const sigW = colW * 0.7
        const sigX = cx + (colW - sigW) / 2

        if (sig) {
          try {
            const sigImg = await phieuDoc.embedPng(sig).catch(() => phieuDoc.embedJpg(sig!))
            phieuPage.drawImage(sigImg, {
              x: sigX, y: sigAreaY - sigAreaH + 8,
              width: sigW, height: sigAreaH - 8,
              opacity: 0.92,
            })
          } catch { /* skip */ }
        }

        const name = (profile?.full_name || profile?.username || "—")
        const nw = phieuFont.widthOfTextAtSize(name, 8.5)
        phieuPage.drawText(name, {
          x: cx + (colW - nw) / 2, y: sigAreaY - sigAreaH - 4,
          size: 8.5, font: phieuFontBold, color: rgb(0.15, 0.15, 0.15),
        })

        const role = profile?.role || ""
        if (role) {
          const rw = phieuFont.widthOfTextAtSize(role, 7.5)
          phieuPage.drawText(role, {
            x: cx + (colW - rw) / 2, y: sigAreaY - sigAreaH - 16,
            size: 7.5, font: phieuFont, color: rgb(0.4, 0.4, 0.4),
          })
        }

        const dateSigned = at ? fmtDate(at) : ""
        if (dateSigned) {
          const dw = phieuFont.widthOfTextAtSize(dateSigned, 7.5)
          phieuPage.drawText(dateSigned, {
            x: cx + (colW - dw) / 2, y: sigAreaY - sigAreaH - (role ? 28 : 16),
            size: 7.5, font: phieuFont, color: rgb(0.35, 0.35, 0.35),
          })
        }
      }

      await stampFooter(phieuPage, phieuFont, maTl, lsStr, dateStr, statusText, isActive)

      // Merge: phiếu ký + trang gốc
      const phieuPages = await finalDoc.copyPages(phieuDoc, phieuDoc.getPageIndices())
      phieuPages.forEach((p) => finalDoc.addPage(p))
    }

    // Append original pages (with stamps + signatures)
    if (originalPages) {
      const origCopied = await finalDoc.copyPages(originalPages, originalPages.getPageIndices())
      origCopied.forEach((p) => finalDoc.addPage(p))
    }

    // If no pages at all (Con with no file_goc), create placeholder
    if (finalDoc.getPageCount() === 0) {
      const blankPage = finalDoc.addPage([595, 842])
      const font = await finalDoc.embedFont(StandardFonts.Helvetica)
      blankPage.drawText("Khong co file tai lieu", {
        x: 200, y: 400, size: 14, font, color: rgb(0.5, 0.5, 0.5),
      })
    }

    const signedPdfBytes = await finalDoc.save()

    // Upload
    const outputPath = `${factoryId}/iso/signed/${docId}_signed.pdf`
    const { error: uploadErr } = await supabaseAdmin.storage
      .from("iso-documents")
      .upload(outputPath, signedPdfBytes, { contentType: "application/pdf", upsert: true })

    if (uploadErr) {
      return NextResponse.json({ error: uploadErr.message }, { status: 500 })
    }

    const { data: urlData } = supabaseAdmin.storage
      .from("iso-documents")
      .getPublicUrl(outputPath)

    // Ghi log
    await supabaseAdmin.from("doc_approval_log").insert({
      factory_id: factoryId,
      doc_id: docId,
      doc_type: docType,
      user_id: userId,
      action: "generate_pdf",
      ip_address: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "",
      user_agent: req.headers.get("user-agent") || "",
    })

    const bodySignaturesEmbedded = allPlacements.filter((p) => p.signerUserId && p.placement).length
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
        allPlacementsRaw: allPlacements.map((p) => ({
          userId: p.signerUserId,
          hasPlacement: !!p.placement,
        })),
        sigImgLoadFailed: sigImgNullFor,
        sigEmbedErrors,
      },
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi server" },
      { status: 500 },
    )
  }
}
