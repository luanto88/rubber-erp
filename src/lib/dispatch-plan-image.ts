// Ảnh "Phiếu điều xe" bản KẾ HOẠCH (lập tối hôm trước, gửi tài xế/đội) — mô phỏng mẫu giấy
// cung_cap_dl/dieu_xe.jpg. Chỉ chạy ở trình duyệt: vẽ bằng Canvas 2D để trình duyệt tự shaping
// chữ Khmer ở dòng tiêu đề (jsPDF không làm được). KHÔNG dùng cho chứng từ ký (đó là "PDF ngày").

import { compareDoiNho, type DiemGN } from "@/lib/dispatch-master"

export type DispatchPlanTrip = {
  so_xe: string
  chuyen?: number
  tai_xe?: string
  diem_gn?: string[]
  phien?: string[]
  stops_detail?: Array<{ diem: string; phien: string[] }> | null
  lo_trinh?: string[]
  so_km?: number | string
  ghi_chu_tu_do?: string
}

export type DispatchPlanImageOptions = {
  /** Ngày ISO YYYY-MM-DD (hoặc dd/mm/yyyy). */
  ngay: string
  rows: DispatchPlanTrip[]
  points: DiemGN[]
  factoryName: string
  factoryNameKhmer?: string | null
}

const SCALE = 2
const FONT_VI = `"Times New Roman", Times, serif`
const FONT_KH = `"NotoSansKhmer", "Khmer OS", sans-serif`
const BAND = "#dbeef7"
const LINE = "#1f2937"

type SubRow = { doi: string; doiNho: string; phien: string; diem: string }
type TripBlock = {
  sub: SubRow[]
  loTrinh: string
  soXe: string
  taiXe: string
  km: string
  ghiChu: string
  ghiChuLines: string[]
  sortDoi: number
  sortDoiNho: string
  chuyen: number
}

let khmerFontPromise: Promise<void> | null = null
function ensureKhmerFont(): Promise<void> {
  if (khmerFontPromise) return khmerFontPromise
  khmerFontPromise = (async () => {
    try {
      if (typeof FontFace === "undefined" || !document.fonts) return
      const face = new FontFace("NotoSansKhmer", "url(/fonts/NotoSansKhmer-Regular.ttf)")
      await face.load()
      document.fonts.add(face)
    } catch {
      // Không tải được font Khmer → trình duyệt dùng font hệ thống (nếu có), không chặn xuất ảnh.
    }
  })()
  return khmerFontPromise
}

function formatTitleDate(ngay: string) {
  const iso = ngay.includes("/") ? ngay.split("/").reverse().join("-") : ngay
  const [y, m, d] = iso.split("-")
  return y && m && d ? `${d}.${m}.${y}` : ngay
}

function shortPhien(phien: string[]) {
  const letters = [...new Set(phien.map((p) => p.replace(/Phiên\s*/i, "").trim()).filter(Boolean))]
  return letters.join("-")
}

