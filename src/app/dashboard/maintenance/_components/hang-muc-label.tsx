"use client"

import { RefreshCw, Wrench } from "lucide-react"

// U1 (2026-10-14): hạng mục là PHÂN LOẠI, không phải trạng thái ⇒ chữ thường kèm icon xám,
// KHÔNG tô đỏ/xanh (đỏ dành cho trạng thái huỷ/nguy hiểm).
export function HangMucLabel({ hangMuc, size = "md" }: { hangMuc: string; size?: "sm" | "md" }) {
  const Icon = hangMuc === "Bảo dưỡng" ? RefreshCw : Wrench
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap font-semibold text-slate-700 ${size === "sm" ? "text-xs" : ""}`}>
      <Icon size={size === "sm" ? 12 : 14} className="text-slate-400" />
      {hangMuc}
    </span>
  )
}
