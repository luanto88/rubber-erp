import path from "node:path"
import fs from "node:fs"
import { pathToFileURL } from "node:url"
import ExcelJS from "exceljs"

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
    translate(tx = 0, ty = 0) {
      return new DOMMatrixPolyfill([this.a, this.b, this.c, this.d, this.e + tx, this.f + ty])
    }
    scale(sx = 1, sy = sx) {
      return new DOMMatrixPolyfill([this.a * sx, this.b * sx, this.c * sy, this.d * sy, this.e, this.f])
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).DOMMatrix = DOMMatrixPolyfill
}

export type SampleMap = {
  tap_chat: number[]
  tro: number[]
  bay_hoi: number[]
  nito: number[]
  po: number[]
  pri: number[]
  mooney: number[]
  mau_sac: string[]
}

export type ParsedLot = {
  pkn: number
  lo_nm: string
  lo_nm_full: string
  hang_dk: string
  chung_loai: string
  loai_csr: string
  dat_hang: string
  tc_x: number
  tc_3sd: number
  tro_x: number
  tro_3sd: number
  bh_x: number
  bh_xmax: number
  ni_x: number
  ni_xmax: number
  po_xmin: number
  po_x: number
  po_xmax: number
  po_step: string
  pri_xmin: number
  pri_x: number
  pri_xmax: number
  ml_xmin: number
  ml_x: number
  ml_xmax: number
  ml_step: string
  samples: SampleMap
}

export type ParseKqknResult = {
  success: boolean
  filename: string
  ngay_sx: string | null
  ngay_kn: string
  total_lots: number
  lots: ParsedLot[]
  excel_base64: string
  report: {
    total_lots: number
    lot_range: string
    ngay_sx: string | null
    ngay_kn: string
    tieu_chuan: string
    n_samples: number
    step_po: { po_05: string[]; po_01: string[] }
    step_ml: { ml_05: string[]; ml_01: string[] }
    rh_lots: [string, string][]
    anomalies: string[]
  }
}

export function roundHalfUp(num: number, decimals: number): number {
  const factor = Math.pow(10, decimals)
  return Math.round((num + Number.EPSILON) * factor) / factor
}

export function extractHangDkInfo(hangRaw: string) {
  let h = String(hangRaw || "").trim().toUpperCase()
  if (!h) return { chung_loai: "10", loai_csr: "CSR10" }
  if (h.startsWith("SVR")) {
    h = "CSR" + h.slice(3)
  }
  const cl = h.replace("CSR", "") || "10"
  const loai_csr = "CSR" + cl
  return { chung_loai: cl, loai_csr }
}

export function solveTcTro(targetMean: number, target3sd: number, n: number, maxIter = 60000): number[] {
  const scale = 1000
  const tm = Math.round(targetMean * scale)
  const t3sd = Math.round(target3sd * scale)
  const targetSum = Math.round(targetMean * n * scale)
  if (t3sd === 0) return Array(n).fill(targetMean)
  const spread = Math.max(1, Math.round((t3sd / 3.0) * 1.6))

  for (let iter = 0; iter < maxIter; iter++) {
    const vals: number[] = []
    for (let i = 0; i < n; i++) {
      vals.push(Math.max(0, tm + Math.floor(Math.random() * (2 * spread + 1)) - spread))
    }
    let curSum = vals.reduce((a, b) => a + b, 0)
    let diff = targetSum - curSum
    while (diff !== 0) {
      const idx = Math.floor(Math.random() * n)
      if (diff > 0) {
        vals[idx]++
        diff--
      } else {
        if (vals[idx] > 0) {
          vals[idx]--
          diff++
        }
      }
    }
    const dSum = vals.reduce((a, b) => a + b, 0)
    const meanD = roundHalfUp(dSum / (n * scale), 3)
    if (Math.abs(meanD - targetMean) > 1e-6) continue

    const meanF = dSum / n
    let varSum = 0
    for (const v of vals) varSum += Math.pow(v - meanF, 2)
    const varF = varSum / (n - 1)
    const sdF = Math.sqrt(varF) / scale
    const sd3D = roundHalfUp(sdF * 3, 3)
    if (Math.abs(sd3D - target3sd) < 1e-6) {
      vals.sort((a, b) => a - b)
      return vals.map((v) => roundHalfUp(v / scale, 3))
    }
  }
  return Array(n).fill(targetMean)
}

