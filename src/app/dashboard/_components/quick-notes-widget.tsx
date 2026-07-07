"use client"
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, Loader2, NotebookPen, X } from "lucide-react"
import { hasPermission, type SessionUser } from "@/lib/auth"
import { getTodayISODate } from "@/lib/date-utils"
import { createOperationNote, fetchOperationNotes, getErrorMessage, type OperationNote } from "@/lib/operation-notes"
import { NoteCard } from "./note-card"
import { NoteFormFields, type NoteFormValue } from "./note-form-fields"

const WIDGET_LIMIT = 5

function emptyForm(): NoteFormValue {
  return { noiDung: "", ngayXayRa: getTodayISODate(), images: [] }
}

type QuickNotesWidgetProps = {
  factoryId: string | null
  user: SessionUser | null
}

/**
 * Widget "Ghi chú nhanh" trên Dashboard chính — nhập ghi chú ngay tại chỗ,
 * hiển thị 5 ghi chú mới nhất, dẫn sang /dashboard/notes (module đầy đủ) để xem tất cả.
 */
export function QuickNotesWidget({ factoryId, user }: QuickNotesWidgetProps) {
  const router = useRouter()
  const [notes, setNotes] = useState<OperationNote[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<NoteFormValue>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [zoomUrl, setZoomUrl] = useState<string | null>(null)

  const canView = hasPermission(user, "notes.view")
  const canCreate = hasPermission(user, "notes.create")

  const load = useCallback(async (fid: string) => {
    setLoading(true)
    try {
      const data = await fetchOperationNotes(fid, { limit: WIDGET_LIMIT })
      setNotes(data)
    } catch {
      // Widget phụ — lỗi tải không được làm gãy cả Dashboard
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (factoryId && canView) void load(factoryId)
    else setLoading(false)
  }, [factoryId, canView, load])

  const handleSubmit = async () => {
    if (!factoryId || !form.noiDung.trim()) return
    setSaving(true)
    setError(null)
    try {
      await createOperationNote({
        factoryId,
        noiDung: form.noiDung,
        ngayXayRa: form.ngayXayRa,
        imageUrls: form.images,
        createdBy: user?.id ?? null,
        nguoiTao: user?.full_name || user?.username || null,
      })
      setForm(emptyForm())
      void load(factoryId)
    } catch (err) {
      setError(getErrorMessage(err, "Không lưu được ghi chú."))
    } finally {
      setSaving(false)
    }
  }

  if (!canView) return null

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-md p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center">
            <NotebookPen size={16} className="text-amber-600" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-700">Ghi chú nhanh</h2>
            <p className="text-xs text-slate-400">Riêng tư, có thể chia sẻ</p>
          </div>
        </div>
        <button
          onClick={() => router.push("/dashboard/notes")}
          className="flex items-center gap-1 text-xs font-semibold text-emerald-600 hover:text-emerald-700"
        >
          Xem tất cả <ArrowRight size={12} />
        </button>
      </div>

      {canCreate && (
        <div className="mb-4 rounded-2xl bg-slate-50 p-3">
          <NoteFormFields
            value={form}
            onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
            factoryId={factoryId}
            compact
          />
          {error && <div className="mt-2 text-xs font-semibold text-red-600">{error}</div>}
          <div className="mt-2 flex justify-end">
            <button
              onClick={handleSubmit}
              disabled={saving || !form.noiDung.trim()}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-md transition-all hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving && <Loader2 size={12} className="animate-spin" />}
              {saving ? "Đang lưu..." : "Ghi lại"}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2.5">
        {loading ? (
          <p className="py-4 text-center text-xs text-slate-400">Đang tải...</p>
        ) : notes.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-400">Chưa có ghi chú nào</p>
        ) : (
          notes.map((note, i) => (
            <NoteCard key={note.id} note={note} index={i} compact onImageClick={setZoomUrl} />
          ))
        )}
      </div>

      {zoomUrl && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setZoomUrl(null)}
        >
          <button
            type="button"
            onClick={() => setZoomUrl(null)}
            className="absolute right-4 top-4 rounded-full bg-white/20 p-2 text-white transition hover:bg-white/40"
            aria-label="Đóng"
          >
            <X size={20} />
          </button>
          <img
            src={zoomUrl}
            alt="Xem ảnh"
            className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