function buildBlocks(rows: DispatchPlanTrip[], points: DiemGN[]): TripBlock[] {
  const blocks: TripBlock[] = []
  for (const row of rows) {
    if (!row.so_xe) continue
    const diemGn = row.diem_gn || []
    // Nhóm điểm theo đội nhỏ (điểm chưa gán đội nhỏ thành nhóm riêng theo đội lớn).
    const groups = new Map<string, { doi: number; doiNho: string; diem: string[] }>()
    for (const code of diemGn) {
      const point = points.find((p) => p.ma_lo === code)
      const doiNho = point?.doi_nho || ""
      const doi = point?.doi || 0
      const key = doiNho ? `n:${doiNho}` : `d:${doi}:${code}`
      const g = groups.get(key) || { doi, doiNho, diem: [] }
      g.diem.push(code)
      groups.set(key, g)
    }
    const sorted = [...groups.values()].sort((a, b) => {
      if (a.doi !== b.doi) return a.doi - b.doi
      if (a.doiNho && b.doiNho) return compareDoiNho(a.doiNho, b.doiNho)
      return a.doiNho ? -1 : b.doiNho ? 1 : 0
    })
    const sub: SubRow[] = sorted.map((g) => {
      const phienList = row.stops_detail
        ? g.diem.flatMap((d) => row.stops_detail?.find((s) => s.diem === d)?.phien || [])
        : row.phien || []
      return {
        doi: g.doi ? String(g.doi) : "",
        doiNho: g.doiNho,
        phien: shortPhien(phienList),
        diem: g.diem.join("-"),
      }
    })
    if (sub.length === 0) sub.push({ doi: "", doiNho: "", phien: shortPhien(row.phien || []), diem: "" })

    const kmNum = Number(row.so_km) || 0
    const loTrinh = (row.lo_trinh && row.lo_trinh.length > 0 ? row.lo_trinh : diemGn).join("->")
    blocks.push({
      sub,
      loTrinh,
      soXe: row.so_xe,
      taiXe: row.tai_xe || "",
      km: kmNum > 0 ? (Math.round(kmNum * 10) / 10).toLocaleString("vi-VN") : "",
      ghiChu: row.ghi_chu_tu_do || "",
      ghiChuLines: [],
      sortDoi: sorted[0]?.doi || 999,
      sortDoiNho: sorted.find((g) => g.doiNho)?.doiNho || "",
      chuyen: Number(row.chuyen) || 1,
    })
  }
  blocks.sort((a, b) => {
    if (a.sortDoi !== b.sortDoi) return a.sortDoi - b.sortDoi
    if (a.sortDoiNho !== b.sortDoiNho) {
      if (!a.sortDoiNho) return 1
      if (!b.sortDoiNho) return -1
      return compareDoiNho(a.sortDoiNho, b.sortDoiNho)
    }
    const v = a.soXe.localeCompare(b.soXe, "vi", { numeric: true, sensitivity: "base" })
    if (v !== 0) return v
    return a.chuyen - b.chuyen
  })
  return blocks
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const clean = text.trim()
  if (!clean) return []
  const words = clean.split(/\s+/)
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate
    } else {
      lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines)
    let last = kept[maxLines - 1]
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1)
    kept[maxLines - 1] = `${last}…`
    return kept
  }
  return lines
}

