"use client"

import { NoteImagePicker } from "./note-image-picker"

export type NoteFormValue = {
  noiDung: string
  ngayXayRa: string
  images: string[]
}

type NoteFormFieldsProps = {
  value: NoteFormValue
  onChange: (patch: Partial<NoteFormValue>) => void
  factoryId: string | null
  compact?: boolean
  textareaRows?: number
}

/**
 * Bộ field dùng chung cho form ghi chú (nội dung + ngày xảy ra + ảnh) —
 * dùng cả ở widget "Ghi chú nhanh" trên Dashboard lẫn modal thêm/sửa ở /dashboard/notes.
 */
export function NoteFormFields({ value, onChange, factoryId, compact = false, textareaRows }: NoteFormFieldsProps) {
  return (
    <div className="space-y-3">
      <textarea
        value={value.noiDung}
        onChange={(e) => onChange({ noiDung: e.target.value })}
        placeholder="Ghi lại sự việc, sự cố, bàn giao ca..."
        rows={textareaRows ?? (compact ? 2 : 5)}
        className="w-full resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
      />
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <label className="mb-1 block text-[11px] font-bold text-slate-500">Ngày xảy ra</label>
          <input
            type="date"
            value={value.ngayXayRa}
            onChange={(e) => onChange({ ngayXayRa: e.target.value })}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
        </div>
        <div className="min-w-[160px] flex-1">
          <label className="mb-1 block text-[11px] font-bold text-slate-500">Hình ảnh</label>
          <NoteImagePicker
            factoryId={factoryId}
            images={value.images}
            onChange={(images) => onChange({ images })}
            compact={compact}
          />
        </div>
      </div>
    </div>
  )
}