export function solveBhNi(targetMean: number, targetXmax: number, n: number): number[] {
  const mult = 100
  const iMax = Math.round(targetXmax * mult)
  if (targetXmax === targetMean) return Array(n).fill(targetXmax)

  // Cách nhau 2 đơn vị
  for (let k0 = 0; k0 < n; k0++) {
    for (let k1 = 0; k1 < n - k0; k1++) {
      const k2 = n - k0 - k1
      if (k2 < 1) continue
      const vals = [...Array(k0).fill(iMax - 2), ...Array(k1).fill(iMax - 1), ...Array(k2).fill(iMax)]
      const sum = vals.reduce((a, b) => a + b, 0)
      const avg = roundHalfUp(sum / (n * mult), 2)
      if (Math.abs(avg - targetMean) < 1e-6) {
        return vals.map((v) => roundHalfUp(v / mult, 2))
      }
    }
  }

  // Cách nhau 3 đơn vị
  for (let k0 = 0; k0 < n; k0++) {
    for (let k1 = 0; k1 < n - k0; k1++) {
      for (let k2 = 0; k2 < n - k0 - k1; k2++) {
        const k3 = n - k0 - k1 - k2
        if (k3 < 1) continue
        const vals = [
          ...Array(k0).fill(iMax - 3),
          ...Array(k1).fill(iMax - 2),
          ...Array(k2).fill(iMax - 1),
          ...Array(k3).fill(iMax),
        ]
        const sum = vals.reduce((a, b) => a + b, 0)
        const avg = roundHalfUp(sum / (n * mult), 2)
        if (Math.abs(avg - targetMean) < 1e-6) {
          return vals.map((v) => roundHalfUp(v / mult, 2))
        }
      }
    }
  }

  // Random search
  const targetSum = Math.round(targetMean * n * mult)
  for (let iter = 0; iter < 30000; iter++) {
    const vals: number[] = []
    for (let i = 0; i < n - 1; i++) {
      vals.push(iMax - Math.floor(Math.random() * 5))
    }
    vals.push(iMax)
    const sum = vals.reduce((a, b) => a + b, 0)
    if (sum === targetSum) {
      vals.sort((a, b) => a - b)
      return vals.map((v) => roundHalfUp(v / mult, 2))
    }
  }
  return Array(n).fill(targetMean)
}

export function solveMinMeanMax(
  xmin: number,
  targetMean: number,
  xmax: number,
  n: number,
  step: number,
  maxIter = 45000,
): number[] {
  const mult = Math.round(1 / step)
  const iMin = Math.round(xmin * mult)
  const iMax = Math.round(xmax * mult)
  if (iMin === iMax) return Array(n).fill(xmin)

  for (let iter = 0; iter < maxIter; iter++) {
    const vals: number[] = [iMin]
    for (let i = 0; i < n - 2; i++) {
      vals.push(iMin + Math.floor(Math.random() * (iMax - iMin + 1)))
    }
    vals.push(iMax)
    const sum = vals.reduce((a, b) => a + b, 0)
    const avg = roundHalfUp(sum / (n * mult), 1)
    if (Math.abs(avg - targetMean) < 1e-6) {
      vals.sort((a, b) => a - b)
      return vals.map((v) => roundHalfUp(v / mult, 1))
    }
  }
  return Array(n).fill(targetMean)
}

