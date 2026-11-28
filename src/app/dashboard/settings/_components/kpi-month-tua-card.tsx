"use client"

// B (20261224) — Cài đặt → KPI & 5S → Trọng số: khối "Tua chuẩn theo tháng".
// Số ngày nghỉ tua chuẩn đặt theo TỪNG THÁNG (chung toàn nhà máy hoặc theo nhóm chính); tháng không
// đặt ⇒ dùng số ngày ở trọng số (nhóm → mặc định → 6). Ghi qua RPC (lý do bắt buộc, nhật ký insert-only,
// chặn tháng đã có điểm KPI khoá sổ). Rule 27 "Hệ số chuyên cần".

import { useCallback, useEffect, useMemo, useState } from "react"
import { CalendarClock, ChevronDown, ChevronRight, Lock, Pencil, Save, Trash2 } from "lucide-react"
import { ReasonConfirmDialog } from "../../_components/reason-confirm-dialog"
import {
  deleteKpiAttendanceMonthConfig,
  fetchKpiAttendanceMonthConfigLogs,
  fetchKpiAttendanceMonthConfigs,
  isKpiAttendanceMonthLocked,
  saveKpiAttendanceMonthConfig,
  type KpiAttendanceMonthConfig,
  type KpiAttendanceMonthConfigLog,
} from "@/lib/kpi-scores"
import { getKpiErrorMessage } from "@/lib/kpi-tasks"
import { getFactoryTodayISO } from "@/lib/date-utils"
import type { KpiGroupOption } from "@/lib/kpi-templates"

const HANH_DONG_LABEL: Record<KpiAttendanceMonthConfigLog["hanh_dong"], string> = {
  them: "Thêm",
  sua: "Sửa",
  xoa: "Xoá",
}

function monthLabel(thang: string): string {
  const [y, m] = thang.split("-")
  return `${m}/${y}`
}

function daysInMonth(thang: string): number {
  const [y, m] = thang.split("-").map(Number)
  return new Date(y, m, 0).getDate()
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false })
}

