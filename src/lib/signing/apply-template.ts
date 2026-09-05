import { PDFDocument, PDFFont, PDFPage, rgb } from "pdf-lib"
import fontkit from "@pdf-lib/fontkit"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import type { ChucVuKey, SignTemplateBox } from "@/lib/signing/templates"
import type { NameStyle } from "@/lib/signing/stamp-pdf"
import {
  loadSignerNameFont,
  drawSignatureImage,
  drawSignerName,
  drawTextFit,
  drawTextWrapped,
  VAN_BAN_SIGNER_NAME_STYLE,
} from "@/lib/signing/stamp-pdf"
import {
  resolveAnchorPages,
  resolveEffectiveNoteLayout,
  resolveEffectiveQrRect,
  resolveEffectiveSubLayout,
  type TemplateAnchorBox,
  type TemplateBoxesPlacement,
  type TemplateNoteBox,
  type TemplateNotePlacement,
  type TemplateQrPlacement,
  type TemplateSignBox,
  type TemplateStepPlacement,
} from "@/lib/signing/template-layout"

// Áp mẫu vị trí ký (`mau_vi_tri`) vào file PDF thật — chế độ "vị trí CỨNG": người soạn thảo vẽ
// khung 1 lần ở /dashboard/ky/mau-vi-tri, hệ thống chốt (snapshot) mẫu vào
// `van_ban_documents.placement_ky` ngay tại hành động `gui_ky`, và mọi lượt ký sau đó chỉ cần
// PIN — không còn canvas kéo-thả.
//
// Hệ toạ độ: `mau_vi_tri.khung[].x_pt/y_pt/w_pt/h_pt` đã là **point, gốc dưới-trái** (xem
// buildKhungPayload trong mau-vi-tri/page.tsx) — TRÙNG KHỚP hệ của pdf-lib, nên ở đây không có
// bất kỳ phép quy đổi toạ độ nào. Không dùng `coords.ts` (file đó dành cho jsPDF mm/top-left).
//
// PHẠM VI: chỉ dùng cho văn bản gửi ký MỚI (có cờ `tu_mau`). Văn bản đang dở dang từ trước
// không có cờ này → route ký tự rơi về `stampPdfStep` cũ, không đổi 1 pixel nào.

// ── Shape dữ liệu lưu trong placement_ky (JSONB) ─────────────────────────────
//
// Các type/hàm thuần (không phụ thuộc pdf-lib) đã tách sang `template-layout.ts` để UI người ký
// dùng chung cùng một công thức vị trí; ở đây chỉ re-export cho các nơi đang import sẵn.

export type {
  TemplateAnchorBox,
  TemplateSignBox,
  TemplateStepPlacement,
  TemplateBoxesPlacement,
  TemplateNoteBox,
  TemplateNotePlacement,
  TemplateQrBox,
  TemplateQrPlacement,
  SignerSubLayout,
  NoteSubLayout,
  LayoutRect,
} from "@/lib/signing/template-layout"

export { resolveAnchorPages } from "@/lib/signing/template-layout"

/** Metadata đánh dấu văn bản đã khoá vị trí theo mẫu — key "_mau". */
export type TemplateMauMeta = {
  tu_mau: true
  loai_tai_lieu: string
  phien_ban: number
  chot_luc: string
}

export const MAU_META_KEY = "_mau"

// ── Chuyển mẫu → placement_ky ─────────────────────────────────────────────────

/**
 * `ky_buoc` -> 1, `ky_buoc__ban2` -> 2. Mirror `roleCloneIndex()` của mau-vi-tri/page.tsx —
 * dùng để SẮP THỨ TỰ ổn định, KHÔNG dùng thẳng làm số bước (id có thể không liên tục khi người
 * dùng xoá bớt bản nhân bản, vd: ky_buoc, __ban2, __ban4).
 */
function cloneIndexOf(vaiTro: string): number {
  const m = /__ban(\d+)$/.exec(vaiTro)
  return m ? parseInt(m[1], 10) : 1
}

function toAnchorBox(box: SignTemplateBox): TemplateAnchorBox {
  return {
    neo_trang: box.neo_trang,
    so_trang: box.so_trang,
    x: box.x_pt,
    y: box.y_pt,
    width: box.w_pt,
    height: box.h_pt,
  }
}

