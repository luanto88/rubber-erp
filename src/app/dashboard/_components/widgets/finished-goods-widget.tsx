"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Package } from "lucide-react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts"
import { hasPermission } from "@/lib/auth"
import { normalizeLotStatus } from "@/app/dashboard/product/shared"
import { CHART_PALETTE, STATUS_COLORS, ChartTooltip, formatKg } from "@/lib/chart-theme"
import { WidgetCard, WidgetLoading, WidgetEmpty, getCurrentRanges, fetchAllPaged, type WidgetProps } from "./widget-shared"

type LotRow = {
  ma_lo: string | null
  loai_csr: string | null
  loai_banh: number | null
  boc: string | null
  tong_kg: number | null
  tong_banh: number | null
  trang_thai: string | null
  ngay_sx: string | null
}

type TxRow = { ngay_nhap: string | null; ca: string | null; so_kg: number | null }

const CA_LABELS: Record<string, string> = { A: "Ca A", B: "Ca B", C: "Ca C" }

export function FinishedGoodsWidget({ factoryId, user }: WidgetProps) {
  const canView = hasPermission(user, "product.view")
  const [loading, setLoading] = useState(true)
  const [csrData, setCsrData] = useState<{ name: string; lots: number; banh: number }[]>([])
  const [statusData, setStatusData] = useState<{ name: string; value: number }[]>([])
  const [tonKhoBreakdown, setTonKhoBreakdown] = useState<
    { key: string; loai_csr: string; loai_banh: number; boc: string; tong_kg: number }[]
  >([])
  const [recentLots, setRecentLots] = useState<LotRow[]>([])
  const [dailyChart, setDailyChart] = useState<{ ngay: string; kg: number }[]>([])
  const [caStats, setCaStats] = useState<{ ca: string; kg: number }[]>([])
  const [thangKg, setThangKg] = useState(0)
  const [namKg, setNamKg] = useState(0)

  useEffect(() => {
    if (!factoryId || !canView) {
      setLoading(false)
      return
    }
    let alive = true
    ;(async () => {
      try {
        const { monthStart, yearStart, today } = getCurrentRanges()

        const [lots, txRows] = await Promise.all([
          fetchAllPaged<LotRow>(
            "lots",
            "ma_lo,loai_csr,loai_banh,boc,tong_kg,tong_banh,trang_thai,ngay_sx",
            (q) => q.eq("factory_id", factoryId),
          ),
          fetchAllPaged<TxRow>("lot_transactions", "ngay_nhap,ca,so_kg,lots!inner(factory_id)", (q) =>
            q.eq("lots.factory_id", factoryId).gte("ngay_nhap", yearStart).lte("ngay_nhap", today),
          ),
        ])

        if (!alive) return

        // CSR bar + trạng thái pie (mirror page.tsx hiện tại)
        const csrMap: Record<string, { lots: number; banh: number }> = {}
        const statusMap: Record<string, number> = {}
        for (const lot of lots) {
          const csr = lot.loai_csr || "Khác"
          if (!csrMap[csr]) csrMap[csr] = { lots: 0, banh: 0 }
          csrMap[csr].lots++
          csrMap[csr].banh += lot.tong_banh || 0
          const st = normalizeLotStatus(lot.trang_thai)
          statusMap[st] = (statusMap[st] || 0) + 1
        }
        setCsrData(Object.entries(csrMap).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.lots - a.lots))
        setStatusData(Object.entries(statusMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value))

        // Tồn kho theo CSR × Bành × Bọc — chỉ lô "Hoàn thành" (đã sản xuất, chưa xuất hàng)
        const tonMap: Record<string, { loai_csr: string; loai_banh: number; boc: string; tong_kg: number }> = {}
        for (const lot of lots) {
          if (normalizeLotStatus(lot.trang_thai) !== "Hoàn thành") continue
          const key = `${lot.loai_csr || "?"}|${lot.loai_banh || 0}|${lot.boc || "?"}`
          if (!tonMap[key]) tonMap[key] = { loai_csr: lot.loai_csr || "?", loai_banh: lot.loai_banh || 0, boc: lot.boc || "—", tong_kg: 0 }
          tonMap[key].tong_kg += lot.tong_kg || 0
        }
        setTonKhoBreakdown(
          Object.entries(tonMap)
            .map(([key, v]) => ({ key, ...v }))
            .sort((a, b) => b.tong_kg - a.tong_kg)
            .slice(0, 8),
        )

        // Lô gần đây
        setRecentLots(
          [...lots]
            .filter((l) => l.ngay_sx)
            .sort((a, b) => (b.ngay_sx || "").localeCompare(a.ngay_sx || ""))
            .slice(0, 5),
        )

        // Biểu đồ theo ngày trong tháng + thống kê theo ca + lũy kế
        const byDay: Record<string, number> = {}
        const byCa: Record<string, number> = {}
        let tKg = 0
        let nKg = 0
        for (const tx of txRows) {
          const kg = Number(tx.so_kg || 0)
          nKg += kg
          if (tx.ngay_nhap && tx.ngay_nhap >= monthStart) {
            tKg += kg
            byDay[tx.ngay_nhap] = (byDay[tx.ngay_nhap] || 0) + kg
            const ca = tx.ca || "?"
            byCa[ca] = (byCa[ca] || 0) + kg
          }
        }
        setThangKg(tKg)
        setNamKg(nKg)
        setDailyChart(
          Object.entries(byDay)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([ngay, kg]) => ({ ngay: ngay.slice(8, 10), kg })),
        )
        setCaStats(
          Object.entries(byCa)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([ca, kg]) => ({ ca, kg })),
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

  const renderPieLabel = ({ name, percent }: { name?: string; percent?: number }) => {
    if (!percent || percent < 0.03) return null
    return `${name} (${(percent * 100).toFixed(0)}%)`
  }

  return (
    <WidgetCard
      title="Thành phẩm"
      subtitle="Tồn kho theo chủng loại & sản lượng theo ngày/ca"
      action={
        <Link href="/dashboard/product" className="text-xs font-semibold text-emerald-600 hover:text-emerald-700">
          Xem tất cả →
        </Link>
      }
    >
      {loading ? (
        <WidgetLoading />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 h-64">
              {csrData.length === 0 ? (
                <WidgetEmpty />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={csrData} barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fontWeight: 600, fill: "#64748b" }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={40} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={50} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar yAxisId="left" dataKey="lots" name="Số lô" fill={CHART_PALETTE[0]} radius={[6, 6, 0, 0]} maxBarSize={40} />
                    <Bar yAxisId="right" dataKey="banh" name="Tổng bành" fill={CHART_PALETTE[1]} radius={[6, 6, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="h-64">
              {statusData.length === 0 ? (
                <WidgetEmpty />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusData} cx="50%" cy="45%" innerRadius={48} outerRadius={78} paddingAngle={3} dataKey="value" label={renderPieLabel} labelLine={{ stroke: "#cbd5e1", strokeWidth: 1 }}>
                      {statusData.map((d, i) => (
                        <Cell key={i} fill={STATUS_COLORS[d.name] || CHART_PALETTE[i % CHART_PALETTE.length]} stroke="white" strokeWidth={2} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                    <Legend verticalAlign="bottom" height={30} iconType="circle" iconSize={8} formatter={(v: string) => <span className="text-xs font-semibold text-slate-600">{v}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-emerald-50 rounded-xl p-3">
              <div className="text-xs font-semibold text-emerald-600 mb-1">Sản lượng tháng này</div>
              <div className="text-lg font-extrabold text-emerald-800">{formatKg(thangKg)}</div>
            </div>
            <div className="bg-blue-50 rounded-xl p-3">
              <div className="text-xs font-semibold text-blue-600 mb-1">Lũy kế năm</div>
              <div className="text-lg font-extrabold text-blue-800">{formatKg(namKg)}</div>
            </div>
            {caStats.map((c) => (
              <div key={c.ca} className="bg-slate-50 rounded-xl p-3">
                <div className="text-xs font-semibold text-slate-500 mb-1">{CA_LABELS[c.ca] || `Ca ${c.ca}`} (tháng)</div>
                <div className="text-lg font-extrabold text-slate-700">{formatKg(c.kg)}</div>
              </div>
            ))}
          </div>

          <div>
            <h3 className="text-sm font-bold text-slate-600 mb-2">Sản lượng theo ngày trong tháng</h3>
            <div className="h-48">
              {dailyChart.length === 0 ? (
                <WidgetEmpty />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyChart}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="ngay" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={40} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="kg" name="KL (kg)" fill={CHART_PALETTE[3]} radius={[6, 6, 0, 0]} maxBarSize={24} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <h3 className="text-sm font-bold text-slate-600 mb-2">Tồn kho theo CSR × Bành × Bọc</h3>
              {tonKhoBreakdown.length === 0 ? (
                <WidgetEmpty />
              ) : (
                <div className="space-y-1.5">
                  {tonKhoBreakdown.map((r) => (
                    <div key={r.key} className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 text-sm">
                      <span className="font-semibold text-slate-700">
                        CSR{r.loai_csr} · {r.loai_banh} · {r.boc}
                      </span>
                      <span className="font-bold text-slate-800">{formatKg(r.tong_kg)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-600 mb-2">Lô gần đây</h3>
              {recentLots.length === 0 ? (
                <WidgetEmpty />
              ) : (
                <div className="space-y-1.5">
                  {recentLots.map((lot, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-50 transition-colors">
                      <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Package size={14} className="text-emerald-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-slate-700 truncate">{lot.ma_lo}</div>
                        <div className="text-[10px] text-slate-400">
                          {lot.ngay_sx ? new Date(lot.ngay_sx).toLocaleDateString("vi-VN") : "—"} · {lot.loai_csr}
                        </div>
                      </div>
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                        style={{
                          backgroundColor: `${STATUS_COLORS[normalizeLotStatus(lot.trang_thai)]}1a`,
                          color: STATUS_COLORS[normalizeLotStatus(lot.trang_thai)],
                        }}
                      >
                        {normalizeLotStatus(lot.trang_thai)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </WidgetCard>
  )
}
