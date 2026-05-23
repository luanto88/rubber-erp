"use client"

import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId } from "@/lib/auth"
import { IsoShell } from "../_components/iso-shell"
import {
  TRANG_THAI_LABEL,
  TRANG_THAI_COLOR,
  LOAI_TAI_LIEU_OPTIONS,
  fmtDate,
  type IsoDocument,
  type IsoTrangThai,
} from "../_components/iso-types"
import { Plus, Search, FileText, Eye, Filter } from "lucide-react"
import Link from "next/link"

export default function IsoDocumentsPage() {
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [docs, setDocs] = useState<IsoDocument[]>([])

  // Bộ lọc
  const [search, setSearch] = useState("")
  const [filterLoai, setFilterLoai] = useState("")
  const [filterTrangThai, setFilterTrangThai] = useState<IsoTrangThai | "">("")
  const [filterCap, setFilterCap] = useState("")

  const loadData = useCallback(async (fid: string) => {
    setLoading(true)
    try {
      const { data } = await supabase
        .from("iso_documents")
        .select(
          "id, ma_tai_lieu, ten_tai_lieu, loai_tai_lieu, phong_ban, cap_tl, loai_vb, lan_ban_hanh, trang_thai, soan_thao, phe_duyet, ngay_hieu_luc, updated_at, created_at",
        )
        .eq("factory_id", fid)
        .order("updated_at", { ascending: false })
      setDocs((data || []) as IsoDocument[])
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

  const filtered = docs.filter((d) => {
    const q = search.toLowerCase()
    if (q && !d.ma_tai_lieu?.toLowerCase().includes(q) && !d.ten_tai_lieu.toLowerCase().includes(q)) return false
    if (filterLoai && d.loai_tai_lieu !== filterLoai) return false
    if (filterTrangThai && d.trang_thai !== filterTrangThai) return false
    if (filterCap && d.cap_tl !== filterCap) return false
    return true
  })

  const trangThaiOptions: { value: IsoTrangThai | ""; label: string }[] = [
    { value: "", label: "Tất cả trạng thái" },
    { value: "draft", label: "Nháp" },
    { value: "cho_xem_xet", label: "Chờ xem xét" },
    { value: "cho_phe_duyet", label: "Chờ phê duyệt" },
    { value: "co_hieu_luc", label: "Có hiệu lực" },
    { value: "het_hieu_luc", label: "Hết hiệu lực" },
    { value: "tra_ve", label: "Trả về" },
  ]

  return (
    <IsoShell>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800">Tài liệu ISO</h1>
            <p className="text-sm text-slate-500 mt-0.5">Quy trình, hướng dẫn, biểu mẫu và tiêu chuẩn</p>
          </div>
          <Link
            href="/dashboard/iso/documents/new"
            className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-xl shadow-md transition-all"
          >
            <Plus size={16} /> Tạo tài liệu
          </Link>
        </div>

        {/* Bộ lọc */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Tìm mã, tên tài liệu..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
            />
          </div>
          <select
            value={filterLoai}
            onChange={(e) => setFilterLoai(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
          >
            <option value="">Tất cả loại</option>
            {LOAI_TAI_LIEU_OPTIONS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
          <select
            value={filterTrangThai}
            onChange={(e) => setFilterTrangThai(e.target.value as IsoTrangThai | "")}
            className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
          >
            {trangThaiOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select
            value={filterCap}
            onChange={(e) => setFilterCap(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
          >
            <option value="">Tất cả cấp</option>
            <option value="Cấp 1">Cấp 1</option>
            <option value="Cấp 2">Cấp 2</option>
          </select>
        </div>

        {/* Bảng danh sách */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-10 text-center text-slate-400 text-sm">Đang tải...</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center">
              <FileText size={36} className="mx-auto mb-2 text-slate-300" />
              <p className="text-sm text-slate-400">
                {docs.length === 0 ? "Chưa có tài liệu nào" : "Không có kết quả phù hợp"}
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-100">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Mã tài liệu</th>
                  <th className="px-4 py-3 text-left font-semibold">Tên tài liệu</th>
                  <th className="px-4 py-3 text-left font-semibold hidden sm:table-cell">Loại</th>
                  <th className="px-4 py-3 text-left font-semibold hidden md:table-cell">Lần BH</th>
                  <th className="px-4 py-3 text-left font-semibold hidden lg:table-cell">Cấp</th>
                  <th className="px-4 py-3 text-left font-semibold">Trạng thái</th>
                  <th className="px-4 py-3 text-left font-semibold hidden xl:table-cell">Ngày HLực</th>
                  <th className="px-4 py-3 text-right font-semibold">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((doc) => (
                  <tr key={doc.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-violet-700 font-bold">
                        {doc.ma_tai_lieu || "—"}
                      </span>
                      {doc.loai_vb === "Mật" && (
                        <span className="ml-1 px-1.5 py-0.5 bg-red-100 text-red-600 text-[10px] font-bold rounded">Mật</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-700 line-clamp-1">{doc.ten_tai_lieu}</div>
                      {doc.soan_thao && (
                        <div className="text-xs text-slate-400 mt-0.5">ST: {doc.soan_thao}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="px-2 py-0.5 bg-violet-50 text-violet-700 rounded-md text-xs font-bold">
                        {doc.loai_tai_lieu || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-center text-slate-600 text-xs font-mono">
                      {doc.lan_ban_hanh}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-xs text-slate-500">
                      {doc.cap_tl || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${TRANG_THAI_COLOR[doc.trang_thai]}`}>
                        {TRANG_THAI_LABEL[doc.trang_thai]}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden xl:table-cell text-xs text-slate-500">
                      {fmtDate(doc.ngay_hieu_luc)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/dashboard/iso/documents/${doc.id}`}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-violet-100 text-slate-600 hover:text-violet-700 text-xs font-bold rounded-lg transition-all"
                      >
                        <Eye size={12} /> Chi tiết
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {filtered.length > 0 && (
            <div className="px-4 py-2.5 border-t border-slate-100 text-xs text-slate-400">
              Hiển thị {filtered.length} / {docs.length} tài liệu
            </div>
          )}
        </div>
      </div>
    </IsoShell>
  )
}
