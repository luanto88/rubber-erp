"use client"

import { useEffect, useState } from "react"
import { Gauge, Save } from "lucide-react"
import { authFetch } from "@/lib/auth-fetch"

type ThresholdInfo = { thresholdUsd: number; columnReady: boolean; canManage: boolean; defaultUsd: number }

// Cài đặt → Bảo trì: ngưỡng phân loại sửa chữa Lớn / Nhỏ (USD). Biên bản tự tính Lớn/Nhỏ theo ngưỡng này,
// không ai chọn tay. Lưu qua API service role (admin / settings.maintenance_config / settings.manage_config).
export function RepairThresholdCard() {
  const [info, setInfo] = useState<ThresholdInfo | null>(null)
  const [value, setValue] = useState("")
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await authFetch("/api/maintenance/repair-threshold")
        const json = (await res.json()) as ThresholdInfo & { error?: string }
        if (!alive) return
        if (!res.ok) { setMsg({ ok: false, text: json.error || "Không tải được ngưỡng sửa chữa" }); return }
        setInfo(json)
        setValue(String(json.thresholdUsd))
      } catch (err) {
        if (alive) setMsg({ ok: false, text: err instanceof Error ? err.message : "Lỗi tải ngưỡng" })
      }
    })()
    return () => { alive = false }
  }, [])

  const handleSave = async () => {
    const n = Number(value)
    if (!Number.isFinite(n) || n <= 0) { setMsg({ ok: false, text: "Ngưỡng phải là số lớn hơn 0." }); return }
    setSaving(true)
    setMsg(null)
    try {
      const res = await authFetch("/api/maintenance/repair-threshold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thresholdUsd: n }),
      })
      const json = (await res.json()) as { thresholdUsd?: number; error?: string }
      if (!res.ok) { setMsg({ ok: false, text: json.error || "Lưu thất bại" }); return }
      setInfo((prev) => (prev ? { ...prev, thresholdUsd: json.thresholdUsd ?? n } : prev))
      setValue(String(json.thresholdUsd ?? n))
      setMsg({ ok: true, text: "Đã lưu ngưỡng sửa chữa lớn" })
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Lưu thất bại" })
    } finally {
      setSaving(false)
    }
  }

  const canEdit = !!info?.canManage && !!info.columnReady
  const dirty = !!info && Number(value) !== info.thresholdUsd

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
      <div className="bg-gradient-to-r from-orange-50 to-amber-50 px-6 py-4 border-b border-slate-200 flex items-center gap-2">
        <Gauge size={16} className="text-orange-600" />
        <span className="font-extrabold text-slate-700">Giá trị sửa chữa lớn</span>
      </div>
      <div className="p-4 space-y-3">
        <p className="text-sm text-slate-600">
          Biên bản <b>Sửa chữa</b> có tổng chi phí (quy USD) <b>lớn hơn</b> ngưỡng này là <b>Sửa chữa lớn</b>, còn lại là
          <b> Sửa chữa nhỏ</b>. Hệ thống tự phân loại — không ai chọn tay được. Biên bản đã gửi ký hoặc đã duyệt không đổi.
        </p>
        {info && !info.columnReady && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Chưa chạy migration <span className="font-mono">20261104_factories_repair_threshold.sql</span> — đang dùng mặc định {info.defaultUsd} USD.
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="w-full sm:w-56">
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngưỡng (USD)</label>
            <div className="relative">
              <input
                type="number"
                min={1}
                step="any"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && canEdit && dirty && !saving) void handleSave() }}
                disabled={!canEdit}
                className="w-full px-3 py-2 pr-12 border border-slate-300 rounded-xl text-sm outline-none focus:border-orange-500 disabled:bg-slate-50 tabular-nums"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">USD</span>
            </div>
          </div>
          {canEdit && (
            <button
              onClick={() => void handleSave()}
              disabled={saving || !dirty}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl shadow-sm transition-all"
            >
              <Save size={14} /> {saving ? "Đang lưu..." : "Lưu ngưỡng"}
            </button>
          )}
        </div>
        {info && !info.canManage && (
          <p className="text-xs text-slate-400">Chỉ admin hoặc người có quyền cấu hình bảo trì được sửa ngưỡng.</p>
        )}
        {msg && <p className={`text-xs font-bold ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</p>}
      </div>
    </div>
  )
}
