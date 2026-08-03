"use client"

// "Gắn bản ghi tại chỗ" (in-context evidence linking) — dùng chung cho mọi module nghiệp vụ.
// Sau khi 1 bản ghi (phiếu điều xe, phiếu sản lượng, phiếu KN, ngăn lưu, giao dịch thành
// phẩm...) được lưu thành công, render component này với thông tin bản ghi đó — nó tự hỏi
// "công việc KPI ĐANG MỞ, ĐÚNG MODULE này của chính người dùng" rồi cho họ gắn bằng 1 cú click.
// Đây KHÔNG phải cơ chế tự động ngầm — luôn cần người dùng tự xác nhận.
//
// Lọc theo module (thêm sau khi có bug thật: gợi ý nhầm việc "Điều xe" khi lưu bản ghi Kho
// nguyên liệu) — `moduleCode` prop giữ nguyên dạng "họ:hành_động" như trước (vd
// "process:measurement"), component tự tách lấy "họ module" (phần trước dấu ":") để lọc đúng
// `kpi_tasks.module_code`/`kpi_task_templates.module_code` (xem KPI_MODULE_OPTIONS trong
// kpi-tasks.ts). Việc không gắn module (module_code = NULL) sẽ không bao giờ được gợi ý ở bất
// kỳ module nào — người thực hiện vẫn hoàn thành bình thường qua trang chi tiết việc.
//
// Component PHẢI fail-silent hoàn toàn: mọi lỗi (query, RPC, thiếu userId) đều bị nuốt, render
// null hoặc thông báo lỗi cục bộ — không bao giờ được ném lỗi làm gãy luồng nghiệp vụ của
// trang cha.
//
// Bố cục: `position: fixed` góc trên-phải (không phải inline trong luồng trang như trước) — dễ
// bị bỏ qua vì mắt người dùng đã rời khỏi khu vực đó ngay sau khi bấm Lưu. Góc trên-phải được
// chọn có chủ đích vì không đụng độ với toast/banner riêng của bất kỳ trang nào đã khảo sát
// (nhiều trang dùng top-center `fixed top-4 left-1/2 -translate-x-1/2`, một số trang — đúng 3/6
// module mục tiêu: Kiểm nghiệm/Điều xe/Kiểm soát quá trình — dùng bottom-right cho toast riêng
// của chúng).

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
  /** 1 bản ghi (chuẩn) hoặc nhiều bản ghi cùng lúc (vd nhiều dòng mẫu vừa lưu trong 1 phiếu) —
   *  mảng được gắn tuần tự vào cùng 1 việc KPI đã chọn, mỗi phần tử là 1 evidence riêng. */
  recordId: string | string[]
  recordLabel: string
  recordUrl?: string | null
  onDone?: () => void
}

const FLOATING_WRAPPER_CLASS =
  "fixed top-4 right-4 z-[70] w-[calc(100vw-2rem)] sm:w-96 animate-[fadeInUp_0.3s_ease-out]"

export function KpiLinkPrompt({ factoryId, moduleCode, recordId, recordLabel, recordUrl, onDone }: KpiLinkPromptProps) {
  const recordIds = Array.isArray(recordId) ? recordId : [recordId]
  const moduleFamily = moduleCode.split(":")[0]
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
        const openTasks = await fetchOpenKpiTasksForUser(factoryId, userId, moduleFamily)
        if (alive) {
          setTasks(openTasks)
          // Chỉ đúng 1 việc khớp module → tự chọn sẵn, người dùng chỉ cần bấm "Gắn & hoàn thành".
          if (openTasks.length === 1) setSelectedTaskId(openTasks[0].id)
        }
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
  }, [factoryId, moduleFamily])

  useEffect(() => {
    if (!doneLabel) return
    const timer = window.setTimeout(() => onDone?.(), 3000)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneLabel])

  const handleConfirm = async () => {
    if (!selectedTaskId || recordIds.length === 0) return
    setSaving(true)
    setError(null)
    let linkedCount = 0
    try {
      for (const id of recordIds) {
        try {
          await linkKpiTaskEvidenceAndComplete({
            taskId: selectedTaskId,
            moduleCode,
            recordId: id,
            recordLabel,
            recordUrl,
          })
          linkedCount++
        } catch (err) {
          // Việc vừa đạt đủ mục tiêu số lượng NGAY GIỮA vòng lặp (từ chính batch này) — dừng
          // êm, không phải lỗi thật. Các bản ghi còn lại không cần gắn nữa vì việc đã đóng.
          if (getKpiErrorMessage(err, "").includes("đã kết thúc")) break
          throw err
        }
      }
      const task = tasks.find((t) => t.id === selectedTaskId)
      const baseLabel = task?.tieu_de || "công việc đã chọn"
      setDoneLabel(recordIds.length > 1 ? `${baseLabel} (đã gắn ${linkedCount}/${recordIds.length} bản ghi)` : baseLabel)
    } catch (err) {
      setError(getKpiErrorMessage(err, "Không gắn được vào công việc."))
    } finally {
      setSaving(false)
    }
  }

  if (loading || recordIds.length === 0 || (!doneLabel && tasks.length === 0)) return null

  if (doneLabel) {
    return (
      <div className={FLOATING_WRAPPER_CLASS}>
        <div className="flex items-center gap-2 rounded-2xl border-2 border-emerald-300 bg-emerald-50 px-4 py-3 shadow-2xl">
          <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />
          <span className="text-sm text-emerald-800">
            Đã hoàn thành công việc: <strong>{doneLabel}</strong>
          </span>
          <button onClick={() => onDone?.()} className="ml-auto shrink-0 text-emerald-500 hover:text-emerald-700">
            <X size={14} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={FLOATING_WRAPPER_CLASS}>
      <div className="rounded-2xl border-2 border-violet-300 bg-violet-50 px-4 py-3 shadow-2xl">
        <div className="flex items-start gap-2.5">
          <span className="relative mt-0.5 shrink-0">
            <Link2 size={17} className="text-violet-600" />
            <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-violet-500 animate-ping" />
            <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-violet-600" />
          </span>
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
    </div>
  )
}