function toSignBox(box: SignTemplateBox): TemplateSignBox {
  const showName = box.show_name ?? true
  return {
    ...toAnchorBox(box),
    show_name: showName,
    // Mẫu lưu trước khi tách 2 công tắc chỉ có `show_name` → suy ra show_chuc_vu = show_name,
    // giữ đúng ý nghĩa "bật là bật cả hai" của mẫu cũ.
    show_chuc_vu: box.show_chuc_vu ?? showName,
    chuc_vu_key: box.chuc_vu_key ?? null,
  }
}

/**
 * Chốt mẫu vị trí thành `placement_ky`. Trả `null` khi mẫu không có khung ký nào dùng được —
 * caller giữ nguyên hành vi cũ (`placement_ky = {}`, người ký tự kéo-thả).
 */
export function buildPlacementKyFromTemplate(params: {
  khung: SignTemplateBox[]
  loaiTaiLieu: string
  phienBan: number
  soBuocTong: number
}): Record<string, unknown> | null {
  const byBase = new Map<string, SignTemplateBox[]>()
  for (const box of params.khung || []) {
    if (!box?.vai_tro) continue
    const base = box.clone_of || box.vai_tro
    const list = byBase.get(base) || []
    list.push(box)
    byBase.set(base, list)
  }
  for (const list of byBase.values()) {
    list.sort((a, b) => cloneIndexOf(a.vai_tro) - cloneIndexOf(b.vai_tro))
  }

  const result: Record<string, unknown> = {}
  let hasSignEntry = false

  // "Ký bước": mỗi bản nhân bản là 1 BƯỚC KÝ KHÁC NHAU (không phải nhiều vị trí của cùng 1
  // người) — ánh xạ theo index mảng đã sắp, mirror đúng docSignerByRoleId của màn vẽ mẫu.
  const kyBuoc = byBase.get("ky_buoc") || []
  for (let i = 0; i < kyBuoc.length && i < params.soBuocTong; i++) {
    const entry: TemplateStepPlacement = {
      tu_mau: true,
      sign_as: kyBuoc[i].sign_as ?? null,
      boxes: [toSignBox(kyBuoc[i])],
    }
    result[String(i + 1)] = entry
    hasSignEntry = true
  }

  // "Phê duyệt": ngược lại — bản gốc + mọi bản nhân bản là CÙNG 1 người ký ở nhiều vị trí.
  const pheDuyet = byBase.get("phe_duyet") || []
  if (pheDuyet.length > 0) {
    const entry: TemplateStepPlacement = {
      tu_mau: true,
      sign_as: pheDuyet[0].sign_as ?? null,
      boxes: pheDuyet.map(toSignBox),
    }
    result.phe_duyet = entry
    hasSignEntry = true
  }

  if (!hasSignEntry) return null

  for (const key of ["qr", "ngay_ky", "ghi_chu"] as const) {
    const boxes = byBase.get(key) || []
    if (boxes.length === 0) continue
    const entry: TemplateBoxesPlacement = { tu_mau: true, boxes: boxes.map(toAnchorBox) }
    result[key] = entry
  }

  const meta: TemplateMauMeta = {
    tu_mau: true,
    loai_tai_lieu: params.loaiTaiLieu,
    phien_ban: params.phienBan,
    chot_luc: new Date().toISOString(),
  }
  result[MAU_META_KEY] = meta
  return result
}

// ── Đọc lại từ placement_ky ───────────────────────────────────────────────────

function asTuMau<T>(value: unknown): T | null {
  if (!value || typeof value !== "object") return null
  return (value as { tu_mau?: boolean }).tu_mau === true ? (value as T) : null
}

/** Bước này đã bị khoá vị trí theo mẫu chưa (→ không nhận placement/sign_as từ client nữa). */
export function getTemplateStepPlacement(
  placementKy: Record<string, unknown> | null | undefined,
  stepKey: string,
): TemplateStepPlacement | null {
  const entry = asTuMau<TemplateStepPlacement>(placementKy?.[stepKey])
  return entry && Array.isArray(entry.boxes) && entry.boxes.length > 0 ? entry : null
}

export function getTemplateBoxesPlacement(
  placementKy: Record<string, unknown> | null | undefined,
  key: "qr" | "ngay_ky" | "ghi_chu",
): TemplateBoxesPlacement | null {
  const entry = asTuMau<TemplateBoxesPlacement>(placementKy?.[key])
  return entry && Array.isArray(entry.boxes) && entry.boxes.length > 0 ? entry : null
}