export async function renderDispatchPlanImage(opts: DispatchPlanImageOptions): Promise<Blob> {
  if (typeof document === "undefined") throw new Error("Chỉ tạo được ảnh trên trình duyệt")
  await ensureKhmerFont()

  const blocks = buildBlocks(opts.rows, opts.points)
  const measureCanvas = document.createElement("canvas")
  const mctx = measureCanvas.getContext("2d")
  if (!mctx) throw new Error("Trình duyệt không hỗ trợ vẽ ảnh")

  const fontSize = 15
  const headerFont = `bold ${fontSize}px ${FONT_VI}`
  const bodyFont = `${fontSize}px ${FONT_VI}`
  const padX = 10
  const lineH = 26

  const headers = ["Đội lớn", "Đội nhỏ", "Phiên bốc", "Điểm", "Lộ trình", "Số xe", "Tên tài xế", "km", "Ghi chú"]
  const minW = [64, 64, 78, 90, 130, 64, 140, 50, 170]
  const widths = minW.slice()
  const fit = (col: number, text: string, bold = false) => {
    mctx.font = bold ? headerFont : bodyFont
    widths[col] = Math.max(widths[col], Math.ceil(mctx.measureText(text).width) + padX * 2)
  }
  headers.forEach((h, i) => fit(i, h, true))
  for (const b of blocks) {
    for (const s of b.sub) {
      fit(0, s.doi); fit(1, s.doiNho); fit(2, s.phien); fit(3, s.diem)
    }
    fit(4, b.loTrinh); fit(5, b.soXe); fit(6, b.taiXe); fit(7, b.km)
  }
  // Ghi chú: giới hạn bề ngang, xuống dòng tối đa 3 dòng.
  widths[8] = Math.min(Math.max(widths[8], 170), 260)
  widths[4] = Math.min(widths[4], 260)
  mctx.font = bodyFont
  for (const b of blocks) b.ghiChuLines = wrapText(mctx, b.ghiChu, widths[8] - padX * 2, 3)

  const tableW = widths.reduce((a, b) => a + b, 0)
  const margin = 20
  const titleBlockH = 78
  const headerRowH = 34

  const blockHeights = blocks.map((b) => Math.max(b.sub.length * lineH, b.ghiChuLines.length * (lineH - 6) + 8))
  const bodyH = blockHeights.reduce((a, b) => a + b, 0)
  const totalRowH = 32
  const canvasW = tableW + margin * 2
  const canvasH = margin + titleBlockH + headerRowH + bodyH + totalRowH + margin

  const canvas = document.createElement("canvas")
  canvas.width = Math.ceil(canvasW * SCALE)
  canvas.height = Math.ceil(canvasH * SCALE)
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Trình duyệt không hỗ trợ vẽ ảnh")
  ctx.scale(SCALE, SCALE)
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, canvasW, canvasH)
  ctx.textBaseline = "middle"

  // Tiêu đề 2 dòng góc trái
  ctx.fillStyle = "#000000"
  ctx.textAlign = "left"
  ctx.font = `17px ${FONT_VI}`
  ctx.fillText(opts.factoryName || "", margin, margin + 12)
  if (opts.factoryNameKhmer) {
    ctx.font = `bold 16px ${FONT_KH}`
    ctx.fillText(opts.factoryNameKhmer, margin, margin + 36)
  }
  // Giữa: "Điều xe dd.mm.yyyy"
  ctx.textAlign = "center"
  ctx.font = `bold 19px ${FONT_VI}`
  ctx.fillText(`Điều xe ${formatTitleDate(opts.ngay)}`, margin + tableW / 2, margin + titleBlockH - 14)

  const x0 = margin
  const colX: number[] = []
  let acc = x0
  for (const w of widths) { colX.push(acc); acc += w }
  let y = margin + titleBlockH

  ctx.strokeStyle = LINE
  ctx.lineWidth = 0.8

  const cellText = (text: string, col: number, top: number, h: number, bold = false) => {
    if (!text) return
    ctx.font = bold ? headerFont : bodyFont
    ctx.fillStyle = "#000000"
    ctx.textAlign = "center"
    ctx.fillText(text, colX[col] + widths[col] / 2, top + h / 2, widths[col] - 4)
  }

  // Hàng tiêu đề — không gộp ô
  for (let c = 0; c < widths.length; c++) {
    ctx.strokeRect(colX[c], y, widths[c], headerRowH)
    cellText(headers[c], c, y, headerRowH, true)
  }
  y += headerRowH

  blocks.forEach((b, bi) => {
    const h = blockHeights[bi]
    if (bi % 2 === 1) {
      ctx.fillStyle = BAND
      ctx.fillRect(x0, y, tableW, h)
    }
    const subH = h / b.sub.length
    b.sub.forEach((s, si) => {
      const top = y + si * subH
      for (let c = 0; c < 4; c++) ctx.strokeRect(colX[c], top, widths[c], subH)
      cellText(s.doi, 0, top, subH)
      cellText(s.doiNho, 1, top, subH)
      cellText(s.phien, 2, top, subH)
      cellText(s.diem, 3, top, subH)
    })
    // Ô gộp theo chuyến
    for (let c = 4; c < widths.length; c++) ctx.strokeRect(colX[c], y, widths[c], h)
    cellText(b.loTrinh, 4, y, h)
    cellText(b.soXe, 5, y, h)
    cellText(b.taiXe, 6, y, h)
    cellText(b.km, 7, y, h)
    if (b.ghiChuLines.length > 0) {
      ctx.font = bodyFont
      ctx.fillStyle = "#000000"
      ctx.textAlign = "center"
      const lh = lineH - 6
      const startY = y + h / 2 - ((b.ghiChuLines.length - 1) * lh) / 2
      b.ghiChuLines.forEach((line, li) => {
        ctx.fillText(line, colX[8] + widths[8] / 2, startY + li * lh, widths[8] - 4)
      })
    }
    y += h
  })

  // Dòng tổng
  const vehicleCount = new Set(blocks.map((b) => b.soXe)).size
  const totalSpan = widths.slice(0, 5).reduce((a, b) => a + b, 0)
  ctx.strokeRect(x0, y, totalSpan, totalRowH)
  for (let c = 5; c < widths.length; c++) ctx.strokeRect(colX[c], y, widths[c], totalRowH)
  ctx.font = headerFont
  ctx.fillStyle = "#000000"
  ctx.textAlign = "center"
  ctx.fillText(`Tổng: ${vehicleCount} xe`, x0 + totalSpan / 2, y + totalRowH / 2)

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Không tạo được ảnh PNG"))), "image/png")
  })
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** Chia sẻ qua Web Share API (điện thoại); không hỗ trợ thì tải PNG về máy. */
export async function shareDispatchPlanImage(blob: Blob, fileName: string): Promise<void> {
  const file = new File([blob], fileName, { type: "image/png" })
  if (typeof navigator !== "undefined" && navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName })
      return
    } catch (err) {
      if ((err as Error).name === "AbortError") return
    }
  }
  downloadBlob(blob, fileName)
}
