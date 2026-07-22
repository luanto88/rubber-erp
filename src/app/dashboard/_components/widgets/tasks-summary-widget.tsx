"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { CheckCircle2, ListTodo } from "lucide-react"
import { hasPermission } from "@/lib/auth"
import {
  getIsoTasks,
  getDocumentsTasks,
  getExportTasks,
  getQualityTasks,
  type ModuleTaskSummary,
} from "@/app/dashboard/_components/module-tasks"
import { WidgetCard, WidgetLoading, type WidgetProps } from "./widget-shared"

// Không gọi getInventoryTasks ở đây — đã có inventory-alerts-widget.tsx đứng cạnh,
// tránh hiện trùng số liệu 2 lần trên cùng trang.
export function TasksSummaryWidget({ factoryId, user }: WidgetProps) {
  const [loading, setLoading] = useState(true)
  const [summaries, setSummaries] = useState<ModuleTaskSummary[]>([])

  useEffect(() => {
    if (!factoryId || !user) {
      setLoading(false)
      return
    }
    let alive = true
    const currentUser = user
    ;(async () => {
      try {
        const jobs: Promise<ModuleTaskSummary>[] = []
        if (hasPermission(currentUser, "iso.view")) jobs.push(getIsoTasks(factoryId, currentUser.id))
        if (hasPermission(currentUser, "documents.view")) jobs.push(getDocumentsTasks(factoryId, currentUser))
        if (hasPermission(currentUser, "export.view")) jobs.push(getExportTasks(factoryId, currentUser))
        if (hasPermission(currentUser, "quality.view")) jobs.push(getQualityTasks(factoryId))
        const results = await Promise.all(jobs)
        if (alive) setSummaries(results)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [factoryId, user])

  if (!user) return null

  const total = summaries.reduce((s, sm) => s + sm.items.reduce((s2, it) => s2 + it.count, 0), 0)

  return (
    <WidgetCard title="Việc cần làm" subtitle="Tổng hợp từ ISO, Văn bản, Xuất hàng, Chất lượng">
      {loading ? (
        <WidgetLoading />
      ) : total === 0 ? (
        <div className="flex items-center gap-2 text-emerald-600 text-sm font-semibold py-4">
          <CheckCircle2 size={18} /> Không có việc gì đang chờ xử lý.
        </div>
      ) : (
        <div className="space-y-3">
          {summaries.map((sm) => {
            const smTotal = sm.items.reduce((s, it) => s + it.count, 0)
            if (smTotal === 0) return null
            return (
              <div key={sm.moduleLabel}>
                <div className="text-xs font-bold text-slate-400 uppercase mb-1">{sm.moduleLabel}</div>
                <div className="space-y-1">
                  {sm.items
                    .filter((it) => it.count > 0)
                    .map((it) => (
                      <Link
                        key={it.label}
                        href={it.link}
                        className="flex items-center justify-between px-3 py-2 rounded-xl bg-cyan-50 hover:bg-cyan-100 transition-colors"
                      >
                        <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                          <ListTodo size={14} className="text-cyan-600" /> {it.label}
                        </span>
                        <span className="text-sm font-extrabold text-cyan-700">{it.count}</span>
                      </Link>
                    ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </WidgetCard>
  )
}
