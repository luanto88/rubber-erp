"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, CheckCircle2 } from "lucide-react"
import { hasPermission } from "@/lib/auth"
import { getInventoryTasks, type ModuleTaskItem } from "@/app/dashboard/_components/module-tasks"
import { WidgetCard, WidgetLoading, type WidgetProps } from "./widget-shared"

export function InventoryAlertsWidget({ factoryId, user }: WidgetProps) {
  const canView = hasPermission(user, "inventory.view")
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<ModuleTaskItem[]>([])

  useEffect(() => {
    if (!factoryId || !canView) {
      setLoading(false)
      return
    }
    let alive = true
    ;(async () => {
      try {
        const summary = await getInventoryTasks(factoryId)
        if (alive) setItems(summary.items)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [factoryId, canView])

  if (!canView) return null

  const total = items.reduce((s, it) => s + it.count, 0)

  return (
    <WidgetCard title="Cảnh báo tồn kho vật tư" subtitle="Phiếu chưa ghi sổ, vật tư tồn thấp, lô sắp/đã hết hạn">
      {loading ? (
        <WidgetLoading />
      ) : total === 0 ? (
        <div className="flex items-center gap-2 text-emerald-600 text-sm font-semibold py-4">
          <CheckCircle2 size={18} /> Không có cảnh báo nào.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <Link
              key={it.label}
              href={it.link}
              className={`flex items-center justify-between px-3 py-2.5 rounded-xl transition-colors ${
                it.count > 0 ? "bg-amber-50 hover:bg-amber-100" : "bg-slate-50 hover:bg-slate-100"
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                {it.count > 0 && <AlertTriangle size={14} className="text-amber-500" />}
                {it.label}
              </span>
              <span className={`text-sm font-extrabold ${it.count > 0 ? "text-amber-700" : "text-slate-400"}`}>{it.count}</span>
            </Link>
          ))}
        </div>
      )}
    </WidgetCard>
  )
}