export function KpiMonthTuaCard({
  factoryId,
  canManage,
  groups,
}: {
  factoryId: string
  canManage: boolean
  groups: KpiGroupOption[]
}) {
  const [rows, setRows] = useState<KpiAttendanceMonthConfig[]>([])
  const [logs, setLogs] = useState<KpiAttendanceMonthConfigLog[]>([])
  const [locked, setLocked] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [showLogs, setShowLogs] = useState(false)

  const [thang, setThang] = useState(() => getFactoryTodayISO().slice(0, 7))
  const [groupId, setGroupId] = useState("")
  const [soNgay, setSoNgay] = useState("6")
  const [formError, setFormError] = useState("")
  const [dialog, setDialog] = useState<null | { mode: "save" } | { mode: "delete"; row: KpiAttendanceMonthConfig }>(null)
  const [busy, setBusy] = useState(false)

  const groupName = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, g.name])), [groups])
  const scopeLabel = (gid: string | null) => (gid ? groupName[gid] || "—" : "Chung toàn nhà máy")

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError("")
    try {
      const [cfg, lg] = await Promise.all([
        fetchKpiAttendanceMonthConfigs(factoryId),
        fetchKpiAttendanceMonthConfigLogs(factoryId),
      ])
      setRows(cfg)
      setLogs(lg)
      const lockEntries = await Promise.all(
        cfg.map(async (r) => [r.id, await isKpiAttendanceMonthLocked(factoryId, r.group_id, r.thang).catch(() => false)] as const),
      )
      setLocked(Object.fromEntries(lockEntries))
    } catch (e) {
      setLoadError(getKpiErrorMessage(e, "Không tải được cấu hình tua chuẩn theo tháng (đã chạy migration 20261224 chưa?)."))
    } finally {
      setLoading(false)
    }
  }, [factoryId])

  useEffect(() => {
    void load()
  }, [load])

  const thangIso = thang ? `${thang}-01` : ""
  const existing = rows.find((r) => r.thang === thangIso && (r.group_id || "") === groupId)
  const soNgayNum = Number(soNgay)
  const soNgayValid = soNgay.trim() !== "" && Number.isInteger(soNgayNum) && soNgayNum >= 0 && soNgayNum <= 10

  const openSave = async () => {
    setFormError("")
    if (!thangIso) { setFormError("Chưa chọn tháng."); return }
    if (!soNgayValid) { setFormError("Số ngày nghỉ tua chuẩn phải là số nguyên từ 0 đến 10."); return }
    if (existing && existing.so_ngay_nghi_tua_chuan === soNgayNum) {
      setFormError("Giá trị không đổi so với cấu hình đang có.")
      return
    }
    try {
      if (await isKpiAttendanceMonthLocked(factoryId, groupId || null, thangIso)) {
        setFormError(`Tháng ${monthLabel(thangIso)} đã có điểm KPI khoá sổ — không sửa được cấu hình tua chuẩn.`)
        return
      }
    } catch (e) {
      setFormError(getKpiErrorMessage(e, "Không kiểm tra được trạng thái khoá sổ."))
      return
    }
    setDialog({ mode: "save" })
  }

  const confirmDialog = async (lyDo: string) => {
    if (!dialog) return
    setBusy(true)
    try {
      if (dialog.mode === "save") {
        await saveKpiAttendanceMonthConfig({ factoryId, groupId: groupId || null, thang: thangIso, soNgay: soNgayNum, lyDo })
      } else {
        await deleteKpiAttendanceMonthConfig(dialog.row.id, lyDo)
      }
      setDialog(null)
      void load()
    } catch (e) {
      setFormError(getKpiErrorMessage(e, "Không lưu được."))
      setDialog(null)
    } finally {
      setBusy(false)
    }
  }

  const editRow = (r: KpiAttendanceMonthConfig) => {
    setThang(r.thang.slice(0, 7))
    setGroupId(r.group_id || "")
    setSoNgay(String(r.so_ngay_nghi_tua_chuan))
    setFormError("")
  }

  const inputCls = "w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50"

  return (
    <div className="mb-4 rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 bg-sky-50 px-4 py-2 text-xs font-extrabold text-sky-700 uppercase">
        <CalendarClock size={13} /> Tua chuẩn theo tháng
      </div>
      <div className="space-y-3 p-4">
        <p className="text-xs text-slate-500">
          Công chuẩn = số ngày của tháng − số ngày nghỉ tua chuẩn. Tháng nào không đặt riêng thì dùng số ngày ở
          trọng số (nhóm → mặc định → 6). Thứ tự áp dụng: <strong>tháng của nhóm chính → tháng chung → trọng số</strong>.
          Tháng đã có điểm KPI khoá sổ thì không sửa / xoá được.
        </p>

        {loadError && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</div>}

        {canManage && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1.4fr_0.8fr_auto] sm:items-end">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">Tháng</label>
              <input type="month" value={thang} onChange={(e) => setThang(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">Áp dụng cho</label>
              <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className={inputCls}>
                <option value="">Chung toàn nhà máy</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>Nhóm chính: {g.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-600">Số ngày nghỉ tua</label>
              <input
                type="number"
                min={0}
                max={10}
                value={soNgay}
                onChange={(e) => setSoNgay(e.target.value)}
                className={inputCls}
              />
            </div>
            <button
              onClick={() => void openSave()}
              className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white shadow-sm hover:bg-emerald-700"
            >
              <Save size={14} /> {existing ? "Cập nhật" : "Lưu"}
            </button>
            {thangIso && soNgayValid && (
              <p className="text-[11px] text-slate-500 sm:col-span-4">
                Tháng {monthLabel(thangIso)} ({daysInMonth(thangIso)} ngày) ⇒ công chuẩn{" "}
                <strong>{Math.max(1, daysInMonth(thangIso) - soNgayNum)}</strong> ngày.
                {existing && <> Đang có: {existing.so_ngay_nghi_tua_chuan} ngày.</>}
              </p>
            )}
          </div>
        )}
        {formError && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</div>}

        <div className="overflow-x-auto">
          <table className="enterprise-table dense min-w-[640px] w-full">
            <thead>
              <tr>
                <th>Tháng</th>
                <th>Áp dụng cho</th>
                <th className="text-right">Ngày tua</th>
                <th>Lý do</th>
                {canManage && <th className="text-right">Thao tác</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={canManage ? 5 : 4} className="py-4 text-center text-slate-400">Đang tải...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={canManage ? 5 : 4} className="py-4 text-center text-slate-400">Chưa đặt tháng nào — mọi tháng dùng trọng số.</td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td className="font-bold">{monthLabel(r.thang)}</td>
                    <td>{scopeLabel(r.group_id)}</td>
                    <td className="text-right">{r.so_ngay_nghi_tua_chuan}</td>
                    <td className="max-w-[280px] whitespace-normal text-slate-600">{r.ly_do}</td>
                    {canManage && (
                      <td className="text-right">
                        {locked[r.id] ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-400" title="Tháng đã có điểm KPI khoá sổ">
                            <Lock size={12} /> Đã khoá sổ
                          </span>
                        ) : (
                          <span className="inline-flex gap-1">
                            <button onClick={() => editRow(r)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" title="Sửa">
                              <Pencil size={14} />
                            </button>
                            <button onClick={() => setDialog({ mode: "delete", row: r })} className="rounded-lg p-1.5 text-red-500 hover:bg-red-50" title="Xoá">
                              <Trash2 size={14} />
                            </button>
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <button
          onClick={() => setShowLogs((v) => !v)}
          className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-700"
        >
          {showLogs ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Nhật ký thay đổi ({logs.length})
        </button>
        {showLogs && (
          <div className="overflow-x-auto">
            <table className="enterprise-table dense min-w-[640px] w-full">
              <thead>
                <tr>
                  <th>Lúc</th>
                  <th>Thao tác</th>
                  <th>Tháng · Áp dụng</th>
                  <th className="text-right">Trước → Sau</th>
                  <th>Lý do</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr><td colSpan={5} className="py-3 text-center text-slate-400">Chưa có thay đổi.</td></tr>
                ) : (
                  logs.map((l) => (
                    <tr key={l.id}>
                      <td className="whitespace-nowrap text-slate-500">{formatDateTime(l.created_at)}</td>
                      <td className="font-bold">{HANH_DONG_LABEL[l.hanh_dong]}</td>
                      <td>{monthLabel(l.thang)} · {scopeLabel(l.group_id)}</td>
                      <td className="text-right">{l.gia_tri_truoc ?? "—"} → {l.gia_tri_sau ?? "—"}</td>
                      <td className="max-w-[280px] whitespace-normal text-slate-600">{l.ly_do}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dialog && (
        <ReasonConfirmDialog
          title={dialog.mode === "save" ? (existing ? "Cập nhật tua chuẩn tháng" : "Đặt tua chuẩn tháng") : "Xoá tua chuẩn tháng"}
          points={
            dialog.mode === "save"
              ? [
                  `Tháng ${monthLabel(thangIso)} · ${scopeLabel(groupId || null)}: ${existing ? `${existing.so_ngay_nghi_tua_chuan} → ` : ""}${soNgayNum} ngày nghỉ tua.`,
                  "Điểm KPI tháng này (chưa khoá sổ) tính theo số mới khi bấm “Tính điểm tháng”.",
                ]
              : [
                  `Tháng ${monthLabel(dialog.row.thang)} · ${scopeLabel(dialog.row.group_id)}: bỏ ${dialog.row.so_ngay_nghi_tua_chuan} ngày, quay về số ngày ở trọng số.`,
                ]
          }
          confirmLabel={dialog.mode === "save" ? "Lưu" : "Xoá"}
          busy={busy}
          onConfirm={(lyDo) => void confirmDialog(lyDo)}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  )
}
