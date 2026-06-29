"use client"

import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import Image from "next/image"
import { Printer, Share2, Download, X, ZoomIn, AlertTriangle } from "lucide-react"
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

// ZWNJ (U+200C) quanh "/" ngăn OpenType fraction ligature khi html2canvas dùng ctx.fillText
const ZWNJ = "‌"
function z(text: string | null | undefined): string {
  if (!text) return ""
  return text.replace(/\//g, `${ZWNJ}/${ZWNJ}`)
}

// Inline styles dùng trong capture div (không phụ thuộc Tailwind)
const TH: React.CSSProperties = {
  backgroundColor: "#0e7490", color: "#ffffff", fontWeight: "bold",
  textAlign: "center", fontSize: "10pt",
  border: "1px solid #999999", padding: "3px 5px", verticalAlign: "middle",
}
const TD: React.CSSProperties = {
  border: "1px solid #cccccc", padding: "3px 5px", verticalAlign: "middle",
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
  const [shareError, setShareError] = useState<string | null>(null)
  const [zoomUrl, setZoomUrl] = useState<string | null>(null)

  // sheetRef: div hiển thị trên màn hình (dùng cho nút In PDF)
  const sheetRef = useRef<HTMLDivElement>(null)
  // captureRef: div ẩn offscreen, toàn inline styles, 720px cố định (dùng cho chia sẻ ảnh)
  const captureRef = useRef<HTMLDivElement>(null)

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
    if (!captureRef.current || sharing) return
    setSharing(true)
    setShareError(null)
    try {
      const html2canvas = (await import("html2canvas")).default

      // captureRef dùng toàn bộ inline styles + fixed 720px → không cần windowWidth.
      // Tailwind v4 inject oklch()/lab() vào :root của trang — html2canvas không parse được.
      // onclone strip toàn bộ <style>/<link> trong cloned doc; captureRef có inline styles
      // nên không cần CSS bên ngoài để render đúng.
      const stripGlobalCss = (clonedDoc: Document) => {
        clonedDoc.querySelectorAll('style, link[rel="stylesheet"]').forEach(el => el.remove())
      }

      let blob: Blob | null = null
      try {
        const canvas = await html2canvas(captureRef.current, {
          useCORS: true,
          scale: 2,
          backgroundColor: "#ffffff",
          logging: false,
          onclone: stripGlobalCss,
        })
        blob = await new Promise<Blob | null>(resolve =>
          canvas.toBlob(resolve, "image/png", 1.0)
        )
      } catch {
        // SecurityError từ ảnh cross-origin → thử lần 2 bỏ qua ảnh
      }

      if (!blob) {
        const canvas = await html2canvas(captureRef.current, {
          useCORS: false,
          scale: 2,
          backgroundColor: "#ffffff",
          logging: false,
          onclone: stripGlobalCss,
          ignoreElements: (el) => el.tagName === "IMG",
        })
        blob = await new Promise<Blob | null>(resolve =>
          canvas.toBlob(resolve, "image/png", 1.0)
        )
      }

      if (!blob) {
        setShareError("Không xuất được ảnh PNG. Thử lại hoặc dùng nút In phiếu.")
        return
      }

      const fileName = `${sheet?.ma_phieu || "phieu-do-nhanh"}.png`
      const file = new File([blob], fileName, { type: "image/png" })

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: sheet?.ma_phieu || "Phiếu đo nhanh" })
      } else {
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url; a.download = fileName; a.style.display = "none"
        document.body.appendChild(a); a.click(); document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        console.error("Share failed:", err)
        setShareError(`Lỗi xuất ảnh: ${(err as Error).message || "Không xác định"}`)
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
          border: 1px solid #ccc; padding: 3px 5px; vertical-align: middle;
        }
        .print-table th {
          border-color: #999;
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

      {/* Toast lỗi chia sẻ */}
      {shareError && (
        <div className="no-print fixed top-16 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 bg-red-600 text-white rounded-2xl shadow-2xl max-w-sm w-[calc(100%-2rem)]">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="text-sm flex-1">{shareError}</span>
          <button onClick={() => setShareError(null)} className="hover:opacity-70">
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Phiếu hiển thị trên màn hình (responsive, dùng Tailwind + print CSS) ── */}
      <div className="p-3 sm:p-4 md:p-6 bg-slate-50 min-h-screen">
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
            <div><b>Loại CSR:</b> {sheet.loai_csr || "—"}</div>
          </div>

          {/* Bảng — horizontal scroll trên mobile */}
          <div className="overflow-x-auto">
            <table className="print-table" style={{ fontSize: "10pt", minWidth: "480px" }}>
              <thead>
                <tr>
                  <th style={{ width: "28px" }}>STT</th>
                  <th style={{ minWidth: "110px" }}>CT-Thùng/<br />Lô/Mẫu</th>
                  <th style={{ minWidth: "90px" }}>Chế độ sấy</th>
                  {chiTieuCols.map(ct => (
                    <th key={ct} style={{ width: "50px" }}>{ct}</th>
                  ))}
                  <th style={{ minWidth: "52px" }}>Ca SX</th>
                  {hasNgan && <th style={{ minWidth: "100px" }}>Ngăn/<br />Ngày lưu</th>}
                  <th style={{ minWidth: "80px" }}>Người đo</th>
                  {hasImages && <th style={{ minWidth: "90px" }}>Hình ảnh</th>}
                  <th style={{ minWidth: "70px" }}>Ghi chú</th>
                </tr>
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
                        <td style={{ fontSize: "8pt", textAlign: "center", wordBreak: "break-word", verticalAlign: "middle" }}>
                          {ngan ? (
                            <>
                              <div style={{ fontWeight: "bold", lineHeight: 1.2 }}>{ngan.ma_ngan || ngan.ten_ngan}</div>
                              {row.so_ngay_luu != null && (
                                <div style={{ color: "#555" }}>{row.so_ngay_luu} ngày</div>
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

      {/* ── Capture div: offscreen, toàn inline styles, 720px cố định ──
          Không phụ thuộc Tailwind → html2canvas không cần windowWidth hay onclone.
          Dùng z() để chèn ZWNJ quanh "/" ngăn fraction ligature trong Canvas 2D. */}
      <div
        ref={captureRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "-9999px",
          top: "0",
          width: "720px",
          backgroundColor: "#ffffff",
          fontFamily: "'Times New Roman', Times, serif",
          fontSize: "10pt",
          color: "#000000",
          lineHeight: "1.4",
        }}
      >
        {/* Header */}
        <div style={{
          backgroundColor: "#0e7490", color: "#ffffff", padding: "10px 14px",
          display: "flex", justifyContent: "space-between", alignItems: "flex-start",
        }}>
          <div>
            <div style={{ fontSize: "9pt", fontWeight: "bold" }}>
              {factory?.name?.toUpperCase() || "CÔNG TY TNHH PTCS PHƯỚC HÒA KAMPONG THOM"}
            </div>
            <div style={{ fontSize: "13pt", fontWeight: "bold", marginTop: "3px", lineHeight: 1.25 }}>
              PHIẾU ĐO NHANH CHỈ TIÊU NGÀY {z(formatDateShort(sheet.ngay))}
            </div>
          </div>
          <div style={{ textAlign: "right", fontSize: "9pt", whiteSpace: "nowrap" }}>
            <div style={{ fontWeight: "bold" }}>{z(sheet.ma_phieu) || "—"}</div>
          </div>
        </div>

        {/* Meta info */}
        <div style={{
          padding: "6px 12px", display: "flex", flexWrap: "wrap", gap: "0 20px",
          fontSize: "9pt", borderBottom: "1px solid #cccccc",
        }}>
          <span><b>Ngày test:</b> {z(formatDate(sheet.ngay))}</span>
          <span style={{ marginLeft: "4px" }}><b>Dây chuyền:</b> {sheet.day_chuyen || "—"}</span>
          <span style={{ marginLeft: "4px" }}><b>Loại CSR:</b> {sheet.loai_csr || "—"}</span>
        </div>

        {/* Bảng */}
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "10pt" }}>
          <thead>
            <tr>
              <th style={{ ...TH, width: "28px" }}>STT</th>
              <th style={{ ...TH, minWidth: "110px" }}>CT-Thùng/<br />Lô/Mẫu</th>
              <th style={{ ...TH, minWidth: "90px" }}>Chế độ sấy</th>
              {chiTieuCols.map(ct => (
                <th key={ct} style={{ ...TH, width: "50px" }}>{ct}</th>
              ))}
              <th style={{ ...TH, minWidth: "52px" }}>Ca SX</th>
              {hasNgan && <th style={{ ...TH, minWidth: "100px" }}>Ngăn/<br />Ngày lưu</th>}
              <th style={{ ...TH, minWidth: "80px" }}>Người đo</th>
              {hasImages && <th style={{ ...TH, minWidth: "90px" }}>Hình ảnh</th>}
              <th style={{ ...TH, minWidth: "70px" }}>Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, idx) => {
              const ngan = row.ngan_id ? ngans[row.ngan_id] : null
              const ctLabel = [
                row.chi_tieu.join(", "),
                [row.thung, row.lo, row.mau].filter(Boolean).join("/"),
              ].filter(Boolean).join(" — ")

              return (
                <tr key={row.id} style={{ backgroundColor: idx % 2 === 0 ? "#ffffff" : "#f8fafc" }}>
                  <td style={{ ...TD, textAlign: "center", fontSize: "9pt" }}>{idx + 1}</td>
                  <td style={{ ...TD, fontSize: "9pt" }}>{z(ctLabel) || "—"}</td>
                  <td style={{ ...TD, fontSize: "9pt", textAlign: "center" }}>{z(row.che_do_say) || "—"}</td>
                  {chiTieuCols.map(ct => {
                    const val = (row.ket_qua as Record<string, number | null>)[ct]
                    return (
                      <td key={ct} style={{ ...TD, textAlign: "center", fontSize: "11pt", fontWeight: "bold" }}>
                        {val != null ? val : "—"}
                      </td>
                    )
                  })}
                  <td style={{ ...TD, textAlign: "center", fontSize: "9pt" }}>{row.ca_sx || "—"}</td>
                  {hasNgan && (
                    <td style={{ ...TD, fontSize: "8pt", textAlign: "center", wordBreak: "break-word", verticalAlign: "middle" }}>
                      {ngan ? (
                        <>
                          <div style={{ fontWeight: "bold", lineHeight: 1.2 }}>{z(ngan.ma_ngan || ngan.ten_ngan)}</div>
                          {row.so_ngay_luu != null && (
                            <div style={{ color: "#555555" }}>{row.so_ngay_luu} ngày</div>
                          )}
                        </>
                      ) : "—"}
                    </td>
                  )}
                  <td style={{ ...TD, fontSize: "9pt" }}>{row.nguoi_do || "—"}</td>
                  {hasImages && (
                    <td style={{ ...TD, padding: "3px" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "3px" }}>
                        {(row.image_urls || []).slice(0, 4).map((url, imgIdx) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={imgIdx}
                            src={url}
                            alt=""
                            crossOrigin="anonymous"
                            style={{ width: "44px", height: "44px", objectFit: "cover", border: "1px solid #cccccc", display: "block" }}
                          />
                        ))}
                      </div>
                    </td>
                  )}
                  <td style={{ ...TD, fontSize: "9pt" }}>{row.ghi_chu || ""}</td>
                </tr>
              )
            })}
            {sheet.rows.length === 0 && (
              <tr>
                <td
                  colSpan={20}
                  style={{ textAlign: "center", color: "#999999", padding: "16px", fontStyle: "italic" }}
                >
                  Không có dòng đo
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Footer ký tên */}
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "12px 16px 24px", fontSize: "10pt" }}>
          <div style={{ textAlign: "center", width: "180px" }}>
            <div style={{ fontWeight: "bold" }}>Người lập phiếu</div>
            <div style={{ fontSize: "8pt", color: "#666666", marginBottom: "48px" }}>(Ký và ghi rõ họ tên)</div>
          </div>
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
