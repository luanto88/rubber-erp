"use client"

import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, getFreshAuthSession } from "@/lib/auth"
import { IsoShell } from "../_components/iso-shell"
import {
  TRANG_THAI_LABEL,
  TRANG_THAI_COLOR,
  LOAI_TAI_LIEU_OPTIONS,
  ISO_STANDARD_FALLBACK,
  isoDocumentTypeFallback,
  fmtDate,
  type IsoDocument,
  type IsoDocumentTypeMaster,
  type IsoStandard,
  type IsoTrangThai,
} from "../_components/iso-types"
import { Plus, Search, FileText, Eye, ChevronDown, CheckCircle2, XCircle, Pencil, Trash2 } from "lucide-react"
import Link from "next/link"

export default function IsoDocumentsPage() {
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [userRole, setUserRole] = useState("")
  const [loading, setLoading] = useState(true)
  const [docs, setDocs] = useState<IsoDocument[]>([])
  const [delConfirm, setDelConfirm] = useState<string | null>(null)
  const [standards, setStandards] = useState<IsoStandard[]>(ISO_STANDARD_FALLBACK)
  const [docTypes, setDocTypes] = useState<IsoDocumentTypeMaster[]>(isoDocumentTypeFallback())
  const [expandedParents, setExpandedParents] = useState<Record<string, boolean>>({})

  // Bộ lọc
  const [search, setSearch] = useState("")
  const [filterLoai, setFilterLoai] = useState("")
  const [filterTrangThai, setFilterTrangThai] = useState<IsoTrangThai | "">("")
  const [filterCap, setFilterCap] = useState("")
  const [filterStandard, setFilterStandard] = useState("")
  const [filterPhongBan, setFilterPhongBan] = useState("")

  const loadData = useCallback(async (fid: string) => {
    setLoading(true)
    try {
      const [docRes, standardRes, typeRes] = await Promise.all([
        supabase
        .from("iso_documents")
        .select(
          "id, ma_tai_lieu, ten_tai_lieu, loai_tai_lieu, phong_ban, cap_tl, loai_vb, lan_ban_hanh, trang_thai, soan_thao, soan_thao_user_id, phe_duyet, ngay_hieu_luc, phan_loai_tl, parent_doc_id, updated_at, created_at",
        )
        .eq("factory_id", fid)
        .order("updated_at", { ascending: false }),
        supabase.from("iso_standards").select("id, tieu_chuan, ten_tieu_chuan, is_active, sort_order").eq("is_active", true).order("sort_order"),
        supabase.from("iso_document_types").select("code, name, can_parent, can_child, force_child, allowed_departments, is_active, sort_order").eq("is_active", true).order("sort_order"),
      ])
      const rows = (docRes.data || []) as IsoDocument[]
      const standardList = !standardRes.error && standardRes.data?.length ? standardRes.data as IsoStandard[] : ISO_STANDARD_FALLBACK
      if (!standardRes.error && standardRes.data?.length) setStandards(standardList)
      if (!typeRes.error && typeRes.data?.length) setDocTypes(typeRes.data as IsoDocumentTypeMaster[])

      const ids = rows.map((d) => d.id)
      const { data: links } = ids.length > 0
        ? await supabase.from("iso_document_standards").select("doc_id, standard_id").in("doc_id", ids).eq("factory_id", fid)
        : { data: [] as { doc_id: string; standard_id: number }[] }
      const standardById = new Map(standardList.map((s) => [s.id, s]))
      const standardsByDoc = new Map<string, IsoStandard[]>()
      for (const link of (links || []) as { doc_id: string; standard_id: number }[]) {
        const standard = standardById.get(link.standard_id)
        if (!standard) continue
        standardsByDoc.set(link.doc_id, [...(standardsByDoc.get(link.doc_id) || []), standard])
      }
      setDocs(rows.map((row) => ({ ...row, standards: standardsByDoc.get(row.id) || [] })))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const bootstrap = async () => {
      const fid = await getActiveFactoryId()
      if (!fid) { setLoading(false); return }
      const session = await getFreshAuthSession()
      const uid = session?.user?.id
      if (uid) {
        setUserId(uid)
        const { data: prof } = await supabase.from("profiles").select("role").eq("id", uid).single()
        if (prof) setUserRole(prof.role || "")
      }
      setFactoryId(fid)
    }
    void bootstrap()
  }, [])

  useEffect(() => {
    if (factoryId) void loadData(factoryId)
  }, [factoryId, loadData])

  const handleDeleteDoc = async (docId: string) => {
    if (!factoryId) return
    await supabase.from("iso_documents").delete().eq("id", docId)
    setDelConfirm(null)
    void loadData(factoryId)
  }

  const filtered = docs.filter((d) => {
    const q = search.toLowerCase()
    if (q && !d.ma_tai_lieu?.toLowerCase().includes(q) && !d.ten_tai_lieu.toLowerCase().includes(q)) return false
    if (filterStandard && !(d.standards || []).some((s) => String(s.id) === filterStandard)) return false
    if (filterLoai && d.loai_tai_lieu !== filterLoai) return false
    if (filterTrangThai && d.trang_thai !== filterTrangThai) return false
    if (filterCap && d.cap_tl !== filterCap) return false
    if (filterPhongBan && d.phong_ban !== filterPhongBan) return false
    return true
  })
  const phongBanOptions = useMemo(
    () => [...new Set(docs.map((d) => d.phong_ban).filter((pb): pb is string => !!pb))].sort(),
    [docs],
  )
  const isChildDoc = (item: IsoDocument) => item.phan_loai_tl === "con" || !!item.parent_doc_id
  const docById = filtered.reduce<Record<string, IsoDocument>>((acc, item) => {
    acc[item.id] = item
    return acc
  }, {})
  // Suy ra mã cha từ mã con: PHK-QT02-F01 + "F" → PHK-QT02
  const inferParentCode = (ma: string, loai: string | null | undefined): string | null => {
    if (!ma || !loai) return null
    const maCha = ma.replace(new RegExp(`-${loai}\\d+$`, "i"), "")
    return maCha !== ma ? maCha : null
  }
  const resolveParentId = (item: IsoDocument): string | null => {
    if (item.parent_doc_id) return docById[item.parent_doc_id] ? item.parent_doc_id : null
    const maCha = inferParentCode(item.ma_tai_lieu || "", item.loai_tai_lieu)
    if (!maCha) return null
    return filtered.find((d) => d.ma_tai_lieu === maCha && !isChildDoc(d))?.id ?? null
  }
  const shouldNestChild = (item: IsoDocument) => !isChildDoc(item) ? false : !!resolveParentId(item)
  const parentRows = filtered.filter((item) => !isChildDoc(item) || !shouldNestChild(item))
  const childrenByParent = filtered
    .filter((item) => shouldNestChild(item))
    .reduce<Record<string, IsoDocument[]>>((acc, item) => {
      const parentId = resolveParentId(item)
      if (parentId) acc[parentId] = [...(acc[parentId] || []), item]
      return acc
    }, {})
  const renderStatusBadge = (status: IsoTrangThai) => {
    if (status === "co_hieu_luc") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700 shadow-sm">
          <CheckCircle2 size={12} /> Có hiệu lực
        </span>
      )
    }
    if (status === "het_hieu_luc") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-1 text-xs font-bold text-red-700 shadow-sm">
          <XCircle size={12} /> Hết hiệu lực
        </span>
      )
    }
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${TRANG_THAI_COLOR[status]}`}>
        {TRANG_THAI_LABEL[status]}
      </span>
    )
  }

  const trangThaiOptions: { value: IsoTrangThai | ""; label: string }[] = [
    { value: "", label: "Tất cả trạng thái" },
    { value: "draft", label: "Nháp" },
    { value: "cho_xem_xet", label: "Chờ xem xét" },
    { value: "cho_phe_duyet", label: "Chờ phê duyệt" },
    { value: "co_hieu_luc", label: "Có hiệu lực" },
    { value: "het_hieu_luc", label: "Hết hiệu lực" },
    { value: "tra_ve", label: "Trả về" },
    { value: "bi_tu_choi_phe_duyet", label: "Phê duyệt từ chối" },
  ]
  const typeOptions = docTypes.length > 0 ? docTypes.map((type) => type.code) : [...LOAI_TAI_LIEU_OPTIONS]

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
            href="/dashboard/iso/documents/new-doc"
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
            value={filterStandard}
            onChange={(e) => setFilterStandard(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
          >
            <option value="">Tất cả tiêu chuẩn</option>
            {standards.map((standard) => (
              <option key={standard.id} value={standard.id}>{standard.tieu_chuan}</option>
            ))}
          </select>
          <select
            value={filterLoai}
            onChange={(e) => setFilterLoai(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
          >
            <option value="">Tất cả loại</option>
            {typeOptions.map((l) => (
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
          <select
            value={filterPhongBan}
            onChange={(e) => setFilterPhongBan(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
          >
            <option value="">Tất cả phòng ban</option>
            {phongBanOptions.map((pb) => (
              <option key={pb} value={pb}>{pb}</option>
            ))}
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
                  <th className="px-4 py-3 text-left font-semibold hidden md:table-cell">Phòng ban</th>
                  <th className="px-4 py-3 text-left font-semibold hidden lg:table-cell">Lần BH</th>
                  <th className="px-4 py-3 text-left font-semibold hidden lg:table-cell">Cấp</th>
                  <th className="px-4 py-3 text-left font-semibold">Trạng thái</th>
                  <th className="px-4 py-3 text-left font-semibold hidden xl:table-cell">Ngày HLực</th>
                  <th className="px-4 py-3 text-right font-semibold">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {parentRows.map((doc) => {
                  const childRows = childrenByParent[doc.id] || []
                  const isExpanded = !!expandedParents[doc.id]
                  return (
                  <Fragment key={doc.id}>
                  <tr key={doc.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {childRows.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => setExpandedParents((prev) => ({ ...prev, [doc.id]: !prev[doc.id] }))}
                            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-violet-700"
                            title="Xem hồ sơ con"
                          >
                            <ChevronDown size={14} className={`transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                          </button>
                        ) : (
                          <span className="w-6" />
                        )}
                        <span className="font-mono text-xs text-violet-700 font-bold">
                          {doc.ma_tai_lieu || "—"}
                        </span>
                      </div>
                      {doc.loai_vb === "Mật" && (
                        <span className="ml-1 px-1.5 py-0.5 bg-red-100 text-red-600 text-[10px] font-bold rounded">Mật</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-700 line-clamp-1">{doc.ten_tai_lieu}</div>
                      {doc.soan_thao && (
                        <div className="text-xs text-slate-400 mt-0.5">ST: {doc.soan_thao}</div>
                      )}
                      {(doc.standards || []).length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {(doc.standards || []).map((standard) => (
                            <span key={standard.id} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                              {standard.tieu_chuan}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="px-2 py-0.5 bg-violet-50 text-violet-700 rounded-md text-xs font-bold">
                        {doc.loai_tai_lieu || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-xs text-slate-500">
                      {doc.phong_ban || "—"}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-center text-slate-600 text-xs font-mono">
                      {doc.lan_ban_hanh}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-xs text-slate-500">
                      {doc.cap_tl || "—"}
                    </td>
                    <td className="px-4 py-3">
                      {renderStatusBadge(doc.trang_thai)}
                    </td>
                    <td className="px-4 py-3 hidden xl:table-cell text-xs text-slate-500">
                      {fmtDate(doc.ngay_hieu_luc)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {(() => {
                        const isAdmin = userRole === "admin"
                        const canEditDoc = (doc.trang_thai === "draft" && doc.soan_thao_user_id === userId) || isAdmin
                        const canDeleteDoc = (doc.trang_thai === "draft" && doc.soan_thao_user_id === userId) || isAdmin
                        return (
                          <div className="inline-flex items-center gap-1">
                            <Link
                              href={`/dashboard/iso/documents/${doc.id}`}
                              title="Xem chi tiết"
                              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
                            >
                              <Eye size={14} />
                            </Link>
                            {canEditDoc && (
                              <Link
                                href={`/dashboard/iso/documents/${doc.id}`}
                                title="Sửa"
                                className="p-1.5 rounded-lg hover:bg-violet-100 text-slate-400 hover:text-violet-600 transition-colors"
                              >
                                <Pencil size={14} />
                              </Link>
                            )}
                            {canDeleteDoc && (
                              <button
                                title="Xóa"
                                onClick={() => setDelConfirm(doc.id)}
                                className="p-1.5 rounded-lg hover:bg-red-100 text-slate-400 hover:text-red-600 transition-colors"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        )
                      })()}
                    </td>
                  </tr>
                  {isExpanded && childRows.map((child) => (
                    <tr key={child.id} className="bg-slate-50/70 hover:bg-slate-100 transition-colors">
                      <td className="px-4 py-3 pl-12">
                        <span className="font-mono text-xs font-bold text-sky-700">{child.ma_tai_lieu || "—"}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-700 line-clamp-1">{child.ten_tai_lieu}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">Hồ sơ con</div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className="px-2 py-0.5 bg-sky-50 text-sky-700 rounded-md text-xs font-bold">
                          {child.loai_tai_lieu || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-xs text-slate-500">{child.phong_ban || doc.phong_ban || "—"}</td>
                      <td className="px-4 py-3 hidden lg:table-cell text-center text-slate-600 text-xs font-mono">{child.lan_ban_hanh}</td>
                      <td className="px-4 py-3 hidden lg:table-cell text-xs text-slate-500">{child.cap_tl || doc.cap_tl || "—"}</td>
                      <td className="px-4 py-3">{renderStatusBadge(child.trang_thai)}</td>
                      <td className="px-4 py-3 hidden xl:table-cell text-xs text-slate-500">{fmtDate(child.ngay_hieu_luc)}</td>
                      <td className="px-4 py-3 text-right">
                        {(() => {
                          const isAdmin = userRole === "admin"
                          const canEditChild = (child.trang_thai === "draft" && child.soan_thao_user_id === userId) || isAdmin
                          const canDeleteChild = (child.trang_thai === "draft" && child.soan_thao_user_id === userId) || isAdmin
                          return (
                            <div className="inline-flex items-center gap-1">
                              <Link
                                href={`/dashboard/iso/documents/${child.id}`}
                                title="Xem chi tiết"
                                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors"
                              >
                                <Eye size={14} />
                              </Link>
                              {canEditChild && (
                                <Link
                                  href={`/dashboard/iso/documents/${child.id}`}
                                  title="Sửa"
                                  className="p-1.5 rounded-lg hover:bg-violet-100 text-slate-400 hover:text-violet-600 transition-colors"
                                >
                                  <Pencil size={14} />
                                </Link>
                              )}
                              {canDeleteChild && (
                                <button
                                  title="Xóa"
                                  onClick={() => setDelConfirm(child.id)}
                                  className="p-1.5 rounded-lg hover:bg-red-100 text-slate-400 hover:text-red-600 transition-colors"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          )
                        })()}
                      </td>
                    </tr>
                  ))}
                  </Fragment>
                  )
                })}
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

      {/* Delete confirm dialog */}
      {delConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-80">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-red-100 rounded-xl"><Trash2 size={18} className="text-red-600" /></div>
              <h3 className="font-bold text-slate-800">Xóa tài liệu?</h3>
            </div>
            <p className="text-sm text-slate-600 mb-5">Hành động này không thể hoàn tác. Tài liệu và file liên quan sẽ bị xóa vĩnh viễn.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDelConfirm(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
                Hủy
              </button>
              <button
                onClick={() => void handleDeleteDoc(delConfirm)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl"
              >
                Xóa
              </button>
            </div>
          </div>
        </div>
      )}
    </IsoShell>
  )
}
