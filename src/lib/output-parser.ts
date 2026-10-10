import * as XLSX from "xlsx"
import { spawn } from "child_process"
import path from "path"

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

/** Bóc tách file PDF qua Python PyMuPDF subprocess */
export async function parseOutputPdf(buffer: Buffer): Promise<ParsedOutputReport> {
  const scriptPath = path.join(process.cwd(), "src", "server", "scripts", "parse_san_luong.py")
  const b64Data = buffer.toString("base64")

  return new Promise<ParsedOutputReport>((resolve, reject) => {
    const pyProcess = spawn("python", [scriptPath, "--stdin-base64"])

    let stdoutData = ""
    let stderrData = ""

    pyProcess.stdout.on("data", (chunk) => {
      stdoutData += chunk.toString("utf-8")
    })
    pyProcess.stderr.on("data", (chunk) => {
      stderrData += chunk.toString("utf-8")
    })

    pyProcess.on("close", (code) => {
      const startMarker = "__OUTPUT_JSON_START__"
      const endMarker = "__OUTPUT_JSON_END__"

      let jsonStr = stdoutData.trim()
      if (jsonStr.includes(startMarker) && jsonStr.includes(endMarker)) {
        jsonStr = jsonStr.slice(
          jsonStr.indexOf(startMarker) + startMarker.length,
          jsonStr.indexOf(endMarker),
        ).trim()
      }

      if (code !== 0) {
        return reject(new Error(stderrData || "Không thể thực thi script parse PDF."))
      }

      try {
        const parsed = JSON.parse(jsonStr)
        resolve({
          success: true,
          format: "pdf",
          detectedDate: parsed.detectedDate || "",
          rows: parsed.results || [],
        })
      } catch (err) {
        reject(new Error(`Lỗi parse output JSON từ PDF: ${err instanceof Error ? err.message : String(err)}`))
      }
    })

    pyProcess.stdin.write(b64Data)
    pyProcess.stdin.end()
  })
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
