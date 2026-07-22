"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Clock, Droplet, Flame, Thermometer } from "lucide-react"
import { hasPermission } from "@/lib/auth"
import { supabase } from "@/lib/supabase"
import { CHI_TIEU_BY_CSR, CSR_BY_DAY_CHUYEN, resolveCheDoSuggestion, type CheDoRow } from "@/app/dashboard/process/_components/process-types"
import { WidgetCard, WidgetLoading, WidgetEmpty, type WidgetProps } from "./widget-shared"

// Màu badge riêng cho từng chỉ tiêu trong bảng kết quả đo — chỉ để phân biệt trực quan giữa
// các cột, không mang ý nghĩa đạt/không đạt (widget này không có ngưỡng để so sánh).
const CHI_TIEU_COLOR: Record<string, { bg: string; text: string }> = {
  Po: { bg: "bg-sky-50", text: "text-sky-700" },
  Mo: { bg: "bg-emerald-50", text: "text-emerald-700" },
  "Màu sắc": { bg: "bg-amber-50", text: "text-amber-700" },
}

type MeasurementRow = {
  id: string
  ngay: string
  chi_tieu: string[]
  ket_qua: Record<string, number | null>
  ca_sx: string | null
}

type ComboCard = {
  dc: string
  csr: string
  row: CheDoRow
  warning: string | null
  measurements: MeasurementRow[]
}

const formatVN = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("vi-VN")
}

