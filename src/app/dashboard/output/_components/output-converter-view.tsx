"use client"

import { useState, useRef, useMemo, useEffect } from "react"
import {
  ArrowLeft, Upload, CheckCircle2, AlertTriangle, XCircle,
  RefreshCw, Download, Check, Sparkles,
  Database, Send, Split, Search, X
} from "lucide-react"
import { PageBackgroundMotif } from "@/app/dashboard/_components/page-background-motif"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { supabase } from "@/lib/supabase"
import type { SessionUser } from "@/lib/auth"
import type { ParsedSlTruckRow, ParsedOutputReport } from "@/lib/output-parser"
import { writeBackToDispatch, buildProductionRecordKey } from "./output-types"
import { normalizeDateInput, formatDateDisplay } from "@/lib/date-utils"
import ExcelJS from "exceljs"
import { saveAs } from "file-saver"

export function FxToExcelIcon({ className = "w-9 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <text x="2" y="21" fontFamily="Times New Roman, serif" fontStyle="italic" fontWeight="bold" fontSize="22" fill="currentColor">
        f
      </text>
      <text x="13" y="19" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="bold" fontSize="13" fill="currentColor">
        (x)
      </text>
      <path
        d="M29 14H39M39 14L35 10M39 14L35 18"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M44 4C44 2.89543 44.8954 2 46 2H55.5L62 8.5V24C62 25.1046 61.1046 26 60 26H46C44.8954 26 44 25.1046 44 24V4Z"
        fill="currentColor"
      />
      <path d="M55 2V8H61" stroke="rgba(0,0,0,0.15)" strokeWidth="1.2" fill="none" />
      <text x="47" y="18" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="900" fontSize="11" fill="#047857">
        X
      </text>
      <rect x="53.5" y="12" width="2.5" height="2" rx="0.5" fill="#047857" />
      <rect x="57" y="12" width="2.5" height="2" rx="0.5" fill="#047857" />
      <rect x="53.5" y="15" width="2.5" height="2" rx="0.5" fill="#047857" />
      <rect x="57" y="15" width="2.5" height="2" rx="0.5" fill="#047857" />
    </svg>
  )
}

export type MatchStatus =
  | "match_ready"           // 🟢 Khớp hoàn toàn
  | "warn_need_split"        // 🟡 1 dòng gộp 2 chuyến
  | "warn_no_dispatch"       // 🟡 Không có trong điều xe
  | "warn_doi_mismatch"      // 🟡 Lệch đội
  | "warn_duplicate_system"  // 🟡 Đã có sản lượng trong hệ thống
  | "error_zero_kl"          // 🔴 Tất cả khối lượng = 0
  | "error_invalid"          // 🔴 Dữ liệu thiếu/lỗi

export interface MatchedRow extends ParsedSlTruckRow {
  uid: string
  status: MatchStatus
  message: string
  tai_xe?: string
  diem_gn?: string[]
  dispatch_entry_id?: string
  selected: boolean
  is_manually_resolved?: boolean
}

export interface DispatchTripSummary {
  entryId: string
  uid: string
  so_xe: string
  chuyen: number
  tai_xe: string
  diem_gn: string[]
  dois: number[]
}

interface Props {
  currentUser: SessionUser | null
  factoryId: string
  onBack: () => void
  onSuccess: (count: number, date: string) => void
  showToast?: (msg: string, ok?: boolean) => void
}