/**
 * Bản hẹp kiểu của `getTemplateBoxesPlacement` cho 2 khung có bố cục con riêng — khung Ghi chú
 * (ô text + chữ ký nháy) và khung QR (1 rect). Cùng đọc 1 chỗ trong JSONB, chỉ khác kiểu để
 * truy cập `box.layout` an toàn.
 */
export function getTemplateNotePlacement(
  placementKy: Record<string, unknown> | null | undefined,
): TemplateNotePlacement | null {
  const entry = asTuMau<TemplateNotePlacement>(placementKy?.["ghi_chu"])
  return entry && Array.isArray(entry.boxes) && entry.boxes.length > 0 ? entry : null
}

export function getTemplateQrPlacement(
  placementKy: Record<string, unknown> | null | undefined,
): TemplateQrPlacement | null {
  const entry = asTuMau<TemplateQrPlacement>(placementKy?.["qr"])
  return entry && Array.isArray(entry.boxes) && entry.boxes.length > 0 ? entry : null
}


// ── Chức vụ người ký ──────────────────────────────────────────────────────────

export type ChucVuByKey = Record<ChucVuKey, string>

const EMPTY_CHUC_VU: ChucVuByKey = { chinh_quyen: "", kiem_nhiem: "", doan_the: "" }

/**
 * Tra chức vụ thật của người ký — mirror đúng cách `api/documents/signer-info/route.ts` đang
 * làm (`maintenance_staff.chuc_vu_chinh_quyen || chuc_vu` qua `profile_id`).
 *
 * `kiem_nhiem`/`doan_the` trả rỗng: DB hiện CHƯA có 2 cột này (gap đã ghi trong CLAUDE.md, chưa
 * chốt cách migrate) — cố ý không tự suy diễn/bịa nguồn dữ liệu khác.
 */
export async function loadSignerChucVu(factoryId: string, userId: string): Promise<ChucVuByKey> {
  try {
    const { data } = await getSupabaseAdmin()
      .from("maintenance_staff")
      .select("chuc_vu, chuc_vu_chinh_quyen")
      .eq("factory_id", factoryId)
      .eq("profile_id", userId)
      .eq("active", true)
      .maybeSingle()
    const row = data as { chuc_vu: string | null; chuc_vu_chinh_quyen: string | null } | null
    return {
      ...EMPTY_CHUC_VU,
      chinh_quyen: row?.chuc_vu_chinh_quyen || row?.chuc_vu || "",
    }
  } catch {
    return { ...EMPTY_CHUC_VU }
  }
}

// ── Đóng dấu theo mẫu ─────────────────────────────────────────────────────────

/**
 * Style tên người ký cho chế độ mẫu — giống hệt `VAN_BAN_SIGNER_NAME_STYLE` trừ `minMaxWidth`.
 *
 * Bản gốc ép bề rộng tối đa của tên luôn ≥ 60pt (kể cả khi khung hẹp hơn), nên chữ có thể tràn
 * ra NGOÀI khung người ký vừa kéo — phá vỡ đúng cam kết "chỉ xê dịch bên trong vùng cho phép".
 * Ở chế độ mẫu, tên phải co đúng theo bề rộng khối đã kéo.
 */
const TEMPLATE_SIGNER_NAME_STYLE: NameStyle = { ...VAN_BAN_SIGNER_NAME_STYLE, minMaxWidth: 0 }

/**
 * Vẽ 3 khối con (ảnh chữ ký / tên / chức danh) trong 1 khung mẫu.
 *
 * Vị trí lấy từ `resolveEffectiveSubLayout()` — ưu tiên bố cục người ký đã tự xê dịch, ngược lại
 * dùng công thức chia dải mặc định (giữ nguyên giao diện của văn bản ký trước khi có tính năng
 * kéo-thả). Cả UI lẫn server dùng chung hàm này nên xem trước và bản đóng dấu không lệch nhau.
 */