export async function generateExcelBuffer(
  lots: ParsedLot[],
  ngay_kn: string,
  ngay_sx: string | null,
  n: number,
  tieuChuan: string,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet("Sheet1")

  // Row 1: Header metadata
  ws.addRow(["NGAY_KN", "NGAY_SX", "CHUNG_LOAI", "LOAI_KN", "TIEU_CHUAN", "SO_MAU"])

  // Row 2: Metadata values
  const firstCl = lots[0]?.chung_loai || "10"
  const loaiKn = n >= 14 ? "ngat" : "thuong"
  ws.addRow([ngay_kn, ngay_sx || ngay_kn, firstCl, loaiKn, tieuChuan, n])

  // Row 3: Column headers
  const colHeaders = ["LO_NM"]
  const sampleGroups = ["TC", "TRO", "BH", "NI", "PO", "PRI", "ML", "MAU"]
  for (const grp of sampleGroups) {
    for (let m = 1; m <= n; m++) {
      colHeaders.push(`${grp}_M${m}`)
    }
  }
  ws.addRow(colHeaders)

  // Row 4+: Dữ liệu từng lô
  for (const lot of lots) {
    const rowVals: (string | number)[] = [lot.lo_nm_full]
    // TC
    for (const v of lot.samples.tap_chat) rowVals.push(v)
    // TRO
    for (const v of lot.samples.tro) rowVals.push(v)
    // BH
    for (const v of lot.samples.bay_hoi) rowVals.push(v)
    // NI
    for (const v of lot.samples.nito) rowVals.push(v)
    // PO
    for (const v of lot.samples.po) rowVals.push(v)
    // PRI
    for (const v of lot.samples.pri) rowVals.push(v)
    // ML
    for (let m = 0; m < n; m++) {
      rowVals.push(lot.samples.mooney[m] ?? 0)
    }
    // MAU
    for (let m = 0; m < n; m++) {
      rowVals.push("")
    }
    ws.addRow(rowVals)
  }

  const uintBuf = await wb.xlsx.writeBuffer()
  return Buffer.from(uintBuf)
}

