"use client"

// Modal "Giao công việc mới" — chọn người thực hiện trực tiếp hoặc mở rộng nhanh theo nhóm
// nhân sự (personnel_groups). Chọn nhóm chỉ là tiện ích UI mở rộng thành viên tại thời điểm
// tạo (snapshot), không lưu liên kết nhóm nào trên chính kpi_tasks.

import { useMemo, useState } from "react"
import { Users } from "lucide-react"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { FilterMultiSelect } from "@/app/dashboard/_components/filter-multi-select"
import { getTodayISODate } from "@/lib/date-utils"
import {
  createKpiTask,
  getKpiErrorMessage,
  KPI_REPORT_REQ_LABEL,
  type KpiReportRequirement,
  type KpiTask,
  type KpiTaskCandidate,
  type KpiTaskCandidateGroup,
} from "@/lib/kpi-tasks"

const REPORT_REQ_OPTIONS: KpiReportRequirement[] = ["anh", "file", "dinh_vi", "van_ban"]

function defaultDeadline(): string {
  const d = new Date()
  d.setDate(d.getDate() + 3)
  d.setHours(17, 0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

type KpiTaskFormModalProps = {
  factoryId: string
  nguoiGiaoId: string
  candidates: { people: KpiTaskCandidate[]; groups: KpiTaskCandidateGroup[] }
  onClose: () => void
  onCreated: (task: KpiTask) => void
}

export function KpiTaskFormModal({ factoryId, nguoiGiaoId, candidates, onClose, onCreated }: KpiTaskFormModalProps) {
  const [tieuDe, setTieuDe] = useState("")
  const [moTa, setMoTa] = useState("")
  const [ngayGiao, setNgayGiao] = useState(getTodayISODate())
  const [hanHoanThanh, setHanHoanThanh] = useState(defaultDeadline())
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [yeuCau, setYeuCau] = useState<KpiReportRequirement[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const peopleLabels = useMemo(
    () => Object.fromEntries(candidates.people.map((p) => [p.userId, p.ten])),
    [candidates.people],
  )
  const peopleOptions = useMemo(() => candidates.people.map((p) => p.userId), [candidates.people])

  const addGroupMembers = (group: KpiTaskCandidateGroup) => {
    setMemberIds((prev) => [...new Set([...prev, ...group.memberUserIds])])
  }

  const handleSave = async () => {
    if (!tieuDe.trim()) {
      setError("Vui lòng nhập tiêu đề công việc.")
      return
    }
    if (!hanHoanThanh) {
      setError("Vui lòng chọn hạn hoàn thành.")
      return
    }
    if (memberIds.length === 0) {
      setError("Vui lòng chọn ít nhất 1 người thực hiện.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const task = await createKpiTask({
        factoryId,
        nguoiGiaoId,
        tieuDe,
        moTa,
        ngayGiao,
        hanHoanThanh: new Date(hanHoanThanh).toISOString(),
        yeuCauBaoCao: yeuCau,
        memberUserIds: memberIds,
      })
      onCreated(task)
    } catch (err) {
      setError(getKpiErrorMessage(err, "Không tạo được công việc."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell
      title="Giao công việc mới"
      onClose={onClose}
      maxWidth="lg"
      footer={
        <>
          <button onClick={onClose} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
            Hủy
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-xl shadow-md transition-all disabled:opacity-60"
          >
            {saving ? "Đang lưu..." : "Giao việc"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Tiêu đề *</label>
          <input
            value={tieuDe}
            onChange={(e) => setTieuDe(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
            placeholder="VD: Kiểm tra lại hệ thống báo cháy khu A"
          />
        </div>

        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Mô tả</label>
          <textarea
            value={moTa}
            onChange={(e) => setMoTa(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngày giao</label>
            <input
              type="date"
              value={ngayGiao}
              onChange={(e) => setNgayGiao(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Hạn hoàn thành *</label>
            <input
              type="datetime-local"
              value={hanHoanThanh}
              onChange={(e) => setHanHoanThanh(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Người thực hiện *</label>
          <FilterMultiSelect
            options={peopleOptions}
            selected={memberIds}
            onChange={setMemberIds}
            labels={peopleLabels}
            placeholder="Chọn người thực hiện"
            searchPlaceholder="Tìm tên..."
            className="sm:w-full"
          />
          {candidates.groups.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-slate-400 flex items-center gap-1">
                <Users size={12} /> Thêm nhanh theo nhóm:
              </span>
              {candidates.groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => addGroupMembers(g)}
                  className="px-2.5 py-1 rounded-lg bg-violet-50 hover:bg-violet-100 text-violet-700 text-xs font-bold"
                >
                  {g.name} ({g.memberUserIds.length})
                </button>
              ))}
            </div>
          )}
          {memberIds.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {memberIds.map((uid) => (
                <span key={uid} className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold">
                  {peopleLabels[uid] || uid}
                </span>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Yêu cầu báo cáo kèm theo</label>
          <div className="flex flex-wrap gap-2">
            {REPORT_REQ_OPTIONS.map((req) => {
              const checked = yeuCau.includes(req)
              return (
                <button
                  key={req}
                  type="button"
                  onClick={() => setYeuCau((prev) => (checked ? prev.filter((r) => r !== req) : [...prev, req]))}
                  className={
                    "px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors " +
                    (checked
                      ? "bg-violet-600 border-violet-600 text-white"
                      : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50")
                  }
                >
                  {KPI_REPORT_REQ_LABEL[req]}
                </button>
              )
            })}
          </div>
        </div>

        {error && <div className="text-sm font-semibold text-red-600">{error}</div>}
      </div>
    </ModalShell>
  )
}