export function OutputConverterView({
  currentUser,
  factoryId,
  onBack,
  onSuccess,
  showToast = () => {},
}: Props) {
  // File upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [parseResult, setParseResult] = useState<ParsedOutputReport | null>(null)
  const [rows, setRows] = useState<MatchedRow[]>([])
  const [savingToDb, setSavingToDb] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Filters & Search
  const [searchVeh, setSearchVeh] = useState("")
  const [filterDoi, setFilterDoi] = useState<string>("ALL")
  const [filterStatus, setFilterStatus] = useState<string>("ALL")

  // Modal Xử lý Lệch tương tác
  const [resolvingRow, setResolvingRow] = useState<MatchedRow | null>(null)
  const [splitTrip1Kl, setSplitTrip1Kl] = useState<number>(0)
  const [splitTrip2Kl, setSplitTrip2Kl] = useState<number>(0)

  // Nạp Điều xe và Lịch sử sản lượng khi có ngày
  const activeDate = parseResult?.detectedDate || ""

  useEffect(() => {
    if (!factoryId || !activeDate) return
    let isSubscribed = true

    const loadDispatchAndExisting = async () => {
      try {
        const normalized = normalizeDateInput(activeDate)
        // 1. Tải Lệnh điều xe ngày
        const { data: entries } = await supabase
          .from("dispatch_entries")
          .select("id, ngay, rows")
          .eq("factory_id", factoryId)

        // 2. Tải danh sách điểm giao nhận để tra cứu đội
        const { data: deliveryPoints } = await supabase
          .from("dispatch_delivery_points")
          .select("ma_lo, doi")
          .eq("factory_id", factoryId)
          .eq("is_active", true)

        const doiByMaLo = new Map<string, number>()
        ;(deliveryPoints || []).forEach((p: { ma_lo: string; doi: number }) => {
          doiByMaLo.set(p.ma_lo, p.doi)
        })

        const trips: DispatchTripSummary[] = []
        for (const entry of entries || []) {
          const entryDate = normalizeDateInput(entry.ngay)
          if (entryDate !== normalized) continue
          for (const r of entry.rows || []) {
            const rawXe = String(r.so_xe || "").trim().toUpperCase().replace(/^0+(\d)/, "$1")
            const diemGn = Array.isArray(r.diem_gn) ? r.diem_gn : []
            const rowDois = Array.isArray(r.doi) && r.doi.length > 0
              ? r.doi
              : [...new Set(diemGn.map((m: string) => doiByMaLo.get(m)).filter(Boolean))]

            trips.push({
              entryId: entry.id,
              uid: r.uid || `${entry.id}_${rawXe}_${r.chuyen}`,
              so_xe: rawXe,
              chuyen: Number(r.chuyen || 1),
              tai_xe: r.tai_xe || "",
              diem_gn: diemGn,
              dois: rowDois as number[],
            })
          }
        }

        // 3. Tải sản lượng đã có trong hệ thống ngày này
        const { data: existingRecords } = await supabase
          .from("production_records")
          .select("id, ngay, doi, so_xe, chuyen")
          .eq("factory_id", factoryId)
          .eq("ngay", normalized)

        const existingSet = new Set<string>()
        ;(existingRecords || []).forEach((rec: { ngay: string; doi: number; so_xe: string; chuyen: number }) => {
          existingSet.add(buildProductionRecordKey({
            ngay: rec.ngay,
            doi: rec.doi,
            so_xe: rec.so_xe,
            chuyen: rec.chuyen,
          }))
        })

        if (!isSubscribed) return

        // Thực hiện đối soát nếu đã có rows bóc tách
        if (parseResult?.rows?.length) {
          const matched = runSmartMatching(parseResult.rows, trips, existingSet)
          setRows(matched)
        }
      } catch (err) {
        console.error("Lỗi tải dữ liệu điều xe:", err)
      }
    }

    loadDispatchAndExisting()
    return () => { isSubscribed = false }
  }, [factoryId, activeDate, parseResult])

  // Thuật toán đối soát thông minh (Smart Matching)
  const runSmartMatching = (
    parsedRows: ParsedSlTruckRow[],
    trips: DispatchTripSummary[],
    existingSet: Set<string>
  ): MatchedRow[] => {
    const tripsByVeh = new Map<string, DispatchTripSummary[]>()
    for (const t of trips) {
      const vKey = t.so_xe.toUpperCase().replace(/^0+(\d)/, "$1")
      const list = tripsByVeh.get(vKey) || []
      list.push(t)
      tripsByVeh.set(vKey, list)
    }

    return parsedRows.map((row, idx) => {
      const vKey = row.base_xe
      const candidateTrips = tripsByVeh.get(vKey) || []
      const uid = `row_${idx}_${row.doi}_${row.base_xe}_${row.chuyen}`

      const allZero = !row.mn_tuoi && !row.ct_tuoi && !row.dct_tuoi && !row.dkt_tuoi && !row.dt_tuoi &&
                      !row.mn_kho && !row.ct_kho && !row.dct_kho && !row.dkt_kho && !row.dt_kho

      if (allZero) {
        return {
          ...row,
          uid,
          status: "error_zero_kl",
          message: "Tất cả khối lượng tươi và khô đều bằng 0",
          selected: false,
        }
      }

      const fileKey = buildProductionRecordKey({
        ngay: row.ngay,
        doi: row.doi,
        so_xe: row.base_xe,
        chuyen: row.chuyen,
      })
      const isDuplicateInDb = existingSet.has(fileKey)

      if (candidateTrips.length === 0) {
        return {
          ...row,
          uid,
          status: "warn_no_dispatch",
          message: `Xe ${row.base_xe} không có trong Điều xe ngày ${formatDateDisplay(row.ngay)}`,
          selected: false,
        }
      }

      // Nếu tên xe trong file có chỉ định chuyến rõ ràng (vd: 7A2 -> chuyến 2)
      if (row.chuyen_tu_ten) {
        const matchedTrip = candidateTrips.find((t) => t.chuyen === row.chuyen)
        if (matchedTrip) {
          const matchDoi = matchedTrip.dois.length === 0 || matchedTrip.dois.includes(row.doi)
          return {
            ...row,
            uid,
            tai_xe: matchedTrip.tai_xe,
            diem_gn: matchedTrip.diem_gn,
            dispatch_entry_id: matchedTrip.entryId,
            status: matchDoi
              ? (isDuplicateInDb ? "warn_duplicate_system" : "match_ready")
              : "warn_doi_mismatch",
            message: matchDoi
              ? (isDuplicateInDb ? "Đã có sản lượng trong hệ thống (ghi đè)" : "Khớp xe và chuyến từ tên file")
              : `Đội ${row.doi} không khớp điểm giao nhận chuyến ${row.chuyen}`,
            selected: matchDoi,
          }
        }
      }

      // Nếu xe chỉ có đúng 1 chuyến điều xe trong ngày
      if (candidateTrips.length === 1) {
        const trip = candidateTrips[0]
        const matchDoi = trip.dois.length === 0 || trip.dois.includes(row.doi)
        return {
          ...row,
          uid,
          chuyen: trip.chuyen,
          tai_xe: trip.tai_xe,
          diem_gn: trip.diem_gn,
          dispatch_entry_id: trip.entryId,
          status: matchDoi
            ? (isDuplicateInDb ? "warn_duplicate_system" : "match_ready")
            : "warn_doi_mismatch",
          message: matchDoi
            ? (isDuplicateInDb ? "Đã có sản lượng trong hệ thống (ghi đè)" : "Khớp hoàn toàn 1-1")
            : `Đội ${row.doi} khác điểm giao nhận trong điều xe (Đội ${trip.dois.join(", ")})`,
          selected: matchDoi,
        }
      }

      // Nếu xe có nhiều chuyến: tìm chuyến có điểm GN thuộc Đội này
      const matchingTrips = candidateTrips.filter((t) => t.dois.includes(row.doi))
      if (matchingTrips.length === 1) {
        const trip = matchingTrips[0]
        return {
          ...row,
          uid,
          chuyen: trip.chuyen,
          tai_xe: trip.tai_xe,
          diem_gn: trip.diem_gn,
          dispatch_entry_id: trip.entryId,
          status: isDuplicateInDb ? "warn_duplicate_system" : "match_ready",
          message: isDuplicateInDb
            ? "Đã có sản lượng trong hệ thống (ghi đè)"
            : `Tự động ghép Chuyến ${trip.chuyen} theo điểm giao nhận Đội ${row.doi}`,
          selected: true,
        }
      }

      if (matchingTrips.length > 1) {
        // Xe đi 2 chuyến cùng thuộc 1 Đội
        return {
          ...row,
          uid,
          chuyen: matchingTrips[0].chuyen,
          tai_xe: matchingTrips[0].tai_xe,
          dispatch_entry_id: matchingTrips[0].entryId,
          status: "warn_need_split",
          message: `Xe đi ${matchingTrips.length} chuyến cùng Đội ${row.doi} (Cần xác nhận chuyến hoặc tách khối lượng)`,
          selected: false,
        }
      }

      // Không có chuyến nào khớp đội
      return {
        ...row,
        uid,
        chuyen: candidateTrips[0].chuyen,
        tai_xe: candidateTrips[0].tai_xe,
        dispatch_entry_id: candidateTrips[0].entryId,
        status: "warn_doi_mismatch",
        message: `Đội ${row.doi} không khớp với bất kỳ chuyến nào của xe ${row.base_xe}`,
        selected: false,
      }
    })
  }

  // Xử lý Upload file qua API
  const handleFileUpload = async (file: File) => {
    setSelectedFile(file)
    setAnalyzing(true)
    try {
      const formData = new FormData()
      formData.append("file", file)

      const session = (await supabase.auth.getSession()).data.session
      const token = session?.access_token || ""

      const res = await fetch("/api/output/parse-report", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      })

      const data: ParsedOutputReport = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Không thể bóc tách file báo cáo.")
      }

      setParseResult(data)
      showToast(`Đã bóc tách thành công ${data.rows.length} dòng dữ liệu sản lượng`, true)
    } catch (err) {
      console.error("Lỗi upload file:", err)
      showToast(err instanceof Error ? err.message : "Lỗi bóc tách file", false)
    } finally {
      setAnalyzing(false)
    }
  }

  // Thống kê nhanh
  const stats = useMemo(() => {
    let ready = 0
    let warn = 0
    let err = 0
    let totalKg = 0
    rows.forEach((r) => {
      if (r.status === "match_ready") ready++
      else if (r.status.startsWith("warn_")) warn++
      else err++
      if (r.selected) totalKg += r.tong_kho
    })
    return {
      total: rows.length,
      ready,
      warn,
      err,
      selectedCount: rows.filter((r) => r.selected).length,
      totalKg: Math.round(totalKg * 100) / 100,
    }
  }, [rows])

  // Lọc hiển thị
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (searchVeh && !r.base_xe.includes(searchVeh.toUpperCase()) && !r.raw_xe.toUpperCase().includes(searchVeh.toUpperCase())) {
        return false
      }
      if (filterDoi !== "ALL" && String(r.doi) !== filterDoi) {
        return false
      }
      if (filterStatus === "READY" && r.status !== "match_ready") return false
      if (filterStatus === "WARN" && !r.status.startsWith("warn_")) return false
      if (filterStatus === "ERROR" && !r.status.startsWith("error_")) return false
      return true
    })
  }, [rows, searchVeh, filterDoi, filterStatus])

  // Thao tác giải quyết cảnh báo: Tách khối lượng hoặc chọn chuyến
  const handleOpenResolve = (row: MatchedRow) => {
    setResolvingRow(row)
    setSplitTrip1Kl(row.tong_kho)
    setSplitTrip2Kl(0)
  }

  const handleApplyResolution = (action: "split" | "assign_trip" | "bypass_dispatch", chosenChuyen = 1) => {
    if (!resolvingRow) return

    if (action === "split") {
      // Tách 1 dòng thành 2 dòng (chuyến 1 và chuyến 2)
      setRows((prev) => {
        const next: MatchedRow[] = []
        for (const r of prev) {
          if (r.uid === resolvingRow.uid) {
            // Dòng chuyến 1
            const ratio1 = resolvingRow.tong_kho > 0 ? splitTrip1Kl / resolvingRow.tong_kho : 0.5
            const ratio2 = resolvingRow.tong_kho > 0 ? splitTrip2Kl / resolvingRow.tong_kho : 0.5

            next.push({
              ...r,
              uid: `${r.uid}_ch1`,
              chuyen: 1,
              dct_tuoi: Math.round(r.dct_tuoi * ratio1 * 100) / 100,
              dct_kho: Math.round(r.dct_kho * ratio1 * 100) / 100,
              dt_tuoi: Math.round(r.dt_tuoi * ratio1 * 100) / 100,
              dt_kho: Math.round(r.dt_kho * ratio1 * 100) / 100,
              tong_kho: Math.round(splitTrip1Kl * 100) / 100,
              status: "match_ready",
              message: "Đã tách thủ công vào Chuyến 1",
              selected: true,
              is_manually_resolved: true,
            })

            // Dòng chuyến 2
            next.push({
              ...r,
              uid: `${r.uid}_ch2`,
              chuyen: 2,
              dct_tuoi: Math.round(r.dct_tuoi * ratio2 * 100) / 100,
              dct_kho: Math.round(r.dct_kho * ratio2 * 100) / 100,
              dt_tuoi: Math.round(r.dt_tuoi * ratio2 * 100) / 100,
              dt_kho: Math.round(r.dt_kho * ratio2 * 100) / 100,
              tong_kho: Math.round(splitTrip2Kl * 100) / 100,
              status: "match_ready",
              message: "Đã tách thủ công vào Chuyến 2",
              selected: true,
              is_manually_resolved: true,
            })
          } else {
            next.push(r)
          }
        }
        return next
      })
      showToast(`Đã tách sản lượng xe ${resolvingRow.base_xe} thành 2 chuyến`, true)
    } else if (action === "assign_trip") {
      setRows((prev) =>
        prev.map((r) =>
          r.uid === resolvingRow.uid
            ? {
                ...r,
                chuyen: chosenChuyen,
                status: "match_ready",
                message: `Đã gán thủ công vào Chuyến ${chosenChuyen}`,
                selected: true,
                is_manually_resolved: true,
              }
            : r,
        ),
      )
      showToast(`Đã gán xe ${resolvingRow.base_xe} vào Chuyến ${chosenChuyen}`, true)
    } else if (action === "bypass_dispatch") {
      setRows((prev) =>
        prev.map((r) =>
          r.uid === resolvingRow.uid
            ? {
                ...r,
                status: "match_ready",
                message: "Chấp nhận lưu độc lập không qua điều xe",
                selected: true,
                is_manually_resolved: true,
              }
            : r,
        ),
      )
      showToast(`Đã cho phép lưu độc lập xe ${resolvingRow.base_xe}`, true)
    }

    setResolvingRow(null)
  }

  // Tác vụ: Đẩy thẳng lên phân hệ Sản lượng & Ghi ngược Điều xe
  const handleCommitToSystem = async () => {
    const selectedRows = rows.filter((r) => r.selected)
    if (selectedRows.length === 0) {
      showToast("Chưa chọn dòng dữ liệu nào để đẩy lên hệ thống", false)
      return
    }

    setSavingToDb(true)
    try {
      const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      const normalizedDate = normalizeDateInput(activeDate)

      // 1. Chuẩn bị payload nạp vào production_records
      const insertPayload = selectedRows.map((r) => ({
        factory_id: factoryId,
        ngay: normalizedDate,
        doi: r.doi,
        so_xe: r.base_xe,
        chuyen: r.chuyen,
        tai_xe: r.tai_xe || null,
        dispatch_entry_id: r.dispatch_entry_id || null,
        mn_tuoi: r.mn_tuoi, mn_drc: r.mn_drc, mn_kho: r.mn_kho,
        ct_tuoi: r.ct_tuoi, ct_drc: r.ct_drc, ct_kho: r.ct_kho,
        dct_tuoi: r.dct_tuoi, dct_drc: r.dct_drc, dct_kho: r.dct_kho,
        dkt_tuoi: r.dkt_tuoi, dkt_drc: r.dkt_drc, dkt_kho: r.dkt_kho,
        dt_tuoi: r.dt_tuoi, dt_drc: r.dt_drc, dt_kho: r.dt_kho,
        ghi_chu: r.ghi_chu || null,
        created_by: currentUser?.id || null,
        nguoi_upload: currentUser?.full_name || currentUser?.username || "Hỗ trợ kỹ thuật",
        import_batch_id: batchId,
        warn_codes: r.status === "match_ready" ? [] : [r.status],
      }))

      // Xóa các bản ghi trùng của các xe đã chọn để ghi đè sạch sẽ
      for (const item of insertPayload) {
        await supabase
          .from("production_records")
          .delete()
          .eq("factory_id", factoryId)
          .eq("ngay", normalizedDate)
          .eq("doi", item.doi)
          .eq("so_xe", item.so_xe)
          .eq("chuyen", item.chuyen)
      }

      // Chèn các bản ghi mới
      const { error: insertErr } = await supabase
        .from("production_records")
        .insert(insertPayload)

      if (insertErr) throw new Error(insertErr.message)

      // 2. Ghi ngược khối lượng thực tế về Điều xe và cập nhật tổng kho
      await writeBackToDispatch(factoryId, normalizedDate, supabase)

      showToast(`Đã đẩy thành công ${selectedRows.length} bản ghi sản lượng & đồng bộ sang Điều xe`, true)
      onSuccess(selectedRows.length, normalizedDate)
    } catch (err) {
      console.error("Lỗi lưu dữ liệu:", err)
      showToast(err instanceof Error ? err.message : "Lỗi khi lưu sản lượng vào hệ thống", false)
    } finally {
      setSavingToDb(false)
    }
  }

  // Tác vụ: Tải file Excel đối chiếu chuẩn hóa
  const handleExportExcel = async () => {
    if (rows.length === 0) return

    const workbook = new ExcelJS.Workbook()
    workbook.creator = "Rubber ERP - Output Converter Engine"
    workbook.created = new Date()

    const sheet = workbook.addWorksheet("DoiSoat_SanLuong", {
      views: [{ showGridLines: true }],
    })

    // Header styling
    sheet.columns = [
      { header: "STT", key: "stt", width: 8 },
      { header: "Ngày", key: "ngay", width: 14 },
      { header: "Đội", key: "doi", width: 10 },
      { header: "Số xe (File)", key: "raw_xe", width: 14 },
      { header: "Số xe chuẩn", key: "base_xe", width: 14 },
      { header: "Chuyến", key: "chuyen", width: 10 },
      { header: "Tài xế", key: "tai_xe", width: 22 },
      { header: "Điểm GN", key: "diem_gn", width: 18 },
      { header: "Đông chén Tươi (kg)", key: "dct_tuoi", width: 18 },
      { header: "Đông chén DRC (%)", key: "dct_drc", width: 18 },
      { header: "Đông chén Khô (kg)", key: "dct_kho", width: 18 },
      { header: "Mủ dây Tươi (kg)", key: "dt_tuoi", width: 16 },
      { header: "Mủ dây Khô (kg)", key: "dt_kho", width: 16 },
      { header: "Tổng khô (kg)", key: "tong_kho", width: 16 },
      { header: "Trạng thái đối soát", key: "status", width: 22 },
      { header: "Ghi chú đối soát", key: "message", width: 35 },
    ]

    const headerRow = sheet.getRow(1)
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } }
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF047857" } }
    headerRow.alignment = { vertical: "middle", horizontal: "center" }

    rows.forEach((r, i) => {
      const row = sheet.addRow({
        stt: i + 1,
        ngay: formatDateDisplay(r.ngay),
        doi: r.doi === 0 ? "Thu mua" : `Đội ${r.doi}`,
        raw_xe: r.raw_xe,
        base_xe: r.base_xe,
        chuyen: r.chuyen,
        tai_xe: r.tai_xe || "—",
        diem_gn: (r.diem_gn || []).join(", ") || "—",
        dct_tuoi: r.dct_tuoi || 0,
        dct_drc: r.dct_drc || 0,
        dct_kho: r.dct_kho || 0,
        dt_tuoi: r.dt_tuoi || 0,
        dt_kho: r.dt_kho || 0,
        tong_kho: r.tong_kho || 0,
        status: r.status === "match_ready" ? "Khớp hoàn toàn" : r.status.startsWith("warn_") ? "Có cảnh báo" : "Lỗi",
        message: r.message,
      })

      // Tô màu dòng theo trạng thái
      if (r.status === "match_ready") {
        row.getCell("status").font = { color: { argb: "FF047857" }, bold: true }
      } else if (r.status.startsWith("warn_")) {
        row.getCell("status").font = { color: { argb: "FFD97706" }, bold: true }
      } else {
        row.getCell("status").font = { color: { argb: "FFDC2626" }, bold: true }
      }
    })

    const buf = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
    saveAs(blob, `DoiSoat_SanLuong_${activeDate || "report"}.xlsx`)
    showToast("Đã xuất file Excel đối chiếu thành công", true)
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto space-y-6">
      <PageBackgroundMotif theme="forest" />

      {/* ── Top Navigation Bar ────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white/80 backdrop-blur-md p-4 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2.5 rounded-xl border border-slate-200 hover:bg-slate-100 active:scale-95 transition-all text-slate-600 hover:text-slate-900"
            title="Quay lại danh sách sản lượng"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                <Sparkles className="w-3.5 h-3.5" /> Hỗ trợ Kỹ thuật Sản lượng
              </span>
              {activeDate && (
                <span className="text-xs font-bold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200">
                  Ngày {formatDateDisplay(activeDate)}
                </span>
              )}
            </div>
            <h1 className="text-lg sm:text-xl font-black text-slate-800 tracking-tight mt-0.5">
              Bóc tách Báo cáo Trạm cân & Đối soát Điều xe
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {rows.length > 0 && (
            <button
              onClick={handleExportExcel}
              className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-sm shadow-xs transition-all active:scale-95"
            >
              <Download className="w-4 h-4 text-emerald-600" />
              <span>Tải file Excel đối chiếu</span>
            </button>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-sm transition-all active:scale-95"
          >
            <Upload className="w-4 h-4" />
            <span>{selectedFile ? "Chọn file khác" : "Chọn file báo cáo"}</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFileUpload(file)
            }}
          />
        </div>
      </div>

      {/* ── Dropzone & Upload State ────────────────────────────────────── */}
      {!selectedFile && (
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-emerald-300 hover:border-emerald-500 bg-emerald-50/40 hover:bg-emerald-50/70 p-10 rounded-3xl text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-3"
        >
          <div className="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center shadow-xs">
            <Upload className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-base font-extrabold text-slate-800">
              Kéo thả hoặc Nhấp để tải tệp Báo cáo Sản lượng
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              Hỗ trợ file chi tiết từng đội (<code className="text-emerald-700 font-bold">SLRpt_SanLuongNgay.xlsx</code>) hoặc bản in PDF từ trạm cân / phòng Quản lý chất lượng.
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs font-bold text-slate-400 mt-2">
            <span>✓ Tự động bóc tách 12 đội</span>
            <span>•</span>
            <span>✓ Tự ghép xe & chuyến</span>
            <span>•</span>
            <span>✓ Đồng bộ ngược Điều xe</span>
          </div>
        </div>
      )}

      {/* ── Đang phân tích file ────────────────────────────────────────── */}
      {analyzing && (
        <div className="bg-white p-8 rounded-2xl border border-slate-200 text-center shadow-xs flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin" />
          <p className="text-sm font-extrabold text-slate-800">Đang đọc cấu trúc và bóc tách dữ liệu xe...</p>
          <p className="text-xs text-slate-400">Vui lòng đợi giây lát</p>
        </div>
      )}

      {/* ── Thống kê tổng hợp & Bộ lọc khi đã có dữ liệu ──────────────── */}
      {rows.length > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            <div className="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-xs">
              <p className="text-[11px] font-bold uppercase text-slate-400 tracking-wider">Tổng bản ghi</p>
              <p className="text-2xl font-black text-slate-800 mt-0.5">{stats.total}</p>
              <p className="text-[11px] text-slate-400 font-medium">xe / chuyến</p>
            </div>
            <div className="bg-emerald-50/60 p-3.5 rounded-2xl border border-emerald-200/80 shadow-xs">
              <p className="text-[11px] font-bold uppercase text-emerald-700 tracking-wider">Khớp hoàn toàn</p>
              <p className="text-2xl font-black text-emerald-700 mt-0.5">{stats.ready}</p>
              <p className="text-[11px] text-emerald-600 font-medium">Sẵn sàng nhập</p>
            </div>
            <div className="bg-amber-50/60 p-3.5 rounded-2xl border border-amber-200/80 shadow-xs">
              <p className="text-[11px] font-bold uppercase text-amber-700 tracking-wider">Cần xử lý</p>
              <p className="text-2xl font-black text-amber-700 mt-0.5">{stats.warn}</p>
              <p className="text-[11px] text-amber-600 font-medium">Cảnh báo / Lệch</p>
            </div>
            <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200 shadow-xs">
              <p className="text-[11px] font-bold uppercase text-slate-500 tracking-wider">Đã chọn nạp</p>
              <p className="text-2xl font-black text-slate-800 mt-0.5">{stats.selectedCount}</p>
              <p className="text-[11px] text-slate-500 font-medium">trên {stats.total} dòng</p>
            </div>
            <div className="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-xs sm:col-span-2">
              <p className="text-[11px] font-bold uppercase text-slate-400 tracking-wider">Tổng sản lượng khô đã chọn</p>
              <p className="text-2xl font-black text-emerald-700 mt-0.5">
                {stats.totalKg.toLocaleString("vi-VN")} <span className="text-sm font-bold text-slate-500">kg</span>
              </p>
              <p className="text-[11px] text-slate-400 font-medium">Sẽ được ghi nhận vào kho & chuyến</p>
            </div>
          </div>

          {/* Thanh Bộ lọc */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-xs">
            <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
              <div className="relative flex-1 min-w-[160px] max-w-[260px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Tìm biển số xe..."
                  value={searchVeh}
                  onChange={(e) => setSearchVeh(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs font-bold rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-emerald-500"
                />
              </div>

              {/* Lọc Đội */}
              <select
                value={filterDoi}
                onChange={(e) => setFilterDoi(e.target.value)}
                className="px-3 py-1.5 text-xs font-bold rounded-xl border border-slate-200 bg-slate-50 text-slate-700 focus:outline-emerald-500"
              >
                <option value="ALL">Tất cả Đội</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={String(d)}>Đội {d}</option>
                ))}
                <option value="0">Thu mua</option>
              </select>

              {/* Lọc Trạng thái */}
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-3 py-1.5 text-xs font-bold rounded-xl border border-slate-200 bg-slate-50 text-slate-700 focus:outline-emerald-500"
              >
                <option value="ALL">Tất cả trạng thái</option>
                <option value="READY">🟢 Khớp hoàn toàn</option>
                <option value="WARN">🟡 Có cảnh báo / Cần xử lý</option>
                <option value="ERROR">🔴 Lỗi dữ liệu</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setRows((prev) => prev.map((r) => ({ ...r, selected: r.status === "match_ready" })))
                }}
                className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                Chỉ chọn dòng Khớp
              </button>
              <button
                onClick={() => {
                  const allSel = rows.every((r) => r.selected)
                  setRows((prev) => prev.map((r) => ({ ...r, selected: !allSel })))
                }}
                className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                {rows.every((r) => r.selected) ? "Bỏ chọn tất cả" : "Chọn tất cả"}
              </button>
            </div>
          </div>

          {/* ── Bảng Ma trận Đối soát Thông minh ──────────────────────────── */}
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
            <ResponsiveTableWrapper>
              <table className="w-full text-left text-xs border-collapse min-w-[1100px]">
                <thead>
                  <tr className="bg-slate-50/90 border-b border-slate-200 text-slate-500 font-extrabold uppercase tracking-wider text-[11px]">
                    <th className="py-3 px-3 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={rows.length > 0 && rows.every((r) => r.selected)}
                        onChange={(e) => {
                          const checked = e.target.checked
                          setRows((prev) => prev.map((r) => ({ ...r, selected: checked })))
                        }}
                        className="rounded text-emerald-600 focus:ring-emerald-500"
                      />
                    </th>
                    <th className="py-3 px-2 w-12 text-center">STT</th>
                    <th className="py-3 px-3 w-20">Đội</th>
                    <th className="py-3 px-3 w-24">Số xe</th>
                    <th className="py-3 px-2 w-16 text-center">Chuyến</th>
                    <th className="py-3 px-3">Tài xế (Điều xe)</th>
                    <th className="py-3 px-3">Điểm GN</th>
                    <th className="py-3 px-3 text-right">Đ.Chén Tươi</th>
                    <th className="py-3 px-2 text-center">DRC</th>
                    <th className="py-3 px-3 text-right">Đ.Chén Khô</th>
                    <th className="py-3 px-3 text-right">Dây Khô</th>
                    <th className="py-3 px-3 text-right font-black text-slate-700">Tổng Khô</th>
                    <th className="py-3 px-3 w-48">Trạng thái đối soát</th>
                    <th className="py-3 px-3 w-24 text-center">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {filteredRows.map((row, idx) => {
                    const isReady = row.status === "match_ready"
                    const isWarn = row.status.startsWith("warn_")

                    return (
                      <tr
                        key={row.uid}
                        className={`hover:bg-slate-50/80 transition-colors ${
                          row.selected ? "bg-emerald-50/20" : ""
                        }`}
                      >
                        <td className="py-2.5 px-3 text-center">
                          <input
                            type="checkbox"
                            checked={row.selected}
                            onChange={(e) => {
                              const checked = e.target.checked
                              setRows((prev) =>
                                prev.map((r) => (r.uid === row.uid ? { ...r, selected: checked } : r)),
                              )
                            }}
                            className="rounded text-emerald-600 focus:ring-emerald-500"
                          />
                        </td>
                        <td className="py-2.5 px-2 text-center text-slate-400 font-bold">{idx + 1}</td>
                        <td className="py-2.5 px-3 font-bold text-slate-800">
                          {row.doi === 0 ? "Thu mua" : `Đội ${row.doi}`}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="font-extrabold text-slate-800">{row.base_xe}</span>
                          {row.raw_xe !== row.base_xe && (
                            <span className="text-[10px] text-slate-400 block font-normal">({row.raw_xe})</span>
                          )}
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <span className="inline-block px-2 py-0.5 rounded-md font-bold text-xs bg-slate-100 text-slate-700">
                            {row.chuyen}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-slate-700">
                          {row.tai_xe || <span className="text-slate-400 italic">Chưa ghép</span>}
                        </td>
                        <td className="py-2.5 px-3 text-slate-500 text-[11px]">
                          {(row.diem_gn || []).join(", ") || "—"}
                        </td>
                        <td className="py-2.5 px-3 text-right font-semibold text-slate-700">
                          {row.dct_tuoi ? row.dct_tuoi.toLocaleString("vi-VN") : "—"}
                        </td>
                        <td className="py-2.5 px-2 text-center text-slate-600 font-bold">
                          {row.dct_drc ? `${row.dct_drc}%` : "—"}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-emerald-700">
                          {row.dct_kho ? row.dct_kho.toLocaleString("vi-VN") : "—"}
                        </td>
                        <td className="py-2.5 px-3 text-right font-semibold text-slate-600">
                          {row.dt_kho ? row.dt_kho.toLocaleString("vi-VN") : "—"}
                        </td>
                        <td className="py-2.5 px-3 text-right font-black text-slate-900 bg-slate-50/50">
                          {row.tong_kho ? row.tong_kho.toLocaleString("vi-VN") : "—"}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-start gap-1.5">
                            {isReady ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                            ) : isWarn ? (
                              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                            ) : (
                              <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                            )}
                            <div>
                              <p
                                className={`font-bold text-[11px] leading-tight ${
                                  isReady
                                    ? "text-emerald-700"
                                    : isWarn
                                      ? "text-amber-700"
                                      : "text-red-700"
                                }`}
                              >
                                {isReady ? "Khớp hoàn toàn" : isWarn ? "Cần xác nhận" : "Lỗi dữ liệu"}
                              </p>
                              <p className="text-[10px] text-slate-500 leading-tight mt-0.5">{row.message}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {isWarn ? (
                            <button
                              onClick={() => handleOpenResolve(row)}
                              className="px-2.5 py-1 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-800 font-extrabold text-[11px] shadow-2xs transition-all active:scale-95"
                            >
                              Xử lý
                            </button>
                          ) : (
                            <button
                              onClick={() => handleOpenResolve(row)}
                              className="text-[11px] text-slate-400 hover:text-slate-600 font-medium"
                            >
                              Sửa
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </ResponsiveTableWrapper>
          </div>

          {/* ── Bottom Action Bar ────────────────────────────────────────── */}
          <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-4 bg-slate-900/90 backdrop-blur-md text-white p-4 rounded-2xl shadow-xl border border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-400 font-black">
                {stats.selectedCount}
              </div>
              <div>
                <p className="text-xs font-bold text-slate-300">
                  Đã chọn {stats.selectedCount} dòng • Tổng khối lượng quy khô:
                </p>
                <p className="text-lg font-black text-emerald-400 tracking-tight">
                  {stats.totalKg.toLocaleString("vi-VN")} kg
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={onBack}
                className="px-4 py-2.5 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-300 font-bold text-xs transition-all"
              >
                Hủy bỏ
              </button>
              <button
                disabled={stats.selectedCount === 0 || savingToDb}
                onClick={handleCommitToSystem}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black text-sm shadow-md transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingToDb ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                <span>Đẩy thẳng lên phân hệ Sản lượng</span>
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Modal Tương tác Xử lý Lệch (Resolution Modal) ────────────── */}
      {resolvingRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center font-bold">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-800">
                    Xử lý dòng lệch: Xe {resolvingRow.base_xe} (Đội {resolvingRow.doi})
                  </h3>
                  <p className="text-xs text-slate-500">Tổng sản lượng: {resolvingRow.tong_kho} kg khô</p>
                </div>
              </div>
              <button
                onClick={() => setResolvingRow(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-4 space-y-4 text-xs">
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-800 font-medium">
                <strong>Vấn đề phát hiện:</strong> {resolvingRow.message}
              </div>

              {/* Tùy chọn 1: Tách thành 2 chuyến */}
              <div className="p-3.5 rounded-2xl border border-slate-200 hover:border-emerald-300 bg-slate-50/50 space-y-2">
                <div className="flex items-center gap-2 font-extrabold text-slate-800">
                  <Split className="w-4 h-4 text-emerald-600" />
                  <span>Cách 1: Tách làm 2 chuyến (Chuyến 1 & Chuyến 2)</span>
                </div>
                <p className="text-slate-500 text-[11px]">
                  Áp dụng khi xe đi 2 chuyến cùng 1 đội nhưng trạm cân gộp thành 1 dòng. Nhập số kg cho từng chuyến:
                </p>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 block mb-1">Chuyến 1 (kg khô)</label>
                    <input
                      type="number"
                      value={splitTrip1Kl}
                      onChange={(e) => {
                        const v = Number(e.target.value) || 0
                        setSplitTrip1Kl(v)
                        setSplitTrip2Kl(Math.max(0, Math.round((resolvingRow.tong_kho - v) * 100) / 100))
                      }}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 block mb-1">Chuyến 2 (kg khô)</label>
                    <input
                      type="number"
                      value={splitTrip2Kl}
                      onChange={(e) => {
                        const v = Number(e.target.value) || 0
                        setSplitTrip2Kl(v)
                        setSplitTrip1Kl(Math.max(0, Math.round((resolvingRow.tong_kho - v) * 100) / 100))
                      }}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-bold"
                    />
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => {
                      const half = Math.round((resolvingRow.tong_kho / 2) * 100) / 100
                      setSplitTrip1Kl(half)
                      setSplitTrip2Kl(resolvingRow.tong_kho - half)
                    }}
                    className="px-2 py-1 rounded bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-[10px]"
                  >
                    Chia đều 50-50
                  </button>
                  <button
                    onClick={() => handleApplyResolution("split")}
                    className="ml-auto px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs"
                  >
                    Xác nhận tách chuyến
                  </button>
                </div>
              </div>

              {/* Tùy chọn 2: Gán toàn bộ cho Chuyến cụ thể */}
              <div className="p-3.5 rounded-2xl border border-slate-200 hover:border-blue-300 bg-slate-50/50 space-y-2">
                <div className="flex items-center gap-2 font-extrabold text-slate-800">
                  <Check className="w-4 h-4 text-blue-600" />
                  <span>Cách 2: Gán toàn bộ sản lượng cho 1 Chuyến</span>
                </div>
                <p className="text-slate-500 text-[11px]">
                  Chọn chuyến điều xe muốn gán toàn bộ khối lượng của dòng này:
                </p>
                <div className="flex gap-2 pt-1">
                  {[1, 2, 3].map((ch) => (
                    <button
                      key={ch}
                      onClick={() => handleApplyResolution("assign_trip", ch)}
                      className="flex-1 py-1.5 rounded-xl border border-slate-300 hover:bg-blue-50 hover:border-blue-500 font-extrabold text-slate-700 hover:text-blue-700 text-xs transition-colors"
                    >
                      Chuyến {ch}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tùy chọn 3: Lưu độc lập nếu không có điều xe */}
              {resolvingRow.status === "warn_no_dispatch" && (
                <div className="p-3.5 rounded-2xl border border-slate-200 hover:border-slate-400 bg-slate-50/50 space-y-2">
                  <div className="flex items-center gap-2 font-extrabold text-slate-800">
                    <Database className="w-4 h-4 text-slate-600" />
                    <span>Cách 3: Chấp nhận lưu độc lập không qua Điều xe</span>
                  </div>
                  <p className="text-slate-500 text-[11px]">
                    Xe phát sinh ngoài kế hoạch điều xe. Vẫn lưu vào Sản lượng để theo dõi khối lượng mủ.
                  </p>
                  <button
                    onClick={() => handleApplyResolution("bypass_dispatch")}
                    className="w-full py-1.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-extrabold text-xs"
                  >
                    Lưu độc lập vào Sản lượng
                  </button>
                </div>
              )}
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setResolvingRow(null)}
                className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-bold text-xs"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
