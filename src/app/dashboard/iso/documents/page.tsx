"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, getFreshAuthSession, hasPermission, type SessionUser } from "@/lib/auth"
import { IsoShell } from "../_components/iso-shell"
import { FilterBar } from "../../_components/filter-bar"
import { ResponsiveTableWrapper } from "../../_components/responsive-table-wrapper"
import { ModalShell } from "../../_components/modal-shell"
import {
  LOAI_TAI_LIEU_OPTIONS,
  ISO_STANDARD_FALLBACK,
  isoDocumentTypeFallback,
  fmtDate,
  type IsoDocument,
  type IsoDocumentTypeMaster,
  type IsoStandard,
  type IsoTrangThai,
} from "../_components/iso-types"
import { canOpenIsoFile, EXPIRED_FILE_HINT } from "../_components/iso-file-access"
import { Plus, Search, FileText, Eye, Pencil, Trash2, Share2, ChevronUp, Download, FileSignature, ShieldCheck } from "lucide-react"
import Link from "next/link"
import { DistributionModal } from "../_components/distribution-modal"
import { DistributionManagement } from "../_components/distribution-management"
import { PageHeaderBanner } from "../../_components/page-header-banner"
import { PageBackgroundMotif } from "../../_components/page-background-motif"
// Vá bảo mật 2026-09-20: bucket iso-documents đang chuyển private — mint Signed URL qua route
// xác thực thay vì đọc thẳng cột file_*_url public.
import { fetchSecureUrl, openSecureFile } from "../../_components/secure-file-open"
import { canCreateIsoDocument, canSeeIsoDocInLibrary, canViewIsoLibrary, isIsoDocParticipant, readCachedIsoUser } from "../_components/iso-access"
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"
import { ExpandableRow, ExpandHeaderCell, ExpandAllToggle } from "@/app/dashboard/_components/doc-ui/expandable-row"
import { DocCodePill } from "@/app/dashboard/_components/doc-ui/doc-code-pill"

