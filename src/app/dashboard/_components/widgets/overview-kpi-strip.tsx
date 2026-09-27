"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Warehouse, Package, BarChart3, FileOutput, ClipboardCheck, ListTodo } from "lucide-react"
import { hasPermission } from "@/lib/auth"
import { normalizeLotStatus } from "@/app/dashboard/product/shared"
import {
  getIsoTasks,
  getDocumentsTasks,
  getExportTasks,
  getInventoryTasks,
  getQualityTasks,
} from "@/app/dashboard/_components/module-tasks"
import { formatKg, formatCompact, formatPercent } from "@/lib/chart-theme"
import {
  getCurrentRanges,
  fetchAllPaged,
  getRawStockKho,
  getYearProductionRows,
  getCurrentMonthQualityReport,
  prodRowKho,
  type WidgetProps,
} from "./widget-shared"
import { AnimatedNumber } from "./animated-number"

type TileDef = {
  key: string
  label: string
  icon: typeof Package
  bg: string
  href?: string
  format: (n: number) => string
  load: () => Promise<{ num: number | null; sub?: string }>
}

type TileResult = { num: number | null; sub?: string } | "error"

export function OverviewKpiStrip({ factoryId, user }: WidgetProps) {
  const [results, setResults] = useState<Record<string, TileResult>>({})

  const defs = useMemo<TileDef[]>(() => {
    if (!factoryId || !user) return []
    const currentUser = user
    const { monthStart, today } = getCurrentRanges()
    const list: TileDef[] = []

    if (hasPermission(currentUser, "storage.view")) {
      list.push({
        key: "ton-nl",
        label: "Tồn kho nguyên liệu",
        icon: Warehouse,
        bg: "from-blue-500 to-indigo-600",
        href: "/dashboard/storage",
        format: formatKg,
        load: async () => ({ num: await getRawStockKho(factoryId) }),
      })
    }

    if (hasPermission(currentUser, "product.view")) {
      list.push({
        key: "ton-tp",
        label: "Tồn kho thành phẩm",
        icon: Package,
        bg: "from-emerald-500 to-green-600",
        href: "/dashboard/product",
        format: formatKg,
        load: async () => {
          // Chỉ lấy lô còn trong kho (Hoàn thành) — lọc tại DB thay vì tải toàn bộ bảng lots.
          // Gồm cả giá trị không dấu "Hoan thanh" còn sót từ trigger cũ (xem rule 06).
          const rows = await fetchAllPaged<{ tong_kg: number | null; trang_thai: string | null }>(
            "lots",
            "tong_kg,trang_thai",
            (q) => q.eq("factory_id", factoryId).in("trang_thai", ["Hoàn thành", "Hoan thanh"]),
          )
          const kho = rows
            .filter((r) => normalizeLotStatus(r.trang_thai) === "Hoàn thành")
            .reduce((s, r) => s + Number(r.tong_kg || 0), 0)
          return { num: kho }
        },
      })
    }

    if (hasPermission(currentUser, "output.view")) {
      list.push({
        key: "sl-thang",
        label: "Sản lượng khô tháng này",
        icon: BarChart3,
        bg: "from-amber-500 to-orange-600",
        href: "/dashboard/output",
        format: formatKg,
        load: async () => {
          const rows = await getYearProductionRows(factoryId)
          const kho = rows.filter((r) => r.ngay >= monthStart).reduce((s, r) => s + prodRowKho(r), 0)
          return { num: kho }
        },
      })
    }

    if (hasPermission(currentUser, "export.view")) {
      list.push({
        key: "xh-thang",
        label: "Xuất hàng tháng này",
        icon: FileOutput,
        bg: "from-purple-500 to-violet-600",
        href: "/dashboard/export",
        format: (n) => `${formatCompact(n)} bành`,
        load: async () => {
          const rows = await fetchAllPaged<{ tong_banh: number | null }>("export_orders", "tong_banh", (q) =>
            q.eq("factory_id", factoryId).gte("ngay", monthStart).lte("ngay", today),
          )
          return { num: rows.reduce((s, r) => s + Number(r.tong_banh || 0), 0), sub: `${rows.length} đơn` }
        },
      })
    }

    if (hasPermission(currentUser, "quality.view")) {
      list.push({
        key: "cl-thang",
        label: "Tỷ lệ đạt hạng tháng này",
        icon: ClipboardCheck,
        bg: "from-rose-500 to-red-600",
        href: "/dashboard/quality",
        format: formatPercent,
        load: async () => ({ num: (await getCurrentMonthQualityReport(factoryId)).tyLeDatToanNhaMay.thang }),
      })
    }

    const taskJobs: (() => Promise<{ items: { count: number }[] }>)[] = []
    if (hasPermission(currentUser, "iso.view")) taskJobs.push(() => getIsoTasks(factoryId, currentUser.id))
    if (hasPermission(currentUser, "documents.view")) taskJobs.push(() => getDocumentsTasks(factoryId, currentUser))
    if (hasPermission(currentUser, "export.view")) taskJobs.push(() => getExportTasks(factoryId, currentUser))
    if (hasPermission(currentUser, "inventory.view")) taskJobs.push(() => getInventoryTasks(factoryId))
    if (hasPermission(currentUser, "quality.view")) taskJobs.push(() => getQualityTasks(factoryId))
    if (taskJobs.length > 0) {
      list.push({
        key: "viec",
        label: "Việc cần làm",
        icon: ListTodo,
        bg: "from-cyan-500 to-teal-600",
        format: formatCompact,
        load: async () => {
          const summaries = await Promise.allSettled(taskJobs.map((j) => j()))
          const total = summaries.reduce(
            (s, sm) => s + (sm.status === "fulfilled" ? sm.value.items.reduce((s2, it) => s2 + it.count, 0) : 0),
            0,
          )
          return { num: total }
        },
      })
    }

    return list
  }, [factoryId, user])

  useEffect(() => {
    let alive = true
    // Mỗi ô tự cập nhật ngay khi xong — không đợi ô chậm nhất.
    for (const def of defs) {
      def
        .load()
        .then((r) => {
          if (alive) setResults((prev) => ({ ...prev, [def.key]: r }))
        })
        .catch(() => {
          if (alive) setResults((prev) => ({ ...prev, [def.key]: "error" }))
        })
    }
    return () => {
      alive = false
    }
  }, [defs])

  if (defs.length === 0) return null

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
      {defs.map((t) => {
        const r = results[t.key]
        const inner = (
          <div className="relative overflow-hidden bg-white rounded-2xl border border-slate-200 shadow-md p-5 hover-glow cursor-default group h-full">
            <div
              className={`absolute top-0 right-0 w-20 h-20 bg-gradient-to-br ${t.bg} rounded-full opacity-10 -translate-y-6 translate-x-6 group-hover:scale-150 transition-transform duration-500`}
            />
            <div className="flex items-center gap-3 mb-3 relative">
              <div className={`w-9 h-9 shrink-0 bg-gradient-to-br ${t.bg} rounded-xl flex items-center justify-center`}>
                <t.icon size={18} className="text-white" />
              </div>
              <span className="text-sm font-bold text-slate-600">{t.label}</span>
            </div>
            <div className="text-xl font-extrabold text-slate-800 relative">
              {r === undefined ? (
                <div className="skeleton h-6 w-24 rounded" />
              ) : r === "error" || r.num == null ? (
                "—"
              ) : (
                <AnimatedNumber value={r.num} format={t.format} />
              )}
            </div>
            {r !== undefined && r !== "error" && r.sub && <div className="text-xs text-slate-400 mt-0.5">{r.sub}</div>}
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
