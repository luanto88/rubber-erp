"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Clock, Droplet, Flame, Thermometer } from "lucide-react"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts"
import { hasPermission } from "@/lib/auth"
import { supabase } from "@/lib/supabase"
import { ChartTooltip } from "@/lib/chart-theme"
import { CHI_TIEU_BY_CSR, CSR_BY_DAY_CHUYEN, resolveCheDoSuggestion, type CheDoRow } from "@/app/dashboard/process/_components/process-types"
import { WidgetCard, WidgetLoading, WidgetEmpty, fetchAllPaged, getCurrentRanges, type WidgetProps } from "./widget-shared"
import { AnimatedNumber } from "./animated-number"

// Màu badge riêng cho từng chỉ tiêu trong bảng kết quả đo — chỉ để phân biệt trực quan giữa
// các cột, không mang ý nghĩa đạt/không đạt (widget này không có ngưỡng để so sánh).
const CHI_TIEU_COLOR: Record<string, { bg: string; text: string }> = {
  Po: { bg: "bg-sky-50", text: "text-sky-700" },
  Mo: { bg: "bg-emerald-50", text: "text-emerald-700" },
  "Màu sắc": { bg: "bg-amber-50", text: "text-amber-700" },
}

// Màu đường biểu đồ khớp màu badge ở trên (sky/emerald/amber).
const CHI_TIEU_LINE: Record<string, string> = {
  Po: "#0284c7",
  Mo: "#059669",
  "Màu sắc": "#d97706",
}

const comboKey = (dc: string, csr: string) => `${dc}|${csr}`
const fmtTemp = (v: number) => `${Math.round(v)}°C`
const fmtMinutes = (v: number) => `${Number(v.toFixed(1)).toLocaleString("vi-VN")}p`

type MonthPoint = { ngay: string } & Record<string, number | string>

/**
 * Trung bình kết quả đo nhanh THEO NGÀY từ đầu tháng tới nay, gom theo (dây chuyền, CSR).
 * Tải 1 lần cho cả nhà máy rồi tách ở client — không query riêng từng CSR.
 */
