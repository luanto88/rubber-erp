"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { FileOutput } from "lucide-react"
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import { supabase } from "@/lib/supabase"
import { hasPermission } from "@/lib/auth"
import { CHART_PALETTE, ChartTooltip, formatCompact } from "@/lib/chart-theme"
import { WidgetCard, WidgetLoading, WidgetEmpty, getCurrentRanges, fetchAllPaged, type WidgetProps } from "./widget-shared"

type OrderRow = { customer_id: string | null; ngay: string | null; tong_banh: number | null }
type CustomerRow = { id: string; ma_kh: string | null; ten_kh_en: string | null }

export function ExportWidget({ factoryId, user }: WidgetProps) {
  const canView = hasPermission(user, "export.view")
  const [loading, setLoading] = useState(true)
  const [topThang, setTopThang] = useState<{ id: string; name: string; banh: number }[]>([])
  const [topNam, setTopNam] = useState<{ id: string; name: string; banh: number }[]>([])
  const [monthlyData, setMonthlyData] = useState<{ month: string; orders: number; banh: number }[]>([])

  useEffect(() => {
    if (!factoryId || !canView) {
      setLoading(false)
      return
    }
    let alive = true
    ;(async () => {
      try {
        const { monthStart, today } = getCurrentRanges()
        const now = new Date()
        const from12mo = new Date(now.getFullYear(), now.getMonth() - 11, 1).toISOString().slice(0, 10)

        const [orders, customersRaw] = await Promise.all([
          fetchAllPaged<OrderRow>("export_orders", "customer_id,ngay,tong_banh", (q) =>
            q.eq("factory_id", factoryId).gte("ngay", from12mo).lte("ngay", today),
          ),
          supabase.from("customers").select("id,ma_kh,ten_kh_en").eq("factory_id", factoryId),
        ])
        if (!alive) return

        const customers = (customersRaw.data || []) as CustomerRow[]
        const nameOf = (id: string | null) => {
          const c = customers.find((x) => x.id === id)
          return c ? c.ma_kh || c.ten_kh_en || "—" : "—"
        }

        const byCustomerThang: Record<string, number> = {}
        const byCustomerNam: Record<string, number> = {}
        const monthMap: Record<string, { orders: number; banh: number }> = {}
        for (let i = 11; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
          monthMap[key] = { orders: 0, banh: 0 }
        }

        const yearStart = `${now.getFullYear()}-01-01`
        for (const o of orders) {
          if (!o.ngay) continue
          const cid = o.customer_id || "—"
          const banh = Number(o.tong_banh || 0)
          if (o.ngay >= yearStart) byCustomerNam[cid] = (byCustomerNam[cid] || 0) + banh
          if (o.ngay >= monthStart) byCustomerThang[cid] = (byCustomerThang[cid] || 0) + banh

          const mKey = o.ngay.slice(0, 7)
          if (monthMap[mKey]) {
            monthMap[mKey].orders++
            monthMap[mKey].banh += banh
          }
        }

        const toTop = (m: Record<string, number>) =>
          Object.entries(m)
            .map(([id, banh]) => ({ id, name: nameOf(id), banh }))
            .sort((a, b) => b.banh - a.banh)
            .slice(0, 5)

        setTopThang(toTop(byCustomerThang))
        setTopNam(toTop(byCustomerNam))
        setMonthlyData(
          Object.entries(monthMap).map(([month, v]) => {
            const [y, m] = month.split("-")
            return { month: `T${parseInt(m)}/${y.slice(2)}`, ...v }
          }),
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
      title="Xuất hàng"
      subtitle="Top khách hàng & xu hướng xuất hàng theo tháng"
      theme="ocean"
      icon={FileOutput}
      action={
        <Link href="/dashboard/export" className="text-xs font-semibold text-white/90 hover:text-white">
          Xem tất cả →
        </Link>
      }
    >
      {loading ? (
        <WidgetLoading />
      ) : (
        <div className="space-y-5">
          <div className="h-56">
            {monthlyData.every((m) => m.orders === 0) ? (
              <WidgetEmpty />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyData}>
                  <defs>
                    <linearGradient id="gradExportOrders" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_PALETTE[3]} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={CHART_PALETTE[3]} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradExportBanh" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_PALETTE[4]} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={CHART_PALETTE[4]} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fontWeight: 600, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={30} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={50} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="orders"
                    name="Số đơn"
                    stroke={CHART_PALETTE[3]}
                    strokeWidth={2.5}
                    fill="url(#gradExportOrders)"
                    dot={{ r: 3, fill: CHART_PALETTE[3], stroke: "white", strokeWidth: 2 }}
                  />
                  <Area
                    yAxisId="right"
                    type="monotone"
                    dataKey="banh"
                    name="Tổng bành"
                    stroke={CHART_PALETTE[4]}
                    strokeWidth={2.5}
                    fill="url(#gradExportBanh)"
                    dot={{ r: 3, fill: CHART_PALETTE[4], stroke: "white", strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <h3 className="text-sm font-bold text-slate-600 mb-2">Top khách hàng tháng này</h3>
              {topThang.length === 0 ? (
                <WidgetEmpty />
              ) : (
                <div className="space-y-1.5">
                  {topThang.map((c) => (
                    <div key={c.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 text-sm">
                      <span className="font-semibold text-slate-700 truncate">{c.name}</span>
                      <span className="font-bold text-slate-800">{formatCompact(c.banh)} bành</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-600 mb-2">Top khách hàng năm nay</h3>
              {topNam.length === 0 ? (
                <WidgetEmpty />
              ) : (
                <div className="space-y-1.5">
                  {topNam.map((c) => (
                    <div key={c.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 text-sm">
                      <span className="font-semibold text-slate-700 truncate">{c.name}</span>
                      <span className="font-bold text-slate-800">{formatCompact(c.banh)} bành</span>
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
