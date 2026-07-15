"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Search, Plus, FolderOpen, AlertTriangle,
  FileText, Loader2, Sparkles, RefreshCw, ClipboardList,
  Eye, Pencil, Trash2,
} from "lucide-react"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, getFreshAuthSession } from "@/lib/auth"
import { IsoShell } from "../_components/iso-shell"
import { ModalShell } from "../../_components/modal-shell"
import { ResponsiveTableWrapper } from "../../_components/responsive-table-wrapper"
import {
  fmtDate,
  FORM_INSTANCE_STATUS_LABEL,
  FORM_INSTANCE_STATUS_COLOR,
  LOAI_TAI_LIEU_LABEL,
  type IsoFormInstance,
  type IsoFormInstanceStatus,
  type TemplateSearchResult,
} from "../_components/iso-types"

// ─── Clone dialog ────────────────────────────────────────────────────────────
function CloneDialog({
  template,
  onClose,
  onCloned,
  factoryId,
  userId,
}: {
  template: TemplateSearchResult
  onClose: () => void
  onCloned: (instanceId: string) => void
  factoryId: string
  userId: string
}) {
  const [tieu_de, setTieuDe] = useState(template.ten_tai_lieu)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async () => {
    if (!tieu_de.trim()) { setError("Vui lòng nhập tiêu đề"); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/iso/forms/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateDocId: template.id, tieu_de: tieu_de.trim(), factoryId, userId }),
      })
      const json = await res.json() as { instanceId?: string; isPdfOnly?: boolean; error?: string }
      if (!res.ok) { setError(json.error ?? "Lỗi tạo hồ sơ"); return }
      if (json.isPdfOnly) {
        setError("Template này chỉ có dạng PDF — bạn sẽ cần upload file Office sau khi tạo.")
        // Vẫn cho phép tạo instance không có draft file
      }
      if (json.instanceId) {
        onCloned(json.instanceId)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không xác định")
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell
      title="Tạo bản thực hiện"
      onClose={onClose}
      maxWidth="md"
      footer={
        <>
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
            Hủy
          </button>
          <button
            onClick={handleCreate}
            disabled={saving || !tieu_de.trim()}
            className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Tạo hồ sơ
          </button>
        </>
      }
    >
      <div className="mb-4 p-3 bg-violet-50 rounded-xl text-sm text-violet-800 border border-violet-100">
        <div className="font-bold truncate">{template.ten_tai_lieu}</div>
        <div className="text-xs mt-0.5 text-violet-500">
          {template.ma_tai_lieu} &middot; {LOAI_TAI_LIEU_LABEL[template.loai_tai_lieu ?? ""] ?? template.loai_tai_lieu} &middot; {template.phong_ban}
        </div>
      </div>

      <label className="text-xs font-bold text-slate-600 block mb-1.5">Tiêu đề hồ sơ thực hiện</label>
      <input
        className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 mb-4"
        value={tieu_de}
        onChange={(e) => setTieuDe(e.target.value)}
        placeholder="Nhập tiêu đề..."
        autoFocus
      />

      {error && (
        <div className="mb-3 p-3 bg-red-50 text-red-700 rounded-xl text-xs flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </ModalShell>
  )
}

// ─── Template card ────────────────────────────────────────────────────────────
function TemplateCard({
  tmpl,
  onSelect,
}: {
  tmpl: TemplateSearchResult
  onSelect: () => void
}) {
  const pct = Math.round(tmpl.similarity * 100)
  const ext = tmpl.file_signed_office_type || (tmpl.file_signed_office_url ? "docx" : tmpl.file_goc_url?.split(".").pop() ?? "pdf")

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 hover:border-violet-300 hover:shadow-md transition-all">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="font-bold text-slate-800 text-sm leading-snug line-clamp-2">{tmpl.ten_tai_lieu}</div>
          <div className="text-xs text-slate-400 mt-0.5">{tmpl.ma_tai_lieu} &middot; {tmpl.phong_ban} &middot; LBH: {tmpl.lan_ban_hanh}</div>
        </div>
        <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-violet-100 text-violet-700">
          {pct}%
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold rounded-md">
          <FileText size={10} />
          {ext.toUpperCase()}
        </span>
        <button
          onClick={onSelect}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg"
        >
          <Plus size={12} />
          Tạo bản thực hiện
        </button>
      </div>
    </div>
  )
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: IsoFormInstanceStatus }) {
  const label = FORM_INSTANCE_STATUS_LABEL[status] ?? status
  const color = FORM_INSTANCE_STATUS_COLOR[status] ?? "bg-slate-100 text-slate-600"
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${color}`}>
      {label}
    </span>
  )
}

// ─── Lập hồ sơ quick dialog ──────────────────────────────────────────────────
interface QuickDoc {
  id: string
  ma_tai_lieu: string
  ten_tai_lieu: string
}

function LapHoSoDialog({
  factoryId,
  userId,
  onClose,
  onCreated,
}: {
  factoryId: string
  userId: string
  onClose: () => void
  onCreated: (instanceId: string) => void
}) {
  const [phongBanList, setPhongBanList] = useState<string[]>([])
  const [phongBan, setPhongBan] = useState("")
  const [docs, setDocs] = useState<QuickDoc[]>([])
  const [selectedDocId, setSelectedDocId] = useState("")
  const [tieuDe, setTieuDe] = useState("")
  const [loadingPb, setLoadingPb] = useState(true)
  const [loadingDocs, setLoadingDocs] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      setLoadingPb(true)
      try {
        const { data } = await supabase
          .from("iso_documents")
          .select("phong_ban")
          .eq("factory_id", factoryId)
          .eq("trang_thai", "co_hieu_luc")
          .eq("phan_loai_tl", "con")
          .not("phong_ban", "is", null)
        const unique = [...new Set((data ?? []).map((d) => d.phong_ban as string))]
          .filter(Boolean)
          .sort()
        setPhongBanList(unique)
      } finally {
        setLoadingPb(false)
      }
    }
    void load()
  }, [factoryId])

  useEffect(() => {
    if (!phongBan) { setDocs([]); setSelectedDocId(""); setTieuDe(""); return }
    const load = async () => {
      setLoadingDocs(true)
      setSelectedDocId("")
      setTieuDe("")
      try {
        const { data } = await supabase
          .from("iso_documents")
          .select("id, ma_tai_lieu, ten_tai_lieu")
          .eq("factory_id", factoryId)
          .eq("trang_thai", "co_hieu_luc")
          .eq("phan_loai_tl", "con")
          .eq("phong_ban", phongBan)
          .order("ma_tai_lieu", { ascending: true })
        setDocs((data ?? []) as QuickDoc[])
      } finally {
        setLoadingDocs(false)
      }
    }
    void load()
  }, [factoryId, phongBan])

  const handleSelectDoc = (docId: string) => {
    setSelectedDocId(docId)
    const doc = docs.find((d) => d.id === docId)
    if (doc && !tieuDe) setTieuDe(doc.ten_tai_lieu)
  }

  const handleCreate = async () => {
    if (!selectedDocId || !tieuDe.trim()) { setError("Vui lòng chọn biểu mẫu và nhập tiêu đề"); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/iso/forms/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateDocId: selectedDocId, tieu_de: tieuDe.trim(), factoryId, userId }),
      })
      const json = await res.json() as { instanceId?: string; isPdfOnly?: boolean; error?: string }
      if (!res.ok) { setError(json.error ?? "Lỗi tạo hồ sơ"); return }
      if (json.instanceId) onCreated(json.instanceId)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi không xác định")
    } finally {
      setSaving(false)
    }
  }

  const footer = (
    <>
      <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
        Hủy
      </button>
      <button
        onClick={handleCreate}
        disabled={saving || !selectedDocId || !tieuDe.trim()}
        className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl"
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <ClipboardList size={14} />}
        Lập hồ sơ ngay
      </button>
    </>
  )

  return (
    <ModalShell
      title={
        <span className="flex items-center gap-2">
          <ClipboardList size={18} className="text-emerald-600" />
          Lập hồ sơ
        </span>
      }
      onClose={onClose}
      maxWidth="md"
      footer={footer}
    >
        <div className="mb-4">
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Phòng ban</label>
          {loadingPb ? (
            <div className="flex items-center gap-2 text-sm text-slate-400 py-2">
              <Loader2 size={14} className="animate-spin" /> Đang tải...
            </div>
          ) : (
            <select
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
              value={phongBan}
              onChange={(e) => setPhongBan(e.target.value)}
              autoFocus
            >
              <option value="">— Chọn phòng ban —</option>
              {phongBanList.map((pb) => (
                <option key={pb} value={pb}>{pb}</option>
              ))}
            </select>
          )}
        </div>

        {phongBan && (
          <div className="mb-4">
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Biểu mẫu</label>
            {loadingDocs ? (
              <div className="flex items-center gap-2 text-sm text-slate-400 py-2">
                <Loader2 size={14} className="animate-spin" /> Đang tải...
              </div>
            ) : docs.length === 0 ? (
              <p className="text-sm text-slate-400 py-2">Không có biểu mẫu đang có hiệu lực</p>
            ) : (
              <select
                className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                value={selectedDocId}
                onChange={(e) => handleSelectDoc(e.target.value)}
              >
                <option value="">— Chọn biểu mẫu —</option>
                {docs.map((d) => (
                  <option key={d.id} value={d.id}>{d.ma_tai_lieu} — {d.ten_tai_lieu}</option>
                ))}
              </select>
            )}
          </div>
        )}

        {selectedDocId && (
          <div className="mb-4">
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Tiêu đề hồ sơ</label>
            <input
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
              value={tieuDe}
              onChange={(e) => setTieuDe(e.target.value)}
              placeholder="Nhập tiêu đề hồ sơ..."
            />
          </div>
        )}

        {error && (
          <div className="mb-3 p-3 bg-red-50 text-red-700 rounded-xl text-xs flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
    </ModalShell>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function IsoFormsPage() {
  const router = useRouter()
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Search state
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<TemplateSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)

  // Instances list
  const [instances, setInstances] = useState<IsoFormInstance[]>([])
  const [instLoading, setInstLoading] = useState(false)

  // Clone dialog
  const [cloneTemplate, setCloneTemplate] = useState<TemplateSearchResult | null>(null)

  // Tab filter
  const [filterStatus, setFilterStatus] = useState<"all" | IsoFormInstanceStatus>("all")

  // Batch re-embed
  const [reembedding, setReembedding] = useState(false)
  const [reembedMsg, setReembedMsg] = useState<string | null>(null)

  // Lập hồ sơ quick dialog
  const [lapHoSoOpen, setLapHoSoOpen] = useState(false)

  // Role & delete
  const [userRole, setUserRole] = useState("")
  const [delConfirm, setDelConfirm] = useState<string | null>(null)

  const searchInputRef = useRef<HTMLInputElement>(null)

  // Bootstrap
  useEffect(() => {
    const bootstrap = async () => {
      try {
        const fid = await getActiveFactoryId()
        if (!fid) { setLoading(false); return }
        const session = await getFreshAuthSession()
        const uid = session?.user?.id
        if (!uid) { setLoading(false); return }
        const { data: prof } = await supabase.from("profiles").select("role").eq("id", uid).single()
        setFactoryId(fid)
        setUserId(uid)
        setUserRole(prof?.role || "")
      } finally {
        setLoading(false)
      }
    }
    void bootstrap()
  }, [])

  const loadInstances = useCallback(async (fid: string, uid: string, role = "") => {
    setInstLoading(true)
    try {
      let query = supabase
        .from("iso_form_instances")
        .select("*")
        .eq("factory_id", fid)
        .order("created_at", { ascending: false })
        .limit(100)
      if (role !== "admin") {
        query = query.or(`nguoi_tao.eq.${uid},xem_xet_user_id.eq.${uid},phe_duyet_user_id.eq.${uid}`)
      }
      const { data } = await query
      setInstances((data ?? []) as IsoFormInstance[])
    } finally {
      setInstLoading(false)
    }
  }, [])

  useEffect(() => {
    if (factoryId && userId) void loadInstances(factoryId, userId, userRole)
  }, [factoryId, userId, userRole, loadInstances])

  const handleDeleteInst = async (instId: string) => {
    if (!factoryId || !userId) return
    await supabase.from("iso_form_instances").delete().eq("id", instId)
    setDelConfirm(null)
    void loadInstances(factoryId, userId, userRole)
  }

  const handleSearch = async () => {
    if (!searchQuery.trim() || !factoryId) return
    setSearching(true)
    setSearchError(null)
    setHasSearched(true)
    try {
      const res = await fetch("/api/iso/forms/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery.trim(), factoryId }),
      })
      const json = await res.json() as { results?: TemplateSearchResult[]; error?: string }
      if (!res.ok) { setSearchError(json.error ?? "Lỗi tìm kiếm"); return }
      setSearchResults(json.results ?? [])
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Lỗi không xác định")
    } finally {
      setSearching(false)
    }
  }

  const handleCloned = (instanceId: string) => {
    setCloneTemplate(null)
    router.push(`/dashboard/iso/forms/${instanceId}`)
  }

  const handleReembed = async () => {
    if (!factoryId) return
    setReembedding(true)
    setReembedMsg(null)
    try {
      const res = await fetch("/api/iso/forms/batch-embed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ factoryId }),
      })
      const json = await res.json() as { processed?: number; failed?: number; total?: number; message?: string; error?: string }
      if (!res.ok) { setReembedMsg(`Lỗi: ${json.error ?? "Không xác định"}`); return }
      if (json.message) { setReembedMsg(json.message); return }
      setReembedMsg(`Đã cập nhật ${json.processed}/${json.total} tài liệu${json.failed ? `, ${json.failed} lỗi` : ""}`)
    } catch (e) {
      setReembedMsg(e instanceof Error ? e.message : "Lỗi không xác định")
    } finally {
      setReembedding(false)
    }
  }

  const filteredInstances = filterStatus === "all"
    ? instances
    : instances.filter((i) => i.trang_thai === filterStatus)

  if (loading) {
    return (
      <IsoShell>
        <div className="p-12 text-center text-slate-400">
          <Loader2 size={32} className="animate-spin mx-auto mb-3 opacity-50" />
          <p>Đang tải...</p>
        </div>
      </IsoShell>
    )
  }

  return (
    <IsoShell>
      <div className="space-y-6">

        {/* ── Header ── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800">Thực hiện hồ sơ ISO</h1>
            <p className="text-sm text-slate-500 mt-0.5">Tìm biểu mẫu bằng AI, tạo bản thực hiện và gửi phê duyệt</p>
          </div>
          <div className="flex flex-col sm:items-end gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleReembed}
                disabled={reembedding || !factoryId}
                title="Cập nhật chỉ mục AI cho các tài liệu chưa được index"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50 rounded-xl border border-slate-200 transition-colors"
              >
                {reembedding ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                Cập nhật chỉ mục AI
              </button>
              <button
                onClick={() => setLapHoSoOpen(true)}
                disabled={!factoryId}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-emerald-700 border border-emerald-300 hover:bg-emerald-50 disabled:opacity-50 rounded-xl transition-colors"
              >
                <ClipboardList size={15} />
                Lập hồ sơ
              </button>
            </div>
            {reembedMsg && (
              <span className="text-[11px] text-slate-500">{reembedMsg}</span>
            )}
          </div>
        </div>

        {/* ── AI Search ── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={16} className="text-violet-500" />
            <span className="text-sm font-bold text-slate-700">Tìm kiếm biểu mẫu bằng AI</span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              ref={searchInputRef}
              className="flex-1 min-w-0 px-4 py-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-400 transition-colors"
              placeholder="Ví dụ: biểu mẫu mục tiêu chất lượng, phiếu kiểm tra sản phẩm..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
            />
            <button
              onClick={handleSearch}
              disabled={searching || !searchQuery.trim() || !factoryId}
              className="flex items-center justify-center gap-2 w-full sm:w-auto px-5 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-colors"
            >
              {searching ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
              Tìm kiếm
            </button>
          </div>

          {searchError && (
            <div className="mt-3 p-3 bg-red-50 text-red-700 rounded-xl text-sm flex items-center gap-2">
              <AlertTriangle size={14} />
              {searchError}
              {searchError.includes("GEMINI_API_KEY") && (
                <span className="ml-1 text-xs text-red-500">(Chưa cấu hình GEMINI_API_KEY)</span>
              )}
            </div>
          )}

          {/* Search results */}
          {hasSearched && !searching && (
            <div className="mt-4">
              {searchResults.length === 0 ? (
                <div className="text-center py-6 text-slate-400 text-sm">
                  <FolderOpen size={32} className="mx-auto mb-2 opacity-30" />
                  <p>Không tìm thấy biểu mẫu phù hợp</p>
                  <p className="text-xs mt-1 text-slate-300">Thử từ khóa khác hoặc kiểm tra GEMINI_API_KEY</p>
                </div>
              ) : (
                <>
                  <p className="text-xs text-slate-400 mb-3">
                    Tìm thấy {searchResults.length} biểu mẫu phù hợp nhất
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {searchResults.map((tmpl) => (
                      <TemplateCard
                        key={tmpl.id}
                        tmpl={tmpl}
                        onSelect={() => setCloneTemplate(tmpl)}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Instances list ── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-b border-slate-100">
            <h2 className="text-sm font-extrabold text-slate-700">Hồ sơ của tôi</h2>
            {/* Status filter chips */}
            <div className="flex gap-1 flex-wrap">
              {(["all", "draft", "cho_xem_xet", "cho_phe_duyet", "da_phe_duyet", "tra_ve"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={
                    "px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors " +
                    (filterStatus === s
                      ? "bg-violet-100 text-violet-700"
                      : "text-slate-500 hover:bg-slate-50")
                  }
                >
                  {s === "all" ? "Tất cả" : (FORM_INSTANCE_STATUS_LABEL[s as IsoFormInstanceStatus] ?? s)}
                </button>
              ))}
            </div>
          </div>

          {instLoading ? (
            <div className="p-8 text-center text-slate-400 text-sm">
              <Loader2 size={24} className="animate-spin mx-auto mb-2 opacity-40" />
              Đang tải...
            </div>
          ) : filteredInstances.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <FolderOpen size={36} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">Chưa có hồ sơ nào</p>
              <p className="text-xs mt-1">Tìm biểu mẫu phía trên để bắt đầu</p>
            </div>
          ) : (
            <ResponsiveTableWrapper className="rounded-none border-0 shadow-none">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left">
                  <th className="px-4 py-2.5 text-xs font-bold text-slate-500 max-w-[220px]">Tiêu đề</th>
                  <th className="px-4 py-2.5 text-xs font-bold text-slate-500">Trạng thái</th>
                  <th className="px-4 py-2.5 text-xs font-bold text-slate-500">Ngày tạo</th>
                  <th className="px-4 py-2.5 text-xs font-bold text-slate-500">Cấp</th>
                  <th className="px-4 py-2.5 text-xs font-bold text-slate-500 w-32"></th>
                </tr>
              </thead>
              <tbody>
                {filteredInstances.map((inst) => {
                  const isAdmin = userRole === "admin"
                  const isCreator = inst.nguoi_tao === userId
                  const canEditInst = (inst.trang_thai === "draft" && isCreator) || isAdmin
                  const canDeleteInst = (inst.trang_thai === "draft" && isCreator) || isAdmin
                  return (
                    <tr
                      key={inst.id}
                      onClick={() => router.push(`/dashboard/iso/forms/${inst.id}`)}
                      className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 max-w-[220px]">
                        <div className="font-semibold text-slate-800 truncate">{inst.tieu_de}</div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={inst.trang_thai} />
                        {inst.trang_thai === "tra_ve" && inst.ly_do_tra_ve && (
                          <div className="text-[10px] text-rose-500 mt-0.5 line-clamp-1">{inst.ly_do_tra_ve}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(inst.created_at)}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-slate-500">{inst.cap_tl}</span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <button
                            title="Xem chi tiết"
                            onClick={() => router.push(`/dashboard/iso/forms/${inst.id}`)}
                            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
                          >
                            <Eye size={14} />
                          </button>
                          {canEditInst && (
                            <button
                              title="Sửa"
                              onClick={() => router.push(`/dashboard/iso/forms/${inst.id}`)}
                              className="p-1.5 rounded-lg hover:bg-violet-100 text-slate-400 hover:text-violet-600 transition-colors"
                            >
                              <Pencil size={14} />
                            </button>
                          )}
                          {canDeleteInst && (
                            <button
                              title="Xóa"
                              onClick={() => setDelConfirm(inst.id)}
                              className="p-1.5 rounded-lg hover:bg-red-100 text-slate-400 hover:text-red-600 transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </ResponsiveTableWrapper>
          )}
        </div>
      </div>

      {/* Clone dialog (from AI search) */}
      {cloneTemplate && factoryId && userId && (
        <CloneDialog
          template={cloneTemplate}
          factoryId={factoryId}
          userId={userId}
          onClose={() => setCloneTemplate(null)}
          onCloned={handleCloned}
        />
      )}

      {/* Lập hồ sơ quick dialog */}
      {lapHoSoOpen && factoryId && userId && (
        <LapHoSoDialog
          factoryId={factoryId}
          userId={userId}
          onClose={() => setLapHoSoOpen(false)}
          onCreated={(instanceId) => {
            setLapHoSoOpen(false)
            router.push(`/dashboard/iso/forms/${instanceId}`)
          }}
        />
      )}

      {/* Delete confirm dialog */}
      {delConfirm && (
        <ModalShell
          title={
            <span className="flex items-center gap-3">
              <span className="p-2 bg-red-100 rounded-xl"><Trash2 size={18} className="text-red-600" /></span>
              Xóa hồ sơ?
            </span>
          }
          onClose={() => setDelConfirm(null)}
          maxWidth="sm"
          footer={
            <>
              <button onClick={() => setDelConfirm(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
                Hủy
              </button>
              <button
                onClick={() => void handleDeleteInst(delConfirm)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl"
              >
                Xóa
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-600">Hành động này không thể hoàn tác. Hồ sơ và file đính kèm sẽ bị xóa vĩnh viễn.</p>
        </ModalShell>
      )}
    </IsoShell>
  )
}

