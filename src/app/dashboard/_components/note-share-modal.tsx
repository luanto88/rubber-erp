"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Loader2, Search } from "lucide-react"
import { ModalShell } from "./modal-shell"
import {
  fetchOperationNoteShares,
  fetchShareCandidates,
  getErrorMessage,
  setOperationNoteShares,
  type OperationNote,
  type ShareCandidate,
} from "@/lib/operation-notes"

type NoteShareModalProps = {
  note: OperationNote
  factoryId: string
  actorId: string
  onClose: () => void
  onSaved: () => void
}

/**
 * Modal chọn người dùng để chia sẻ 1 ghi chú — người được chia sẻ sẽ tự thấy ghi chú
 * này trong danh sách của họ (xem RLS operation_note_shares, migration 20260707).
 */
export function NoteShareModal({ note, factoryId, actorId, onClose, onSaved }: NoteShareModalProps) {
  const [candidates, setCandidates] = useState<ShareCandidate[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")

  useEffect(() => {
    let alive = true
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const [users, shares] = await Promise.all([
          fetchShareCandidates(factoryId),
          fetchOperationNoteShares(note.id),
        ])
        if (!alive) return
        setCandidates(users.filter((u) => u.id !== note.created_by))
        setSelected(new Set(shares.map((s) => s.shared_with_user_id)))
      } catch (err) {
        if (alive) setError(getErrorMessage(err, "Không tải được danh sách."))
      } finally {
        if (alive) setLoading(false)
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [factoryId, note.id, note.created_by])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return candidates
    return candidates.filter((c) => c.name.toLowerCase().includes(q))
  }, [candidates, search])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await setOperationNoteShares({
        noteId: note.id,
        factoryId,
        actorId,
        recipientUserIds: [...selected],
      })
      onSaved()
      onClose()
    } catch (err) {
      setError(getErrorMessage(err, "Không lưu được chia sẻ."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell
      title="Chia sẻ ghi chú"
      onClose={onClose}
      maxWidth="sm"
      footer={
        <>
          <button onClick={onClose} className="rounded-xl px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100">
            Hủy
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 font-bold text-white shadow-md transition-all hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? "Đang lưu..." : "Lưu chia sẻ"}
          </button>
        </>
      }
    >
      <p className="mb-3 text-xs text-slate-500">
        Người được chọn sẽ thấy ghi chú này trong danh sách của họ, nhưng không sửa/xóa được.
      </p>

      <div className="relative mb-3">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm người dùng..."
          className="w-full rounded-xl border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-500"
        />
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm text-slate-400">Đang tải...</div>
      ) : filtered.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-400">Không có người dùng phù hợp</div>
      ) : (
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {filtered.map((c) => (
            <label
              key={c.id}
              className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={selected.has(c.id)}
                onChange={() => toggle(c.id)}
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="font-semibold text-slate-700">{c.name}</span>
            </label>
          ))}
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
          <AlertTriangle size={14} className="shrink-0" /> {error}
        </div>
      )}
    </ModalShell>
  )
}
