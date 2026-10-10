import * as XLSX from "xlsx"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

// Polyfill DOMMatrix cho Node.js runtime (Vercel Serverless Function thiếu Web API này)
if (typeof globalThis.DOMMatrix === "undefined") {
  class DOMMatrixPolyfill {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0
    m11 = 1; m12 = 0; m21 = 0; m22 = 1; m41 = 0; m42 = 0
    is2D = true; isIdentity = true
    constructor(init?: number[]) {
      if (Array.isArray(init) && init.length >= 6) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = init
        this.m11 = init[0]; this.m12 = init[1]; this.m21 = init[2]
        this.m22 = init[3]; this.m41 = init[4]; this.m42 = init[5]
      }
    }
    multiply(o: DOMMatrixPolyfill) {
      return new DOMMatrixPolyfill([
        this.a * o.a + this.c * o.b, this.b * o.a + this.d * o.b,
        this.a * o.c + this.c * o.d, this.b * o.c + this.d * o.d,
        this.a * o.e + this.c * o.f + this.e, this.b * o.e + this.d * o.f + this.f,
      ])
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).DOMMatrix = DOMMatrixPolyfill
}

export interface ParsedSlTruckRow {
  row_index: number
  ngay: string
  doi: number
  raw_xe: string
  base_xe: string
  chuyen: number
  chuyen_tu_ten: boolean
  ghi_chu: string
  mn_tuoi: number
  mn_drc: number
  mn_kho: number
  ct_tuoi: number
  ct_drc: number
  ct_kho: number
  dct_tuoi: number
  dct_drc: number
  dct_kho: number
  dkt_tuoi: number
  dkt_drc: number
  dkt_kho: number
  dt_tuoi: number
  dt_drc: number
  dt_kho: number
  tong_kho: number
}

export interface TeamSummary {
  doi: number
  ten_doi: string
  mn_kho: number
  ct_kho: number
  dct_kho: number
  dkt_kho: number
  dt_kho: number
  tong_kho: number
}

export interface ParsedOutputReport {
  success: boolean
  filename?: string
  detectedDate: string
  format: "detail_xlsx" | "summary_xlsx" | "flat_xlsx" | "pdf"
  rows: ParsedSlTruckRow[]
  teamSummaries?: TeamSummary[]
  companyTotalDry?: number
  thuMuaDry?: number
  error?: string
}

function parseDateFromText(text: string): string | null {
  if (!text) return null
  const m = String(text).match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/)
  if (!m) return null
  const [, d, mth, y] = m
  return `${y}-${mth.padStart(2, "0")}-${d.padStart(2, "0")}`
}

function toNum(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0
  const n = parseFloat(String(v).replace(/,/g, ""))
  return isNaN(n) ? 0 : Math.round(n * 100) / 100
}

export function parseVehicleCode(raw: string): { base_xe: string; chuyen: number; chuyen_tu_ten: boolean } {
  const s = String(raw || "").trim().toUpperCase().replace(/^0+(\d)/, "$1")
  const m = s.match(/^(\d+[A-Z]+)(\d)$/)
  if (!m) return { base_xe: s, chuyen: 1, chuyen_tu_ten: false }
  return { base_xe: m[1], chuyen: parseInt(m[2], 10), chuyen_tu_ten: true }
}