export async function processKqknPdf(
  pdfBuffer: Buffer | Uint8Array,
  options: {
    nSamples?: number
    tieuChuan?: string
    filenameHint?: string
  } = {},
): Promise<ParseKqknResult> {
  const n = options.nSamples || 6
  const tieuChuan = options.tieuChuan || "TCCS 112:2022"
  const filename = options.filenameHint || "KQKN.pdf"

  // Load pdfjs-dist
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjsLib: any = await import("pdfjs-dist/legacy/build/pdf.mjs")
  const cmapsDir = path.join(process.cwd(), "node_modules", "pdfjs-dist", "cmaps")
  const hasCMaps = fs.existsSync(cmapsDir)
  const cMapUrl = hasCMaps ? pathToFileURL(cmapsDir).href + "/" : undefined

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(pdfBuffer),
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    ...(cMapUrl ? { cMapUrl, cMapPacked: true } : {}),
  })

  const doc = await loadingTask.promise
  if (doc.numPages === 0) {
    throw new Error("Tệp PDF rỗng, không chứa trang dữ liệu nào")
  }

  const page = await doc.getPage(1)
  const textContent = await page.getTextContent()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allItems = textContent.items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((i: any) => i.str && i.str.trim())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((i: any) => ({
      str: i.str.trim(),
      x: Math.round(i.transform[4]),
      y: Math.round(i.transform[5]),
    }))

  const fullText = allItems.map((i: { str: string }) => i.str).join(" ")

  // 1. Ngày sản xuất
  const mSx = fullText.match(/NGÀY\s*SẢN\s*XUẤT:\s*(\d{2}\/\d{2}\/\d{4})/i)
  const ngay_sx = mSx ? mSx[1] : null

  // 2. Ngày kiểm nghiệm
  const mKn = fullText.match(/ngày\s*(\d{2})\s*tháng\s*(\d{2})\s*năm\s*(\d{4})/i)
  let ngay_kn = mKn ? `${mKn[1]}/${mKn[2]}/${mKn[3]}` : null
  if (!ngay_kn) {
    const mFile = filename.match(/(\d{2})[-/](\d{2})[-/](\d{4})/)
    if (mFile) {
      ngay_kn = `${mFile[1]}/${mFile[2]}/${mFile[3]}`
    } else {
      const today = new Date()
      const dd = String(today.getDate()).padStart(2, "0")
      const mm = String(today.getMonth() + 1).padStart(2, "0")
      const yyyy = today.getFullYear()
      ngay_kn = `${dd}/${mm}/${yyyy}`
    }
  }

  // 3. Tìm các cột Lô theo dòng PKN ở Y ≈ 43
  const pknItems = allItems.filter(
    (i: { x: number; y: number; str: string }) => Math.abs(i.y - 43) <= 4 && /^\d{3,5}$/.test(i.str),
  )
  pknItems.sort((a: { x: number }, b: { x: number }) => a.x - b.x)

  if (pknItems.length === 0) {
    throw new Error("Không tìm thấy bảng kết quả kiểm nghiệm cao su trong file PDF (không nhận diện được cột PKN)")
  }

  const lots: ParsedLot[] = []
  const yearSuffix = ngay_kn.split("/").pop()?.slice(-2) || "26"

  const reportStepPo: Record<string, string> = {}
  const reportStepMl: Record<string, string> = {}
  const reportRhLots: [string, string][] = []
  const anomalies: string[] = []

  for (const pknItem of pknItems) {
    const x = pknItem.x
    // Các item thuộc cùng một cột X
    const colItems = allItems.filter((i: { x: number }) => Math.abs(i.x - x) <= 7)

    const getItemAtY = (targetY: number) => {
      const match = colItems.find((i: { y: number }) => Math.abs(i.y - targetY) <= 6)
      return match ? match.str : ""
    }

    const parseNum = (y: number, decimals = 3) => {
      const s = getItemAtY(y)
      if (!s) return 0
      const val = parseFloat(s.replace(",", "."))
      return isNaN(val) ? 0 : roundHalfUp(val, decimals)
    }

    const pkn = parseInt(pknItem.str, 10)
    const lo_nm_raw = getItemAtY(71) || pknItem.str
    const lo_nm_full = lo_nm_raw.includes("/") ? lo_nm_raw : `${lo_nm_raw}/${yearSuffix}`
    const hang_dk = getItemAtY(107) || "CSR10"
    const dat_hang = getItemAtY(718) || hang_dk

    const { chung_loai, loai_csr } = extractHangDkInfo(hang_dk)

    const tc_x = parseNum(144, 3)
    const tc_3sd = parseNum(173, 3)
    const tro_x = parseNum(231, 3)
    const tro_3sd = parseNum(260, 3)
    const bh_x = parseNum(319, 2)
    const bh_xmax = parseNum(345, 2)
    const ni_x = parseNum(373, 2)
    const ni_xmax = parseNum(397, 2)
    const po_xmin = parseNum(423, 1)
    const po_x = parseNum(450, 1)
    const po_xmax = parseNum(474, 1)
    const pri_xmin = parseNum(501, 1)
    const pri_x = parseNum(527, 1)
    const pri_xmax = parseNum(552, 1)
    const ml_xmin = parseNum(635, 1)
    const ml_x = parseNum(661, 1)
    const ml_xmax = parseNum(686, 1)

    // Tái tạo mẫu chi tiết
    const tcSamples = solveTcTro(tc_x, tc_3sd, n)
    const troSamples = solveTcTro(tro_x, tro_3sd, n)
    const bhSamples = solveBhNi(bh_x, bh_xmax, n)
    const niSamples = solveBhNi(ni_x, ni_xmax, n)

    const stepPo = (po_xmin * 2) % 1 === 0 && (po_xmax * 2) % 1 === 0 ? 0.5 : 0.1
    const poSamples = solveMinMeanMax(po_xmin, po_x, po_xmax, n, stepPo)
    const priSamples = solveMinMeanMax(pri_xmin, pri_x, pri_xmax, n, 0.1)

    const stepMl = (ml_xmin * 2) % 1 === 0 && (ml_xmax * 2) % 1 === 0 ? 0.5 : 0.1
    const mlSamples = ml_x > 0 ? solveMinMeanMax(ml_xmin, ml_x, ml_xmax, n, stepMl) : Array(n).fill(0)

    reportStepPo[lo_nm_full] = String(stepPo)
    reportStepMl[lo_nm_full] = String(stepMl)

    if (dat_hang === "RHCSR10" || dat_hang.includes("RH")) {
      const reasons: string[] = []
      if (ml_x > 0 && (ml_xmin < 73 || ml_xmax > 93)) {
        reasons.push(`ML ngoài 73-93 (${ml_xmin}-${ml_xmax})`)
      }
      if (pri_xmax - pri_xmin > 10.0) {
        reasons.push(`Độ rộng PRI > 10 (${roundHalfUp(pri_xmax - pri_xmin, 1)})`)
      }
      if (po_xmax - po_xmin > 8.0) {
        reasons.push(`Độ rộng PO > 8 (${roundHalfUp(po_xmax - po_xmin, 1)})`)
      }
      reportRhLots.push([lo_nm_full, reasons.length ? reasons.join(", ") : "Vượt chỉ tiêu"])
    }

    if (tro_3sd > 0.1) {
      anomalies.push(`Lô ${lo_nm_full} có 3sd Tro cao bất thường: ${tro_3sd}`)
    }

    lots.push({
      pkn,
      lo_nm: lo_nm_raw,
      lo_nm_full,
      hang_dk,
      chung_loai,
      loai_csr,
      dat_hang,
      tc_x,
      tc_3sd,
      tro_x,
      tro_3sd,
      bh_x,
      bh_xmax,
      ni_x,
      ni_xmax,
      po_xmin,
      po_x,
      po_xmax,
      po_step: String(stepPo),
      pri_xmin,
      pri_x,
      pri_xmax,
      ml_xmin,
      ml_x,
      ml_xmax,
      ml_step: String(stepMl),
      samples: {
        tap_chat: tcSamples,
        tro: troSamples,
        bay_hoi: bhSamples,
        nito: niSamples,
        po: poSamples,
        pri: priSamples,
        mooney: ml_x > 0 ? mlSamples : [],
        mau_sac: [],
      },
    })
  }

  // Tạo file Excel đối chiếu bằng ExcelJS
  const excelBuffer = await generateExcelBuffer(lots, ngay_kn, ngay_sx, n, tieuChuan)
  const excel_base64 = excelBuffer.toString("base64")

  const dateFormatted = ngay_kn.replace(/\//g, "-")
  const outFilename = `Nhap_lieu_ban_dau_${dateFormatted}_${n}mau.xlsx`

  const po_05 = Object.keys(reportStepPo).filter((k) => reportStepPo[k] === "0.5")
  const po_01 = Object.keys(reportStepPo).filter((k) => reportStepPo[k] === "0.1")
  const ml_05 = Object.keys(reportStepMl).filter((k) => reportStepMl[k] === "0.5")
  const ml_01 = Object.keys(reportStepMl).filter((k) => reportStepMl[k] === "0.1")

  return {
    success: true,
    filename: outFilename,
    ngay_sx,
    ngay_kn,
    total_lots: lots.length,
    lots,
    excel_base64,
    report: {
      total_lots: lots.length,
      lot_range: `${lots[0].lo_nm_full} -> ${lots[lots.length - 1].lo_nm_full}`,
      ngay_sx,
      ngay_kn,
      tieu_chuan: tieuChuan,
      n_samples: n,
      step_po: { po_05, po_01 },
      step_ml: { ml_05, ml_01 },
      rh_lots: reportRhLots,
      anomalies,
    },
  }
}
