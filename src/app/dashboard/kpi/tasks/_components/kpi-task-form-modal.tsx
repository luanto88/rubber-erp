"use client"

// Modal "Giao công việc mới" — chọn người thực hiện trực tiếp hoặc mở rộng nhanh theo nhóm
// nhân sự (personnel_groups). Chọn nhóm chỉ là tiện ích UI mở rộng thành viên tại thời điểm
// tạo (snapshot), không lưu liên kết nhóm nào trên chính kpi_tasks.

import { useEffect, useMemo, useState } from "react"
import { Users } from "lucide-react"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { FilterMultiSelect } from "@/app/dashboard/_components/filter-multi-select"
import { getTodayISODate } from "@/lib/date-utils"
import { sendKpiNotify } from "@/lib/kpi-notify"
import type { DepartmentOption } from "@/lib/kpi-department-leaders"
import {
  computeChinhThreshold,
  createKpiTask,
  formatKpiDateTime,
  getKpiErrorMessage,
  loadKpiTaskCandidates,
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
  departments: DepartmentOption[]
  onClose: () => void
  onCreated: (task: KpiTask) => void
}

export function KpiTaskFormModal({ factoryId, nguoiGiaoId, candidates, departments, onClose, onCreated }: KpiTaskFormModalProps) {
  const [tieuDe, setTieuDe] = useState("")
  const [moTa, setMoTa] = useState("")
  const [phongBanId, setPhongBanId] = useState("")
  const [ngayGiao, setNgayGiao] = useState(getTodayISODate())
  const [hanHoanThanh, setHanHoanThanh] = useState(defaultDeadline())
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [yeuCau, setYeuCau] = useState<KpiReportRequirement[]>([])
  const [mucTieuSoLuong, setMucTieuSoLuong] = useState("")
  const [nguoiChinhId, setNguoiChinhId] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Ứng viên "Người thực hiện" thu hẹp theo phòng ban đã chọn — mặc định = candidates chung khi
  // chưa chọn phòng ban (không chặn tạo việc trước khi có phòng ban).
  const [scopedPeople, setScopedPeople] = useState<KpiTaskCandidate[]>(candidates.people)
  useEffect(() => {
    let alive = true
    if (!phongBanId) {
      setScopedPeople(candidates.people)
      return
    }
    void loadKpiTaskCandidates(factoryId, { departmentId: phongBanId }).then(({ people }) => {
      if (alive) setScopedPeople(people)
    })
    return () => { alive = false }
  }, [phongBanId, factoryId, candidates.people])

  // Đổi phòng ban → gỡ khỏi lựa chọn những người không còn thuộc danh sách mới.
  useEffect(() => {
    const scopedIds = new Set(scopedPeople.map((p) => p.userId))
    setMemberIds((prev) => prev.filter((uid) => scopedIds.has(uid)))
  }, [scopedPeople])

  const peopleLabels = useMemo(
    () => Object.fromEntries(candidates.people.map((p) => [p.userId, p.ten])),
    [candidates.people],
  )
  const peopleOptions = useMemo(() => scopedPeople.map((p) => p.userId), [scopedPeople])
  const mucTieuNumber = mucTieuSoLuong.trim() ? Number(mucTieuSoLuong) : null
  const isQuantityMode = !!mucTieuNumber && mucTieuNumber > 0

  const addGroupMembers = (group: KpiTaskCandidateGroup) => {
    const scopedIds = new Set(scopedPeople.map((p) => p.userId))
    setMemberIds((prev) => [...new Set([...prev, ...group.memberUserIds.filter((uid) => scopedIds.has(uid))])])
  }

  // Người chính phải nằm trong danh sách đã chọn — tự bỏ chọn nếu bị gỡ khỏi danh sách; tự
  // chọn sẵn nếu chỉ còn đúng 1 người thực hiện (đỡ phải bấm thêm 1 bước khi task chỉ 1 người).
  useEffect(() => {
    if (nguoiChinhId && !memberIds.includes(nguoiChinhId)) {
      setNguoiChinhId(memberIds.length === 1 ? memberIds[0] : "")
    } else if (!nguoiChinhId && memberIds.length === 1) {
      setNguoiChinhId(memberIds[0])
    }
  }, [memberIds, nguoiChinhId])

  const handleSave = async () => {
    if (!phongBanId) {
      setError("Vui lòng chọn phòng ban chịu trách nhiệm.")
      return
    }
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
    if (isQuantityMode && !nguoiChinhId) {
      setError("Vui lòng chọn người chính chịu trách nhiệm chính cho việc mục tiêu số lượng.")
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
        mucTieuSoLuong: isQuantityMode ? mucTieuNumber : null,
        nguoiChinhId: isQuantityMode ? nguoiChinhId : null,
        phongBanId,
      })
      sendKpiNotify({
        factoryId,
        title: "Công việc mới được giao",
        lines: [
          `📋 ${task.tieu_de}${task.ma_cong_viec ? ` (${task.ma_cong_viec})` : ""}`,
          `👥 Người thực hiện: ${memberIds.map((uid) => peopleLabels[uid] || uid).join(", ")}`,
          `⏰ Hạn: ${formatKpiDateTime(task.han_hoan_thanh)}`,
        ],
        link: `/dashboard/kpi/tasks/${task.id}`,
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
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Ghi chú / Hướng dẫn thực hiện</label>
          <textarea
            value={moTa}
            onChange={(e) => setMoTa(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
            placeholder="VD: Không để chai lọ trên bờ tường; kiểm tra pallet trước khi cho mủ vào kiện..."
          />
          <p className="mt-1 text-[11px] text-slate-400">
            Nội dung này hiển thị đầy đủ cho người thực hiện — dùng để ghi rõ yêu cầu/lưu ý cụ thể
            khi giao việc, không chỉ mô tả chung chung.
          </p>
        </div>

        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Phòng ban chịu trách nhiệm *</label>
          <select
            value={phongBanId}
            onChange={(e) => setPhongBanId(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
          >
            <option value="">-- Chọn phòng ban --</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-slate-400">
            Thu hẹp danh sách người thực hiện bên dưới theo đúng phòng ban này.
          </p>
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
          <label className="text-xs font-bold text-slate-600 block mb-1.5">
            Số lượng mục tiêu chung (tuỳ chọn)
          </label>
          <input
            type="number"
            min={1}
            value={mucTieuSoLuong}
            onChange={(e) => setMucTieuSoLuong(e.target.value)}
            placeholder="VD: 4 (đo 4 mẫu — nhiều người cùng làm, tính theo tổng)"
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
          />
          <p className="mt-1 text-xs text-slate-400">
            Để trống nếu việc này chỉ cần 1 người/1 hành động là xong. Có giá trị → việc chỉ
            &quot;Hoàn thành&quot; khi TỔNG bằng chứng của cả nhóm đạt đủ số này.
          </p>

          {isQuantityMode && (
            <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3">
              <label className="text-xs font-bold text-violet-800 block mb-1.5">
                Người chính (chịu trách nhiệm chính) *
              </label>
              <select
                value={nguoiChinhId}
                onChange={(e) => setNguoiChinhId(e.target.value)}
                className="w-full px-3 py-2 border border-violet-300 rounded-xl text-sm bg-white outline-none focus:border-violet-500"
              >
                <option value="">-- Chọn người chính --</option>
                {memberIds.map((uid) => (
                  <option key={uid} value={uid}>
                    {peopleLabels[uid] || uid}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-violet-700">
                Người chính phải tự đóng góp ít nhất 50% TỔNG mục tiêu (bất kể nhóm có bao nhiêu
                người choàng hỗ trợ) — không đạt sẽ bị trừ điểm cá nhân dù việc chung đã xong nhờ
                người khác. Các thành viên còn lại (choàng) không bị ràng buộc ngưỡng, luôn được
                ghi nhận đầy đủ khi việc chung hoàn thành.
                {!!mucTieuNumber && (
                  <>
                    {" "}
                    Ngưỡng hiện tại: <strong>{computeChinhThreshold(mucTieuNumber)}</strong> (= 50%
                    làm tròn lên của tổng {mucTieuNumber}).
                  </>
                )}
              </p>
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
