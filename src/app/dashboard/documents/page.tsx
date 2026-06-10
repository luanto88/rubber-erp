"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
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
import { FileText, Search, Eye } from "lucide-react"
import Link from "next/link"

export default function DocumentsPage() {
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [docs, setDocs] = useState<VanBanDocument[]>([])

  const [search, setSearch] = useState("")
  const [filterLoai, setFilterLoai] = useState("")
  const [filterTrangThai, setFilterTrangThai] = useState<VanBanTrangThai | "">("")
  const [filterPhongBan, setFilterPhongBan] = useState("")

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

      {/* Bộ lọc */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-center">
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
      </div>

      {/* Bảng */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
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
      </div>

      <p className="text-xs text-slate-400 mt-2 text-right">
        {filtered.length} / {docs.length} văn bản
      </p>
    </DocumentsShell>
  )
}
