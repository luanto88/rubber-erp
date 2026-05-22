"use client"

import { useState, useRef, useCallback } from "react"
import { Upload, AlertTriangle, CheckCircle, FileSpreadsheet, X, ChevronRight } from "lucide-react"
import type { MatchedSlRow, ParsedSlRow, WarnCode } from "./output-types"
import { parseVehicleCode, WARN_LABELS, WARN_SEVERITY, writeBackToDispatch } from "./output-types"

// ────────────────────────────────────────────────────────────────
// Excel helpers
// ────────────────────────────────────────────────────────────────

function excelSerialToISO(serial: number): string {
  // Excel epoch: Dec 30 1899; 25569 = days between 1900-01-01 and 1970-01-01
  const ms = (serial - 25569) * 86400 * 1000
  const d = new Date(ms)
  if (isNaN(d.getTime()) || d.getFullYear() < 2000) return ""
  return d.toISOString().slice(0, 10)
}

function toNum(v: unknown): number {
  const n = parseFloat(String(v ?? 0))
  return isNaN(n) ? 0 : Math.round(n * 100) / 100
}

async function parseSlFile(file: File): Promise<ParsedSlRow[]> {
  const XLSX = await import("xlsx")
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: 0 })
  const dataRows = raw.slice(2) // bỏ 2 dòng header

  const result: ParsedSlRow[] = []
  dataRows.forEach((r, idx) => {
    const row = r as unknown[]
    const colC = String(row[2] ?? "").trim()
    if (!colC) return

    const ngay = typeof row[0] === "number" ? excelSerialToISO(row[0]) : ""
    if (!ngay) return

    const doi = parseInt(String(row[1] ?? "0"))
    if (!doi || doi < 1 || doi > 12) return

    const { base_xe, chuyen } = parseVehicleCode(colC)

    // Auto-calc KL khô nếu cột khô = 0 nhưng tươi và DRC có giá trị
    const calcKho = (t: number, d: number, k: number) =>
      k === 0 && t > 0 && d > 0 ? Math.round(t * d / 100 * 100) / 100 : k

    const mn_tuoi = toNum(row[3]);  const mn_drc = toNum(row[4]);  const mn_kho = calcKho(mn_tuoi, mn_drc, toNum(row[5]))
    const ct_tuoi = toNum(row[6]);  const ct_drc = toNum(row[7]);  const ct_kho = calcKho(ct_tuoi, ct_drc, toNum(row[8]))
    const dct_tuoi = toNum(row[9]); const dct_drc = toNum(row[10]); const dct_kho = calcKho(dct_tuoi, dct_drc, toNum(row[11]))
    const dkt_tuoi = toNum(row[12]); const dkt_drc = toNum(row[13]); const dkt_kho = calcKho(dkt_tuoi, dkt_drc, toNum(row[14]))
    const dt_tuoi = toNum(row[15]); const dt_drc = toNum(row[16]);  const dt_kho = calcKho(dt_tuoi, dt_drc, toNum(row[17]))

    result.push({
      row_index: idx + 3,
      ngay, doi, base_xe, chuyen,
      mn_tuoi, mn_drc, mn_kho,
      ct_tuoi, ct_drc, ct_kho,
      dct_tuoi, dct_drc, dct_kho,
      dkt_tuoi, dkt_drc, dkt_kho,
      dt_tuoi, dt_drc, dt_kho,
    })
  })
  return result
}

// ────────────────────────────────────────────────────────────────
// Matching algorithm
// ────────────────────────────────────────────────────────────────

interface DispatchEntry {
  id: string
  ngay: string
  rows: Array<{
    uid: string
    so_xe: string
    chuyen: number
    tai_xe: string
    diem_gn: string[]
  }>
}

interface DeliveryPoint { ma_lo: string; doi: number }