async function drawSignBoxOnPage(
  pdfDoc: PDFDocument,
  page: PDFPage,
  box: TemplateSignBox,
  opts: {
    sigBuf: Buffer | null
    signerName: string
    chucVuByKey: ChucVuByKey
    prefixText: string | null
    font: PDFFont | null
  },
): Promise<void> {
  const chucVuText = box.show_chuc_vu ? opts.chucVuByKey[box.chuc_vu_key ?? "chinh_quyen"] || "" : ""
  const layout = resolveEffectiveSubLayout(box, {
    chucVuAvailable: !!chucVuText,
    // Người ký tắt tiền tố → route đã ghi sign_as = "none" → prefixText null → không có khối này.
    prefixAvailable: !!opts.prefixText,
  })

  if (opts.sigBuf) {
    await drawSignatureImage(pdfDoc, page, opts.sigBuf, layout.sig)
  }

  if (layout.name) {
    drawSignerName(
      page,
      opts.signerName,
      {
        x: layout.name.x,
        y: layout.name.y,
        width: layout.name.width,
        height: layout.name.height,
        nameX: layout.name.x,
        nameY: layout.name.y,
        nameWidth: layout.name.width,
        nameHeight: layout.name.height,
      },
      opts.font,
      TEMPLATE_SIGNER_NAME_STYLE,
    )
  }

  if (layout.chuc_vu) {
    drawTextFit(page, chucVuText, layout.chuc_vu, opts.font, { maxFontSize: 8.5, minFontSize: 6 })
  }

  // Tiền tố ký thay (KT./TM./TL./TUQ.) — từ 2026-09-05 là KHỐI CON THỨ 4, nằm TRONG khung và
  // người ký kéo/tắt được (trước đây vẽ cứng ngoài mép trên khung). Dùng drawTextFit (canh giữa
  // được) thay vì drawSignPrefix (canh trái, không nhận chiều rộng).
  if (opts.prefixText && layout.prefix) {
    drawTextFit(page, opts.prefixText, layout.prefix, opts.font, { maxFontSize: 10, minFontSize: 7 })
  }
}

// ── Khung "Ghi chú" — ý kiến chỉ đạo của lãnh đạo + chữ ký nháy ──────────────

/**
 * Vẽ ô ý kiến chỉ đạo: nội dung lãnh đạo gõ lúc phê duyệt (wrap nhiều dòng) + chữ ký nháy nhỏ.
 * Chữ ký nháy dùng lại chính ảnh `chu_ky.png` của người phê duyệt, thu nhỏ — không có mục upload
 * ảnh ký nháy riêng.
 *
 * Từ 2026-09-05 khung Ghi chú là "vùng cho phép" chứa 2 khối con kéo/resize được: ô text và chữ
 * ký nháy (mục đích: ý kiến dài không đè lên chữ sẵn có của văn bản). Vì 2 khối đã tách rời nên
 * `reserveTopHeight = 0`; bố cục MẶC ĐỊNH (chưa kéo) vẫn tự chừa dải trên như trước, do
 * `computeDefaultNoteLayout()` quy định.
 */
async function drawGhiChuBox(
  pdfDoc: PDFDocument,
  page: PDFPage,
  box: TemplateNoteBox,
  text: string,
  opts: { kyNhayBuf: Buffer | null; font: PDFFont | null },
): Promise<void> {
  const layout = resolveEffectiveNoteLayout(box, { kyNhayAvailable: !!opts.kyNhayBuf })
  if (opts.kyNhayBuf && layout.ky_nhay) {
    await drawSignatureImage(pdfDoc, page, opts.kyNhayBuf, layout.ky_nhay)
  }
  drawTextWrapped(page, text, layout.text, opts.font, { maxFontSize: 10, minFontSize: 6 })
}

// ── Khung "Ngày ký" — tick xanh + dòng chữ xám mờ ────────────────────────────

const TICK_COLOR = rgb(0.06, 0.6, 0.35)
const DATE_TEXT_COLOR = rgb(0.45, 0.45, 0.45)

/**
 * Vẽ dấu tick bằng 2 đoạn thẳng (`drawLine`) thay vì ký tự `✓` — font TimesNewRoman.ttf đang
 * dùng có thể thiếu glyph này (bài học ký tự Unicode ở `.claude/rules/14-maintenance-module.md`),
 * thiếu glyph sẽ ra ô vuông hoặc mất hẳn ký tự.
 */
function drawTick(page: PDFPage, x: number, y: number, size: number): void {
  const thickness = Math.max(1, size * 0.12)
  page.drawLine({
    start: { x: x + size * 0.16, y: y + size * 0.52 },
    end: { x: x + size * 0.42, y: y + size * 0.24 },
    thickness,
    color: TICK_COLOR,
  })
  page.drawLine({
    start: { x: x + size * 0.42, y: y + size * 0.24 },
    end: { x: x + size * 0.86, y: y + size * 0.78 },
    thickness,
    color: TICK_COLOR,
  })
}