async function loadCombo(factoryId: string, dc: string, csr: string): Promise<ComboCard | null> {
  const cols = "nhiet_do_dau_1,nhiet_do_dau_2,thoi_gian_say,ngay,created_at,loai_csr"
  const [csrMatchRes, latestAnyRes] = await Promise.all([
    supabase
      .from("process_params")
      .select(cols)
      .eq("factory_id", factoryId)
      .eq("day_chuyen", dc)
      .eq("loai_csr", csr)
      .order("ngay", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("process_params")
      .select(cols)
      .eq("factory_id", factoryId)
      .eq("day_chuyen", dc)
      .order("ngay", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const csrMatch = (csrMatchRes.data as CheDoRow | null) || null
  // Chỉ hiện thẻ khi có chế độ sấy ghi nhận RIÊNG cho đúng CSR này — bỏ qua hoàn toàn
  // fallback/warning của resolveCheDoSuggestion (hàm đó vốn thiết kế cho auto-fill form ở
  // module Process, không phù hợp để tóm tắt trên Dashboard: sẽ hiện nhầm chế độ của CSR khác).
  if (!csrMatch) return null
  const latestAny = (latestAnyRes.data as CheDoRow | null) || null
  const { row, warning } = resolveCheDoSuggestion(csrMatch, latestAny, csr, formatVN)
  if (!row) return null

  const { data: sheets } = await supabase
    .from("quick_measurements")
    .select("id,ngay")
    .eq("factory_id", factoryId)
    .eq("day_chuyen", dc)
    .eq("loai_csr", csr)
    .order("ngay", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(5)

  const sheetRows = (sheets || []) as { id: string; ngay: string }[]
  const sheetMap = new Map(sheetRows.map((s) => [s.id, s.ngay]))
  const sheetIds = sheetRows.map((s) => s.id)

  let measurements: MeasurementRow[] = []
  if (sheetIds.length > 0) {
    const { data: rowsRaw } = await supabase
      .from("quick_measurement_rows")
      .select("id,sheet_id,chi_tieu,ket_qua,ca_sx,created_at")
      .in("sheet_id", sheetIds)
      .order("created_at", { ascending: false })
      .limit(5)
    measurements = ((rowsRaw || []) as { id: string; sheet_id: string; chi_tieu: string[] | null; ket_qua: Record<string, number | null> | null; ca_sx: string | null }[]).map(
      (r) => ({
        id: r.id,
        ngay: sheetMap.get(r.sheet_id) || "",
        chi_tieu: r.chi_tieu || [],
        ket_qua: r.ket_qua || {},
        ca_sx: r.ca_sx,
      }),
    )
  }

  return { dc, csr, row, warning, measurements }
}

export function ProcessDryingWidget({ factoryId, user }: WidgetProps) {
  const canView = hasPermission(user, "process.view")
  const [loading, setLoading] = useState(true)
  const [cards, setCards] = useState<ComboCard[]>([])

  useEffect(() => {
    if (!factoryId || !canView) {
      setLoading(false)
      return
    }
    let alive = true
    ;(async () => {
      try {
        const combos = Object.entries(CSR_BY_DAY_CHUYEN).flatMap(([dc, csrList]) => csrList.map((csr) => ({ dc, csr })))
        const results = await Promise.all(combos.map((c) => loadCombo(factoryId, c.dc, c.csr)))
        if (alive) setCards(results.filter((c): c is ComboCard => c != null))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [factoryId, canView])

  if (!canView) return null

  return (
    <WidgetCard
      title="Chế độ sấy & đo nhanh chỉ tiêu"
      subtitle="Chế độ sấy mới nhất theo từng loại CSR kèm 5 kết quả đo gần nhất"
      className="h-full"
      action={
        <Link href="/dashboard/process" className="text-xs font-semibold text-emerald-600 hover:text-emerald-700">
          Xem tất cả →
        </Link>
      }
    >
      {loading ? (
        <WidgetLoading />
      ) : cards.length === 0 ? (
        <WidgetEmpty />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
          {cards.map((c) => {
            const chiTieuCols = CHI_TIEU_BY_CSR[c.csr] || []
            return (
              <div key={`${c.dc}-${c.csr}`} className="min-w-[340px] max-w-[340px] flex-shrink-0 rounded-xl border border-slate-200 overflow-hidden">
                {/* Header strip */}
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
                  <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                    <Thermometer size={14} className="text-emerald-600" />
                  </div>
                  <div className="text-sm font-bold text-slate-700">
                    {c.dc} · CSR{c.csr}
                  </div>
                </div>

                <div className="p-3">
                  {/* KPI tiles: chế độ sấy mới nhất */}
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="rounded-lg bg-blue-50 p-2 text-center">
                      <Droplet size={13} className="mx-auto text-blue-500 mb-0.5" />
                      <div className="text-[9px] font-bold text-blue-600/70 uppercase tracking-wide">Đầu ướt</div>
                      <div className="text-sm font-extrabold text-blue-700">{c.row.nhiet_do_dau_1 ?? "—"}°C</div>
                    </div>
                    <div className="rounded-lg bg-orange-50 p-2 text-center">
                      <Flame size={13} className="mx-auto text-orange-500 mb-0.5" />
                      <div className="text-[9px] font-bold text-orange-600/70 uppercase tracking-wide">Đầu khô</div>
                      <div className="text-sm font-extrabold text-orange-700">{c.row.nhiet_do_dau_2 ?? "—"}°C</div>
                    </div>
                    <div className="rounded-lg bg-violet-50 p-2 text-center">
                      <Clock size={13} className="mx-auto text-violet-500 mb-0.5" />
                      <div className="text-[9px] font-bold text-violet-600/70 uppercase tracking-wide">Thời gian</div>
                      <div className="text-sm font-extrabold text-violet-700">{c.row.thoi_gian_say ?? "—"}p</div>
                    </div>
                  </div>

                  {c.warning && <p className="text-[10px] text-amber-600 mb-2">{c.warning}</p>}

                  <div className="text-[10px] font-bold text-slate-400 uppercase mb-1.5">5 kết quả đo gần nhất</div>
                  {c.measurements.length === 0 ? (
                    <p className="text-[11px] text-slate-400">Chưa có dữ liệu</p>
                  ) : (
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="border-b border-slate-100">
                          <th className="text-left font-bold text-slate-400 pb-1">Ngày đo</th>
                          <th className="text-left font-bold text-slate-400 pb-1">Ca</th>
                          {chiTieuCols.map((ct) => (
                            <th key={ct} className="text-center font-bold text-slate-400 pb-1">{ct}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {c.measurements.map((m) => (
                          <tr key={m.id} className="border-b border-slate-50 last:border-0">
                            <td className="py-1 text-slate-500 whitespace-nowrap">{formatVN(m.ngay)}</td>
                            <td className="py-1 text-slate-500">{m.ca_sx ? m.ca_sx.replace(/^Ca\s*/i, "") : "—"}</td>
                            {chiTieuCols.map((ct) => (
                              <td key={ct} className="py-1 text-center">
                                {m.chi_tieu.includes(ct) ? (
                                  <span
                                    className={`inline-block min-w-[28px] px-1.5 py-0.5 rounded font-bold ${CHI_TIEU_COLOR[ct]?.bg ?? "bg-slate-100"} ${CHI_TIEU_COLOR[ct]?.text ?? "text-slate-700"}`}
                                  >
                                    {m.ket_qua[ct] ?? "—"}
                                  </span>
                                ) : (
                                  <span className="text-slate-300">—</span>
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </WidgetCard>
  )
}
