"use client"

import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import Image from "next/image"
import { Printer, Share2, Download, X, ZoomIn } from "lucide-react"
import { supabase } from "@/lib/supabase"
import type { QuickMeasurementSheet, QuickMeasurementRow } from "../_components/process-types"

type NganInfo = { id: string; ten_ngan: string; ma_ngan: string; loai_nl: string; ngay_bd: string }
type FactoryInfo = { name: string; address?: string }
type SheetFull = QuickMeasurementSheet & { rows: QuickMeasurementRow[] }

function formatDate(d: string) {
  const [y, m, day] = d.split("-")
  return `${day}/${m}/${y}`
}

function formatDateShort(d: string) {
  const [y, m, day] = d.split("-")
  return `${day}/${m}/${y.slice(2)}`
}

export default function ProcessPrintPage() {
  const params = useSearchParams()
  const sheetId = params.get("sheetId")

  const [sheet, setSheet] = useState<SheetFull | null>(null)
  const [ngans, setNgans] = useState<Record<string, NganInfo>>({})
  const [factory, setFactory] = useState<FactoryInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [zoomUrl, setZoomUrl] = useState<string | null>(null)

  const sheetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const load = async () => {
      if (!sheetId) { setError("Thiếu sheetId"); setLoading(false); return }
      const { data, error: err } = await supabase
        .from("quick_measurements")
        .select("*, rows:quick_measurement_rows(*)")
        .eq("id", sheetId)
        .single()

      if (err || !data) { setError("Không tìm thấy phiếu"); setLoading(false); return }

      const s = data as SheetFull
      s.rows = s.rows?.sort((a, b) => a.sort_order - b.sort_order) || []
      setSheet(s)

      const { data: fData } = await supabase
        .from("factories")
        .select("name, address")
        .eq("id", s.factory_id)
        .single()
      if (fData) setFactory(fData as FactoryInfo)

      const nganIds = [...new Set(s.rows.filter(r => r.ngan_id).map(r => r.ngan_id!))]
      if (nganIds.length) {
        const { data: nData } = await supabase
          .from("ngans")
          .select("id,ten_ngan,ma_ngan,loai_nl,ngay_bd")
          .in("id", nganIds)
        if (nData) {
          const map: Record<string, NganInfo> = {}
          for (const n of nData as NganInfo[]) map[n.id] = n
          setNgans(map)
        }
      }

      setLoading(false)
    }
    void load()
  }, [sheetId])

  const handlePrint = () => window.print()

  const handleShare = async () => {
    if (!sheetRef.current || sharing) return
    setSharing(true)
    try {
      const html2canvas = (await import("html2canvas")).default
      const canvas = await html2canvas(sheetRef.current, {
        useCORS: true,
        allowTaint: true,
        scale: 2,
        backgroundColor: "#ffffff",
        logging: false,
      })

      const blob = await new Promise<Blob | null>(resolve =>
        canvas.toBlob(resolve, "image/png", 1.0)
      )
      if (!blob) return

      const fileName = `${sheet?.ma_phieu || "phieu-do-nhanh"}.png`
      const file = new File([blob], fileName, { type: "image/png" })

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: sheet?.ma_phieu || "Phiếu đo nhanh",
        })
      } else {
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = fileName
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        console.error("Share failed:", err)
      }
    } finally {
      setSharing(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen text-slate-500 text-sm">
      Đang tải phiếu...
    </div>
  )
  if (error || !sheet) return (
    <div className="flex items-center justify-center min-h-screen text-red-500 text-sm">
      {error || "Lỗi tải phiếu"}
    </div>
  )

  const chiTieuCols = [...new Set(sheet.rows.flatMap(r => r.chi_tieu))]
  const hasNgan = sheet.rows.some(r => r.ngan_id)
  const hasImages = sheet.rows.some(r => r.image_urls?.length > 0)

  return (
    <>
      <style>{`
        @page { size: A4; margin: 12mm 10mm; }
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
          .print-sheet { max-width: 195mm !important; margin: 0 auto !important; }
        }
        body { font-family: 'Times New Roman', serif; color: #000; }
        .print-table { border-collapse: collapse; width: 100%; }
        .print-table th, .print-table td {
          border: 1px solid #000; padding: 3px 5px; vertical-align: middle;
        }
        .print-table th {
          background-color: #0e7490; color: #fff; font-weight: bold;
          text-align: center; font-size: 10pt;
        }
      `}</style>

      {/* Toolbar — không in */}
      <div className="no-print sticky top-0 z-10 bg-white border-b border-slate-200 shadow-sm px-4 py-3 flex items-center gap-2 flex-wrap">
        <span className="text-sm font-bold text-teal-700 flex-1 min-w-0 truncate">
          {sheet.ma_phieu || "Phiếu đo nhanh"}
        </span>
        <button
          onClick={handlePrint}
          className="flex items-center gap-1.5 px-3 py-2 bg-slate-700 hover:bg-slate-800 text-white text-xs font-bold rounded-lg transition-colors"
        >
          <Printer size={14} /> In phiếu
        </button>
        <button
          onClick={handleShare}
          disabled={sharing}
          className="flex items-center gap-1.5 px-3 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-xs font-bold rounded-lg transition-colors"
        >
          {sharing ? (
            <>
              <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Đang xuất...
            </>
          ) : (
            <>
              {typeof navigator !== "undefined" && "share" in navigator
                ? <><Share2 size={14} /> Chia sẻ ảnh</>
                : <><Download size={14} /> Tải ảnh PNG</>
              }
            </>
          )}
        </button>
      </div>

      {/* Wrapper trên mobile: có padding, scroll ngang cho bảng */}
      <div className="p-3 sm:p-4 md:p-6 bg-slate-50 min-h-screen">
        {/* Phiếu — ref để html2canvas chụp */}
        <div
          ref={sheetRef}
          className="print-sheet bg-white shadow-md rounded-lg overflow-hidden mx-auto"
          style={{ maxWidth: "min(195mm, 100%)" }}
        >
          {/* Header */}
          <div style={{ backgroundColor: "#0e7490", color: "#fff", padding: "10px 14px" }}>
            <div className="flex justify-between items-start gap-2">
              <div>
                <div style={{ fontSize: "9pt", fontWeight: "bold" }}>
                  {factory?.name?.toUpperCase() || "CÔNG TY TNHH PTCS PHƯỚC HÒA KAMPONG THOM"}
                </div>
                <div style={{ fontSize: "13pt", fontWeight: "bold", marginTop: "3px", lineHeight: 1.25 }}>
                  PHIẾU ĐO NHANH CHỈ TIÊU NGÀY {formatDateShort(sheet.ngay)}
                </div>
              </div>
              <div style={{ textAlign: "right", fontSize: "9pt", whiteSpace: "nowrap" }}>
                <div style={{ fontWeight: "bold" }}>{sheet.ma_phieu || "—"}</div>
              </div>
            </div>
          </div>

          {/* Meta info — responsive wrap */}
          <div className="px-3 py-2 flex flex-wrap gap-x-5 gap-y-1 text-sm border-b border-slate-200">
            <div><b>Ngày test:</b> {formatDate(sheet.ngay)}</div>
            <div><b>Dây chuyền:</b> {sheet.day_chuyen || "—"}</div>
            <div><b>Chủng loại:</b> {sheet.chung_loai || "—"}</div>
            <div><b>Loại CSR:</b> {sheet.loai_csr || "—"}</div>
          </div>

          {/* Bảng — horizontal scroll trên mobile */}
          <div className="overflow-x-auto">
            <table className="print-table" style={{ fontSize: "10pt", minWidth: "480px" }}>
              <thead>
                <tr>
                  <th rowSpan={2} style={{ width: "28px" }}>STT</th>
                  <th rowSpan={2} style={{ minWidth: "110px" }}>CT-Thùng/<br />Lô/Mẫu</th>
                  <th rowSpan={2} style={{ minWidth: "90px" }}>Chế độ sấy</th>
                  {chiTieuCols.map(ct => (
                    <th key={ct} style={{ width: "50px" }}>{ct}</th>
                  ))}
                  <th rowSpan={2} style={{ minWidth: "52px" }}>Ca SX</th>
                  {hasNgan && <th rowSpan={2} style={{ minWidth: "80px" }}>Ngăn/<br />Ngày lưu</th>}
                  <th rowSpan={2} style={{ minWidth: "80px" }}>Người đo</th>
                  {hasImages && <th rowSpan={2} style={{ minWidth: "90px" }}>Hình ảnh</th>}
                  <th rowSpan={2} style={{ minWidth: "70px" }}>Ghi chú</th>
                </tr>
                <tr />
              </thead>
              <tbody>
                {sheet.rows.map((row, idx) => {
                  const ngan = row.ngan_id ? ngans[row.ngan_id] : null
                  const ctLabel = [
                    row.chi_tieu.join(", "),
                    [row.thung, row.lo, row.mau].filter(Boolean).join("/"),
                  ].filter(Boolean).join(" — ")

                  return (
                    <tr key={row.id} style={{ backgroundColor: idx % 2 === 0 ? "#fff" : "#f8fafc" }}>
                      <td style={{ textAlign: "center", fontSize: "9pt" }}>{idx + 1}</td>
                      <td style={{ fontSize: "9pt" }}>{ctLabel || "—"}</td>
                      <td style={{ fontSize: "9pt", textAlign: "center" }}>{row.che_do_say || "—"}</td>
                      {chiTieuCols.map(ct => {
                        const val = (row.ket_qua as Record<string, number | null>)[ct]
                        return (
                          <td key={ct} style={{ textAlign: "center", fontSize: "11pt", fontWeight: "bold" }}>
                            {val != null ? val : "—"}
                          </td>
                        )
                      })}
                      <td style={{ textAlign: "center", fontSize: "9pt" }}>{row.ca_sx || "—"}</td>
                      {hasNgan && (
                        <td style={{ fontSize: "9pt", textAlign: "center" }}>
                          {ngan ? (
                            <>
                              <div style={{ fontWeight: "bold" }}>{ngan.ma_ngan || ngan.ten_ngan}</div>
                              {row.so_ngay_luu != null && (
                                <div style={{ fontSize: "8pt", color: "#555" }}>{row.so_ngay_luu} ngày</div>
                              )}
                            </>
                          ) : "—"}
                        </td>
                      )}
                      <td style={{ fontSize: "9pt" }}>{row.nguoi_do || "—"}</td>
                      {hasImages && (
                        <td style={{ padding: "3px" }}>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "3px" }}>
                            {(row.image_urls || []).slice(0, 4).map((url, imgIdx) => (
                              <button
                                key={imgIdx}
                                type="button"
                                className="no-print relative group"
                                onClick={() => setZoomUrl(url)}
                                style={{ padding: 0, border: "none", background: "none", cursor: "pointer" }}
                              >
                                <Image
                                  src={url}
                                  alt=""
                                  width={44}
                                  height={44}
                                  style={{ width: "44px", height: "44px", objectFit: "cover", border: "1px solid #ccc", display: "block" }}
                                  unoptimized
                                />
                                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                  <ZoomIn size={16} color="white" />
                                </div>
                              </button>
                            ))}
                            {/* Ảnh cho in — không có nút zoom */}
                            {(row.image_urls || []).slice(0, 4).map((url, imgIdx) => (
                              <Image
                                key={`print-${imgIdx}`}
                                src={url}
                                alt=""
                                width={44}
                                height={44}
                                className="hidden print:block"
                                style={{ width: "44px", height: "44px", objectFit: "cover", border: "1px solid #ccc" }}
                                unoptimized
                              />
                            ))}
                          </div>
                        </td>
                      )}
                      <td style={{ fontSize: "9pt" }}>{row.ghi_chu || ""}</td>
                    </tr>
                  )
                })}
                {sheet.rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={20}
                      style={{ textAlign: "center", color: "#999", padding: "16px", fontStyle: "italic" }}
                    >
                      Không có dòng đo
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Footer ký tên */}
          <div className="flex justify-end px-4 pt-4 pb-6" style={{ fontSize: "10pt" }}>
            <div style={{ textAlign: "center", width: "180px" }}>
              <div style={{ fontWeight: "bold" }}>Người lập phiếu</div>
              <div style={{ fontSize: "8pt", color: "#666", marginBottom: "48px" }}>(Ký và ghi rõ họ tên)</div>
            </div>
          </div>
        </div>

        {/* Hướng dẫn nhỏ bên dưới — không in */}
        <div className="no-print mt-3 text-center text-xs text-slate-400 pb-6">
          Bấm <b>In phiếu</b> để in PDF · Bấm <b>Chia sẻ ảnh</b> để gửi qua Zalo, Telegram...
        </div>
      </div>

      {/* Lightbox zoom ảnh */}
      {zoomUrl && (
        <div
          className="no-print fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setZoomUrl(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/80 hover:text-white"
            onClick={() => setZoomUrl(null)}
          >
            <X size={28} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomUrl}
            alt="Ảnh phóng to"
            className="max-w-full max-h-full object-contain rounded shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}
