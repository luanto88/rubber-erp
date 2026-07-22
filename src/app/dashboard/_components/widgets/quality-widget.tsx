"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts"
import { hasPermission } from "@/lib/auth"
import {
  buildMonthlyQualityReport,
  fetchAllQcResults,
  SAN_PHAM_GROUP,
  TIEU_CHUAN_OPTIONS,
  CHI_TIEU_META,
  toNums,
  mean,
  type ChiTieuKey,
} from "@/lib/quality-stats"
import { CHART_PALETTE, ChartTooltip, formatPercent } from "@/lib/chart-theme"
import { WidgetCard, WidgetLoading, WidgetEmpty, getCurrentRanges, type WidgetProps } from "./widget-shared"

type ProductAchievement = { sanPham: string; tyLe: number; tyLeMucTieu: number | null; kl: number }
type TrendSeriesMeta = { key: string; label: string }

export function QualityWidget({ factoryId, user }: WidgetProps) {
  const canView = hasPermission(user, "quality.view")
  const [loading, setLoading] = useState(true)
  const [achievements, setAchievements] = useState<ProductAchievement[]>([])
  const [tyLeToanNhaMay, setTyLeToanNhaMay] = useState<number | null>(null)
  const [trendData, setTrendData] = useState<Record<string, number | string>[]>([])
  const [trendSeries, setTrendSeries] = useState<TrendSeriesMeta[]>([])

  useEffect(() => {
    if (!factoryId || !canView) {
      setLoading(false)
      return
    }
    let alive = true
    ;(async () => {
      try {
        const { nam, thang, monthStart, today } = getCurrentRanges()

        const [report, qcRows] = await Promise.all([
          buildMonthlyQualityReport({
            factoryId,
            nam,
            thang,
            sanPhamList: Object.keys(SAN_PHAM_GROUP),
            tieuChuan: TIEU_CHUAN_OPTIONS[0],
            chiTieuList: [],
          }),
          fetchAllQcResults(factoryId, monthStart, today),
        ])
        if (!alive) return

        setTyLeToanNhaMay(report.tyLeDatToanNhaMay.thang)

        const tccsRow = report.rows.find((r) => r.chiTieu === "tccs_tong")
        const achv: ProductAchievement[] = []
        if (tccsRow) {
          for (const [sp, cell] of Object.entries(tccsRow.bySanPham)) {
            if (!cell.thang.kl || cell.thang.kl <= 0 || cell.thang.tyLe == null) continue
            achv.push({ sanPham: sp, tyLe: cell.thang.tyLe, tyLeMucTieu: tccsRow.tyLeMucTieu, kl: cell.thang.kl })
          }
        }
        achv.sort((a, b) => b.kl - a.kl)
        setAchievements(achv)

        // Xu hướng theo ngày cho 1 chỉ tiêu đại diện mỗi sản phẩm (tạp chất: mủ tạp, Po: mủ nước) —
        // chỉ hiện các tổ hợp CSR thực sự có dữ liệu tháng này, không bịa/hardcode danh sách.
        const csrList = Array.from(new Set(qcRows.map((r) => r.loai_csr).filter((v): v is string => !!v)))
        const dayMap: Record<string, Record<string, number>> = {}
        const seriesMeta: TrendSeriesMeta[] = []
        csrList.forEach((csr, idx) => {
          const chiTieu: ChiTieuKey = SAN_PHAM_GROUP[csr] === "mu_tap" ? "tap_chat" : "po"
          const rowsForCsr = qcRows.filter((r) => r.loai_csr === csr)
          const byDay: Record<string, number[]> = {}
          for (const r of rowsForCsr) {
            const vals = toNums(r.samples?.[chiTieu])
            if (!vals.length) continue
            const iso = (r.ngay_sx || "").slice(0, 10)
            if (!iso) continue
            if (!byDay[iso]) byDay[iso] = []
            byDay[iso].push(...vals)
          }
          if (Object.keys(byDay).length === 0) return
          const key = `csr_${idx}`
          seriesMeta.push({ key, label: `${CHI_TIEU_META[chiTieu].label} · CSR${csr}` })
          for (const [iso, vals] of Object.entries(byDay)) {
            if (!dayMap[iso]) dayMap[iso] = {}
            dayMap[iso][key] = Number(mean(vals).toFixed(3))
          }
        })
        setTrendSeries(seriesMeta)
        setTrendData(
          Object.entries(dayMap)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([iso, vals]) => ({ ngay: iso.slice(8, 10), ...vals })),
        )
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
      title="Chất lượng"
      subtitle="Tỷ lệ đạt hạng theo mục tiêu & xu hướng chỉ tiêu chính"
      action={
        <Link href="/dashboard/quality" className="text-xs font-semibold text-emerald-600 hover:text-emerald-700">
          Xem tất cả →
        </Link>
      }
    >
      {loading ? (
        <WidgetLoading />
      ) : (
        <div className="space-y-5">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-slate-600">Tỷ lệ đạt hạng theo mục tiêu (tháng này)</h3>
              <span className="text-sm font-extrabold text-rose-600">
                Toàn nhà máy: {tyLeToanNhaMay == null ? "—" : formatPercent(tyLeToanNhaMay)}
              </span>
            </div>
            {achievements.length === 0 ? (
              <WidgetEmpty />
            ) : (
              <div className="space-y-2">
                {achievements.map((a) => {
                  const dat = a.tyLeMucTieu == null || a.tyLe >= a.tyLeMucTieu
                  return (
                    <div key={a.sanPham}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-semibold text-slate-600">CSR{a.sanPham}</span>
                        <span className="font-bold text-slate-700">
                          {formatPercent(a.tyLe)}
                          {a.tyLeMucTieu != null && <span className="text-slate-400 font-normal"> / mục tiêu {formatPercent(a.tyLeMucTieu)}</span>}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${dat ? "bg-emerald-500" : "bg-amber-500"}`}
                          style={{ width: `${Math.min(100, a.tyLe)}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {trendSeries.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-slate-600 mb-2">Xu hướng chỉ tiêu chính theo ngày</h3>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="ngay" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={40} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {trendSeries.map((s, i) => (
                      <Line
                        key={s.key}
                        type="monotone"
                        dataKey={s.key}
                        name={s.label}
                        stroke={CHART_PALETTE[i % CHART_PALETTE.length]}
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}
    </WidgetCard>
  )
}