export default function IsoDocumentsPage() {
  const router = useRouter()

  // Vá bảo mật 2026-09-20: mint Signed URL cho file TRƯỚC khi điều hướng sang màn Cài đặt vị
  // trí ký (trang đó tự render PDF qua pdfjs, tự fetch(pdfUrl) trong trình duyệt) — thay vì
  // truyền thẳng URL public như trước.
  const goToMauViTri = async (targetId: string, loaiTaiLieu: string) => {
    const result = await fetchSecureUrl(`/api/iso/documents/${targetId}/file-url?variant=main`)
    if (!result.ok) {
      alert(result.error)
      return
    }
    router.push(
      `/dashboard/ky/mau-vi-tri?modun=iso&docId=${targetId}&loaiTaiLieu=${encodeURIComponent(loaiTaiLieu)}&pdfUrl=${encodeURIComponent(result.url)}&returnTo=${encodeURIComponent("/dashboard/iso/documents")}`,
    )
  }

  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [userRole, setUserRole] = useState("")
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [docs, setDocs] = useState<IsoDocument[]>([])
  const [delConfirm, setDelConfirm] = useState<string | null>(null)
  const [standards, setStandards] = useState<IsoStandard[]>(ISO_STANDARD_FALLBACK)
  const [docTypes, setDocTypes] = useState<IsoDocumentTypeMaster[]>(isoDocumentTypeFallback())
  const [expandedParents, setExpandedParents] = useState<Record<string, boolean>>({})
  const [canDistribute, setCanDistribute] = useState(false)
  const [canCreate, setCanCreate] = useState(false)
  const [showDistributeModal, setShowDistributeModal] = useState(false)
  const [distributeDocId, setDistributeDocId] = useState<string | undefined>(undefined)
  const [showManagement, setShowManagement] = useState(false)

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
          "id, ma_tai_lieu, ten_tai_lieu, loai_tai_lieu, phong_ban, cap_tl, loai_vb, lan_ban_hanh, trang_thai, soan_thao, soan_thao_user_id, created_by, xem_xet_user_id, phe_duyet_user_id, phe_duyet, ngay_hieu_luc, phan_loai_tl, parent_doc_id, updated_at, created_at, file_signed_pdf_url, file_signed_office_url, file_goc_url",
        )
        .eq("factory_id", fid)
        .order("updated_at", { ascending: false }),
        supabase.from("iso_standards").select("id, tieu_chuan, ten_tieu_chuan, is_active, sort_order").eq("is_active", true).order("sort_order"),
        supabase.from("iso_document_types").select("code, name, can_parent, can_child, force_child, allowed_departments, is_active, sort_order").eq("is_active", true).order("sort_order"),
      ])
      // GĐ3 (sau test): lọc theo trạng thái — có hiệu lực ai cũng thấy; hết hiệu lực cần
      // iso.view_het_hieu_luc hoặc đã tham gia; nháp/đang luân chuyển chỉ người tham gia.
      const allRows = (docRes.data || []) as IsoDocument[]
      const viewer = readCachedIsoUser()
      const session = await getFreshAuthSession()
      const viewerId = session?.user?.id ?? null
      const participantDocIds = new Set(allRows.filter((d) => isIsoDocParticipant(d, viewerId)).map((d) => d.id))
      const rows = allRows.filter((d) => canSeeIsoDocInLibrary(d, viewer, viewerId, participantDocIds))
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
      // GĐ3: kho tài liệu toàn nhà máy cần iso.view_library — chặn cả khi dán URL trực tiếp.
      const accessUser = readCachedIsoUser()
      if (!canViewIsoLibrary(accessUser)) {
        router.replace("/dashboard/iso/my-tasks")
        return
      }
      setCanCreate(canCreateIsoDocument(accessUser))
      const fid = await getActiveFactoryId()
      if (!fid) { setLoading(false); return }
      const session = await getFreshAuthSession()
      const uid = session?.user?.id
      if (uid) {
        setUserId(uid)
        // Cache session (đã gồm mảng permissions) — mirror đúng cách trang chi tiết ISO đang
        // làm. Quyền vừa được admin cấp chỉ có hiệu lực sau khi tải lại trang, vì chỉ bootstrap
        // của dashboard/layout.tsx mới gọi hydrateActiveSession() làm mới cache này.
        const cachedUser = JSON.parse(localStorage.getItem("erp_user") || "{}") as SessionUser
        setUser(cachedUser)
        const profRes = await supabase.from("profiles").select("role").eq("id", uid).single()
        if (profRes.data) setUserRole(profRes.data.role || "")
        // Dùng danh sách quyền hiệu lực trong cache session (đã gộp user_permissions đã cấp +
        // role_permissions) thay vì đọc thẳng user_permissions — cách cũ bỏ qua quyền cấp theo
        // vai trò và không xét cột `granted` (quyền đã thu hồi vẫn hiện nút).
        setCanDistribute(
          profRes.data?.role === "admin" ||
          (Array.isArray(cachedUser.permissions) && cachedUser.permissions.includes("iso.distribute")),
        )
      }
      setFactoryId(fid)
    }
    void bootstrap()
  }, [router])

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
  const renderCapBadge = (cap: string | null | undefined) => {
    if (!cap) return <span className="text-slate-300">—</span>
    if (cap === "Cấp 1") {
      return (
        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200/80">
          Cấp 1
        </span>
      )
    }
    if (cap === "Cấp 2") {
      return (
        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
          Cấp 2
        </span>
      )
    }
    return (
      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200/80">
        {cap}
      </span>
    )
  }

  const renderLoaiBadge = (loai: string | null | undefined) => {
    if (!loai) return <span className="text-slate-300">—</span>
    const u = loai.toUpperCase()
    if (u === "F" || u === "BM" || u.includes("BIỂU MẪU")) {
      return (
        <span className="inline-flex px-2 py-0.5 rounded-md text-xs font-bold bg-brand-50 text-brand-700 border border-brand-200/80">
          {loai}
        </span>
      )
    }
    if (u === "QT" || u.includes("QUY TRÌNH")) {
      return (
        <span className="inline-flex px-2 py-0.5 rounded-md text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">
          {loai}
        </span>
      )
    }
    if (u === "HD" || u.includes("HƯỚNG DẪN")) {
      return (
        <span className="inline-flex px-2 py-0.5 rounded-md text-xs font-bold bg-brand-50 text-brand-800 border border-brand-200/80">
          {loai}
        </span>
      )
    }
    return (
      <span className="inline-flex px-2 py-0.5 rounded-md text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200/80">
        {loai}
      </span>
    )
  }

  // Doc-UI: badge trạng thái dùng chung (status-registry.ts).
  const renderStatusBadge = (status: IsoTrangThai) => <StatusBadge domain="iso" status={status} />

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
        <PageBackgroundMotif theme="rubber" />
        <PageHeaderBanner
          title="Tài liệu ISO"
          subtitle="Quy trình, hướng dẫn, biểu mẫu và tiêu chuẩn"
          theme="rubber"
          icon={ShieldCheck}
          collapsible={true}
          storageKey="banner_collapsed_iso_documents"
          action={
            <>
              {canDistribute && (
                <button
                  onClick={() => { setDistributeDocId(undefined); setShowDistributeModal(true) }}
                  className="flex items-center gap-2 px-4 py-2.5 bg-white/15 hover:bg-white/25 border border-white/40 text-white font-bold rounded-xl transition-all active:scale-95"
                >
                  <Share2 size={15} /> Phân phối
                </button>
              )}
              {canCreate && (
                <Link
                  href="/dashboard/iso/documents/new-doc"
                  className="flex items-center gap-2 px-5 py-2.5 bg-white text-brand-800 hover:bg-brand-50 font-bold rounded-xl shadow-md transition-all active:scale-95"
                >
                  <Plus size={16} /> Tạo tài liệu
                </Link>
              )}
            </>
          }
        />

        {/* Bộ lọc */}
        <FilterBar activeCount={[search, filterStandard, filterLoai, filterTrangThai, filterCap, filterPhongBan].filter(Boolean).length}>
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Tìm mã, tên tài liệu..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-brand-500"
            />
          </div>
          <select
            value={filterStandard}
            onChange={(e) => setFilterStandard(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-brand-500"
          >
            <option value="">Tất cả tiêu chuẩn</option>
            {standards.map((standard) => (
              <option key={standard.id} value={standard.id}>{standard.tieu_chuan}</option>
            ))}
          </select>
          <select
            value={filterLoai}
            onChange={(e) => setFilterLoai(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-brand-500"
          >
            <option value="">Tất cả loại</option>
            {typeOptions.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
          <select
            value={filterTrangThai}
            onChange={(e) => setFilterTrangThai(e.target.value as IsoTrangThai | "")}
            className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-brand-500"
          >
            {trangThaiOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select
            value={filterCap}
            onChange={(e) => setFilterCap(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-brand-500"
          >
            <option value="">Tất cả cấp</option>
            <option value="Cấp 1">Cấp 1</option>
            <option value="Cấp 2">Cấp 2</option>
          </select>
          <select
            value={filterPhongBan}
            onChange={(e) => setFilterPhongBan(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-brand-500"
          >
            <option value="">Tất cả phòng ban</option>
            {phongBanOptions.map((pb) => (
              <option key={pb} value={pb}>{pb}</option>
            ))}
          </select>
        </FilterBar>

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
            <ResponsiveTableWrapper className="rounded-none border-0 shadow-none">
            {(() => {
              const ids = parentRows.filter((d) => (childrenByParent[d.id] || []).length > 0).map((d) => d.id)
              const allExpanded = ids.length > 0 && ids.every((id) => expandedParents[id])
              return (
                <div className="flex justify-end border-b border-slate-100 px-3 py-2">
                  <ExpandAllToggle
                    allExpanded={allExpanded}
                    disabled={ids.length === 0}
                    onExpandAll={() => setExpandedParents(Object.fromEntries(ids.map((id) => [id, true])))}
                    onCollapseAll={() => setExpandedParents({})}
                  />
                </div>
              )
            })()}
            <table className="enterprise-table">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Mã tài liệu</th>
                  <th className="px-4 py-3 text-left font-semibold">Tên tài liệu</th>
                  <th className="px-4 py-3 text-left font-semibold hidden sm:table-cell">Loại</th>
                  <th className="px-4 py-3 text-left font-semibold hidden md:table-cell">Phòng ban</th>
                  <th className="px-4 py-3 text-left font-semibold hidden lg:table-cell">Lần BH</th>
                  <th className="px-4 py-3 text-left font-semibold hidden lg:table-cell">Cấp</th>
                  <th className="px-4 py-3 text-left font-semibold">Trạng thái</th>
                  <th className="px-4 py-3 text-left font-semibold hidden xl:table-cell">Ngày HLực</th>
                  <ExpandHeaderCell>Thao tác</ExpandHeaderCell>
                </tr>
              </thead>
              <tbody>
                {parentRows.map((doc) => {
                  const childRows = childrenByParent[doc.id] || []
                  const isExpanded = !!expandedParents[doc.id]
                const renderDocActions = (d: typeof parentRows[number], isChild: boolean) =>
                        (() => {
                          const isAdmin = userRole === "admin"
                          const canEditDoc = (d.trang_thai === "draft" && (d.soan_thao_user_id === userId || d.created_by === userId)) || isAdmin
                          const canDeleteDoc = (d.trang_thai === "draft" && (d.soan_thao_user_id === userId || d.created_by === userId)) || isAdmin
                          const canOpenDocFile = canOpenIsoFile(d.trang_thai, user, d, userId)
                          const hasDocFile = !!(d.file_signed_pdf_url || d.file_signed_office_url || d.file_goc_url)
                          return (
                            <div className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                              <Link
                                href={`/dashboard/iso/documents/${d.id}`}
                                title="Xem chi tiết"
                                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
                              >
                                <Eye size={14} />
                              </Link>
                              {!canOpenDocFile ? (
                                <span
                                  title={EXPIRED_FILE_HINT}
                                  className="p-1.5 rounded-lg text-slate-200 cursor-not-allowed"
                                >
                                  <Download size={14} />
                                </span>
                              ) : hasDocFile ? (
                                <button
                                  type="button"
                                  title="Tải xuống"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    void openSecureFile(`/api/iso/documents/${d.id}/file-url?variant=main&download=1`)
                                  }}
                                  className="p-1.5 rounded-lg hover:bg-brand-100 text-slate-400 hover:text-brand-600 transition-colors"
                                >
                                  <Download size={14} />
                                </button>
                              ) : (
                                <Link
                                  href={`/dashboard/iso/documents/${d.id}`}
                                  title="Tải xuống"
                                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-brand-600 transition-colors"
                                >
                                  <Download size={14} />
                                </Link>
                              )}
                              {!isChild && canDistribute && d.trang_thai === "co_hieu_luc" && (
                                <button
                                  title="Phân phối tài liệu này"
                                  onClick={() => { setDistributeDocId(d.id); setShowDistributeModal(true) }}
                                  className="p-1.5 rounded-lg hover:bg-sky-50 text-slate-400 hover:text-sky-700 transition-colors"
                                >
                                  <Share2 size={14} />
                                </button>
                              )}
                              {canEditDoc && (
                                <Link
                                  href={`/dashboard/iso/documents/${d.id}`}
                                  title="Sửa"
                                  className="p-1.5 rounded-lg hover:bg-brand-100 text-slate-400 hover:text-brand-700 transition-colors"
                                >
                                  <Pencil size={14} />
                                </Link>
                              )}
                              {hasDocFile && canEditDoc && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    void goToMauViTri(d.id, d.loai_tai_lieu || d.ma_tai_lieu || "")
                                  }}
                                  title="Cài đặt mẫu vị trí ký"
                                  className="p-1.5 rounded-lg hover:bg-brand-100 text-slate-400 hover:text-brand-700 transition-colors"
                                >
                                  <FileSignature size={14} />
                                </button>
                              )}
                              {canDeleteDoc && (
                                <button
                                  title="Xóa"
                                  onClick={() => setDelConfirm(d.id)}
                                  className="p-1.5 rounded-lg hover:bg-red-100 text-slate-400 hover:text-red-600 transition-colors"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          )
                        })()
                  const childTable = (
                    <table className="enterprise-table dense">
                      <thead>
                        <tr>
                          <th>Mã hồ sơ</th>
                          <th>Tên hồ sơ</th>
                          <th className="hidden sm:table-cell">Loại</th>
                          <th className="hidden lg:table-cell">Lần BH</th>
                          <th>Trạng thái</th>
                          <th className="hidden md:table-cell">Ngày HLực</th>
                          <th className="sticky-end text-right">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {childRows.map((child) => (
                          <tr key={child.id}>
                            <td onClick={(e) => e.stopPropagation()}>
                              <Link href={`/dashboard/iso/documents/${child.id}`} className="hover:opacity-80">
                                <DocCodePill code={child.ma_tai_lieu} muted />
                              </Link>
                            </td>
                            <td><div className="font-medium text-slate-700 line-clamp-1">{child.ten_tai_lieu}</div></td>
                            <td className="hidden sm:table-cell">{renderLoaiBadge(child.loai_tai_lieu)}</td>
                            <td className="hidden lg:table-cell text-center text-slate-600 text-xs font-mono">{child.lan_ban_hanh}</td>
                            <td>{renderStatusBadge(child.trang_thai)}</td>
                            <td className="hidden md:table-cell text-xs text-slate-500">{fmtDate(child.ngay_hieu_luc)}</td>
                            <td className="sticky-end text-right">{renderDocActions(child, true)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                  return (
                  <ExpandableRow
                    key={doc.id}
                    expanded={isExpanded}
                    onToggle={() => setExpandedParents((prev) => ({ ...prev, [doc.id]: !prev[doc.id] }))}
                    canExpand={childRows.length > 0}
                    colSpan={9}
                    label={`Xem ${childRows.length} hồ sơ trong bộ`}
                    endCell={renderDocActions(doc, false)}
                    detail={childTable}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <Link href={`/dashboard/iso/documents/${doc.id}`} className="hover:opacity-80">
                          <DocCodePill code={doc.ma_tai_lieu} />
                        </Link>
                        {childRows.length > 0 && (
                          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-slate-500">{childRows.length} hồ sơ</span>
                        )}
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
                      {renderLoaiBadge(doc.loai_tai_lieu)}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-xs text-slate-500">
                      {doc.phong_ban || "—"}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-center text-slate-600 text-xs font-mono">
                      {doc.lan_ban_hanh}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-xs text-slate-500">
                      {renderCapBadge(doc.cap_tl)}
                    </td>
                    <td className="px-4 py-3">
                      {renderStatusBadge(doc.trang_thai)}
                    </td>
                    <td className="px-4 py-3 hidden xl:table-cell text-xs text-slate-500">
                      {fmtDate(doc.ngay_hieu_luc)}
                    </td>
                  </ExpandableRow>
                  )
                })}
              </tbody>
            </table>
            </ResponsiveTableWrapper>
          )}
          {filtered.length > 0 && (
            <div className="px-4 py-2.5 border-t border-slate-100 text-xs text-slate-400">
              Hiển thị {filtered.length} / {docs.length} tài liệu
            </div>
          )}
        </div>
      </div>

      {/* Quản lý phân phối */}
      {canDistribute && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <button
            onClick={() => setShowManagement((prev) => !prev)}
            className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-slate-50 transition-colors"
          >
            <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
              <Share2 size={14} className="text-brand-600" />
              Quản lý phân phối tài liệu
            </span>
            <ChevronUp size={14} className={`text-slate-400 transition-transform ${showManagement ? "" : "rotate-180"}`} />
          </button>
          {showManagement && factoryId && userId && (
            <div className="border-t border-slate-100 p-4">
              <DistributionManagement
                factoryId={factoryId}
                userId={userId}
                canDistribute={canDistribute}
              />
            </div>
          )}
        </div>
      )}

      {/* Delete confirm dialog */}
      {delConfirm && (
        <ModalShell
          title={
            <span className="flex items-center gap-3">
              <span className="p-2 bg-red-100 rounded-xl"><Trash2 size={18} className="text-red-600" /></span>
              Xóa tài liệu?
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
                onClick={() => void handleDeleteDoc(delConfirm)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl"
              >
                Xóa
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-600">Hành động này không thể hoàn tác. Tài liệu và file liên quan sẽ bị xóa vĩnh viễn.</p>
        </ModalShell>
      )}

      {/* Distribution modal */}
      {showDistributeModal && factoryId && userId && (
        <DistributionModal
          factoryId={factoryId}
          userId={userId}
          initialDocIds={distributeDocId ? [distributeDocId] : undefined}
          onClose={() => setShowDistributeModal(false)}
          onSuccess={() => {
            setShowDistributeModal(false)
            setShowManagement(true)
          }}
        />
      )}
    </IsoShell>
  )
}
