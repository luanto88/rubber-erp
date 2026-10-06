"use client"

// Cảnh báo khi tạo PHÂN LOẠI vật tư mà tên trùng / gần giống tên một VẬT TƯ đang có — chống lỗi
// nhập nhầm vật tư vào ô phân loại (vụ 3 phân loại "Rotyl" 08/09/2026). Chỉ cảnh báo, người dùng
// tick xác nhận là lưu được; không chặn cứng.

import { AlertTriangle } from "lucide-react"
import { findSimilarNames, normalizeName } from "@/lib/similar-name"

export type NamedItem = { code?: string | null; name: string }

/** Vật tư có tên trùng/gần giống tên phân loại đang nhập (tối đa 3). */
export function findCategoryNameClashes<T extends NamedItem>(categoryName: string, items: T[]): T[] {
  if (!categoryName.trim()) return []
  return findSimilarNames(categoryName, items, (i) => i.name, { limit: 3 }).map((c) => c.item)
}

/** Đã xác nhận đúng cho tên hiện tại chưa (đổi tên thì phải xác nhận lại). */
export function isClashConfirmed(confirmedName: string, currentName: string): boolean {
  return !!confirmedName && normalizeName(confirmedName) === normalizeName(currentName)
}

export function CategoryNameClashWarning<T extends NamedItem>({
  name, clashes, confirmed, onConfirmChange,
}: {
  name: string
  clashes: T[]
  confirmed: boolean
  onConfirmChange: (checked: boolean) => void
}) {
  if (!clashes.length) return null
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="flex items-start gap-2 font-bold">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        ‘{name.trim()}’ là tên vật tư, không phải phân loại — bạn có chắc?
      </p>
      <p className="mt-1 text-xs">
        Vật tư đang có: {clashes.map((c) => (c.code ? `${c.code} — ${c.name}` : c.name)).join("; ")}.
        Phân loại là NHÓM vật tư (vd “Hóa chất”, “Vật tư điện”), không phải tên 1 vật tư.
      </p>
      <label className="mt-2 flex items-center gap-2 text-xs font-semibold">
        <input type="checkbox" checked={confirmed} onChange={(e) => onConfirmChange(e.target.checked)} />
        Tôi chắc chắn đây là một phân loại
      </label>
    </div>
  )
}
