"use client"

import { Fragment, useCallback, useMemo, useRef, useState } from "react"
import { AlertTriangle, CheckCircle, ChevronRight, FileSpreadsheet, Plus, Upload } from "lucide-react"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { RequiredNoteSelect } from "@/app/dashboard/_components/required-note-select"
import type { MatchedSlRow, ParsedSlRow, WarnCode } from "./output-types"
import {
  buildProductionRecordKey,
  parseVehicleCode,
  WARN_LABELS,
  WARN_SEVERITY,
  writeBackToDispatch,
} from "./output-types"
import { normalizeDateInput, formatDateDisplay } from "@/lib/date-utils"
import { createRequiredNote, loadRequiredNotes } from "@/lib/required-notes"
import { isBlankNoteContent } from "@/lib/note-filter"
import type { SessionUser } from "@/lib/auth"

// Danh sách loại mủ cho bảng xem trước (Step 2) — chỉ cột của loại có dữ liệu trong file mới hiện.
const PREVIEW_MATERIALS = [
  { label: "Mủ nước", tuoiKey: "mn_tuoi", khoKey: "mn_kho" },
  { label: "Mủ chén", tuoiKey: "ct_tuoi", khoKey: "ct_kho" },
  { label: "Mủ đông chén", tuoiKey: "dct_tuoi", khoKey: "dct_kho" },
  { label: "Mủ đông khối", tuoiKey: "dkt_tuoi", khoKey: "dkt_kho" },
  { label: "Mủ dây", tuoiKey: "dt_tuoi", khoKey: "dt_kho" },
] as const satisfies ReadonlyArray<{ label: string; tuoiKey: keyof MatchedSlRow; khoKey: keyof MatchedSlRow }>

// ────────────────────────────────────────────────────────────────
// Excel helpers
// ────────────────────────────────────────────────────────────────

function excelSerialToISO(serial: number): string {
  // Excel epoch: Dec 30 1899; 25569 = days between 1900-01-01 and 1970-01-01
  const ms = (serial - 25569) * 86400 * 1000
  const d = new Date(ms)
  if (isNaN(d.getTime()) || d.getFullYear() < 2000) return ""
  return normalizeDateInput(d.toISOString().slice(0, 10))
}

function toNum(v: unknown): number {
  const n = parseFloat(String(v ?? 0))
  return isNaN(n) ? 0 : Math.round(n * 100) / 100
}

