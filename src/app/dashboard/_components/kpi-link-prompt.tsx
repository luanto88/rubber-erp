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
// Bố cục: `position: fixed`, căn GIỮA màn hình kèm backdrop mờ (không phải góc nhỏ như bản đầu,
// càng không phải inline trong luồng trang — 2 bản trước đó đều bị người dùng phản ánh "dễ bỏ
// qua"/"quá nhỏ"). Có backdrop (`bg-black/30`) để tách hẳn khỏi nội dung trang phía sau.
//
// Click vào backdrop KHÔNG đóng banner nữa (đổi theo phản hồi người dùng — trước đó click ra
// ngoài coi như "Bỏ qua", nhưng dễ vô tình tắt khi chỉ định bấm hụt) — thay vào đó thẻ "nhấp
// nháy" (rung nhẹ, keyframe `attentionShake` trong globals.css) để nhắc người dùng vẫn còn ở đây,
// cần tự bấm đúng nút "Bỏ qua" hoặc chọn việc rồi "Gắn & hoàn thành" mới đóng được.

import { useEffect, useRef, useState } from "react"
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

export function KpiLinkPrompt({ factoryId, moduleCode, recordId, recordLabel, recordUrl, onDone }: KpiLinkPromptProps) {
  const recordIds = Array.isArray(recordId) ? recordId : [recordId]
  const moduleFamily = moduleCode.split(":")[0]
  const [loading, setLoading] = useState(true)
  const [tasks, setTasks] = useState<KpiTask[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [doneLabel, setDoneLabel] = useState<string | null>(null)
  const [shake, setShake] = useState(false)
  const shakeTimerRef = useRef<number | null>(null)

  // Backdrop bấm ra ngoài KHÔNG đóng banner — chỉ rung nhẹ để nhắc còn ở đây.
  const nudge = () => {
    setShake(false)
    window.requestAnimationFrame(() => {
      setShake(true)
      if (shakeTimerRef.current) window.clearTimeout(shakeTimerRef.current)
      shakeTimerRef.current = window.setTimeout(() => setShake(false), 420)
    })
  }
  useEffect(() => {
    return () => {
      if (shakeTimerRef.current) window.clearTimeout(shakeTimerRef.current)
    }
  }, [])

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
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/30" onClick={nudge} />
        <div
          className={`relative w-full max-w-md rounded-3xl border-2 border-emerald-300 bg-white p-6 shadow-2xl ${
            shake ? "animate-[attentionShake_0.4s_ease-in-out]" : "animate-[fadeInUp_0.3s_ease-out]"
          }`}
        >
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-100">
              <CheckCircle2 size={22} className="text-emerald-600" />
            </div>
            <div className="min-w-0 flex-1 pt-1">
              <p className="text-base text-slate-700">
                Đã hoàn thành công việc: <strong className="text-emerald-700">{doneLabel}</strong>
              </p>
            </div>
            <button onClick={() => onDone?.()} className="shrink-0 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
              <X size={18} />
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={nudge} />
      <div
        className={`relative w-full max-w-lg rounded-3xl border-2 border-violet-300 bg-white p-6 shadow-2xl sm:p-7 ${
          shake ? "animate-[attentionShake_0.4s_ease-in-out]" : "animate-[fadeInUp_0.3s_ease-out]"
        }`}
      >
        <div className="flex items-start gap-3.5">
          <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-violet-100">
            <Link2 size={22} className="text-violet-600" />
            <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-violet-500 animate-ping" />
            <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-violet-600" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-slate-800">
              Đã lưu <strong className="text-violet-700">{recordLabel}</strong>
            </p>
            <p className="mt-0.5 text-sm text-slate-500">Gắn vào công việc KPI nào đang mở?</p>
          </div>
          <button onClick={() => onDone?.()} className="shrink-0 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <div className="mt-5 space-y-3">
          <select
            value={selectedTaskId}
            onChange={(e) => setSelectedTaskId(e.target.value)}
            className="w-full rounded-xl border border-violet-300 bg-white px-3.5 py-3 text-sm outline-none focus:border-violet-500"
          >
            <option value="">-- Chọn việc --</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.tieu_de} (hạn {formatKpiDateTime(t.han_hoan_thanh)})
              </option>
            ))}
          </select>

          {error && <div className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-semibold text-red-600">{error}</div>}

          <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
            <button
              onClick={() => onDone?.()}
              className="rounded-xl px-4 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-100"
            >
              Bỏ qua
            </button>
            <button
              onClick={() => void handleConfirm()}
              disabled={!selectedTaskId || saving}
              className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white shadow-md hover:bg-violet-700 disabled:opacity-50"
            >
              {saving ? "Đang gắn..." : "Gắn & hoàn thành"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
