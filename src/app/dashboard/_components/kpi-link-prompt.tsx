"use client"

// "Gắn bản ghi tại chỗ" (in-context evidence linking) — dùng chung cho mọi module nghiệp vụ.
// Sau khi 1 bản ghi (phiếu điều xe, phiếu sản lượng, phiếu KN, ngăn lưu, giao dịch thành
// phẩm...) được lưu thành công, render component này với thông tin bản ghi đó — nó tự hỏi
// "công việc KPI ĐANG MỞ của chính người này" (không lọc theo ngày giao việc — xem
// fetchOpenKpiTasksForUser trong kpi-tasks.ts) rồi cho họ gắn bằng 1 cú click. Đây KHÔNG phải
// cơ chế tự động ngầm — luôn cần người dùng tự xác nhận.
//
// Chưa gợi ý sẵn việc "khớp" (banner TH1 dùng `kpi_task_templates.auto_action_type`) vì bảng
// "Việc định kỳ" chưa tồn tại — hiện luôn hiển thị dropdown để người dùng tự chọn (TH2). Khi
// "Việc định kỳ" ra đời, nối thêm nhánh gợi ý sẵn tại đây, không đổi props/API của component.
//
// Component PHẢI fail-silent hoàn toàn: mọi lỗi (query, RPC, thiếu userId) đều bị nuốt, render
// null hoặc thông báo lỗi cục bộ — không bao giờ được ném lỗi làm gãy luồng nghiệp vụ của
// trang cha.

import { useEffect, useState } from "react"
import { CheckCircle2, Link2, X } from "lucide-react"
import {
  fetchOpenKpiTasksForUser,
  formatKpiDateTime,
  getKpiCachedUserId,
  getKpiErrorMessage,
  linkKpiTaskEvidenceAndComplete,
  type KpiTask,
} from "@/lib/kpi-tasks"

type KpiLinkPromptProps = {
  factoryId: string | null
  moduleCode: string
  recordId: string
  recordLabel: string
  recordUrl?: string | null
  onDone?: () => void
}

export function KpiLinkPrompt({ factoryId, moduleCode, recordId, recordLabel, recordUrl, onDone }: KpiLinkPromptProps) {
  const [loading, setLoading] = useState(true)
  const [tasks, setTasks] = useState<KpiTask[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [doneLabel, setDoneLabel] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      if (!factoryId) {
        setLoading(false)
        return
      }
      try {
        const userId = getKpiCachedUserId()
        if (!userId) {
          if (alive) setLoading(false)
          return
        }
        const openTasks = await fetchOpenKpiTasksForUser(factoryId, userId)
        if (alive) setTasks(openTasks)
      } catch {
        // Fail-silent — widget phụ, không được làm gãy trang cha nếu lỗi mạng/DB.
      } finally {
        if (alive) setLoading(false)
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [factoryId])

  useEffect(() => {
    if (!doneLabel) return
    const timer = window.setTimeout(() => onDone?.(), 3000)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneLabel])

  const handleConfirm = async () => {
    if (!selectedTaskId) return
    setSaving(true)
    setError(null)
    try {
      await linkKpiTaskEvidenceAndComplete({
        taskId: selectedTaskId,
        moduleCode,
        recordId,
        recordLabel,
        recordUrl,
      })
      const task = tasks.find((t) => t.id === selectedTaskId)
      setDoneLabel(task?.tieu_de || "công việc đã chọn")
    } catch (err) {
      setError(getKpiErrorMessage(err, "Không gắn được vào công việc."))
    } finally {
      setSaving(false)
    }
  }

  if (loading || (!doneLabel && tasks.length === 0)) return null

  if (doneLabel) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm">
        <CheckCircle2 size={15} className="shrink-0 text-emerald-600" />
        <span className="text-emerald-800">
          Đã hoàn thành công việc: <strong>{doneLabel}</strong>
        </span>
        <button onClick={() => onDone?.()} className="ml-auto shrink-0 text-emerald-500 hover:text-emerald-700">
          <X size={13} />
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <Link2 size={15} className="mt-0.5 shrink-0 text-violet-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-violet-800">
            Đã lưu <strong>{recordLabel}</strong> — gắn vào công việc KPI nào đang mở?
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value={selectedTaskId}
              onChange={(e) => setSelectedTaskId(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-violet-300 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-violet-500"
            >
              <option value="">-- Chọn việc --</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.tieu_de} (hạn {formatKpiDateTime(t.han_hoan_thanh)})
                </option>
              ))}
            </select>
            <button
              onClick={() => void handleConfirm()}
              disabled={!selectedTaskId || saving}
              className="shrink-0 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {saving ? "Đang gắn..." : "Gắn & hoàn thành"}
            </button>
            <button
              onClick={() => onDone?.()}
              className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-100"
            >
              Bỏ qua
            </button>
          </div>
          {error && <div className="mt-1.5 text-xs font-semibold text-red-600">{error}</div>}
        </div>
      </div>
    </div>
  )
}
