"use client"

// View "Lịch" — lưới tháng thuần Tailwind (repo chưa có thư viện calendar), mỗi ngày liệt kê
// các công việc có han_hoan_thanh rơi vào đúng ngày đó, màu theo trạng thái. Click 1 ngày ->
// panel bên dưới hiện danh sách chi tiết; click 1 task -> vào trang chi tiết.

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { KPI_STATUS_BADGE_CLASS, KPI_STATUS_LABEL, formatKpiDateTime, isTaskOverdue, type KpiTask } from "@/lib/kpi-tasks"

const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"]

function pad2(n: number) {
  return String(n).padStart(2, "0")
}
function toDateKey(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

type KpiTaskCalendarProps = {
  tasks: KpiTask[]
}

export function KpiTaskCalendar({ tasks }: KpiTaskCalendarProps) {
  const router = useRouter()
  const [cursor, setCursor] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const tasksByDay = useMemo(() => {
    const map = new Map<string, KpiTask[]>()
    for (const t of tasks) {
      const d = new Date(t.han_hoan_thanh)
      if (Number.isNaN(d.getTime())) continue
      const key = toDateKey(d)
      map.set(key, [...(map.get(key) || []), t])
    }
    return map
  }, [tasks])

  const cells = useMemo(() => {
    const year = cursor.getFullYear()
    const month = cursor.getMonth()
    const firstDay = new Date(year, month, 1)
    // Thứ Hai = 0 ... Chủ Nhật = 6
    const startOffset = (firstDay.getDay() + 6) % 7
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const result: { date: Date | null; key: string | null }[] = []
    for (let i = 0; i < startOffset; i++) result.push({ date: null, key: null })
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(year, month, day)
      result.push({ date: d, key: toDateKey(d) })
    }
    while (result.length % 7 !== 0) result.push({ date: null, key: null })
    return result
  }, [cursor])

  const todayKey = toDateKey(new Date())
  const selectedTasks = selectedKey ? tasksByDay.get(selectedKey) || [] : []

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
            className="p-2 rounded-xl hover:bg-slate-100 text-slate-500"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="text-sm font-extrabold text-slate-700">
            Tháng {cursor.getMonth() + 1}/{cursor.getFullYear()}
          </div>
          <button
            onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
            className="p-2 rounded-xl hover:bg-slate-100 text-slate-500"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold text-slate-400 mb-1">
          {WEEKDAYS.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {cells.map((cell, idx) => {
            if (!cell.date) return <div key={idx} className="aspect-square sm:aspect-auto sm:h-20" />
            const dayTasks = tasksByDay.get(cell.key!) || []
            const isToday = cell.key === todayKey
            const isSelected = cell.key === selectedKey
            return (
              <button
                key={idx}
                onClick={() => setSelectedKey(cell.key)}
                className={
                  "flex flex-col items-start gap-0.5 rounded-lg border p-1 text-left transition-colors sm:h-20 " +
                  (isSelected
                    ? "border-violet-400 bg-violet-50"
                    : isToday
                      ? "border-violet-200 bg-violet-50/40"
                      : "border-slate-100 hover:bg-slate-50")
                }
              >
                <span className={`text-[11px] font-bold ${isToday ? "text-violet-700" : "text-slate-500"}`}>
                  {cell.date.getDate()}
                </span>
                <div className="flex flex-wrap gap-0.5">
                  {dayTasks.slice(0, 3).map((t) => (
                    <span
                      key={t.id}
                      className={`h-1.5 w-1.5 rounded-full ${isTaskOverdue(t) ? "bg-red-500" : "bg-violet-500"}`}
                      title={t.tieu_de}
                    />
                  ))}
                  {dayTasks.length > 3 && <span className="text-[9px] text-slate-400">+{dayTasks.length - 3}</span>}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {selectedKey && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <div className="text-sm font-bold text-slate-700 mb-3">
            Công việc đến hạn ngày {selectedKey.split("-").reverse().join("/")}
          </div>
          {selectedTasks.length === 0 ? (
            <p className="text-sm text-slate-400 py-3 text-center">Không có công việc nào đến hạn ngày này.</p>
          ) : (
            <div className="space-y-2">
              {selectedTasks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => router.push(`/dashboard/kpi/tasks/${t.id}`)}
                  className="w-full flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2.5 text-left hover:bg-slate-50 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-700 truncate">{t.tieu_de}</div>
                    <div className="text-xs text-slate-400">{formatKpiDateTime(t.han_hoan_thanh)}</div>
                  </div>
                  <span className={`shrink-0 px-2.5 py-1 rounded-lg text-xs font-bold ${KPI_STATUS_BADGE_CLASS[t.trang_thai]}`}>
                    {KPI_STATUS_LABEL[t.trang_thai]}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
