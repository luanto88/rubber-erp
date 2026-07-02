"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId } from "@/lib/auth"
import { DocumentsShell } from "./_components/documents-shell"
import {
  LOAI_VAN_BAN_LABEL,
  LOAI_VAN_BAN_OPTIONS,
  PHONG_BAN_VAN_BAN_OPTIONS,
  TRANG_THAI_COLOR,
  TRANG_THAI_LABEL,
  fmtDate,
  type VanBanDocument,
  type VanBanTrangThai,
} from "./_components/documents-types"
import { FileText, Search, Eye, Sparkles, Loader2, X, BarChart2 } from "lucide-react"
import Link from "next/link"
import { FilterBar } from "@/app/dashboard/_components/filter-bar"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"

type AiSearchResult = {
  id: string
  ma_van_ban: string | null
  ten_van_ban: string
  loai_van_ban: string | null
  phong_ban: string | null
  trang_thai: string
  ngay_phe_duyet: string | null
  mo_ta_tim_kiem: string | null
  similarity: number
}

export default function DocumentsPage() {
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [docs, setDocs] = useState<VanBanDocument[]>([])
  const [activeTab, setActiveTab] = useState<"list" | "stats">("list")

  const [search, setSearch] = useState("")
  const [filterLoai, setFilterLoai] = useState("")
  const [filterTrangThai, setFilterTrangThai] = useState<VanBanTrangThai | "">("")
  const [filterPhongBan, setFilterPhongBan] = useState("")

  // Bug 6d: AI semantic search
  const [aiMode, setAiMode] = useState(false)
  const [aiQuery, setAiQuery] = useState("")
  const [aiSearching, setAiSearching] = useState(false)
  const [aiResults, setAiResults] = useState<AiSearchResult[] | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const aiInputRef = useRef<HTMLInputElement>(null)

  const handleAiSearch = async () => {
    if (!aiQuery.trim() || !factoryId) return
    setAiSearching(true)
    setAiError(null)
    setAiResults(null)
    try {
      const res = await fetch("/api/documents/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: aiQuery.trim(), factoryId }),
      })
      const json = (await res.json()) as AiSearchResult[] | { error: string }
      if (!res.ok || "error" in json) {
        setAiError((json as { error: string }).error || "Tìm kiếm thất bại")
      } else {
        setAiResults(json as AiSearchResult[])
      }
    } catch {
      setAiError("Lỗi kết nối. Vui lòng thử lại.")
    } finally {
      setAiSearching(false)
    }
  }

  const loadData = useCallback(async (fid: string) => {
    setLoading(true)
    try {
      const { data } = await supabase
        .from("van_ban_documents")
        .select(
          "id, ma_van_ban, ten_van_ban, loai_van_ban, phong_ban, trang_thai, is_uploaded, ngay_phe_duyet, nam, so_van_ban, file_signed_pdf_url, nguoi_soan_thao_display, created_at, updated_at",
        )
        .eq("factory_id", fid)
        .order("updated_at", { ascending: false })
      setDocs((data || []) as VanBanDocument[])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const bootstrap = async () => {
      const fid = await getActiveFactoryId()
      if (!fid) { setLoading(false); return }
      setFactoryId(fid)
    }
    void bootstrap()
  }, [])

  useEffect(() => {
    if (factoryId) void loadData(factoryId)
  }, [factoryId, loadData])

  const filtered = useMemo(() => {
    return docs.filter((d) => {
      if (filterLoai && d.loai_van_ban !== filterLoai) return false
      if (filterTrangThai && d.trang_thai !== filterTrangThai) return false
      if (filterPhongBan && d.phong_ban !== filterPhongBan) return false
      if (search) {
        const q = search.toLowerCase()
        return (
          (d.ma_van_ban || "").toLowerCase().includes(q) ||
          d.ten_van_ban.toLowerCase().includes(q) ||
          (d.phong_ban || "").toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [docs, search, filterLoai, filterTrangThai, filterPhongBan])

  return (
    <DocumentsShell>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Văn bản nội bộ</h1>
          <p className="text-sm text-slate-500 mt-0.5">Quản lý đề nghị, tờ trình, báo cáo, kế hoạch, biên bản</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/documents/new"
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-md transition-all"
          >
            <FileText size={16} />
            Soạn thảo mới
          </Link>
          <Link
            href="/dashboard/documents/new/upload"
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 border border-slate-300 rounded-xl transition-all"
          >
            Upload ký tay
          </Link>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 mb-4 bg-slate-100 rounded-xl p-1 w-fit">
        <button
          onClick={() => setActiveTab("list")}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === "list" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
        >
          <FileText size={14} />
          Danh sách
        </button>
        <button
          onClick={() => setActiveTab("stats")}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === "stats" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
        >
          <BarChart2 size={14} />
          Thống kê
        </button>
      </div>

      {/* Tab Thống kê */}
      {activeTab === "stats" && <VanBanStats docs={docs} loading={loading} />}

      {/* Tab danh sách */}
      {activeTab === "list" && (<><FilterBar activeCount={aiMode ? 0 : [search, filterLoai, filterPhongBan, filterTrangThai].filter(Boolean).length}>
        <div className="flex flex-wrap gap-3 items-center w-full">
          {/* Toggle AI / Text search */}
          <button
            onClick={() => {
              setAiMode((v) => {
                if (!v) setTimeout(() => aiInputRef.current?.focus(), 50)
                return !v
              })
              setAiResults(null)
              setAiError(null)
            }}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-xl border transition-all ${
              aiMode
                ? "bg-violet-600 text-white border-violet-600 shadow"
                : "bg-white text-violet-600 border-violet-300 hover:bg-violet-50"
            }`}
            title={aiMode ? "Tắt tìm kiếm AI" : "Bật tìm kiếm AI"}
          >
            <Sparkles size={12} />
            {aiMode ? "AI đang bật" : "Tìm AI"}
          </button>

          {!aiMode && (
            <>
              <div className="relative flex-1 min-w-[200px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-blue-500"
                  placeholder="Tìm theo số, tên văn bản..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select
                className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-blue-500"
                value={filterLoai}
                onChange={(e) => setFilterLoai(e.target.value)}
              >
                <option value="">Tất cả loại</option>
                {LOAI_VAN_BAN_OPTIONS.map((code) => (
                  <option key={code} value={code}>{LOAI_VAN_BAN_LABEL[code]}</option>
                ))}
              </select>
              <select
                className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-blue-500"
                value={filterPhongBan}
                onChange={(e) => setFilterPhongBan(e.target.value)}
              >
                <option value="">Tất cả phòng ban</option>
                {PHONG_BAN_VAN_BAN_OPTIONS.map((pb) => (
                  <option key={pb} value={pb}>{pb}</option>
                ))}
              </select>
              <select
                className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-blue-500"
                value={filterTrangThai}
                onChange={(e) => setFilterTrangThai(e.target.value as VanBanTrangThai | "")}
              >
                <option value="">Tất cả trạng thái</option>
                {(Object.keys(TRANG_THAI_LABEL) as VanBanTrangThai[]).map((k) => (
                  <option key={k} value={k}>{TRANG_THAI_LABEL[k]}</option>
                ))}
              </select>
              {(search || filterLoai || filterPhongBan || filterTrangThai) && (
                <button
                  onClick={() => { setSearch(""); setFilterLoai(""); setFilterPhongBan(""); setFilterTrangThai("") }}
                  className="px-3 py-2 text-sm font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all"
                >
                  Xóa lọc
                </button>
              )}
            </>
          )}

          {/* AI search input */}
          {aiMode && (
            <div className="flex-1 flex items-center gap-2 min-w-[280px]">
              <div className="relative flex-1">
                <Sparkles size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-violet-400" />
                <input
                  ref={aiInputRef}
                  className="w-full pl-8 pr-3 py-2 border-2 border-violet-300 rounded-xl text-sm outline-none focus:border-violet-500 bg-violet-50"
                  placeholder="Mô tả nội dung văn bản cần tìm (VD: kế hoạch sản xuất quý 3)..."
                  value={aiQuery}
                  onChange={(e) => setAiQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void handleAiSearch()}
                />
              </div>
              <button
                onClick={() => void handleAiSearch()}
                disabled={aiSearching || !aiQuery.trim()}
                className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl transition-all"
              >
                {aiSearching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                Tìm kiếm
              </button>
              {aiResults !== null && (
                <button
                  onClick={() => { setAiResults(null); setAiQuery(""); setAiError(null) }}
                  className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
                  title="Xóa kết quả"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          )}
        </div>

        {aiMode && aiError && (
          <p className="text-xs text-red-600 font-medium flex items-center gap-1.5 w-full">
            <span className="text-red-500">⚠</span> {aiError}
          </p>
        )}
        {aiMode && (
          <p className="text-xs text-violet-500 w-full">
            AI tìm kiếm ngữ nghĩa trên văn bản đã phê duyệt. Nhập mô tả nội dung rồi nhấn Tìm kiếm hoặc Enter.
          </p>
        )}
      </FilterBar>

      {/* Kết quả AI */}
      {aiMode && aiResults !== null && (
        <ResponsiveTableWrapper className="border-violet-200 mb-4">
          <div className="px-4 py-3 bg-violet-50 border-b border-violet-100 flex items-center gap-2">
            <Sparkles size={14} className="text-violet-600" />
            <span className="text-sm font-bold text-violet-700">
              Kết quả tìm kiếm AI — {aiResults.length} văn bản phù hợp
            </span>
          </div>
          {aiResults.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <Sparkles size={40} className="mx-auto mb-3 opacity-30" />
              <p>Không tìm thấy văn bản phù hợp</p>
              <p className="text-xs mt-1">Thử mô tả khác hoặc kiểm tra lại chỉ mục AI</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Số văn bản</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Tên văn bản</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Loại</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Phòng ban</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Ngày phê duyệt</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Độ phù hợp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {aiResults.map((r) => (
                  <tr
                    key={r.id}
                    className="hover:bg-violet-50 transition-colors cursor-pointer"
                    onClick={() => { window.location.href = `/dashboard/documents/${r.id}` }}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">
                      {r.ma_van_ban || <span className="text-slate-300 italic">—</span>}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-800 max-w-xs">
                      <Link href={`/dashboard/documents/${r.id}`} className="hover:text-violet-700 line-clamp-2" onClick={(e) => e.stopPropagation()}>
                        {r.ten_van_ban}
                      </Link>
                      {r.mo_ta_tim_kiem && (
                        <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{r.mo_ta_tim_kiem}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-xs">
                      {r.loai_van_ban ? (LOAI_VAN_BAN_LABEL[r.loai_van_ban] || r.loai_van_ban) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-xs">
                      {r.phong_ban || <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {r.ngay_phe_duyet ? fmtDate(r.ngay_phe_duyet) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-bold ${
                        r.similarity >= 0.75 ? "bg-emerald-100 text-emerald-700" :
                        r.similarity >= 0.6 ? "bg-blue-100 text-blue-700" :
                        "bg-amber-100 text-amber-700"
                      }`}>
                        {Math.round(r.similarity * 100)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ResponsiveTableWrapper>
      )}

      {/* Bảng danh sách thường */}
      {(!aiMode || aiResults === null) && (
        <ResponsiveTableWrapper>
          {loading ? (
            <div className="p-12 text-center text-slate-400">Đang tải...</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <FileText size={40} className="mx-auto mb-3 opacity-30" />
              <p>Không có văn bản nào</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Số văn bản</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Tên văn bản</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Loại</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Phòng ban</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Trạng thái</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Ngày phê duyệt</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((doc) => (
                  <tr key={doc.id} className="hover:bg-slate-50 transition-colors cursor-pointer" onClick={() => window.location.href = `/dashboard/documents/${doc.id}`}>
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">
                      {doc.ma_van_ban || <span className="text-slate-300 italic">—</span>}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-800 max-w-xs truncate">
                      <Link href={`/dashboard/documents/${doc.id}`} className="hover:text-blue-700" onClick={(e) => e.stopPropagation()}>
                        {doc.ten_van_ban}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {doc.loai_van_ban ? (LOAI_VAN_BAN_LABEL[doc.loai_van_ban] || doc.loai_van_ban) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {doc.phong_ban || <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-bold ${TRANG_THAI_COLOR[doc.trang_thai] || "bg-slate-100 text-slate-600"}`}>
                        {TRANG_THAI_LABEL[doc.trang_thai] || doc.trang_thai}
                      </span>
                      {doc.is_uploaded && (
                        <span className="ml-1.5 inline-flex px-2 py-0.5 rounded-full text-xs font-bold bg-sky-100 text-sky-700">Ký tay</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {doc.ngay_phe_duyet ? fmtDate(doc.ngay_phe_duyet) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {doc.file_signed_pdf_url && (
                          <a
                            href={doc.file_signed_pdf_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-all"
                          >
                            <Eye size={12} />
                            Xem
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ResponsiveTableWrapper>
      )}

      {!aiMode && (
        <p className="text-xs text-slate-400 mt-2 text-right">
          {filtered.length} / {docs.length} văn bản
        </p>
      )}
      </>)}
    </DocumentsShell>
  )
}

// ─── VanBanStats ─────────────────────────────────────────────────────────────

function VanBanStats({ docs, loading }: { docs: VanBanDocument[]; loading: boolean }) {
  if (loading) {
    return <div className="p-12 text-center text-slate-400">Đang tải thống kê...</div>
  }

  const total = docs.length
  const byStatus: Record<string, number> = {}
  const byLoai: Record<string, number> = {}
  const byPhongBan: Record<string, number> = {}
  const byMonth: Record<string, number> = {}

  for (const d of docs) {
    byStatus[d.trang_thai] = (byStatus[d.trang_thai] || 0) + 1
    const loai = d.loai_van_ban || "—"
    byLoai[loai] = (byLoai[loai] || 0) + 1
    const pb = d.phong_ban || "—"
    byPhongBan[pb] = (byPhongBan[pb] || 0) + 1
    if (d.created_at) {
      const ym = d.created_at.substring(0, 7)
      byMonth[ym] = (byMonth[ym] || 0) + 1
    }
  }

  const daPheduyet = byStatus["da_phe_duyet"] || 0
  const dangXuLy = (byStatus["cho_ky_phong_ban"] || 0) + (byStatus["cho_phe_duyet"] || 0)
  const nhap = byStatus["draft"] || 0
  const traVe = byStatus["tra_ve"] || 0

  const kpiCards = [
    { label: "Tổng văn bản", value: total, color: "bg-blue-50 text-blue-700 border-blue-200" },
    { label: "Đã phê duyệt", value: daPheduyet, color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    { label: "Đang xử lý", value: dangXuLy, color: "bg-amber-50 text-amber-700 border-amber-200" },
    { label: "Nháp", value: nhap, color: "bg-slate-50 text-slate-600 border-slate-200" },
    { label: "Trả về", value: traVe, color: "bg-red-50 text-red-600 border-red-200" },
  ]

  const sortedMonths = Object.keys(byMonth).sort().reverse().slice(0, 6).reverse()
  const maxMonth = Math.max(...sortedMonths.map((m) => byMonth[m]), 1)

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {kpiCards.map((k) => (
          <div key={k.label} className={`rounded-xl border p-4 ${k.color}`}>
            <p className="text-xs font-bold opacity-70 mb-1">{k.label}</p>
            <p className="text-3xl font-extrabold">{k.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Theo tháng */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">
            Văn bản theo tháng (6 gần nhất)
          </p>
          {sortedMonths.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">Chưa có dữ liệu</p>
          ) : (
            <div className="space-y-2">
              {sortedMonths.map((ym) => {
                const pct = Math.round((byMonth[ym] / maxMonth) * 100)
                const [y, m] = ym.split("-")
                return (
                  <div key={ym} className="flex items-center gap-3">
                    <span className="text-xs text-slate-500 w-14 shrink-0">{m}/{y}</span>
                    <div className="flex-1 bg-slate-100 rounded-full h-5 relative overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs font-bold text-slate-700 w-6 text-right">{byMonth[ym]}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Theo loại */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Theo loại văn bản</p>
          <div className="space-y-1.5">
            {Object.entries(byLoai)
              .sort((a, b) => b[1] - a[1])
              .map(([loai, count]) => (
                <div key={loai} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">
                    {LOAI_VAN_BAN_LABEL[loai] || loai}
                  </span>
                  <span className="font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-full text-xs">
                    {count}
                  </span>
                </div>
              ))}
            {Object.keys(byLoai).length === 0 && (
              <p className="text-sm text-slate-400 text-center py-4">Chưa có dữ liệu</p>
            )}
          </div>
        </div>

        {/* Theo phòng ban */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Theo phòng ban</p>
          <div className="space-y-1.5">
            {Object.entries(byPhongBan)
              .sort((a, b) => b[1] - a[1])
              .map(([pb, count]) => (
                <div key={pb} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">{pb}</span>
                  <span className="font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-full text-xs">
                    {count}
                  </span>
                </div>
              ))}
            {Object.keys(byPhongBan).length === 0 && (
              <p className="text-sm text-slate-400 text-center py-4">Chưa có dữ liệu</p>
            )}
          </div>
        </div>
      </div>

      {/* Theo trạng thái - bảng đầy đủ */}
      <ResponsiveTableWrapper>
        <div className="px-4 py-3 border-b border-slate-100">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Chi tiết theo trạng thái</p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="text-left px-4 py-2 text-xs font-bold text-slate-500">Trạng thái</th>
              <th className="text-right px-4 py-2 text-xs font-bold text-slate-500">Số lượng</th>
              <th className="text-right px-4 py-2 text-xs font-bold text-slate-500">Tỷ lệ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {Object.entries(byStatus)
              .sort((a, b) => b[1] - a[1])
              .map(([st, cnt]) => (
                <tr key={st}>
                  <td className="px-4 py-2">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-bold ${TRANG_THAI_COLOR[st as VanBanTrangThai] || "bg-slate-100 text-slate-600"}`}>
                      {TRANG_THAI_LABEL[st as VanBanTrangThai] || st}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right font-bold text-slate-800">{cnt}</td>
                  <td className="px-4 py-2 text-right text-slate-500">
                    {total > 0 ? `${Math.round((cnt / total) * 100)}%` : "—"}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </ResponsiveTableWrapper>
    </div>
  )
}
