"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Truck } from "lucide-react"
import { hasPermission } from "@/lib/auth"
import { supabase } from "@/lib/supabase"
import { toISODate } from "@/lib/dispatch-entry-rows"
import { buildDispatchAnalytics, type DispatchAnalyticsEntry } from "@/lib/dispatch-analytics"
import type { DiemGN } from "@/lib/dispatch-master"
import { formatCompact } from "@/lib/chart-theme"
import { WidgetCard, WidgetLoading, WidgetEmpty, getCurrentRanges, fetchAllPaged, TILE_PATTERN_OCEAN, type WidgetProps } from "./widget-shared"

type Stat = { chuyen1: number; chuyenTiep: number; km: number; quyKhoTb: number; trips: number }

function computeStat(entries: DispatchAnalyticsEntry[], deliveryPoints: DiemGN[]): Stat {
  const analytics = buildDispatchAnalytics(entries, deliveryPoints)
  const chuyen1 = analytics.trips.filter((t) => (t.chuyen ?? 1) === 1).length
  const chuyenTiep = analytics.trips.length - chuyen1
  return {
    chuyen1,
    chuyenTiep,
    km: analytics.totals.km,
    quyKhoTb: analytics.totals.trips > 0 ? analytics.totals.totalKho / analytics.totals.trips : 0,
    trips: analytics.totals.trips,
  }
}

export function DispatchWidget({ factoryId, user }: WidgetProps) {
  const canView = hasPermission(user, "dispatch.view")
  const [loading, setLoading] = useState(true)
  const [thang, setThang] = useState<Stat | null>(null)
  const [nam, setNam] = useState<Stat | null>(null)

  useEffect(() => {
    if (!factoryId || !canView) {
      setLoading(false)
      return
    }
    let alive = true
    ;(async () => {
      try {
        const { monthStart } = getCurrentRanges()
        const [entries, deliveryPointsRes] = await Promise.all([
          fetchAllPaged<DispatchAnalyticsEntry>("dispatch_entries", "id,ngay,rows", (q) =>
            q.eq("factory_id", factoryId),
          ),
          supabase.from("dispatch_delivery_points").select("ma_lo,lat,lng,doi,phien_a,phien_b,phien_c,phien_d").eq("factory_id", factoryId),
        ])
        if (!alive) return

        const deliveryPoints = (deliveryPointsRes.data || []) as DiemGN[]
        const yearNow = new Date().getFullYear()
        // dispatch_entries.ngay có thể là "YYYY-MM-DD" hoặc "dd/mm/yyyy" — không lọc bằng
        // .gte/.lte trên chuỗi thô, phải chuẩn hóa từng dòng trước khi so sánh.
        const yearEntries = entries.filter((e) => toISODate(e.ngay).slice(0, 4) === String(yearNow))
        const monthEntries = yearEntries.filter((e) => toISODate(e.ngay) >= monthStart)

        setNam(computeStat(yearEntries, deliveryPoints))
        setThang(computeStat(monthEntries, deliveryPoints))
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
      title="Điều xe"
      subtitle="Số chuyến, quãng đường & quy khô trung bình mỗi chuyến"
      theme="ocean"
      icon={Truck}
      action={
        <Link href="/dashboard/dispatch" className="text-xs font-semibold text-white/90 hover:text-white">
          Xem tất cả →
        </Link>
      }
    >
      {loading ? (
        <WidgetLoading />
      ) : !thang || !nam || thang.trips === 0 ? (
        <WidgetEmpty />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { label: "Tháng này", stat: thang },
            { label: "Năm nay", stat: nam },
          ].map(({ label, stat }) => (
            <div key={label} className={`rounded-xl border border-slate-100 p-4 ${TILE_PATTERN_OCEAN}`}>
              <div className="text-xs font-bold text-slate-500 mb-3">{label}</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[11px] text-slate-400">Chuyến 1</div>
                  <div className="text-lg font-extrabold text-slate-800">{formatCompact(stat.chuyen1)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400">Chuyến 2+</div>
                  <div className="text-lg font-extrabold text-slate-800">{formatCompact(stat.chuyenTiep)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400">Số km</div>
                  <div className="text-lg font-extrabold text-slate-800">{formatCompact(stat.km)} km</div>
                </div>
                <div>
                  <div className="text-[11px] text-slate-400">Quy khô TB/chuyến</div>
                  <div className="text-lg font-extrabold text-slate-800">{formatCompact(Math.round(stat.quyKhoTb))} kg</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </WidgetCard>
  )
}