/** "✓ Văn bản được ký dd/mm/yyyy hh:mm:ss" — tick xanh, chữ xám mờ, canh giữa khung. */
function drawNgayKyTag(
  page: PDFPage,
  box: TemplateAnchorBox,
  text: string,
  font: PDFFont | null,
): void {
  if (!font || !text) return
  try {
    const tickSize = Math.min(box.height * 0.8, 11)
    const gap = tickSize * 0.35
    const maxTextW = Math.max(box.width - tickSize - gap, 1)

    let fontSize = Math.min(9, box.height * 0.7)
    while (fontSize > 5 && font.widthOfTextAtSize(text, fontSize) > maxTextW) {
      fontSize -= 0.25
    }
    const textW = font.widthOfTextAtSize(text, fontSize)
    const groupW = tickSize + gap + textW
    const startX = box.x + Math.max(0, (box.width - groupW) / 2)
    const centerY = box.y + box.height / 2

    drawTick(page, startX, centerY - tickSize / 2, tickSize)
    page.drawText(text, {
      x: startX + tickSize + gap,
      y: centerY - fontSize * 0.36,
      size: fontSize,
      font,
      color: DATE_TEXT_COLOR,
    })
  } catch { /* bỏ qua nếu vẽ tag ngày ký thất bại */ }
}

export async function stampPdfWithTemplate(params: {
  fileBytes: Buffer
  entry: TemplateStepPlacement
  sigBuf: Buffer | null
  signerName: string
  chucVuByKey: ChucVuByKey
  prefixText: string | null
  qrBuf: Buffer | null
  qrEntry: TemplateQrPlacement | null
  /** Chỉ truyền ở đúng lượt đóng dấu cần vẽ — caller quyết định để tránh vẽ chồng nhiều lần. */
  ghiChu?: { entry: TemplateNotePlacement; text: string; kyNhayBuf: Buffer | null } | null
  ngayKy?: { entry: TemplateBoxesPlacement; text: string } | null
}): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(params.fileBytes)
  pdfDoc.registerFontkit(fontkit)

  let font: PDFFont | null = null
  try {
    const fontBytes = loadSignerNameFont()
    font = fontBytes ? await pdfDoc.embedFont(fontBytes) : null
  } catch {
    font = null
  }

  const pages = pdfDoc.getPages()
  const pageCount = pages.length

  for (const box of params.entry.boxes) {
    for (const pageNo of resolveAnchorPages(box, pageCount)) {
      await drawSignBoxOnPage(pdfDoc, pages[pageNo - 1], box, {
        sigBuf: params.sigBuf,
        signerName: params.signerName,
        chucVuByKey: params.chucVuByKey,
        prefixText: params.prefixText,
        font,
      })
    }
  }

  if (params.ghiChu?.text) {
    for (const box of params.ghiChu.entry.boxes) {
      for (const pageNo of resolveAnchorPages(box, pageCount)) {
        await drawGhiChuBox(pdfDoc, pages[pageNo - 1], box, params.ghiChu.text, {
          kyNhayBuf: params.ghiChu.kyNhayBuf,
          font,
        })
      }
    }
  }

  if (params.ngayKy?.text) {
    for (const box of params.ngayKy.entry.boxes) {
      for (const pageNo of resolveAnchorPages(box, pageCount)) {
        drawNgayKyTag(pages[pageNo - 1], box, params.ngayKy.text, font)
      }
    }
  }

  if (params.qrBuf) {
    try {
      const qrImage = await pdfDoc.embedPng(params.qrBuf)
      if (params.qrEntry) {
        // Người soạn thảo quy định KHUNG + neo trang của QR trong mẫu; người ký ĐẦU TIÊN được
        // xê dịch QR bên trong khung đó (`box.layout`), các lượt ký sau dùng lại đúng vị trí ấy.
        for (const box of params.qrEntry.boxes) {
          const rect = resolveEffectiveQrRect(box)
          for (const pageNo of resolveAnchorPages(box, pageCount)) {
            pages[pageNo - 1].drawImage(qrImage, rect)
          }
        }
      } else {
        // Mẫu không đặt khung QR → giữ fallback góc trên-phải mọi trang như luồng cũ, để không
        // im lặng làm mất QR tra cứu công khai của văn bản.
        for (const p of pages) {
          const { width, height } = p.getSize()
          const qrSize = 54
          const margin = 20
          p.drawImage(qrImage, {
            x: width - qrSize - margin,
            y: height - qrSize - margin,
            width: qrSize,
            height: qrSize,
          })
        }
      }
    } catch {
      /* lỗi nhúng QR không chặn cả lượt ký */
    }
  }

  return Buffer.from(await pdfDoc.save())
}
