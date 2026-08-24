"use client"

import { useEffect, useState } from "react"
import { Droplet } from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import { hasPermission } from "@/lib/auth"
import { CHART_PALETTE, ChartTooltip, formatKg } from "@/lib/chart-theme"
import { WidgetCard, WidgetLoading, WidgetEmpty, getCurrentRanges, fetchAllPaged, TILE_PATTERN_FOREST, type WidgetProps } from "./widget-shared"

type ProdRow = {
  ngay: string
  mn_kho: number | null
  ct_kho: number | null
  dct_kho: number | null
  dkt_kho: number | null
  dt_kho: number | null
}

function rowKho(r: ProdRow) {
  return Number(r.mn_kho || 0) + Number(r.ct_kho || 0) + Number(r.dct_kho || 0) + Number(r.dkt_kho || 0) + Number(r.dt_kho || 0)
}

export function ProductionWidget({ factoryId, user }: WidgetProps) {
  const canView = hasPermission(user, "output.view")
  const canViewStorage = hasPermission(user, "storage.view")
  const [loading, setLoading] = useState(true)
  const [tonKho, setTonKho] = useState<number | null>(null)
  const [thangKho, setThangKho] = useState(0)
  const [namKho, setNamKho] = useState(0)
  const [chartData, setChartData] = useState<{ ngay: string; kho: number }[]>([])

  useEffect(() => {
    if (!factoryId || !canView) {
      setLoading(false)
      return
    }
    let alive = true
    ;(async () => {
      try {
        const { monthStart, yearStart, today } = getCurrentRanges()
        const jobs: Promise<void>[] = []

        jobs.push(
          (async () => {
            const rows = await fetchAllPaged<ProdRow>(
              "production_records",
              "ngay,mn_kho,ct_kho,dct_kho,dkt_kho,dt_kho",
              (q) => q.eq("factory_id", factoryId).gte("ngay", yearStart).lte("ngay", today),
            )
            let tKho = 0
            let nKho = 0
            const byDay: Record<string, number> = {}
            for (const r of rows) {
              const v = rowKho(r)
              nKho += v
              if (r.ngay >= monthStart) {
                tKho += v
                byDay[r.ngay] = (byDay[r.ngay] || 0) + v
              }
            }
            if (alive) {
              setThangKho(tKho)
              setNamKho(nKho)
              setChartData(
                Object.entries(byDay)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([ngay, kho]) => ({ ngay: ngay.slice(8, 10), kho })),
              )
            }
          })(),
        )

        if (canViewStorage) {
          jobs.push(
            (async () => {
              const rows = await fetchAllPaged<{ tong_kho: number | null }>("ngans", "tong_kho", (q) =>
                q.eq("factory_id", factoryId).neq("trang_thai", "Đã sản xuất"),
              )
              const kho = rows.reduce((s, r) => s + Number(r.tong_kho || 0), 0)
              if (alive) setTonKho(kho)
            })(),
          )
        }

        await Promise.allSettled(jobs)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [factoryId, canView, canViewStorage])

  if (!canView) return null

  return (
    <WidgetCard
      title="Sản lượng"
      subtitle="Nguyên liệu tồn kho & sản lượng khô theo ngày trong tháng"
      theme="forest"
      icon={Droplet}
    >
      {loading ? (
        <WidgetLoading />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {canViewStorage && (
              <div className={`bg-blue-50 rounded-xl p-3 ${TILE_PATTERN_FOREST}`}>
                <div className="text-xs font-semibold text-blue-600 mb-1">Tồn kho NL hiện tại</div>
                <div className="text-lg font-extrabold text-blue-800">{tonKho == null ? "—" : formatKg(tonKho)}</div>
              </div>
            )}
            <div className={`bg-amber-50 rounded-xl p-3 ${TILE_PATTERN_FOREST}`}>
              <div className="text-xs font-semibold text-amber-600 mb-1">Khô tháng này</div>
              <div className="text-lg font-extrabold text-amber-800">{formatKg(thangKho)}</div>
            </div>
            <div className={`bg-emerald-50 rounded-xl p-3 ${TILE_PATTERN_FOREST}`}>
              <div className="text-xs font-semibold text-emerald-600 mb-1">Lũy kế năm</div>
              <div className="text-lg font-extrabold text-emerald-800">{formatKg(namKho)}</div>
            </div>
          </div>
          <div className="h-56">
            {chartData.length === 0 ? (
              <WidgetEmpty />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="ngay" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="kho" name="Khô (kg)" fill={CHART_PALETTE[2]} radius={[6, 6, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}
    </WidgetCard>
  )
}
