"use client"

// Chọn 1 trong 3 mức chấm điểm 5S (Đạt/Tương đối/Không đạt) + ô lý do bắt buộc khi khác Đạt.
// Dùng chung ở 3 nơi: form "Chấm điểm tuần này" (zone/[id]/page.tsx), modal "Sửa kết quả"
// (admin, zone/[id]/page.tsx), modal resolve-appeal (appeals/page.tsx).
// Xem đầy đủ .claude/rules/27-kpi-module.md.

import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react"
import { type Kpi5sResult } from "@/lib/kpi-5s"

const OPTIONS: { value: Kpi5sResult; label: string; icon: typeof CheckCircle2; active: string }[] = [
  { value: "dat", label: "Đạt", icon: CheckCircle2, active: "border-emerald-500 bg-emerald-50 text-emerald-700" },
  { value: "tuong_doi", label: "Tương đối", icon: AlertTriangle, active: "border-amber-500 bg-amber-50 text-amber-700" },
  { value: "khong_dat", label: "Không đạt", icon: XCircle, active: "border-rose-500 bg-rose-50 text-rose-700" },
]

type Kpi5sResultPickerProps = {
  ketQua: Kpi5sResult
  onKetQuaChange: (v: Kpi5sResult) => void
  lyDo: string
  onLyDoChange: (v: string) => void
  disabled?: boolean
  lyDoLabel?: string
}

export function Kpi5sResultPicker({ ketQua, onKetQuaChange, lyDo, onLyDoChange, disabled, lyDoLabel }: Kpi5sResultPickerProps) {
  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-bold text-slate-600">Kết quả *</label>
        <div className="flex gap-2">
          {OPTIONS.map((opt) => {
            const Icon = opt.icon
            return (
              <button
                key={opt.value}
                type="button"
                disabled={disabled}
                onClick={() => onKetQuaChange(opt.value)}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl border-2 py-2.5 text-sm font-bold transition-all disabled:opacity-50 ${
                  ketQua === opt.value ? opt.active : "border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                <Icon size={15} /> {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {ketQua !== "dat" && (
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-600">{lyDoLabel || "Lý do *"}</label>
          <textarea
            value={lyDo}
            onChange={(e) => onLyDoChange(e.target.value)}
            disabled={disabled}
            rows={3}
            placeholder="Mô tả cụ thể vấn đề..."
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-violet-500 disabled:opacity-50"
          />
        </div>
      )}
    </div>
  )
}