/** Bóc tách mẫu SLRpt_SanLuongNgay (chi tiết từng đội có danh sách xe) */
function parseDetailXlsx(rows: unknown[][]): { detectedDate: string; results: ParsedSlTruckRow[] } {
  let detectedDate = ""
  for (let i = 0; i < Math.min(25, rows.length); i++) {
    const rStr = (rows[i] || []).join(" ")
    const d = parseDateFromText(rStr)
    if (d) {
      detectedDate = d
      break
    }
  }

  const results: ParsedSlTruckRow[] = []
  let currentDoi: number | null = null
  let inData = false

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || []
    const rowStr = row.join(" | ")

    const doiMatch = rowStr.match(/PHIẾU BÁO CÁO SẢN LƯỢNG MỦ\s*-\s*ĐỘI\s*(\d+)/i)
    if (doiMatch) {
      currentDoi = parseInt(doiMatch[1], 10)
      inData = false
      continue
    }

    const c0 = String(row[0] || "").trim().toLowerCase()
    const c1 = String(row[1] || "").trim().toLowerCase()
    if (c0 === "stt" && c1.includes("xe")) {
      inData = true
      i++ // Bỏ qua dòng sub-header tiếp theo
      continue
    }

    if (inData && currentDoi !== null) {
      if (c0 === "tổng cộng" || c0.startsWith("tổng") || rowStr.includes("Lập bảng")) {
        inData = false
        continue
      }

      if (c0 && !isNaN(Number(c0)) && row[1]) {
        const rawXe = String(row[1]).trim()
        const { base_xe, chuyen, chuyen_tu_ten } = parseVehicleCode(rawXe)

        const mn_tuoi = toNum(row[3])
        const mn_drc = toNum(row[4])
        const mn_kho = toNum(row[5]) || (mn_tuoi > 0 && mn_drc > 0 ? Math.round((mn_tuoi * mn_drc) / 100 * 100) / 100 : 0)

        const ct_tuoi = toNum(row[7])
        const ct_drc = toNum(row[9])
        const ct_kho = toNum(row[11]) || (ct_tuoi > 0 && ct_drc > 0 ? Math.round((ct_tuoi * ct_drc) / 100 * 100) / 100 : 0)

        const dct_tuoi = toNum(row[14])
        const dct_drc = toNum(row[15])
        const dct_kho = toNum(row[16]) || (dct_tuoi > 0 && dct_drc > 0 ? Math.round((dct_tuoi * dct_drc) / 100 * 100) / 100 : 0)

        const dkt_tuoi = toNum(row[17])
        const dkt_drc = toNum(row[19])
        const dkt_kho = toNum(row[21]) || (dkt_tuoi > 0 && dkt_drc > 0 ? Math.round((dkt_tuoi * dkt_drc) / 100 * 100) / 100 : 0)

        const dt_tuoi = toNum(row[22])
        const dt_drc = toNum(row[24])
        const dt_kho = toNum(row[25]) || (dt_tuoi > 0 && dt_drc > 0 ? Math.round((dt_tuoi * dt_drc) / 100 * 100) / 100 : 0)

        const calcTotal = Math.round((mn_kho + ct_kho + dct_kho + dkt_kho + dt_kho) * 100) / 100

        results.push({
          row_index: i + 1,
          ngay: detectedDate,
          doi: currentDoi,
          raw_xe: rawXe,
          base_xe,
          chuyen,
          chuyen_tu_ten,
          ghi_chu: "",
          mn_tuoi, mn_drc, mn_kho,
          ct_tuoi, ct_drc, ct_kho,
          dct_tuoi, dct_drc, dct_kho,
          dkt_tuoi, dkt_drc, dkt_kho,
          dt_tuoi, dt_drc, dt_kho,
          tong_kho: toNum(row[27]) || calcTotal,
        })
      }
    }
  }

  return { detectedDate, results }
}

