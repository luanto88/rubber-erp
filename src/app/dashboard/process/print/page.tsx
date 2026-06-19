"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import Image from "next/image"
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

      // Load factory info
      const { data: fData } = await supabase
        .from("factories")
        .select("name, address")
        .eq("id", s.factory_id)
        .single()
      if (fData) setFactory(fData as FactoryInfo)

      // Load ngans referenced
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

  useEffect(() => {
    if (!loading && sheet) {
      setTimeout(() => window.print(), 600)
    }
  }, [loading, sheet])

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen text-slate-500">Đang tải phiếu...</div>
  )
  if (error || !sheet) return (
    <div className="flex items-center justify-center min-h-screen text-red-500">{error || "Lỗi tải phiếu"}</div>
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
        }
        body { font-family: 'Times New Roman', serif; font-size: 11pt; color: #000; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #000; padding: 3px 5px; vertical-align: middle; }
        th { background-color: #0e7490; color: #fff; font-weight: bold; text-align: center; font-size: 10pt; }
        .header-row { background-color: #0e7490; color: #fff; }
      `}</style>

      <div style={{ maxWidth: "195mm", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ backgroundColor: "#0e7490", color: "#fff", padding: "8px 12px", marginBottom: "6px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: "9pt", fontWeight: "bold" }}>
                {factory?.name?.toUpperCase() || "CÔNG TY TNHH PTCS PHƯỚC HÒA KAMPONG THOM"}
              </div>
              <div style={{ fontSize: "15pt", fontWeight: "bold", marginTop: "3px" }}>
                PHIẾU ĐO NHANH CHỈ TIÊU NGÀY {formatDateShort(sheet.ngay)}
              </div>
            </div>
            <div style={{ textAlign: "right", fontSize: "9pt" }}>
              <div style={{ fontWeight: "bold" }}>{sheet.ma_phieu || "—"}</div>
            </div>
          </div>
        </div>

        {/* Meta info */}
        <div style={{ display: "flex", gap: "24px", marginBottom: "6px", fontSize: "10pt" }}>
          <div><b>Ngày test:</b> {formatDate(sheet.ngay)}</div>
          <div><b>Dây chuyền:</b> {sheet.day_chuyen || "—"}</div>
          <div><b>Loại CSR:</b> {sheet.loai_csr || "—"}</div>
        </div>

        {/* Main table */}
        <table>
          <thead>
            <tr>
              <th rowSpan={2} style={{ width: "28px" }}>STT</th>
              <th rowSpan={2}>CT-Thùng/<br />Lô/Mẫu</th>
              <th rowSpan={2}>Chế độ sấy</th>
              {chiTieuCols.map(ct => (
                <th key={ct} style={{ width: "48px" }}>{ct}</th>
              ))}
              <th rowSpan={2}>Ca SX</th>
              {hasNgan && <th rowSpan={2}>Ngăn/<br />Ngày lưu</th>}
              <th rowSpan={2}>Người đo</th>
              {hasImages && <th rowSpan={2} style={{ width: "90px" }}>Hình ảnh</th>}
              <th rowSpan={2}>Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, idx) => {
              const ngan = row.ngan_id ? ngans[row.ngan_id] : null
              const ctLabel = [
                row.chi_tieu.join(", "),
                [row.thung, row.lo, row.mau].filter(Boolean).join("/"),
              ].filter(Boolean).join("-")

              return (
                <tr key={row.id} style={{ backgroundColor: idx % 2 === 0 ? "#fff" : "#fafafa" }}>
                  <td style={{ textAlign: "center", fontSize: "9pt" }}>{idx + 1}</td>
                  <td style={{ fontSize: "9pt" }}>{ctLabel || "—"}</td>
                  <td style={{ fontSize: "9pt", textAlign: "center" }}>{row.che_do_say || "—"}</td>
                  {chiTieuCols.map(ct => {
                    const val = (row.ket_qua as Record<string, number | null>)[ct]
                    return (
                      <td key={ct} style={{ textAlign: "center", fontSize: "10pt", fontWeight: "bold" }}>
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
                            <div style={{ fontSize: "8pt" }}>{row.so_ngay_luu} ngày</div>
                          )}
                        </>
                      ) : "—"}
                    </td>
                  )}
                  <td style={{ fontSize: "9pt" }}>{row.nguoi_do || "—"}</td>
                  {hasImages && (
                    <td style={{ padding: "2px" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "2px" }}>
                        {(row.image_urls || []).slice(0, 4).map((url, imgIdx) => (
                          <Image
                            key={imgIdx}
                            src={url}
                            alt=""
                            width={40}
                            height={40}
                            style={{ width: "40px", height: "40px", objectFit: "cover", border: "1px solid #ccc" }}
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
              <tr><td colSpan={20} style={{ textAlign: "center", color: "#999", padding: "12px" }}>Không có dòng đo</td></tr>
            )}
          </tbody>
        </table>

        {/* Footer signature */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px", fontSize: "10pt" }}>
          <div style={{ textAlign: "center", width: "180px" }}>
            <div style={{ fontWeight: "bold" }}>Người lập phiếu</div>
            <div style={{ fontSize: "8pt", color: "#666", marginBottom: "40px" }}>(Ký và ghi rõ họ tên)</div>
          </div>
        </div>

        {/* Print button — hidden on print */}
        <div className="no-print" style={{ position: "fixed", bottom: "20px", right: "20px" }}>
          <button
            onClick={() => window.print()}
            style={{
              padding: "10px 20px", backgroundColor: "#0e7490", color: "#fff",
              border: "none", borderRadius: "8px", fontWeight: "bold", cursor: "pointer", fontSize: "14px",
            }}
          >
            In phiếu
          </button>
        </div>
      </div>
    </>
  )
}