async function parseSlFile(file: File): Promise<ParsedSlRow[]> {
  const XLSX = await import("xlsx")
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" })
  const dataRows = raw.slice(2) // bỏ 2 dòng header

  const result: ParsedSlRow[] = []
  dataRows.forEach((r, idx) => {
    const row = r as unknown[]
    const colC = String(row[2] ?? "").trim()
    if (!colC) return

    const ngay = typeof row[0] === "number"
      ? excelSerialToISO(row[0])
      : normalizeDateInput(String(row[0] ?? ""))
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
    const ghi_chu = String(row[18] ?? "").trim()

    result.push({
      row_index: idx + 3,
      ngay, doi, base_xe, chuyen, ghi_chu,
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

interface ExistingProductionRecord {
  id: string
  ngay: string
  doi: number
  so_xe: string
  chuyen: number
  created_at: string
  updated_at: string
}

function getMatchedKey(row: Pick<ParsedSlRow, "ngay" | "doi" | "base_xe" | "chuyen">) {
  return buildProductionRecordKey({
    ngay: row.ngay,
    doi: row.doi,
    so_xe: row.base_xe,
    chuyen: row.chuyen,
  })
}

async function loadExistingRecords(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  factoryId: string,
  parsed: ParsedSlRow[],
) {
  const uniqueDates = [...new Set(parsed.map((row) => row.ngay))]
  if (uniqueDates.length === 0) return [] as ExistingProductionRecord[]

  const { data, error } = await supabase
    .from("production_records")
    .select("id, ngay, doi, so_xe, chuyen, created_at, updated_at")
    .eq("factory_id", factoryId)
    .in("ngay", uniqueDates)

  if (error) throw new Error(error.message)
  return (data as ExistingProductionRecord[]) || []
}

function compareExistingRecordPriority(a: ExistingProductionRecord, b: ExistingProductionRecord) {
  const aStamp = a.updated_at || a.created_at || ""
  const bStamp = b.updated_at || b.created_at || ""
  if (aStamp !== bStamp) return bStamp.localeCompare(aStamp)
  if (a.created_at !== b.created_at) return b.created_at.localeCompare(a.created_at)
  return b.id.localeCompare(a.id)
}

export function matchRows(
  parsed: ParsedSlRow[],
  dispatches: DispatchEntry[],
  deliveryPoints: DeliveryPoint[],
  existingKeyCounts?: Map<string, number>,
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
      const { base_xe } = parseVehicleCode(row.so_xe ?? "")
      const chuyen = typeof row.chuyen === "number" ? row.chuyen : 1
      const k = `${base_xe}:${chuyen}`
      dayMap.set(k, { entryId: entry.id, tai_xe: row.tai_xe ?? "", diem_gn: row.diem_gn ?? [] })
    }
  }

  // track duplicates within the file
  const seen = new Map<string, number>()

  return parsed.map(row => {
    const warns: WarnCode[] = []
    const fileKey = getMatchedKey(row)
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

    if ((existingKeyCounts?.get(fileKey) ?? 0) > 0) {
      warns.push("DUPLICATE_IN_SYSTEM")
    }

    return { ...row, dispatch_entry_id, tai_xe, warn_codes: warns }
  }).map(row => {
    const fileKey = getMatchedKey(row)
    if ((seen.get(fileKey) ?? 0) > 1 && !row.warn_codes.includes("DUPLICATE_IN_FILE")) {
      return { ...row, warn_codes: [...row.warn_codes, "DUPLICATE_IN_FILE" as WarnCode] }
    }
    return row
  })
}

// ────────────────────────────────────────────────────────────────
// Kiểm tra ghi_chu theo danh mục required_notes — bắt buộc chọn từ danh mục, không tự do
// (xem .claude/rules/15-output-module.md). Rỗng luôn hợp lệ vì ghi_chu là optional.
// ────────────────────────────────────────────────────────────────

function isNoteKnown(note: string, catalog: string[]): boolean {
  if (isBlankNoteContent(note)) return true
  const trimmed = note.trim()
  return catalog.some((content) => content.trim().toLowerCase() === trimmed.toLowerCase())
}

export function applyNoteWarnings(rows: MatchedSlRow[], catalog: string[]): MatchedSlRow[] {
  return rows.map((row) => {
    const known = isNoteKnown(row.ghi_chu, catalog)
    const hasWarn = row.warn_codes.includes("UNKNOWN_NOTE")
    if (known === !hasWarn) return row
    return {
      ...row,
      warn_codes: known
        ? row.warn_codes.filter((c) => c !== "UNKNOWN_NOTE")
        : [...row.warn_codes, "UNKNOWN_NOTE" as WarnCode],
    }
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
  currentUser: SessionUser | null
}

export function OutputImport({
  factoryId, dispatches, deliveryPoints, onImported, onClose, supabase, currentUser,
}: OutputImportProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [fileName, setFileName] = useState("")
  const [matched, setMatched] = useState<MatchedSlRow[]>([])
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<{
    ok: number
    inserted: number
    updated: number
    deduped: number
    warn: number
    skippedInvalidNote: number
  } | null>(null)
  const [requiredNotes, setRequiredNotes] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (file: File) => {
    setImportError(null)
    try {
      const parsed = await parseSlFile(file)
      if (!parsed.length) { setImportError("Không tìm thấy dữ liệu hợp lệ trong file."); return }
      const existingRows = await loadExistingRecords(supabase, factoryId, parsed)
      const existingKeyCounts = new Map<string, number>()
      for (const row of existingRows) {
        const key = buildProductionRecordKey(row)
        existingKeyCounts.set(key, (existingKeyCounts.get(key) ?? 0) + 1)
      }
      const noteRows = await loadRequiredNotes(supabase, factoryId).catch(() => [])
      const noteCatalog = noteRows.map((row) => row.content)
      setRequiredNotes(noteCatalog)
      const matchedRows = matchRows(parsed, dispatches, deliveryPoints, existingKeyCounts)
      const result = applyNoteWarnings(matchedRows, noteCatalog)
      setMatched(result)
      setFileName(file.name)
      setStep(2)
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Lỗi đọc file")
    }
  }, [deliveryPoints, dispatches, factoryId, supabase])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [handleFile])

  // Lớp 1 — sửa ghi_chu trực tiếp tại đúng dòng trong bảng xem trước.
  const updateMatchedRowNote = (index: number, ghiChu: string) => {
    setMatched((prev) => prev.map((row, i) => {
      if (i !== index) return row
      const known = isNoteKnown(ghiChu, requiredNotes)
      return {
        ...row,
        ghi_chu: ghiChu,
        warn_codes: known
          ? row.warn_codes.filter((c) => c !== "UNKNOWN_NOTE")
          : row.warn_codes.includes("UNKNOWN_NOTE") ? row.warn_codes : [...row.warn_codes, "UNKNOWN_NOTE" as WarnCode],
      }
    }))
    setRequiredNotes((prev) => (
      ghiChu.trim() && !prev.some((n) => n.trim().toLowerCase() === ghiChu.trim().toLowerCase())
        ? [...prev, ghiChu.trim()]
        : prev
    ))
  }

  // Lớp 2 — thêm 1 giá trị ghi_chu lạ vào danh mục, áp dụng cho TẤT CẢ dòng đang dùng
  // đúng giá trị đó cùng lúc (tránh phải sửa từng dòng khi nhiều dòng dùng chung 1 ghi
  // chú mới hợp lệ).
  const [addingNoteContent, setAddingNoteContent] = useState<string | null>(null)
  const handleBulkAddNote = async (content: string) => {
    if (!factoryId) return
    setAddingNoteContent(content)
    try {
      const row = await createRequiredNote(supabase, factoryId, content)
      setRequiredNotes((prev) => (prev.some((n) => n.toLowerCase() === row.content.toLowerCase()) ? prev : [...prev, row.content]))
      setMatched((prev) => prev.map((r) => (
        r.ghi_chu.trim().toLowerCase() === content.trim().toLowerCase()
          ? { ...r, warn_codes: r.warn_codes.filter((c) => c !== "UNKNOWN_NOTE") }
          : r
      )))
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Không thêm được ghi chú")
    } finally {
      setAddingNoteContent(null)
    }
  }

  const unknownNoteGroups = useMemo(() => {
    const map = new Map<string, number>()
    matched.forEach((row) => {
      if (!row.warn_codes.includes("UNKNOWN_NOTE")) return
      const key = row.ghi_chu.trim()
      map.set(key, (map.get(key) ?? 0) + 1)
    })
    return [...map.entries()].map(([content, count]) => ({ content, count }))
  }, [matched])

  const activeMaterials = useMemo(() => {
    return PREVIEW_MATERIALS.filter((def) =>
      matched.some((r) => Number(r[def.tuoiKey] ?? 0) > 0 || Number(r[def.khoKey] ?? 0) > 0)
    )
  }, [matched])

  // Tổng hợp theo ngày -> loại mủ -> ghi chú (kg), dùng cho khối "Tổng hợp trước khi nhập"
  // ở footer Bước 2. Mỗi giá trị Ghi chú khác rỗng/"0" tách thành dòng riêng để không gộp
  // nhầm sản lượng có nguồn gốc/điều kiện khác nhau vào chung 1 dòng.
  const dailySummaries = useMemo(() => {
    type SummaryRow = { label: string; note: string | null; tuoi: number; kho: number }
    const dayMap = new Map<string, Map<string, SummaryRow>>()
    matched.forEach((row) => {
      const note = isBlankNoteContent(row.ghi_chu) ? null : row.ghi_chu.trim()
      let materialMap = dayMap.get(row.ngay)
      if (!materialMap) { materialMap = new Map(); dayMap.set(row.ngay, materialMap) }
      PREVIEW_MATERIALS.forEach((def) => {
        const tuoi = Number(row[def.tuoiKey] ?? 0)
        const kho = Number(row[def.khoKey] ?? 0)
        if (tuoi <= 0 && kho <= 0) return
        const key = `${def.label}__${note ?? ""}`
        const existing = materialMap!.get(key)
        if (existing) { existing.tuoi += tuoi; existing.kho += kho }
        else materialMap!.set(key, { label: def.label, note, tuoi, kho })
      })
    })
    return [...dayMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([ngay, materialMap]) => ({
        ngay,
        rows: [...materialMap.values()].sort((a, b) =>
          a.label.localeCompare(b.label) || (a.note ?? "").localeCompare(b.note ?? "")
        ),
      }))
  }, [matched])

  const handleConfirm = async (options?: { skipInvalidNotes?: boolean }) => {
    setImporting(true)
    setImportError(null)
    try {
      const duplicateInFileCount = matched.filter((row) => row.warn_codes.includes("DUPLICATE_IN_FILE")).length
      if (duplicateInFileCount > 0) {
        throw new Error(`File đang có ${duplicateInFileCount} dòng trùng khóa ngày + đội + xe + chuyến. Vui lòng xử lý file trước khi import.`)
      }

      const unresolvedNoteRows = matched.filter((row) => row.warn_codes.includes("UNKNOWN_NOTE"))
      if (unresolvedNoteRows.length > 0 && !options?.skipInvalidNotes) {
        throw new Error(`Còn ${unresolvedNoteRows.length} dòng có ghi chú chưa có trong danh mục. Sửa ở cột Ghi chú bên trên, thêm vào danh mục, hoặc bấm "Nhập phần hợp lệ, bỏ qua phần lỗi".`)
      }

      const rowsToImport = options?.skipInvalidNotes
        ? matched.filter((row) => !row.warn_codes.includes("UNKNOWN_NOTE"))
        : matched
      const skippedInvalidNote = matched.length - rowsToImport.length

      const batchId = crypto.randomUUID()
      const rows = rowsToImport.map(r => ({
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
        ghi_chu: isBlankNoteContent(r.ghi_chu) ? null : r.ghi_chu.trim(),
        nguoi_upload: currentUser?.full_name || currentUser?.username || null,
        created_by: currentUser?.id ?? null,
      }))
      const existingRows = await loadExistingRecords(supabase, factoryId, rowsToImport)
      const existingByKey = new Map<string, ExistingProductionRecord[]>()
      for (const row of existingRows) {
        const key = buildProductionRecordKey(row)
        const bucket = existingByKey.get(key)
        if (bucket) bucket.push(row)
        else existingByKey.set(key, [row])
      }
      for (const bucket of existingByKey.values()) bucket.sort(compareExistingRecordPriority)

      const insertRows: typeof rows = []
      const updateRows: Array<(typeof rows)[number] & { id: string }> = []
      const deleteIds: string[] = []
      let inserted = 0
      let updated = 0
      let deduped = 0

      for (const row of rows) {
        const key = buildProductionRecordKey(row)
        const existing = existingByKey.get(key) ?? []
        if (existing.length === 0) {
          insertRows.push(row)
          inserted += 1
          continue
        }

        const [primary, ...duplicates] = existing
        updateRows.push({ ...row, id: primary.id })
        updated += 1

        if (duplicates.length > 0) {
          deleteIds.push(...duplicates.map((item) => item.id))
          deduped += duplicates.length
        }
      }

      if (deleteIds.length > 0) {
        const { error } = await supabase.from("production_records").delete().in("id", deleteIds)
        if (error) throw new Error(error.message)
      }

      if (insertRows.length > 0) {
        const { error } = await supabase.from("production_records").insert(insertRows)
        if (error) throw new Error(error.message)
      }

      for (const row of updateRows) {
        const { id, ...payload } = row
        const { error } = await supabase.from("production_records").update(payload).eq("id", id)
        if (error) throw new Error(error.message)
      }

      const uniqueNgays = [...new Set(rows.map(r => r.ngay))]
      await Promise.all(uniqueNgays.map((ngay) => writeBackToDispatch(factoryId, ngay, supabase)))
      setImportResult({
        ok: rows.length,
        inserted,
        updated,
        deduped,
        warn: rows.filter(r => r.warn_codes.length > 0).length,
        skippedInvalidNote,
      })
      setStep(3)
      onImported()
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
  const hasDuplicateInFile = matched.some(r => r.warn_codes.includes("DUPLICATE_IN_FILE"))
  const unresolvedNoteCount = matched.filter(r => r.warn_codes.includes("UNKNOWN_NOTE")).length
  const validCount = matched.length - unresolvedNoteCount

  return (
    <ModalShell
      title={
        <span className="flex items-center gap-3">
          <FileSpreadsheet size={20} className="text-emerald-600" />
          Import file sản lượng
          {/* steps */}
          <span className="hidden md:flex items-center gap-1 ml-4">
            {([1,2,3] as const).map(s => (
              <span key={s} className={`flex items-center gap-1 text-xs font-bold ${step === s ? "text-emerald-700" : step > s ? "text-slate-400" : "text-slate-300"}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${step === s ? "bg-emerald-600 text-white" : step > s ? "bg-slate-300 text-slate-600" : "bg-slate-100 text-slate-400"}`}>{s}</span>
                {s === 1 ? "Chọn file" : s === 2 ? "Xem trước" : "Hoàn thành"}
                {s < 3 && <ChevronRight size={12} className="text-slate-300" />}
              </span>
            ))}
          </span>
        </span>
      }
      onClose={onClose}
      maxWidth="5xl"
      footer={(step === 1 || step === 2) && (
        <div className="flex flex-col gap-3 w-full">
          {step === 2 && dailySummaries.length > 0 && (
            <details className="rounded-xl border border-slate-200 bg-slate-50">
              <summary className="cursor-pointer select-none px-3 py-2 text-xs font-bold text-slate-600">
                Tổng hợp trước khi nhập ({dailySummaries.length} ngày)
              </summary>
              <div className="max-h-40 overflow-y-auto px-3 pb-2 space-y-2">
                {dailySummaries.map((day) => (
                  <div key={day.ngay}>
                    <p className="text-xs font-bold text-slate-700">{formatDateDisplay(day.ngay) || day.ngay}</p>
                    <div className="mt-0.5 space-y-0.5">
                      {day.rows.map((row, idx) => (
                        <div key={idx} className="flex items-center justify-between gap-2 text-xs text-slate-600">
                          <span className="truncate">
                            {row.label}
                            {row.note && <span className="ml-1.5 text-slate-400">· {row.note}</span>}
                          </span>
                          <span className="shrink-0 font-medium text-slate-700">
                            {row.tuoi.toLocaleString("vi-VN")} kg tươi / {row.kho.toLocaleString("vi-VN")} kg khô
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
          <div className="flex flex-col items-end gap-2 w-full sm:flex-row sm:items-center sm:justify-between">
          <button
            onClick={() => { if (step === 2) setStep(1); else onClose() }}
            className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
          >
            {step === 2 ? "← Chọn lại file" : "Hủy"}
          </button>
          {step === 2 && (
            <div className="flex flex-col items-end gap-2">
              {unresolvedNoteCount > 0 && !hasDuplicateInFile && (
                <button
                  onClick={() => handleConfirm({ skipInvalidNotes: true })}
                  disabled={importing || validCount === 0}
                  className="px-4 py-2 text-sm font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 disabled:opacity-60 rounded-xl transition-all"
                >
                  Nhập {validCount} dòng hợp lệ, bỏ qua {unresolvedNoteCount} dòng lỗi
                </button>
              )}
              <button
                onClick={() => handleConfirm()}
                disabled={importing || hasDuplicateInFile || unresolvedNoteCount > 0}
                title={
                  hasDuplicateInFile
                    ? "File đang trùng khóa, không thể nhập"
                    : unresolvedNoteCount > 0
                      ? `Còn ${unresolvedNoteCount} dòng ghi chú chưa hợp lệ — sửa ở bảng trên hoặc bỏ qua các dòng này`
                      : undefined
                }
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold rounded-xl shadow-md transition-all"
              >
                {importing ? "Đang nhập..." : `Nhập ${matched.length} bản ghi${warnCount > 0 ? ` (${warnCount} cảnh báo)` : ""}`}
              </button>
            </div>
          )}
          </div>
        </div>
      )}
    >
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
                <p className="font-bold mb-2">Cấu trúc file (19 cột A–S):</p>
                <p>A: Ngày &nbsp;|&nbsp; B: Đội (1–12) &nbsp;|&nbsp; C: Số xe (1A, 1A2, 1A3...)</p>
                <p>D–F: Mủ nước &nbsp;|&nbsp; G–I: Mủ chén &nbsp;|&nbsp; J–L: Mủ đông chén &nbsp;|&nbsp; M–O: Mủ đông khối &nbsp;|&nbsp; P–R: Mủ dây</p>
                <p className="mt-1 text-slate-400">Mỗi nhóm: Tươi / DRC% / Khô · Cột S: Ghi chú</p>
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

              {unknownNoteGroups.length > 0 && (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3">
                  <p className="text-xs font-bold text-red-700 mb-2">
                    {unknownNoteGroups.length} ghi chú trong file chưa có trong danh mục — bấm &quot;Thêm vào danh mục&quot; để duyệt hàng loạt, hoặc sửa từng dòng ở cột Ghi chú bên dưới.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {unknownNoteGroups.map(({ content, count }) => (
                      <div key={content} className="flex items-center gap-2 bg-white border border-red-200 rounded-lg pl-3 pr-1.5 py-1">
                        <span className="text-xs font-semibold text-slate-700">{content}</span>
                        <span className="text-[10px] font-bold text-red-500">×{count}</span>
                        <button
                          type="button"
                          onClick={() => void handleBulkAddNote(content)}
                          disabled={addingNoteContent === content}
                          className="flex items-center gap-1 px-2 py-1 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-60 text-emerald-700 text-[10px] font-bold rounded-md transition-colors"
                        >
                          <Plus size={10} />
                          {addingNoteContent === content ? "Đang thêm..." : "Thêm vào danh mục"}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <ResponsiveTableWrapper className="rounded-xl">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2 text-left font-bold text-slate-600">Ngày</th>
                      <th className="px-3 py-2 text-center font-bold text-slate-600">Đội</th>
                      <th className="px-3 py-2 text-left font-bold text-slate-600">Số xe</th>
                      <th className="px-3 py-2 text-center font-bold text-slate-600">Chuyến</th>
                      <th className="px-3 py-2 text-left font-bold text-slate-600">Tài xế</th>
                      {activeMaterials.map((def) => (
                        <Fragment key={def.label}>
                          <th className="px-3 py-2 text-right font-bold text-slate-600 whitespace-nowrap">{def.label} — Tươi (kg)</th>
                          <th className="px-3 py-2 text-right font-bold text-slate-600 whitespace-nowrap">{def.label} — Khô (kg)</th>
                        </Fragment>
                      ))}
                      <th className="px-3 py-2 text-left font-bold text-slate-600">Ghi chú</th>
                      <th className="px-3 py-2 text-left font-bold text-slate-600">Cảnh báo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matched.map((r, i) => {
                      const hasRed = r.warn_codes.some(c => WARN_SEVERITY[c] === "red")
                      const hasAmber = !hasRed && r.warn_codes.some(c => WARN_SEVERITY[c] === "amber")
                      const rowCls = hasRed ? "bg-red-50" : hasAmber ? "bg-amber-50/50" : i % 2 === 0 ? "bg-white" : "bg-slate-50/50"
                      return (
                        <tr key={i} className={rowCls}>
                          <td className="px-3 py-1.5 text-slate-700">{r.ngay}</td>
                          <td className="px-3 py-1.5 text-center font-bold text-slate-700">{r.doi}</td>
                          <td className="px-3 py-1.5 font-mono font-bold text-slate-800">{r.base_xe}</td>
                          <td className="px-3 py-1.5 text-center text-slate-600">{r.chuyen}</td>
                          <td className="px-3 py-1.5 text-slate-600">{r.tai_xe || <span className="text-slate-300">—</span>}</td>
                          {activeMaterials.map((def) => {
                            const tuoi = Number(r[def.tuoiKey] ?? 0)
                            const kho = Number(r[def.khoKey] ?? 0)
                            return (
                              <Fragment key={def.label}>
                                <td className="px-3 py-1.5 text-right text-slate-700">{tuoi > 0 ? tuoi.toLocaleString("vi-VN") : "—"}</td>
                                <td className="px-3 py-1.5 text-right font-bold text-emerald-700">{kho > 0 ? kho.toLocaleString("vi-VN") : "—"}</td>
                              </Fragment>
                            )
                          })}
                          <td className="px-3 py-1.5 text-slate-500 min-w-[140px]">
                            {r.warn_codes.includes("UNKNOWN_NOTE") ? (
                              <RequiredNoteSelect
                                factoryId={factoryId}
                                value={r.ghi_chu}
                                onChange={(v) => updateMatchedRowNote(i, v)}
                                className="w-full px-2 py-1 border border-red-300 rounded-lg text-xs"
                                onError={setImportError}
                              />
                            ) : (
                              r.ghi_chu || <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td className="px-3 py-1.5">
                            {r.warn_codes.map(c => <WarnBadge key={c} code={c} />)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </ResponsiveTableWrapper>

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
              {importResult.skippedInvalidNote > 0 && (
                <p className="text-sm text-red-600 max-w-md text-center">
                  <span className="font-bold">{importResult.skippedInvalidNote}</span> dòng đã bị bỏ qua do ghi chú không hợp lệ — vào Danh sách sản lượng và sửa tay các dòng đó qua ô Ghi chú (chọn từ danh mục).
                </p>
              )}
              <button onClick={onClose} className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all">
                Đóng
              </button>
            </div>
          )}
    </ModalShell>
  )
}