/** Bóc tách mẫu SLRpt_SLToanCongTy (Tổng hợp 12 đội) */
function parseSummaryXlsx(rows: unknown[][]): {
  detectedDate: string
  teamSummaries: TeamSummary[]
  companyTotalDry: number
  thuMuaDry: number
} {
  let detectedDate = ""
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const rStr = (rows[i] || []).join(" ")
    const m = rStr.match(/ngày\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/i)
    if (m) {
      detectedDate = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`
      break
    }
  }

  const teamSummaries: TeamSummary[] = []
  let companyTotalDry = 0
  let thuMuaDry = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || []
    const c0 = String(row[0] || "").trim().toLowerCase()
    const c1 = String(row[1] || "").trim()

    if (c0 && !isNaN(Number(c0)) && c1.toLowerCase().includes("đội")) {
      const doi = parseInt(c0, 10)
      const mn_kho = toNum(row[4])
      const ct_kho = toNum(row[9])
      const dct_kho = toNum(row[15])
      const dkt_kho = toNum(row[18])
      const dt_kho = toNum(row[23])
      const tong_kho = toNum(row[25]) || Math.round((mn_kho + ct_kho + dct_kho + dkt_kho + dt_kho) * 100) / 100

      teamSummaries.push({
        doi,
        ten_doi: c1,
        mn_kho, ct_kho, dct_kho, dkt_kho, dt_kho, tong_kho,
      })
    } else if (c0.includes("thu mua") || c1.toLowerCase().includes("thu mua")) {
      thuMuaDry = toNum(row[25]) || toNum(row[30])
    } else if (c0.includes("tổng cộng")) {
      companyTotalDry = toNum(row[25])
    }
  }

  return { detectedDate, teamSummaries, companyTotalDry, thuMuaDry }
}

/** Nhận diện và bóc tách workbook Excel */
export function parseOutputExcel(buffer: Buffer): ParsedOutputReport {
  const wb = XLSX.read(buffer, { type: "buffer" })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" })

  const firstFewLines = rows.slice(0, 15).map((r) => (r || []).join(" ").toLowerCase()).join(" ")

  if (firstFewLines.includes("phiếu báo cáo sản lượng mủ") || firstFewLines.includes("tên xe")) {
    // File chi tiết từng đội và xe
    const { detectedDate, results } = parseDetailXlsx(rows)
    return {
      success: true,
      format: "detail_xlsx",
      detectedDate,
      rows: results,
    }
  }

  if (firstFewLines.includes("báo cáo sản lượng mủ công ty") || firstFewLines.includes("lũy kế")) {
    // File tổng hợp công ty
    const { detectedDate, teamSummaries, companyTotalDry, thuMuaDry } = parseSummaryXlsx(rows)
    return {
      success: true,
      format: "summary_xlsx",
      detectedDate,
      rows: [],
      teamSummaries,
      companyTotalDry,
      thuMuaDry,
    }
  }

  // Fallback flat SLRpt_SanLuongNgay_TongHop
  const { detectedDate, results } = parseDetailXlsx(rows)
  return {
    success: true,
    format: "flat_xlsx",
    detectedDate,
    rows: results,
  }
}

/** Bóc tách file PDF sản lượng thuần TypeScript (chạy an toàn trên mọi môi trường bao gồm Vercel Serverless) */
export async function parseOutputPdf(buffer: Buffer): Promise<ParsedOutputReport> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjsLib: any = await import("pdfjs-dist/legacy/build/pdf.mjs")
  const cmapsDir = path.join(process.cwd(), "node_modules", "pdfjs-dist", "cmaps")
  const hasCMaps = fs.existsSync(cmapsDir)
  const cMapUrl = hasCMaps ? pathToFileURL(cmapsDir).href + "/" : undefined

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    ...(cMapUrl ? { cMapUrl, cMapPacked: true } : {}),
  })

  const doc = await loadingTask.promise
  const results: ParsedSlTruckRow[] = []
  let detectedDate = ""

  for (let pageIdx = 0; pageIdx < doc.numPages; pageIdx++) {
    const page = await doc.getPage(pageIdx + 1)
    const textContent = await page.getTextContent()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = textContent.items
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((i: any) => i.str && i.str.trim())
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((i: any) => ({
        str: i.str.trim(),
        x: Math.round(i.transform[4]),
        y: Math.round(i.transform[5]),
      }))

    const pageText = items.map((i: { str: string }) => i.str).join(" ")
    if (!detectedDate) {
      const d = parseDateFromText(pageText)
      if (d) detectedDate = d
    }

    let currentDoi = 1
    const mDoi = pageText.match(/ĐỘI\s*(\d+)/i)
    if (mDoi) {
      currentDoi = parseInt(mDoi[1], 10)
    }

    // Nhóm theo dòng (Y tương tự)
    const lineMap: Record<number, { str: string; x: number }[]> = {}
    for (const item of items) {
      const existingY = Object.keys(lineMap).find((ky) => Math.abs(Number(ky) - item.y) <= 3)
      const targetY = existingY !== undefined ? Number(existingY) : item.y
      if (!lineMap[targetY]) lineMap[targetY] = []
      lineMap[targetY].push({ str: item.str, x: item.x })
    }

    const sortedY = Object.keys(lineMap)
      .map(Number)
      .sort((a, b) => b - a)

    for (const y of sortedY) {
      const line = lineMap[y].sort((a, b) => a.x - b.x)
      if (line.length < 3) continue

      const firstStr = line[0].str
      const secondStr = line[1].str
      // Kiểm tra dòng dữ liệu: STT dạng số và cột thứ 2 là mã xe
      if (/^\d+$/.test(firstStr) && secondStr && !/^(TỔNG|STT|ĐỘI)/i.test(secondStr)) {
        const vh = parseVehicleCode(secondStr)
        const nums = line
          .slice(2)
          .map((c) => toNum(c.str))
          .filter((n) => n > 0)

        results.push({
          row_index: results.length + 1,
          ngay: detectedDate || "",
          doi: currentDoi,
          raw_xe: secondStr,
          base_xe: vh.base_xe,
          chuyen: vh.chuyen,
          chuyen_tu_ten: vh.chuyen_tu_ten,
          ghi_chu: "",
          mn_tuoi: 0,
          mn_drc: 0,
          mn_kho: 0,
          ct_tuoi: 0,
          ct_drc: 0,
          ct_kho: 0,
          dct_tuoi: nums[0] || 0,
          dct_drc: nums[1] || 0,
          dct_kho: nums[2] || 0,
          dkt_tuoi: 0,
          dkt_drc: 0,
          dkt_kho: 0,
          dt_tuoi: nums[3] || 0,
          dt_drc: nums[4] || 0,
          dt_kho: nums[5] || 0,
          tong_kho: nums[nums.length - 1] || 0,
        })
      }
    }
  }

  return {
    success: true,
    format: "pdf",
    detectedDate,
    rows: results,
  }
}

/** Helper chính: tự động điều phối parse theo định dạng tệp */
export async function parseOutputReport(buffer: Buffer, filename: string): Promise<ParsedOutputReport> {
  const isPdf = filename.toLowerCase().endsWith(".pdf") || buffer.subarray(0, 4).toString() === "%PDF"
  if (isPdf) {
    const res = await parseOutputPdf(buffer)
    res.filename = filename
    return res
  }
  const res = parseOutputExcel(buffer)
  res.filename = filename
  return res
}
