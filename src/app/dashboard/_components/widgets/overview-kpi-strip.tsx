"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Warehouse, Package, BarChart3, FileOutput, ClipboardCheck, ListTodo } from "lucide-react"
import { hasPermission } from "@/lib/auth"
import { normalizeLotStatus } from "@/app/dashboard/product/shared"
import { buildMonthlyQualityReport, SAN_PHAM_GROUP, TIEU_CHUAN_OPTIONS } from "@/lib/quality-stats"
import {
  getIsoTasks,
  getDocumentsTasks,
  getExportTasks,
  getInventoryTasks,
  getQualityTasks,
} from "@/app/dashboard/_components/module-tasks"
import { formatKg, formatCompact, formatPercent } from "@/lib/chart-theme"
import { getCurrentRanges, fetchAllPaged, type WidgetProps } from "./widget-shared"

type Tile = {
  key: string
  label: string
  value: string
  sub?: string
  icon: typeof Package
  bg: string
  href?: string
}

export function OverviewKpiStrip({ factoryId, user }: WidgetProps) {
  const [tiles, setTiles] = useState<Tile[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!factoryId || !user) {
      setLoading(false)
      return
    }
    let alive = true
    const currentUser = user
    ;(async () => {
     try {
      const { nam, thang, monthStart, today } = getCurrentRanges()
      const results: Tile[] = []
      const jobs: Promise<void>[] = []

      if (hasPermission(currentUser, "storage.view")) {
        jobs.push(
          (async () => {
            const rows = await fetchAllPaged<{ tong_kho: number | null }>("ngans", "tong_kho", (q) =>
              q.eq("factory_id", factoryId).neq("trang_thai", "Đã sản xuất"),
            )
            const kho = rows.reduce((s, r) => s + Number(r.tong_kho || 0), 0)
            results.push({
              key: "ton-nl",
              label: "Tồn kho nguyên liệu",
              value: formatKg(kho),
              icon: Warehouse,
              bg: "from-blue-500 to-indigo-600",
              href: "/dashboard/storage",
            })
          })(),
        )
      }

      if (hasPermission(currentUser, "product.view")) {
        jobs.push(
          (async () => {
            const rows = await fetchAllPaged<{ tong_kg: number | null; trang_thai: string | null }>(
              "lots",
              "tong_kg,trang_thai",
              (q) => q.eq("factory_id", factoryId),
            )
            const kho = rows
              .filter((r) => normalizeLotStatus(r.trang_thai) === "Hoàn thành")
              .reduce((s, r) => s + Number(r.tong_kg || 0), 0)
            results.push({
              key: "ton-tp",
              label: "Tồn kho thành phẩm",
              value: formatKg(kho),
              icon: Package,
              bg: "from-emerald-500 to-green-600",
              href: "/dashboard/product",
            })
          })(),
        )
      }

      if (hasPermission(currentUser, "output.view")) {
        jobs.push(
          (async () => {
            const rows = await fetchAllPaged<{
              mn_kho: number | null
              ct_kho: number | null
              dct_kho: number | null
              dkt_kho: number | null
              dt_kho: number | null
            }>("production_records", "mn_kho,ct_kho,dct_kho,dkt_kho,dt_kho", (q) =>
              q.eq("factory_id", factoryId).gte("ngay", monthStart).lte("ngay", today),
            )
            const kho = rows.reduce(
              (s, r) =>
                s +
                Number(r.mn_kho || 0) +
                Number(r.ct_kho || 0) +
                Number(r.dct_kho || 0) +
                Number(r.dkt_kho || 0) +
                Number(r.dt_kho || 0),
              0,
            )
            results.push({
              key: "sl-thang",
              label: "Sản lượng khô tháng này",
              value: formatKg(kho),
              icon: BarChart3,
              bg: "from-amber-500 to-orange-600",
              href: "/dashboard/output",
            })
          })(),
        )
      }

      if (hasPermission(currentUser, "export.view")) {
        jobs.push(
          (async () => {
            const rows = await fetchAllPaged<{ tong_banh: number | null }>(
              "export_orders",
              "tong_banh",
              (q) => q.eq("factory_id", factoryId).gte("ngay", monthStart).lte("ngay", today),
            )
            const banh = rows.reduce((s, r) => s + Number(r.tong_banh || 0), 0)
            results.push({
              key: "xh-thang",
              label: "Xuất hàng tháng này",
              value: `${formatCompact(banh)} bành`,
              sub: `${rows.length} đơn`,
              icon: FileOutput,
              bg: "from-purple-500 to-violet-600",
              href: "/dashboard/export",
            })
          })(),
        )
      }

      if (hasPermission(currentUser, "quality.view")) {
        jobs.push(
          (async () => {
            const report = await buildMonthlyQualityReport({
              factoryId,
              nam,
              thang,
              sanPhamList: Object.keys(SAN_PHAM_GROUP),
              tieuChuan: TIEU_CHUAN_OPTIONS[0],
              chiTieuList: [],
            })
            const ty = report.tyLeDatToanNhaMay.thang
            results.push({
              key: "cl-thang",
              label: "Tỷ lệ đạt hạng tháng này",
              value: ty == null ? "—" : formatPercent(ty),
              icon: ClipboardCheck,
              bg: "from-rose-500 to-red-600",
              href: "/dashboard/quality",
            })
          })(),
        )
      }

      const taskJobs: Promise<{ items: { count: number }[] }>[] = []
      if (hasPermission(currentUser, "iso.view")) taskJobs.push(getIsoTasks(factoryId, currentUser.id))
      if (hasPermission(currentUser, "documents.view")) taskJobs.push(getDocumentsTasks(factoryId, currentUser))
      if (hasPermission(currentUser, "export.view")) taskJobs.push(getExportTasks(factoryId, currentUser))
      if (hasPermission(currentUser, "inventory.view")) taskJobs.push(getInventoryTasks(factoryId))
      if (hasPermission(currentUser, "quality.view")) taskJobs.push(getQualityTasks(factoryId))
      if (taskJobs.length > 0) {
        jobs.push(
          (async () => {
            const summaries = await Promise.all(taskJobs)
            const total = summaries.reduce((s, sm) => s + sm.items.reduce((s2, it) => s2 + it.count, 0), 0)
            results.push({
              key: "viec",
              label: "Việc cần làm",
              value: formatCompact(total),
              icon: ListTodo,
              bg: "from-cyan-500 to-teal-600",
            })
          })(),
        )
      }

      await Promise.allSettled(jobs)
      if (alive) setTiles(results)
     } finally {
      if (alive) setLoading(false)
     }
    })()
    return () => {
      alive = false
    }
  }, [factoryId, user])

  if (!loading && tiles.length === 0) return null

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
      {loading
        ? Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-slate-200 shadow-md p-5 h-[92px] animate-pulse" />
          ))
        : tiles.map((t) => {
            const inner = (
              <div className="relative overflow-hidden bg-white rounded-2xl border border-slate-200 shadow-md p-5 hover-glow cursor-default group h-full">
                <div
                  className={`absolute top-0 right-0 w-20 h-20 bg-gradient-to-br ${t.bg} rounded-full opacity-10 -translate-y-6 translate-x-6 group-hover:scale-150 transition-transform duration-500`}
                />
                <div className="flex items-center gap-3 mb-3 relative">
                  <div className={`w-9 h-9 bg-gradient-to-br ${t.bg} rounded-xl flex items-center justify-center`}>
                    <t.icon size={18} className="text-white" />
                  </div>
                  <span className="text-sm font-bold text-slate-600">{t.label}</span>
                </div>
                <div className="text-xl font-extrabold text-slate-800 relative">{t.value}</div>
                {t.sub && <div className="text-xs text-slate-400 mt-0.5">{t.sub}</div>}
              </div>
            )
            return t.href ? (
              <Link key={t.key} href={t.href}>
                {inner}
              </Link>
            ) : (
              <div key={t.key}>{inner}</div>
            )
          })}
    </div>
  )
}