export function matchRows(
  parsed: ParsedSlRow[],
  dispatches: DispatchEntry[],
  deliveryPoints: DeliveryPoint[],
): MatchedSlRow[] {
  // doi lookup
  const doiByMaLo = new Map<string, number>(deliveryPoints.map(p => [p.ma_lo, p.doi]))

  // dispatch index: "YYYY-MM-DD" → Map<"baseXe:chuyen", {entryId, dxRow}>
  type DxMatch = { entryId: string; tai_xe: string; diem_gn: string[] }
  const dispIdx = new Map<string, Map<string, DxMatch>>()
  for (const entry of dispatches) {
    // normalize date to ISO
    let dateKey = entry.ngay
    if (dateKey.includes("/")) {
      const p = dateKey.split("/")
      dateKey = `${p[2]}-${p[1].padStart(2,"0")}-${p[0].padStart(2,"0")}`
    }
    if (!dispIdx.has(dateKey)) dispIdx.set(dateKey, new Map())
    const dayMap = dispIdx.get(dateKey)!
    for (const row of entry.rows ?? []) {
      const { base_xe, chuyen } = parseVehicleCode(row.so_xe ?? "")
      const k = `${base_xe}:${chuyen}`
      dayMap.set(k, { entryId: entry.id, tai_xe: row.tai_xe ?? "", diem_gn: row.diem_gn ?? [] })
    }
  }

  // track duplicates within the file
  const seen = new Map<string, number>()

  return parsed.map(row => {
    const warns: WarnCode[] = []
    const fileKey = `${row.ngay}:${row.base_xe}:${row.chuyen}:${row.doi}`
    seen.set(fileKey, (seen.get(fileKey) ?? 0) + 1)

    let dispatch_entry_id: string | null = null
    let tai_xe: string | null = null

    const allKlZero = [
      row.mn_tuoi, row.ct_tuoi, row.dct_tuoi, row.dkt_tuoi, row.dt_tuoi,
      row.mn_kho, row.ct_kho, row.dct_kho, row.dkt_kho, row.dt_kho,
    ].every(v => !v)
    if (allKlZero) warns.push("ZERO_KL")

    const dayMap = dispIdx.get(row.ngay)
    if (!dayMap) {
      warns.push("NO_DISPATCH_DATE")
      return { ...row, dispatch_entry_id: null, tai_xe: null, warn_codes: warns }
    }

    const xeKey = `${row.base_xe}:${row.chuyen}`
    const match = dayMap.get(xeKey)

    if (!match) {
      // check if vehicle exists with any trip
      const hasVehicle = [...dayMap.keys()].some(k => k.startsWith(`${row.base_xe}:`))
      warns.push(hasVehicle ? "CHUYEN_NOT_FOUND" : "VEHICLE_NOT_FOUND")
    } else {
      dispatch_entry_id = match.entryId
      tai_xe = match.tai_xe || null

      // kiểm tra doi
      const pointDois = new Set(
        match.diem_gn.map(ma => doiByMaLo.get(ma)).filter((d): d is number => d !== undefined)
      )
      if (pointDois.size > 0 && !pointDois.has(row.doi)) {
        warns.push("DOI_MISMATCH")
      }
    }

    return { ...row, dispatch_entry_id, tai_xe, warn_codes: warns }
  }).map(row => {
    const fileKey = `${row.ngay}:${row.base_xe}:${row.chuyen}:${row.doi}`
    if ((seen.get(fileKey) ?? 0) > 1 && !row.warn_codes.includes("DUPLICATE_IN_FILE")) {
      return { ...row, warn_codes: [...row.warn_codes, "DUPLICATE_IN_FILE" as WarnCode] }
    }
    return row
  })
}

// ────────────────────────────────────────────────────────────────
// Warn badge component
// ────────────────────────────────────────────────────────────────

