"use client"
/* eslint-disable @next/next/no-img-element */

import { memo } from "react"
import { Pencil, Share2, Trash2, Users } from "lucide-react"
import { formatDateDisplay } from "@/lib/date-utils"
import { notePastelBg, type OperationNote } from "@/lib/operation-notes"

type NoteCardProps = {
  note: OperationNote
  index: number
  compact?: boolean
  canManage?: boolean
  sharedCount?: number
  // Nhận tham số (note/noteId) thay vì đã bind sẵn — để component cha chỉ cần 1 useCallback([])
  // ổn định dùng chung cho cả danh sách, thay vì tạo N closure mới mỗi lần render (bắt buộc để
  // React.memo bên dưới thực sự chặn được re-render thừa).
  onEdit?: (note: OperationNote) => void
  onDelete?: (noteId: string) => void
  onShare?: (note: OperationNote) => void
  onImageClick?: (url: string) => void
}

/**
 * Thẻ ghi chú kiểu "giấy nhớ" — pastel, bo góc mềm, chỉ đổ bóng nhẹ, không viền cứng.
 * Dùng chung cho widget Dashboard (compact) và grid đầy đủ ở /dashboard/notes.
 */
function NoteCardBase({
  note,
  index,
  compact = false,
  canManage = false,
  sharedCount = 0,
  onEdit,
  onDelete,
  onShare,
  onImageClick,
}: NoteCardProps) {
  return (
    <div className={`${notePastelBg(index)} rounded-2xl shadow-sm transition-shadow hover:shadow-md ${compact ? "p-3" : "p-4"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-bold text-slate-600">
            {formatDateDisplay(note.ngay_xay_ra) || note.ngay_xay_ra}
          </span>
          {canManage && sharedCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-1 text-[10px] font-bold text-slate-500">
              <Users size={10} /> {sharedCount}
            </span>
          )}
        </div>
        {canManage && (onEdit || onDelete || onShare) && (
          <div className="flex items-center gap-1">
            {onShare && (
              <button
                type="button"
                onClick={() => onShare(note)}
                className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/70"
                aria-label="Chia sẻ ghi chú"
              >
                <Share2 size={13} />
              </button>
            )}
            {onEdit && (
              <button
                type="button"
                onClick={() => onEdit(note)}
                className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/70"
                aria-label="Sửa ghi chú"
              >
                <Pencil size={13} />
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={() => onDelete(note.id)}
                className="rounded-lg p-1.5 text-red-500 transition hover:bg-white/70"
                aria-label="Xóa ghi chú"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        )}
      </div>

      <p className={`mt-2 whitespace-pre-wrap text-sm text-slate-700 ${compact ? "line-clamp-3" : ""}`}>
        {note.noi_dung}
      </p>

      {note.image_urls.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {note.image_urls.map((url, i) => (
            <img
              key={`${url}-${i}`}
              src={url}
              alt=""
              loading="lazy"
              className="h-12 w-12 cursor-zoom-in rounded-lg object-cover shadow-sm"
              onClick={() => onImageClick?.(url)}
            />
          ))}
        </div>
      )}

      <div className="mt-3 text-[10px] font-semibold text-slate-400">{note.nguoi_tao || "Không rõ người ghi"}</div>
    </div>
  )
}

export const NoteCard = memo(NoteCardBase)
