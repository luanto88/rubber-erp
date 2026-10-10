"use client"

import { useState, useRef, useMemo } from "react"
import {
  ArrowLeft, Upload, FileText, CheckCircle2, AlertTriangle, XCircle,
  RefreshCw, Download, Check, Sparkles, Layers, ShieldCheck, Calendar,
  Award, Eye, Info, Database, Send
} from "lucide-react"
import { PageBackgroundMotif } from "@/app/dashboard/_components/page-background-motif"
import { supabase } from "@/lib/supabase"
import type { SessionUser } from "@/lib/auth"

type SampleMap = Record<string, (string | number)[]>

type ParsedLot = {
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

type ParseResponse = {
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

type FactoryLot = {
  id: string
  ma_lo: string
  loai_csr: string
  ngay_sx: string
  ngay_ht?: string | null
  trang_thai?: string
  tong_banh?: number
}

type ExistingQc = {
  id: string
  lot_id: string | null
  ma_lo: string
  ngay_kn: string
}

type MatchEvaluation = {
  lot: ParsedLot
  matchedLot: FactoryLot | null
  status: "match_ready" | "wrong_date" | "wrong_csr" | "already_tested" | "not_found"
  message: string
  selected: boolean
}

export function FxToExcelIcon({ className = "w-9 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* f(x) */}
      <text x="2" y="21" fontFamily="Times New Roman, serif" fontStyle="italic" fontWeight="bold" fontSize="22" fill="currentColor">
        f
      </text>
      <text x="13" y="19" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="bold" fontSize="13" fill="currentColor">
        (x)
      </text>
      {/* Mũi tên -> */}
      <path
        d="M29 14H39M39 14L35 10M39 14L35 18"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* File Document */}
      <path
        d="M44 4C44 2.89543 44.8954 2 46 2H55.5L62 8.5V24C62 25.1046 61.1046 26 60 26H46C44.8954 26 44 25.1046 44 24V4Z"
        fill="currentColor"
      />
      <path d="M55 2V8H61" stroke="rgba(0,0,0,0.15)" strokeWidth="1.2" fill="none" />
      {/* Chữ X của Excel */}
      <text x="47" y="18" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="900" fontSize="11" fill="#047857">
        X
      </text>
      {/* Lưới ô vuông nhỏ */}
      <rect x="53.5" y="12" width="2.5" height="2" rx="0.5" fill="#047857" />
      <rect x="57" y="12" width="2.5" height="2" rx="0.5" fill="#047857" />
      <rect x="53.5" y="15" width="2.5" height="2" rx="0.5" fill="#047857" />
      <rect x="57" y="15" width="2.5" height="2" rx="0.5" fill="#047857" />
    </svg>
  )
}

type Props = {
  currentUser: SessionUser | null
  factoryId: string
  factoryCode: string
  factoryLots?: FactoryLot[]
  existingQcRows?: ExistingQc[]
  signingStatusByDate: Map<string, any>
  onBack: () => void
  onSuccess: (count: number, batchPKN: number, ngayKN: string) => void
  showToast: (msg: string, ok?: boolean) => void
  calcGrade: (samples: SampleMap, loaiCsr: string, tieuChuan: string) => { grade: any; dat_hang: string; trang_thai: string }
  getNextPKN: (fid: string, year: number) => Promise<number>
  getNextLoKN: (fid: string) => Promise<number>
  normalizeLotCode: (maLo: string) => string
  stripYear: (maLo: string) => string
  getLotQcDate: (lot: { ngay_sx: string; ngay_ht?: string | null }) => string
  formatPKN: (pkn: number, ngayKN: string, fCode: string) => string
}

export function QualityConverterView({
  currentUser,
  factoryId,
  factoryCode,
  factoryLots: propFactoryLots,
  existingQcRows: propExistingQcRows,
  signingStatusByDate,
  onBack,
  onSuccess,
  showToast,
  calcGrade,
  getNextPKN,
  getNextLoKN,
  normalizeLotCode,
  stripYear,
  getLotQcDate,
  formatPKN,
}: Props) {
  // Parameters
  const [tieuChuan, setTieuChuan] = useState<"TCCS 112:2022" | "TCVN 3769:2016">("TCCS 112:2022")
  const [nSamples, setNSamples] = useState<number>(6)
  
  // File & Upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [parseResult, setParseResult] = useState<ParseResponse | null>(null)
  const [selectedLotsMap, setSelectedLotsMap] = useState<Record<string, boolean>>({})
  const [savingToDb, setSavingToDb] = useState(false)
  
  // Internal fetched data if not provided
  const [internalLots, setInternalLots] = useState<FactoryLot[]>([])
  const [internalQcRows, setInternalQcRows] = useState<ExistingQc[]>([])

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Tự động load kho thành phẩm nếu prop không có
  const factoryLots = propFactoryLots || internalLots
  const existingQcRows = propExistingQcRows || internalQcRows

  useState(() => {
    // initial
  })

  // Load kho khi mount
  useMemo(() => {
    if (!factoryId || propFactoryLots?.length) return
    let active = true
    const loadData = async () => {
      try {
        const { data: lotsData } = await supabase
          .from("lots")
          .select("id,ma_lo,loai_csr,ngay_sx,ngay_ht,trang_thai,tong_banh")
          .eq("factory_id", factoryId)
          .limit(2000)

        const { data: qcData } = await supabase
          .from("qc_results")
          .select("id,lot_id,ma_lo,ngay_kn")
          .eq("factory_id", factoryId)

        if (active) {
          if (lotsData) setInternalLots(lotsData)
          if (qcData) setInternalQcRows(qcData)
        }
      } catch (err) {
        console.error("Lỗi nạp dữ liệu kho:", err)
      }
    }
    loadData()
    return () => { active = false }
  }, [factoryId, propFactoryLots?.length])

  // Map tra cứu lô trong kho nhanh
  const { lotByExact, lotByBase } = useMemo(() => {
    const byExact = new Map<string, FactoryLot>()
    const byBase = new Map<string, FactoryLot>()
    factoryLots.forEach((lot) => {
      const exactKey = normalizeLotCode(lot.ma_lo)
      const baseKey = stripYear(lot.ma_lo)
      if (!byExact.has(exactKey)) byExact.set(exactKey, lot)
      if (!byBase.has(baseKey)) byBase.set(baseKey, lot)
    })
    return { lotByExact: byExact, lotByBase: byBase }
  }, [factoryLots, normalizeLotCode, stripYear])

  // Chuyển ngày dd/mm/yyyy -> yyyy-mm-dd
  const parseVnDateToIso = (vnDateStr: string | null): string => {
    if (!vnDateStr) return ""
    const parts = vnDateStr.trim().split(/[\/\-]/)
    if (parts.length === 3) {
      const [d, m, y] = parts
      return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`
    }
    return vnDateStr
  }

  // Đánh giá 4 tiêu chí cho từng lô từ PDF
  const evaluations = useMemo<MatchEvaluation[]>(() => {
    if (!parseResult?.lots) return []

    const ngayKN_Iso = parseVnDateToIso(parseResult.ngay_kn)
    const ngaySX_Iso = parseVnDateToIso(parseResult.ngay_sx)
    const isDateLocked = currentUser?.role !== "admin" && Boolean(signingStatusByDate.get(ngayKN_Iso))

    return parseResult.lots.map((lot) => {
      const exactKey = normalizeLotCode(lot.lo_nm_full)
      const baseKey = stripYear(lot.lo_nm)
      const matched = lotByExact.get(exactKey) || lotByBase.get(baseKey) || null

      let status: MatchEvaluation["status"] = "match_ready"
      let message = "Khớp 4 tiêu chí — Sẵn sàng nhập"

      if (!matched) {
        status = "not_found"
        message = "Không tìm thấy số lô tương ứng trong kho"
      } else {
        // Kiểm tra chủng loại: Hạng ĐK trên PDF phải khớp loai_csr trong kho
        const lotLoaiCsrNormalized = matched.loai_csr.replace(/^SVR/, "CSR")
        const pdfLoaiCsrNormalized = lot.loai_csr.replace(/^SVR/, "CSR")
        if (lotLoaiCsrNormalized !== pdfLoaiCsrNormalized) {
          status = "wrong_csr"
          message = `Lệch chủng loại: PDF ghi ${lot.loai_csr}, kho là ${matched.loai_csr}`
        } else {
          // Kiểm tra ngày sản xuất: Ngày SX trên PDF phải khớp ngày hoàn thành lô trong kho
          const lotDate = getLotQcDate(matched)
          if (ngaySX_Iso && lotDate && lotDate !== ngaySX_Iso) {
            status = "wrong_date"
            message = `Lệch ngày SX: PDF là ${parseResult.ngay_sx}, kho là ${lotDate}`
          } else {
            // Kiểm tra đã có phiếu KN chưa
            const alreadyQc = existingQcRows.find(
              (qc) => qc.lot_id === matched.id || normalizeLotCode(qc.ma_lo) === exactKey
            )
            if (alreadyQc) {
              status = "already_tested"
              message = `Đã kiểm nghiệm ngày ${alreadyQc.ngay_kn}`
            } else if (isDateLocked) {
              status = "already_tested"
              message = `Ngày ${parseResult.ngay_kn} đã gửi ký duyệt (bị khóa)`
            }
          }
        }
      }

      const defaultSelected = status === "match_ready"
      const isSelected = selectedLotsMap[lot.lo_nm_full] !== undefined 
        ? selectedLotsMap[lot.lo_nm_full] 
        : defaultSelected

      return {
        lot,
        matchedLot: matched,
        status,
        message,
        selected: isSelected,
      }
    })
  }, [
    parseResult,
    lotByExact,
    lotByBase,
    normalizeLotCode,
    stripYear,
    getLotQcDate,
    existingQcRows,
    signingStatusByDate,
    currentUser,
    selectedLotsMap,
  ])

  // Số lượng lô hợp lệ được tick chọn
  const readyLotsToImport = useMemo(() => {
    return evaluations.filter((e) => e.status === "match_ready" && e.selected)
  }, [evaluations])

  // Xử lý gửi file PDF lên API phân tích
  const handleAnalyze = async (fileToProcess?: File) => {
    const file = fileToProcess || selectedFile
    if (!file) {
      showToast("Vui lòng chọn file PDF biểu kết quả kiểm nghiệm", false)
      return
    }

    setAnalyzing(true)
    setParseResult(null)
    setSelectedLotsMap({})

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token

      const formData = new FormData()
      formData.append("file", file)
      formData.append("n_samples", String(nSamples))
      formData.append("tieu_chuan", tieuChuan)

      const headers: Record<string, string> = {}
      if (token) {
        headers["Authorization"] = `Bearer ${token}`
      }

      const res = await fetch("/api/quality/parse-pdf", {
        method: "POST",
        headers,
        body: formData,
      })

      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Không thể phân tích file PDF")
      }

      setParseResult(data)
      showToast(`Đã bóc tách thành công ${data.total_lots} lô từ biểu KQKN!`)
    } catch (e: any) {
      console.error(e)
      showToast("Lỗi phân tích: " + (e.message || String(e)), false)
    } finally {
      setAnalyzing(false)
    }
  }

  // Tải file Excel sinh ra
  const handleDownloadExcel = () => {
    if (!parseResult?.excel_base64) return
    try {
      const byteCharacters = atob(parseResult.excel_base64)
      const byteNumbers = new Array(byteCharacters.length)
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i)
      }
      const byteArray = new Uint8Array(byteNumbers)
      const blob = new Blob([byteArray], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })

      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = parseResult.filename || "Ket_qua_kiem_nghiem.xlsx"
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      showToast("Đã tải file Excel đối chiếu thành công!")
    } catch (e: any) {
      showToast("Lỗi tải file Excel: " + e.message, false)
    }
  }

  // Hành động: Đẩy thẳng lên phân hệ Kiểm nghiệm
  const handleDirectPushToQuality = async () => {
    if (!parseResult || !readyLotsToImport.length) {
      showToast("Không có lô hợp lệ nào để nhập", false)
      return
    }

    const ngayKN_Iso = parseVnDateToIso(parseResult.ngay_kn)
    const ngaySX_Iso = parseVnDateToIso(parseResult.ngay_sx)
    const year = new Date(ngayKN_Iso).getFullYear()

    setSavingToDb(true)
    try {
      const [startPKN, startLoKN] = await Promise.all([
        getNextPKN(factoryId, year),
        getNextLoKN(factoryId),
      ])

      let curLoKN = startLoKN
      const batchId = crypto.randomUUID()
      const loaiKN = nSamples >= 14 ? "ngat" : "thuong"

      let successCount = 0
      const errors: string[] = []

      for (const item of readyLotsToImport) {
        const { lot, matchedLot } = item
        if (!matchedLot) continue

        // Tính xếp hạng grade theo chủng loại riêng của từng lô
        const { grade, dat_hang, trang_thai } = calcGrade(
          lot.samples,
          matchedLot.loai_csr,
          tieuChuan
        )

        const { error } = await supabase.from("qc_results").insert({
          factory_id: factoryId,
          lot_id: matchedLot.id,
          ma_lo: matchedLot.ma_lo,
          batch_id: batchId,
          pkn: startPKN,
          lo_kn: curLoKN,
          ngay_kn: ngayKN_Iso,
          ngay_sx: getLotQcDate(matchedLot) || ngaySX_Iso,
          chung_loai: lot.chung_loai,
          loai_csr: matchedLot.loai_csr,
          loai_kn: loaiKN,
          tieu_chuan: tieuChuan,
          so_mau: nSamples,
          samples: lot.samples,
          grade,
          dat_hang,
          trang_thai,
          parent_id: null,
          lan: 1,
          notes: [],
          created_by: currentUser?.id ?? null,
        })

        if (error) {
          errors.push(`Lô ${lot.lo_nm_full}: ${error.message}`)
        } else {
          successCount++
          curLoKN++
        }
      }

      if (successCount > 0) {
        showToast(
          `Đã nhập thành công ${successCount} lô vào phân hệ Kiểm nghiệm (${formatPKN(startPKN, ngayKN_Iso, factoryCode)})!`
        )
        onSuccess(successCount, startPKN, ngayKN_Iso)
      } else {
        showToast("Không nhập được lô nào: " + errors.join("; "), false)
      }
    } catch (e: any) {
      console.error(e)
      showToast("Lỗi ghi dữ liệu: " + (e.message || String(e)), false)
    } finally {
      setSavingToDb(false)
    }
  }

  return (
    <div className="relative min-h-screen pb-16">
      <PageBackgroundMotif theme="mint" />

      {/* Header Bar */}
      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 pt-6">
        <div className="flex items-center justify-between bg-white/80 backdrop-blur-md border border-slate-200/90 rounded-2xl p-4 sm:p-5 shadow-sm mb-6">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="flex items-center gap-2 px-3 py-2 text-sm font-bold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all"
            >
              <ArrowLeft size={16} /> Quay lại Kiểm nghiệm
            </button>
            <div className="h-6 w-px bg-slate-200 hidden sm:block" />
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-mint-500 text-white font-bold text-xs shadow-sm">
                  f(x)
                </span>
                <h1 className="text-lg sm:text-xl font-extrabold text-slate-800">
                  Hỗ trợ Kỹ thuật: Phân tích KQKN & Tái tạo Số liệu
                </h1>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 font-medium mt-0.5">
                Tự động nhận diện chủng loại từng lô, tái tạo số liệu chi tiết và đối soát 4 tiêu chí trước khi nhập
              </p>
            </div>
          </div>
        </div>

        {/* Cấu hình tham số & Dropzone */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
          {/* Cấu hình */}
          <div className="lg:col-span-4 bg-white border border-slate-200/90 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
            <div>
              <h2 className="text-sm font-extrabold text-slate-800 flex items-center gap-2 mb-4">
                <Layers size={18} className="text-mint-600" /> Cấu hình Kiểm nghiệm
              </h2>

              {/* Tiêu chuẩn */}
              <div className="mb-4">
                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                  Tiêu chuẩn áp dụng
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTieuChuan("TCCS 112:2022")}
                    className={`px-3 py-2.5 rounded-xl text-xs font-bold transition-all text-center border ${
                      tieuChuan === "TCCS 112:2022"
                        ? "bg-mint-50 border-mint-500 text-mint-800 shadow-sm"
                        : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    TCCS 112:2022
                  </button>
                  <button
                    type="button"
                    onClick={() => setTieuChuan("TCVN 3769:2016")}
                    className={`px-3 py-2.5 rounded-xl text-xs font-bold transition-all text-center border ${
                      tieuChuan === "TCVN 3769:2016"
                        ? "bg-mint-50 border-mint-500 text-mint-800 shadow-sm"
                        : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    TCVN 3769:2016
                  </button>
                </div>
              </div>

              {/* Số mẫu */}
              <div className="mb-4">
                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                  Số lượng mẫu tái tạo
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { n: 6, label: "6 mẫu", sub: "Thường" },
                    { n: 10, label: "10 mẫu", sub: "Tùy chọn" },
                    { n: 14, label: "14 mẫu", sub: "Ngặt" },
                  ].map((item) => (
                    <button
                      key={item.n}
                      type="button"
                      onClick={() => setNSamples(item.n)}
                      className={`p-2 rounded-xl text-center border transition-all ${
                        nSamples === item.n
                          ? "bg-mint-50 border-mint-500 text-mint-800 shadow-sm"
                          : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      <div className="text-xs font-bold">{item.label}</div>
                      <div className="text-[10px] text-slate-500">{item.sub}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 text-xs text-slate-600 flex items-start gap-2">
                <Info size={16} className="text-mint-600 shrink-0 mt-0.5" />
                <span>
                  Chủng loại của từng lô sẽ được <strong>tự động nhận diện từ cột Hạng ĐK</strong> trên biểu PDF (CSR10, CSR20, CSRL, CSR3L...).
                </span>
              </div>
            </div>
          </div>

          {/* Vùng Dropzone Upload */}
          <div className="lg:col-span-8 bg-white border border-slate-200/90 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
            <div>
              <h2 className="text-sm font-extrabold text-slate-800 flex items-center gap-2 mb-3">
                <FileText size={18} className="text-mint-600" /> Tải lên Biểu Kết Quả Kiểm Nghiệm (PDF)
              </h2>

              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) {
                    setSelectedFile(f)
                    handleAnalyze(f)
                  }
                }}
              />

              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const f = e.dataTransfer.files?.[0]
                  if (f && f.name.toLowerCase().endsWith(".pdf")) {
                    setSelectedFile(f)
                    handleAnalyze(f)
                  } else {
                    showToast("Vui lòng chỉ chọn file PDF", false)
                  }
                }}
                className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
                  selectedFile
                    ? "border-mint-400 bg-mint-50/30"
                    : "border-slate-300 hover:border-mint-400 hover:bg-slate-50"
                }`}
              >
                <div className="w-12 h-12 rounded-2xl bg-mint-100 text-mint-700 flex items-center justify-center mx-auto mb-3 shadow-sm">
                  {analyzing ? (
                    <RefreshCw size={24} className="animate-spin" />
                  ) : (
                    <Upload size={24} />
                  )}
                </div>

                {selectedFile ? (
                  <div>
                    <p className="text-sm font-extrabold text-slate-800">{selectedFile.name}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      {(selectedFile.size / 1024).toFixed(1)} KB — Nhấp để chọn file khác
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm font-bold text-slate-700">
                      Kéo thả file PDF vào đây hoặc <span className="text-mint-700 underline">bấm để chọn</span>
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      Biểu QLCL-QT21-F08 (BẢNG KẾT QUẢ KIỂM NGHIỆM CAO SU CSR)
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-3">
              <button
                type="button"
                disabled={!selectedFile || analyzing}
                onClick={() => handleAnalyze()}
                className="flex items-center gap-2 px-5 py-2.5 bg-mint-600 hover:bg-mint-700 disabled:opacity-50 text-white font-bold rounded-xl shadow-md transition-all text-sm"
              >
                {analyzing ? <RefreshCw size={16} className="animate-spin" /> : <Sparkles size={16} />}
                {analyzing ? "Đang phân tích..." : "Phân tích & Tái tạo"}
              </button>
            </div>
          </div>
        </div>

        {/* Dashboard Kết quả phân tích */}
        {parseResult && (
          <div className="space-y-6">
            {/* KPI Cards Strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm">
                <div className="text-xs font-bold text-slate-500 uppercase">Tổng số lô</div>
                <div className="text-2xl font-black text-slate-800 mt-1">{parseResult.total_lots}</div>
                <div className="text-xs text-slate-500 mt-1 truncate">{parseResult.report.lot_range}</div>
              </div>

              <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm">
                <div className="text-xs font-bold text-slate-500 uppercase">Ngày SX / Ngày KN</div>
                <div className="text-sm font-extrabold text-slate-800 mt-1">
                  SX: {parseResult.ngay_sx || "--"}
                </div>
                <div className="text-sm font-extrabold text-mint-700 mt-0.5">
                  KN: {parseResult.ngay_kn}
                </div>
              </div>

              <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm">
                <div className="text-xs font-bold text-slate-500 uppercase">Phân loại máy đo</div>
                <div className="text-xs font-medium text-slate-700 mt-1">
                  P0: {parseResult.report.step_po.po_05.length} lô bước 0.5 | {parseResult.report.step_po.po_01.length} lô bước 0.1
                </div>
                <div className="text-xs font-medium text-slate-700 mt-1">
                  ML: {parseResult.report.step_ml.ml_05.length} lô bước 0.5 | {parseResult.report.step_ml.ml_01.length} lô bước 0.1
                </div>
              </div>

              <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm">
                <div className="text-xs font-bold text-slate-500 uppercase">Xếp hạng đạt chuẩn</div>
                <div className="text-sm font-extrabold text-emerald-600 mt-1">
                  {parseResult.total_lots - parseResult.report.rh_lots.length} lô Đạt
                </div>
                <div className="text-xs text-rose-600 font-bold mt-0.5">
                  {parseResult.report.rh_lots.length > 0
                    ? `${parseResult.report.rh_lots.length} lô RHCSR10 (hạ cấp)`
                    : "100% đạt chuẩn"}
                </div>
              </div>
            </div>

            {/* Bảng Đối soát 4 Tiêu chí */}
            <div className="bg-white border border-slate-200/90 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200/90 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-extrabold text-slate-800 flex items-center gap-2">
                    <ShieldCheck size={20} className="text-mint-600" />
                    Bảng Đối Soát 4 Tiêu Chí: Số lô • Chủng loại • Ngày SX • Ngày KN
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Hệ thống chỉ chấp thuận nhập các lô đạt chuẩn 4 tiêu chí để đảm bảo tính toàn vẹn kho thành phẩm.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadExcel}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl transition-all"
                  >
                    <Download size={14} /> Tải Excel (.xlsx)
                  </button>

                  <button
                    type="button"
                    disabled={!readyLotsToImport.length || savingToDb}
                    onClick={handleDirectPushToQuality}
                    className="flex items-center gap-2 px-5 py-2 text-sm font-bold text-white bg-mint-600 hover:bg-mint-700 disabled:opacity-50 rounded-xl shadow-md transition-all"
                  >
                    {savingToDb ? (
                      <RefreshCw size={16} className="animate-spin" />
                    ) : (
                      <Send size={16} />
                    )}
                    {savingToDb
                      ? "Đang ghi vào hệ thống..."
                      : `Đẩy thẳng lên Kiểm nghiệm (${readyLotsToImport.length}/${parseResult.total_lots} lô)`}
                  </button>
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-extrabold">
                      <th className="py-3 px-4 w-12 text-center">
                        <input
                          type="checkbox"
                          className="rounded text-mint-600 focus:ring-mint-500"
                          checked={
                            readyLotsToImport.length > 0 &&
                            readyLotsToImport.length ===
                              evaluations.filter((e) => e.status === "match_ready").length
                          }
                          onChange={(e) => {
                            const checked = e.target.checked
                            const newMap: Record<string, boolean> = {}
                            evaluations.forEach((item) => {
                              newMap[item.lot.lo_nm_full] =
                                item.status === "match_ready" ? checked : false
                            })
                            setSelectedLotsMap(newMap)
                          }}
                        />
                      </th>
                      <th className="py-3 px-3">PKN</th>
                      <th className="py-3 px-3">Số hiệu lô (PDF)</th>
                      <th className="py-3 px-3">Chủng loại PDF</th>
                      <th className="py-3 px-3">Lô trong kho thành phẩm</th>
                      <th className="py-3 px-4">Đối soát 4 Tiêu chí</th>
                      <th className="py-3 px-4">Tóm tắt số liệu tái tạo</th>
                      <th className="py-3 px-3 text-center">Xếp hạng</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {evaluations.map((item, idx) => {
                      const { lot, matchedLot, status, message, selected } = item
                      const isMatch = status === "match_ready"

                      return (
                        <tr
                          key={lot.lo_nm_full || idx}
                          className={`hover:bg-slate-50/80 transition-colors ${
                            isMatch ? "bg-white" : "bg-slate-50/40 opacity-90"
                          }`}
                        >
                          {/* Checkbox */}
                          <td className="py-3 px-4 text-center">
                            <input
                              type="checkbox"
                              disabled={!isMatch}
                              checked={selected}
                              onChange={(e) => {
                                setSelectedLotsMap((prev) => ({
                                  ...prev,
                                  [lot.lo_nm_full]: e.target.checked,
                                }))
                              }}
                              className="rounded text-mint-600 focus:ring-mint-500 disabled:opacity-30"
                            />
                          </td>

                          {/* PKN */}
                          <td className="py-3 px-3 font-bold text-slate-700">#{lot.pkn}</td>

                          {/* Số lô PDF */}
                          <td className="py-3 px-3 font-extrabold text-slate-800">
                            {lot.lo_nm_full}
                          </td>

                          {/* Chủng loại PDF */}
                          <td className="py-3 px-3">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md font-bold text-[11px] bg-slate-100 text-slate-700 border border-slate-200">
                              {lot.hang_dk}
                            </span>
                          </td>

                          {/* Lô trong kho */}
                          <td className="py-3 px-3">
                            {matchedLot ? (
                              <div>
                                <span className="font-bold text-slate-800">{matchedLot.ma_lo}</span>
                                <div className="text-[10px] text-slate-500">
                                  Loại: {matchedLot.loai_csr} • Ngày: {getLotQcDate(matchedLot)}
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-400 italic">Chưa có trong kho</span>
                            )}
                          </td>

                          {/* Trạng thái 4 Tiêu chí */}
                          <td className="py-3 px-4">
                            {isMatch ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <CheckCircle2 size={13} /> Khớp 4 tiêu chí (Hợp lệ)
                              </span>
                            ) : status === "wrong_date" ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                <AlertTriangle size={13} /> {message}
                              </span>
                            ) : status === "wrong_csr" ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-orange-50 text-orange-700 border border-orange-200">
                                <AlertTriangle size={13} /> {message}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
                                <XCircle size={13} /> {message}
                              </span>
                            )}
                          </td>

                          {/* Số liệu tái tạo */}
                          <td className="py-3 px-4">
                            <div className="font-mono text-[11px] text-slate-600">
                              TC: {lot.tc_x} (3sd: {lot.tc_3sd}) • Tro: {lot.tro_x} • Po: {lot.po_x} (bước {lot.po_step}) • PRI: {lot.pri_x}
                              {lot.ml_x > 0 && ` • ML: ${lot.ml_x} (bước ${lot.ml_step})`}
                            </div>
                          </td>

                          {/* Xếp hạng */}
                          <td className="py-3 px-3 text-center">
                            {lot.dat_hang === "RHCSR10" || lot.dat_hang.includes("RH") ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black bg-rose-100 text-rose-700">
                                {lot.dat_hang}
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black bg-emerald-100 text-emerald-800">
                                {lot.dat_hang}
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
