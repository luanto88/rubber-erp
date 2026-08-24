"use client"
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Loader2, NotebookPen, Plus, Search, X } from "lucide-react"
import { getActiveFactoryId, hasPermission, type SessionUser } from "@/lib/auth"
import { getTodayISODate } from "@/lib/date-utils"
import { FilterBar } from "@/app/dashboard/_components/filter-bar"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { NoteCard } from "@/app/dashboard/_components/note-card"
import { NoteFormFields, type NoteFormValue } from "@/app/dashboard/_components/note-form-fields"
import { NoteShareModal } from "@/app/dashboard/_components/note-share-modal"
import {
  canManageOperationNote,
  compareOperationNotes,
  createOperationNote,
  deleteOperationNote,
  fetchOperationNotes,
  fetchShareCountsForNoteIds,
  getErrorMessage,
  updateOperationNote,
  type OperationNote,
} from "@/lib/operation-notes"
import { PageHeaderBanner } from "@/app/dashboard/_components/page-header-banner"
import { PageBackgroundMotif } from "@/app/dashboard/_components/page-background-motif"

const PAGE_SIZE = 60

function emptyForm(): NoteFormValue {
  return { noiDung: "", ngayXayRa: getTodayISODate(), images: [] }
}

export default function NotesPage() {
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null)
  const [notes, setNotes] = useState<OperationNote[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)

  // Filters — searchInput là state gõ tay, search (debounced 300ms) mới thật sự đẩy vào
  // loadData. Trước đây mỗi ký tự gõ bắn ngay 1 query Supabase, gây giật lag rõ rệt.
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [filterFrom, setFilterFrom] = useState("")
  const [filterTo, setFilterTo] = useState("")

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  // Modal thêm/sửa
  const [modal, setModal] = useState<"add" | "edit" | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<NoteFormValue>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [delConfirm, setDelConfirm] = useState<string | null>(null)
  const [zoomUrl, setZoomUrl] = useState<string | null>(null)
  const [shareNote, setShareNote] = useState<OperationNote | null>(null)
  const [shareCounts, setShareCounts] = useState<Record<string, number>>({})

  const canCreate = hasPermission(currentUser, "notes.create")

  const loadData = useCallback(async (fid: string) => {
    setLoading(true)
    try {
      const data = await fetchOperationNotes(fid, {
        search: search || undefined,
        from: filterFrom || undefined,
        to: filterTo || undefined,
        limit: PAGE_SIZE,
        offset: 0,
      })
      setNotes(data)
      setHasMore(data.length >= PAGE_SIZE)
    } finally {
      setLoading(false)
    }
  }, [search, filterFrom, filterTo])

  // "Tải thêm" — chỉ lấy đúng trang kế tiếp (offset = số ghi chú đã có) rồi NỐI THÊM, thay vì
  // tăng dần 1 giới hạn rồi truy vấn lại toàn bộ từ đầu (bug lag cũ, càng tải càng chậm).
  const loadMore = async () => {
    if (!factoryId || loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const more = await fetchOperationNotes(factoryId, {
        search: search || undefined,
        from: filterFrom || undefined,
        to: filterTo || undefined,
        limit: PAGE_SIZE,
        offset: notes.length,
      })
      setNotes((prev) => [...prev, ...more])
      setHasMore(more.length >= PAGE_SIZE)
    } finally {
      setLoadingMore(false)
    }
  }

  // Bootstrap — chỉ chạy 1 lần, không gọi loadData trực tiếp (xem 04-code-patterns.md)
  useEffect(() => {
    const bootstrap = async () => {
      const cachedUser = JSON.parse(localStorage.getItem("erp_user") || "null") as SessionUser | null
      setCurrentUser(cachedUser)
      if (!hasPermission(cachedUser, "notes.view")) {
        setLoading(false)
        window.location.replace("/dashboard")
        return
      }
      const fid = await getActiveFactoryId()
      if (!fid) {
        setLoading(false)
        return
      }
      setFactoryId(fid)
    }
    void bootstrap()
  }, [])

  useEffect(() => {
    if (factoryId) void loadData(factoryId)
  }, [factoryId, loadData])

  // Số người được chia sẻ chỉ hiển thị chính xác cho ghi chú mình sở hữu/admin
  // (xem canManage ở nơi render) — RLS operation_note_shares tự giới hạn số dòng trả về.
  useEffect(() => {
    if (!notes.length) {
      setShareCounts({})
      return
    }
    fetchShareCountsForNoteIds(notes.map((n) => n.id))
      .then(setShareCounts)
      .catch(() => {})
  }, [notes])

  const openAdd = () => {
    setForm(emptyForm())
    setSaveError(null)
    setEditId(null)
    setModal("add")
  }

  // useCallback([]) — chỉ dùng các setState setter (ổn định giữa các render) nên an toàn để giữ
  // 1 tham chiếu duy nhất cho toàn bộ danh sách, thay vì tạo closure mới mỗi lần render (điều
  // kiện bắt buộc để React.memo trên NoteCard thực sự có tác dụng).
  const openEdit = useCallback((note: OperationNote) => {
    setForm({ noiDung: note.noi_dung, ngayXayRa: note.ngay_xay_ra, images: note.image_urls || [] })
    setSaveError(null)
    setEditId(note.id)
    setModal("edit")
  }, [])

  const requestDelete = useCallback((noteId: string) => setDelConfirm(noteId), [])
  const openShare = useCallback((note: OperationNote) => setShareNote(note), [])

  const closeModal = () => setModal(null)

  const handleSave = async () => {
    if (!factoryId || !form.noiDung.trim()) return
    setSaving(true)
    setSaveError(null)
    try {
      if (editId) {
        const updated = await updateOperationNote(editId, {
          noiDung: form.noiDung,
          ngayXayRa: form.ngayXayRa,
          imageUrls: form.images,
        })
        setNotes((prev) => prev.map((n) => (n.id === editId ? updated : n)).sort(compareOperationNotes))
      } else {
        const created = await createOperationNote({
          factoryId,
          noiDung: form.noiDung,
          ngayXayRa: form.ngayXayRa,
          imageUrls: form.images,
          createdBy: currentUser?.id ?? null,
          nguoiTao: currentUser?.full_name || currentUser?.username || null,
        })
        setNotes((prev) => [...prev, created].sort(compareOperationNotes))
      }
      closeModal()
    } catch (err) {
      setSaveError(getErrorMessage(err, "Không lưu được ghi chú."))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!factoryId) return
    await deleteOperationNote(id)
    setDelConfirm(null)
    setNotes((prev) => prev.filter((n) => n.id !== id))
  }

  const clearFilters = () => {
    setSearchInput("")
    setSearch("")
    setFilterFrom("")
    setFilterTo("")
  }

  const activeFilterCount = [search, filterFrom, filterTo].filter(Boolean).length

  return (
    <div className="space-y-4">
      <PageBackgroundMotif theme="rose"/>
      <PageHeaderBanner
        title="Ghi chú nhanh"
        subtitle="Ghi chú riêng tư kèm hình ảnh — chỉ bạn thấy, trừ khi bạn chia sẻ cho người khác"
        theme="rose"
        icon={NotebookPen}
        action={
          canCreate ? (
            <button
              onClick={openAdd}
              className="flex items-center gap-2 px-5 py-2.5 bg-white text-rose-700 font-bold rounded-xl shadow-sm transition-all hover:bg-white/90"
            >
              <Plus size={16} /> Thêm ghi chú
            </button>
          ) : undefined
        }
      />

      <FilterBar activeCount={activeFilterCount}>
        <div className="relative min-w-[220px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Tìm nội dung ghi chú..."
            className="w-full rounded-xl border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-600">Từ ngày</label>
          <input
            type="date"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-slate-600">Đến ngày</label>
          <input
            type="date"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          />
        </div>
        {activeFilterCount > 0 && (
          <button onClick={clearFilters} className="text-xs font-semibold text-slate-500 hover:text-slate-700">
            Xóa lọc
          </button>
        )}
      </FilterBar>

      {loading ? (
        <div className="py-16 text-center text-sm text-slate-400">Đang tải...</div>
      ) : notes.length === 0 ? (
        <div className="py-16 text-center text-slate-400">
          <NotebookPen size={40} className="mx-auto mb-3 opacity-30" />
          <p>Chưa có ghi chú nào</p>
        </div>
      ) : (
        <>
          <div className="columns-1 gap-4 md:columns-2 xl:columns-3">
            {notes.map((note, i) => (
              <div key={note.id} className="mb-4 break-inside-avoid">
                <NoteCard
                  note={note}
                  index={i}
                  canManage={canManageOperationNote(note, currentUser)}
                  sharedCount={shareCounts[note.id] || 0}
                  onEdit={openEdit}
                  onDelete={requestDelete}
                  onShare={openShare}
                  onImageClick={setZoomUrl}
                />
              </div>
            ))}
          </div>
          {hasMore && (
            <div className="text-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded-xl px-5 py-2 text-sm font-bold text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
              >
                {loadingMore ? "Đang tải..." : "Tải thêm"}
              </button>
            </div>
          )}
        </>
      )}

      {(modal === "add" || modal === "edit") && (
        <ModalShell
          title={modal === "add" ? "Thêm ghi chú" : "Sửa ghi chú"}
          onClose={closeModal}
          maxWidth="lg"
          footer={
            <>
              <button onClick={closeModal} className="rounded-xl px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100">
                Hủy
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.noiDung.trim()}
                className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 font-bold text-white shadow-md transition-all hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {saving ? "Đang lưu..." : "Lưu"}
              </button>
            </>
          }
        >
          <NoteFormFields
            value={form}
            onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
            factoryId={factoryId}
            textareaRows={5}
          />
          {saveError && (
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
              <AlertTriangle size={14} className="shrink-0" /> {saveError}
            </div>
          )}
        </ModalShell>
      )}

      {delConfirm && (
        <ModalShell
          title="Xác nhận xóa"
          onClose={() => setDelConfirm(null)}
          maxWidth="sm"
          footer={
            <>
              <button
                onClick={() => setDelConfirm(null)}
                className="rounded-xl px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
              >
                Hủy
              </button>
              <button
                onClick={() => handleDelete(delConfirm)}
                className="rounded-xl bg-red-600 px-5 py-2 font-bold text-white shadow-md hover:bg-red-700"
              >
                Xóa
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-600">Bạn có chắc muốn xóa ghi chú này? Hành động này không thể hoàn tác.</p>
        </ModalShell>
      )}

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

      {shareNote && factoryId && currentUser && (
        <NoteShareModal
          note={shareNote}
          factoryId={factoryId}
          actorId={currentUser.id}
          onClose={() => setShareNote(null)}
          onSaved={() => {
            fetchShareCountsForNoteIds(notes.map((n) => n.id))
              .then(setShareCounts)
              .catch(() => {})
          }}
        />
      )}
    </div>
  )
}