async function loadMonthSeries(factoryId: string): Promise<Record<string, MonthPoint[]>> {
  const { monthStart, today } = getCurrentRanges()
  const sheets = await fetchAllPaged<{ id: string; ngay: string; day_chuyen: string | null; loai_csr: string | null }>(
    "quick_measurements",
    "id,ngay,day_chuyen,loai_csr",
    (q) => q.eq("factory_id", factoryId).gte("ngay", monthStart).lte("ngay", today),
  )
  if (sheets.length === 0) return {}
  const sheetById = new Map(sheets.map((s) => [s.id, s]))
  const ids = sheets.map((s) => s.id)

  // Chia lô 200 id/lần cho câu IN (...) — xem .claude/rules/04-code-patterns.md.
  type RawRow = { sheet_id: string; ket_qua: Record<string, unknown> | null }
  const rows: RawRow[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    rows.push(...(await fetchAllPaged<RawRow>("quick_measurement_rows", "sheet_id,ket_qua", (q) => q.in("sheet_id", chunk))))
  }

  // combo → ngày → chỉ tiêu → các giá trị
  const acc: Record<string, Record<string, Record<string, number[]>>> = {}
  for (const r of rows) {
    const sheet = sheetById.get(r.sheet_id)
    if (!sheet?.day_chuyen || !sheet.loai_csr) continue
    const key = comboKey(sheet.day_chuyen, sheet.loai_csr)
    const day = sheet.ngay.slice(0, 10)
    for (const [ct, raw] of Object.entries(r.ket_qua || {})) {
      if (raw == null || raw === "") continue
      const v = Number(raw)
      if (!Number.isFinite(v)) continue
      const byDay = (acc[key] ??= {})
      const byCt = (byDay[day] ??= {})
      ;(byCt[ct] ??= []).push(v)
    }
  }

  const out: Record<string, MonthPoint[]> = {}
  for (const [key, byDay] of Object.entries(acc)) {
    out[key] = Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, byCt]) => {
        const point: MonthPoint = { ngay: `${day.slice(8, 10)}/${day.slice(5, 7)}` }
        for (const [ct, vals] of Object.entries(byCt)) {
          point[ct] = Number((vals.reduce((s, x) => s + x, 0) / vals.length).toFixed(2))
        }
        return point
      })
  }
  return out
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
  const [monthSeries, setMonthSeries] = useState<Record<string, MonthPoint[]>>({})
  const [monthLoading, setMonthLoading] = useState(true)
  const [pickedKey, setPickedKey] = useState<string | null>(null)

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

  // Biểu đồ tháng tải song song, độc lập với các thẻ — lỗi chỉ làm trống biểu đồ.
  useEffect(() => {
    if (!factoryId || !canView) return
    let alive = true
    loadMonthSeries(factoryId)
      .then((res) => {
        if (alive) setMonthSeries(res)
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setMonthLoading(false)
      })
    return () => {
      alive = false
    }
  }, [factoryId, canView])

  // CSR đang xem trên biểu đồ: người dùng chọn, mặc định thẻ đầu tiên.
  const selectedKey = useMemo(() => {
    if (pickedKey && cards.some((c) => comboKey(c.dc, c.csr) === pickedKey)) return pickedKey
    return cards[0] ? comboKey(cards[0].dc, cards[0].csr) : null
  }, [pickedKey, cards])
  const selectedCard = cards.find((c) => comboKey(c.dc, c.csr) === selectedKey) || null
  const selectedSeries = selectedKey ? monthSeries[selectedKey] || [] : []
  const selectedCts = selectedCard ? CHI_TIEU_BY_CSR[selectedCard.csr] || [] : []

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
        <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 lg:mx-0 lg:px-0 lg:flex-col lg:overflow-x-visible lg:overflow-y-auto lg:max-h-[440px] lg:shrink-0">
          {cards.map((c) => {
            const chiTieuCols = CHI_TIEU_BY_CSR[c.csr] || []
            const key = comboKey(c.dc, c.csr)
            const selectable = cards.length > 1
            const isSelected = selectable && key === selectedKey
            return (
              <div
                key={key}
                role={selectable ? "button" : undefined}
                tabIndex={selectable ? 0 : undefined}
                onClick={selectable ? () => setPickedKey(key) : undefined}
                onKeyDown={
                  selectable
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") setPickedKey(key)
                      }
                    : undefined
                }
                className={`min-w-[340px] max-w-[340px] flex-shrink-0 rounded-xl border overflow-hidden transition-shadow ${
                  selectable ? "cursor-pointer" : ""
                } ${isSelected ? "border-emerald-400 ring-2 ring-emerald-100" : "border-slate-200"}`}
              >
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
                      <div className="text-sm font-extrabold text-blue-700">{c.row.nhiet_do_dau_1 == null ? "—" : <AnimatedNumber value={Number(c.row.nhiet_do_dau_1)} format={fmtTemp} />}</div>
                    </div>
                    <div className="rounded-lg bg-orange-50 p-2 text-center">
                      <Flame size={13} className="mx-auto text-orange-500 mb-0.5" />
                      <div className="text-[9px] font-bold text-orange-600/70 uppercase tracking-wide">Đầu khô</div>
                      <div className="text-sm font-extrabold text-orange-700">{c.row.nhiet_do_dau_2 == null ? "—" : <AnimatedNumber value={Number(c.row.nhiet_do_dau_2)} format={fmtTemp} />}</div>
                    </div>
                    <div className="rounded-lg bg-violet-50 p-2 text-center">
                      <Clock size={13} className="mx-auto text-violet-500 mb-0.5" />
                      <div className="text-[9px] font-bold text-violet-600/70 uppercase tracking-wide">Thời gian</div>
                      <div className="text-sm font-extrabold text-violet-700">{c.row.thoi_gian_say == null ? "—" : <AnimatedNumber value={Number(c.row.thoi_gian_say)} format={fmtMinutes} />}</div>
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

        {/* Kết quả đo nhanh trong tháng — cột phải trên desktop, xếp dưới thẻ trên mobile */}
        <div className="flex-1 min-w-0 rounded-xl border border-slate-200 p-3 flex flex-col">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-2">
            <div>
              <div className="text-sm font-bold text-slate-700">Kết quả đo trong tháng</div>
              <div className="text-[11px] text-slate-400">
                Trung bình theo ngày{selectedCard ? ` · ${selectedCard.dc} · CSR${selectedCard.csr}` : ""}
              </div>
            </div>
            {cards.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {cards.map((c) => {
                  const key = comboKey(c.dc, c.csr)
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setPickedKey(key)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                        key === selectedKey ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      CSR{c.csr}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          <div className="flex-1 min-h-[260px]">
            {monthLoading ? (
              <div className="skeleton h-full min-h-[260px] w-full rounded-lg" />
            ) : selectedSeries.length === 0 ? (
              <WidgetEmpty label="Chưa có kết quả đo trong tháng" />
            ) : (
              <ResponsiveContainer width="100%" height="100%" minHeight={260}>
                <LineChart data={selectedSeries} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="ngay" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="left" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={34} domain={["auto", "auto"]} />
                  {selectedCts.length > 1 && (
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fontSize: 10, fill: "#94a3b8" }}
                      axisLine={false}
                      tickLine={false}
                      width={34}
                      domain={["auto", "auto"]}
                    />
                  )}
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {selectedCts.map((ct, i) => (
                    <Line
                      key={ct}
                      yAxisId={i === 0 ? "left" : "right"}
                      type="monotone"
                      dataKey={ct}
                      name={ct}
                      stroke={CHI_TIEU_LINE[ct] ?? "#64748b"}
                      strokeWidth={2.5}
                      dot={{ r: 3, strokeWidth: 2, fill: "white" }}
                      activeDot={{ r: 5 }}
                      connectNulls
                      animationDuration={900}
                      animationEasing="ease-out"
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
        </div>
      )}
    </WidgetCard>
  )
}