function WarnBadge({ code }: { code: WarnCode }) {
  const sev = WARN_SEVERITY[code]
  const cls = sev === "red" ? "bg-red-100 text-red-700" :
              sev === "amber" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"
  return (
    <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded mr-1 ${cls}`}>
      {WARN_LABELS[code]}
    </span>
  )
}

// ────────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────────

interface OutputImportProps {
  factoryId: string
  dispatches: DispatchEntry[]
  deliveryPoints: DeliveryPoint[]
  onImported: () => void
  onClose: () => void
  // Supabase client passed from parent (avoid re-import)
  supabase: import("@supabase/supabase-js").SupabaseClient
}

export function OutputImport({
  factoryId, dispatches, deliveryPoints, onImported, onClose, supabase,
}: OutputImportProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [fileName, setFileName] = useState("")
  const [matched, setMatched] = useState<MatchedSlRow[]>([])
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<{ ok: number; warn: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (file: File) => {
    setImportError(null)
    try {
      const parsed = await parseSlFile(file)
      if (!parsed.length) { setImportError("Không tìm thấy dữ liệu hợp lệ trong file."); return }
      const result = matchRows(parsed, dispatches, deliveryPoints)
      setMatched(result)
      setFileName(file.name)
      setStep(2)
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Lỗi đọc file")
    }
  }, [dispatches, deliveryPoints])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [handleFile])

  const handleConfirm = async () => {
    setImporting(true)
    setImportError(null)
    try {
      const batchId = crypto.randomUUID()
      const rows = matched.map(r => ({
        factory_id: factoryId,
        ngay: r.ngay,
        doi: r.doi,
        so_xe: r.base_xe,
        chuyen: r.chuyen,
        tai_xe: r.tai_xe,
        mn_tuoi: r.mn_tuoi, mn_drc: r.mn_drc, mn_kho: r.mn_kho,
        ct_tuoi: r.ct_tuoi, ct_drc: r.ct_drc, ct_kho: r.ct_kho,
        dct_tuoi: r.dct_tuoi, dct_drc: r.dct_drc, dct_kho: r.dct_kho,
        dkt_tuoi: r.dkt_tuoi, dkt_drc: r.dkt_drc, dkt_kho: r.dkt_kho,
        dt_tuoi: r.dt_tuoi, dt_drc: r.dt_drc, dt_kho: r.dt_kho,
        dispatch_entry_id: r.dispatch_entry_id,
        warn_codes: r.warn_codes,
        import_batch_id: batchId,
      }))
      const { error } = await supabase
        .from("production_records")
        .upsert(rows, { onConflict: "factory_id,ngay,so_xe,chuyen,doi" })
      if (error) throw new Error(error.message)
      setImportResult({
        ok: rows.length,
        warn: rows.filter(r => r.warn_codes.length > 0).length,
      })
      setStep(3)
      onImported()
      // Ghi ngược KL vào dispatch (fire-and-forget, không block bước hoàn thành)
      const uniqueNgays = [...new Set(rows.map(r => r.ngay))]
      void Promise.all(uniqueNgays.map(ngay => writeBackToDispatch(factoryId, ngay, supabase).catch(() => {})))
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Lỗi nhập dữ liệu")
    } finally {
      setImporting(false)
    }
  }

  const warnCount = matched.filter(r => r.warn_codes.length > 0).length
  const redCount = matched.filter(r =>
    r.warn_codes.some(c => WARN_SEVERITY[c] === "red")
  ).length

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <FileSpreadsheet size={20} className="text-emerald-600" />
            <h2 className="text-lg font-bold text-slate-800">Import file sản lượng</h2>
            {/* steps */}
            <div className="flex items-center gap-1 ml-4">
              {([1,2,3] as const).map(s => (
                <span key={s} className={`flex items-center gap-1 text-xs font-bold ${step === s ? "text-emerald-700" : step > s ? "text-slate-400" : "text-slate-300"}`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${step === s ? "bg-emerald-600 text-white" : step > s ? "bg-slate-300 text-slate-600" : "bg-slate-100 text-slate-400"}`}>{s}</span>
                  {s === 1 ? "Chọn file" : s === 2 ? "Xem trước" : "Hoàn thành"}
                  {s < 3 && <ChevronRight size={12} className="text-slate-300" />}
                </span>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg"><X size={18} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-6">

          {/* Step 1 – Upload */}
          {step === 1 && (
            <div>
              <div
                onDrop={handleDrop}
                onDragOver={e => e.preventDefault()}
                onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed border-slate-300 rounded-xl p-16 text-center cursor-pointer hover:border-emerald-400 hover:bg-emerald-50 transition-all"
              >
                <Upload size={40} className="mx-auto mb-3 text-slate-300" />
                <p className="text-slate-600 font-bold mb-1">Kéo thả hoặc bấm để chọn file</p>
                <p className="text-slate-400 text-sm">Định dạng: .xlsx (theo mẫu sl_mau.xlsx)</p>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
              />
              {importError && (
                <div className="mt-4 flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-xl text-sm">
                  <AlertTriangle size={16} className="shrink-0" />{importError}
                </div>
              )}
              <div className="mt-4 p-4 bg-slate-50 rounded-xl text-sm text-slate-600">
                <p className="font-bold mb-2">Cấu trúc file (18 cột A–R):</p>
                <p>A: Ngày &nbsp;|&nbsp; B: Đội (1–12) &nbsp;|&nbsp; C: Số xe (1A, 1A2, 1A3...)</p>
                <p>D–F: Mủ nước &nbsp;|&nbsp; G–I: Mủ chén &nbsp;|&nbsp; J–L: Mủ đông chén &nbsp;|&nbsp; M–O: Mủ đông khối &nbsp;|&nbsp; P–R: Mủ dây</p>
                <p className="mt-1 text-slate-400">Mỗi nhóm: Tươi / DRC% / Khô</p>
              </div>
            </div>
          )}

          {/* Step 2 – Preview */}
          {step === 2 && (
            <div>
              <div className="flex items-center gap-4 mb-4">
                <div className="text-sm text-slate-600">
                  <span className="font-bold">{fileName}</span>
                  <span className="ml-2 text-slate-400">— {matched.length} dòng</span>
                </div>
                {warnCount > 0 && (
                  <div className="flex items-center gap-1.5 text-sm font-bold text-amber-700 bg-amber-50 px-3 py-1 rounded-lg">
                    <AlertTriangle size={14} />{warnCount} cảnh báo
                    {redCount > 0 && <span className="ml-1 text-red-700">({redCount} lỗi)</span>}
                  </div>
                )}
                {warnCount === 0 && (
                  <div className="flex items-center gap-1.5 text-sm font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-lg">
                    <CheckCircle size={14} />Khớp hoàn toàn
                  </div>
                )}
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2 text-left font-bold text-slate-600">Ngày</th>
                      <th className="px-3 py-2 text-center font-bold text-slate-600">Đội</th>
                      <th className="px-3 py-2 text-left font-bold text-slate-600">Số xe</th>
                      <th className="px-3 py-2 text-center font-bold text-slate-600">Chuyến</th>
                      <th className="px-3 py-2 text-left font-bold text-slate-600">Tài xế</th>
                      <th className="px-3 py-2 text-right font-bold text-slate-600">Tươi (kg)</th>
                      <th className="px-3 py-2 text-right font-bold text-slate-600">Khô (kg)</th>
                      <th className="px-3 py-2 text-left font-bold text-slate-600">Cảnh báo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matched.map((r, i) => {
                      const hasRed = r.warn_codes.some(c => WARN_SEVERITY[c] === "red")
                      const hasAmber = !hasRed && r.warn_codes.some(c => WARN_SEVERITY[c] === "amber")
                      const rowCls = hasRed ? "bg-red-50" : hasAmber ? "bg-amber-50/50" : i % 2 === 0 ? "bg-white" : "bg-slate-50/50"
                      const totalTuoi = r.mn_tuoi + r.ct_tuoi + r.dct_tuoi + r.dkt_tuoi + r.dt_tuoi
                      const totalKho = r.mn_kho + r.ct_kho + r.dct_kho + r.dkt_kho + r.dt_kho
                      return (
                        <tr key={i} className={rowCls}>
                          <td className="px-3 py-1.5 text-slate-700">{r.ngay}</td>
                          <td className="px-3 py-1.5 text-center font-bold text-slate-700">{r.doi}</td>
                          <td className="px-3 py-1.5 font-mono font-bold text-slate-800">{r.base_xe}</td>
                          <td className="px-3 py-1.5 text-center text-slate-600">{r.chuyen}</td>
                          <td className="px-3 py-1.5 text-slate-600">{r.tai_xe || <span className="text-slate-300">—</span>}</td>
                          <td className="px-3 py-1.5 text-right text-slate-700">{totalTuoi > 0 ? totalTuoi.toLocaleString("vi-VN") : "—"}</td>
                          <td className="px-3 py-1.5 text-right font-bold text-emerald-700">{totalKho > 0 ? totalKho.toLocaleString("vi-VN") : "—"}</td>
                          <td className="px-3 py-1.5">
                            {r.warn_codes.map(c => <WarnBadge key={c} code={c} />)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {importError && (
                <div className="mt-4 flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-xl text-sm">
                  <AlertTriangle size={16} className="shrink-0" />{importError}
                </div>
              )}
            </div>
          )}

          {/* Step 3 – Done */}
          {step === 3 && importResult && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <CheckCircle size={56} className="text-emerald-500" />
              <p className="text-2xl font-extrabold text-slate-800">Nhập thành công!</p>
              <p className="text-slate-500">
                <span className="font-bold text-emerald-700">{importResult.ok}</span> bản ghi đã được lưu
                {importResult.warn > 0 && (
                  <> &nbsp;·&nbsp; <span className="font-bold text-amber-600">{importResult.warn}</span> dòng có cảnh báo</>
                )}
              </p>
              <button onClick={onClose} className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all">
                Đóng
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        {(step === 1 || step === 2) && (
          <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between">
            <button
              onClick={() => { if (step === 2) setStep(1); else onClose() }}
              className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
            >
              {step === 2 ? "← Chọn lại file" : "Hủy"}
            </button>
            {step === 2 && (
              <button
                onClick={handleConfirm}
                disabled={importing}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold rounded-xl shadow-md transition-all"
              >
                {importing ? "Đang nhập..." : `Nhập ${matched.length} bản ghi${warnCount > 0 ? ` (${warnCount} cảnh báo)` : ""}`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
