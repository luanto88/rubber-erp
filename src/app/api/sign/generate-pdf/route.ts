import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { PDFDocument, rgb, StandardFonts } from "pdf-lib"
import { jwtVerify } from "jose"
import QRCode from "qrcode"

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
          ? statusText === "Co hieu luc" ? rgb(0.1, 0.72, 0.36) : rgb(0.85, 0.2, 0.2)
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
    }: {
      token: string
      docId: string
      docType: string
      signaturePlacement?: SignPlacement
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
    const statusText = isActive ? "Co hieu luc" : trangThai === "het_hieu_luc" ? "Het hieu luc" : "Cho phe duyet"

    const effectiveDate = (doc.ngay_hieu_luc as string) || (doc.ky_phe_duyet_at as string) || (doc.updated_at as string)
    const dateStr = fmtDate(effectiveDate)

    // Con/Cha detection
    const loaiTaiLieu = doc.loai_tai_lieu as string | null
    const phanLoaiTl = doc.phan_loai_tl as string | null
    const isCon = isConDoc(loaiTaiLieu, phanLoaiTl)

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

    // Lấy ảnh chữ ký (chỉ người đã ký)
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

    // Lấy ảnh chữ ký của người đang thực hiện (cho signaturePlacement)
    const currentUserSig = await getSigImage(factoryId, userId)

    // Tạo QR code PNG
    const qrUrl = `${APP_URL}/dashboard/iso/documents/${docId}`
    const qrBuffer = await QRCode.toBuffer(qrUrl, { width: 120, margin: 1 })

    // ─── Load và stamp file gốc ───
    let originalPages: PDFDocument | null = null
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
          try {
            originalPages = await PDFDocument.load(pdfBytes)
            const origFont = await originalPages.embedFont(StandardFonts.Helvetica)
            const origFontBold = await originalPages.embedFont(StandardFonts.HelveticaBold)

            for (const page of originalPages.getPages()) {
              // Stamp footer on all pages
              await stampFooter(page, origFont, maTl, lsStr, dateStr, statusText, isActive)
              // Stamp header (QR + info box for Cha; QR-only for Con)
              await stampHeader(page, originalPages, origFont, origFontBold, qrBuffer, maTl, lsStr, dateStr, statusText, !isCon)
            }

            // Embed current user's signature at the placement position (if provided)
            if (signaturePlacement && currentUserSig) {
              const targetPage = originalPages.getPage(signaturePlacement.page - 1)
              if (targetPage) {
                try {
                  const sigImg = await originalPages.embedPng(currentUserSig)
                    .catch(() => originalPages!.embedJpg(currentUserSig!))
                  targetPage.drawImage(sigImg, {
                    x: signaturePlacement.x,
                    y: signaturePlacement.y,
                    width: signaturePlacement.width,
                    height: signaturePlacement.height,
                    opacity: 0.92,
                  })
                } catch { /* skip if image fails */ }
              }
            }
          } catch { originalPages = null }
        }
      }
    }

    // ─── Build final PDF ───
    const finalDoc = await PDFDocument.create()

    if (!isCon) {
      // ── Cha: build phiếu ký duyệt ──
      const phieuDoc = await PDFDocument.create()
      const phieuPage = phieuDoc.addPage([595, 842])
      const font = await phieuDoc.embedFont(StandardFonts.Helvetica)
      const fontBold = await phieuDoc.embedFont(StandardFonts.HelveticaBold)

      const { height: pH } = phieuPage.getSize()
      const margin = 40
      const colW = (595 - margin * 2) / 3

      // Header: tên công ty + info box
      phieuPage.drawText(companyName.toUpperCase(), {
        x: margin, y: pH - 50,
        size: 9, font: fontBold, color: rgb(0, 0, 0),
      })

      const infoX = 595 - margin - 180
      const infoStartY = pH - 38
      const infoLines = [
        `Ma tai lieu: ${maTl}`,
        `Ngay hieu luc: ${dateStr || "---"}`,
        `Tinh trang: ${statusText}`,
        `Lan sua doi: ${lsStr}`,
      ]
      infoLines.forEach((line, i) => {
        phieuPage.drawText(line, {
          x: infoX, y: infoStartY - i * 13,
          size: 8, font, color: rgb(0.2, 0.2, 0.2),
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
      const titleText = "PHIEU XAC NHAN KY DUYET"
      const titleWidth = fontBold.widthOfTextAtSize(titleText, 13)
      phieuPage.drawText(titleText, {
        x: (595 - titleWidth) / 2, y: titleY,
        size: 13, font: fontBold, color: rgb(0, 0, 0),
      })

      phieuPage.drawLine({
        start: { x: margin, y: titleY - 6 },
        end: { x: 595 - margin, y: titleY - 6 },
        thickness: 0.8, color: rgb(0.6, 0.6, 0.6),
      })

      const colHeaders = ["Soan thao", "Xem xet", "Phe duyet"]
      const colStartY = titleY - 22
      colHeaders.forEach((label, i) => {
        const cx = margin + i * colW + colW / 2
        const lw = fontBold.widthOfTextAtSize(label, 9)
        phieuPage.drawText(label, {
          x: cx - lw / 2, y: colStartY,
          size: 9, font: fontBold, color: rgb(0.2, 0.25, 0.35),
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
        const nw = font.widthOfTextAtSize(name, 8.5)
        phieuPage.drawText(name, {
          x: cx + (colW - nw) / 2, y: sigAreaY - sigAreaH - 4,
          size: 8.5, font: fontBold, color: rgb(0.15, 0.15, 0.15),
        })

        const role = profile?.role || ""
        if (role) {
          const rw = font.widthOfTextAtSize(role, 7.5)
          phieuPage.drawText(role, {
            x: cx + (colW - rw) / 2, y: sigAreaY - sigAreaH - 16,
            size: 7.5, font, color: rgb(0.4, 0.4, 0.4),
          })
        }

        const dateSigned = at ? fmtDate(at) : ""
        if (dateSigned) {
          const dw = font.widthOfTextAtSize(dateSigned, 7.5)
          phieuPage.drawText(dateSigned, {
            x: cx + (colW - dw) / 2, y: sigAreaY - sigAreaH - (role ? 28 : 16),
            size: 7.5, font, color: rgb(0.35, 0.35, 0.35),
          })
        }
      }

      await stampFooter(phieuPage, font, maTl, lsStr, dateStr, statusText, isActive)

      // Merge: phiếu ký + trang gốc
      const phieuPages = await finalDoc.copyPages(phieuDoc, phieuDoc.getPageIndices())
      phieuPages.forEach((p) => finalDoc.addPage(p))
    }

    // Append original pages (with stamps)
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

    return NextResponse.json({ ok: true, signedPdfUrl: urlData.publicUrl, storagePath: outputPath })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi server" },
      { status: 500 },
    )
  }
}
