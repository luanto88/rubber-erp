"use client"

import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, getFreshAuthSession } from "@/lib/auth"
import { IsoShell } from "../_components/iso-shell"
import { ResponsiveTableWrapper } from "../../_components/responsive-table-wrapper"
import { TRANG_THAI_LABEL, TRANG_THAI_COLOR, fmtDate, type IsoDocument } from "../_components/iso-types"
import { ClipboardCheck, ClipboardList, Eye, FileText, BadgeCheck, History } from "lucide-react"
import Link from "next/link"
import {
  FORM_INSTANCE_STATUS_COLOR,
  FORM_INSTANCE_STATUS_LABEL,
  type IsoFormInstance,
  stepSignerUserId,
} from "../_components/iso-types"
import { PageHeaderBanner } from "../../_components/page-header-banner"
import { PageBackgroundMotif } from "../../_components/page-background-motif"

type IsoTaskGroup = {
  doc: IsoDocument
  total: number
  childCount: number
}

export default function IsoMyTasksPage() {
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tasks, setTasks] = useState<IsoDocument[]>([])
  const [formTasks, setFormTasks] = useState<IsoFormInstance[]>([])
  const [participatedForms, setParticipatedForms] = useState<IsoFormInstance[]>([])
  const [formTasksLoading, setFormTasksLoading] = useState(false)

  const loadTasks = useCallback(async (fid: string, uid: string) => {
    setLoading(true)
    try {
      // Tài liệu cần tôi xem xét hoặc phê duyệt
      const { data } = await supabase
        .from("iso_documents")
        .select("id, ma_tai_lieu, ten_tai_lieu, loai_tai_lieu, trang_thai, cap_tl, soan_thao, xem_xet, phe_duyet, soan_thao_user_id, xem_xet_user_id, phe_duyet_user_id, parent_doc_id, phan_loai_tl, chon_quy_trinh, updated_at")
        .eq("factory_id", fid)
        .or(`xem_xet_user_id.eq.${uid},phe_duyet_user_id.eq.${uid},soan_thao_user_id.eq.${uid}`)
        .in("trang_thai", ["cho_xem_xet", "cho_phe_duyet", "bi_tu_choi_phe_duyet", "tra_ve"])
        .order("updated_at", { ascending: false })
      setTasks((data || []) as IsoDocument[])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const bootstrap = async () => {
      const fid = await getActiveFactoryId()
      if (!fid) { setLoading(false); return }
      const session = await getFreshAuthSession()
      if (!session?.user) { setLoading(false); return }
      setFactoryId(fid)
      setUserId(session.user.id)
    }
    void bootstrap()
  }, [])

  useEffect(() => {
    if (factoryId && userId) void loadTasks(factoryId, userId)
  }, [factoryId, userId, loadTasks])

  const loadFormTasks = useCallback(async (fid: string, uid: string) => {
    setFormTasksLoading(true)
    try {
      const { data } = await supabase
        .from("iso_form_instances")
        .select("id, tieu_de, trang_thai, cap_tl, created_at, updated_at, nguoi_tao, xem_xet_user_id, phe_duyet_user_id, ly_do_tra_ve, draft_file_url, draft_file_type, final_office_url, final_pdf_url, soan_thao_signed_url, xem_xet, phe_duyet, ky_xem_xet_at, ky_phe_duyet_at, auto_convert_pdf, ghi_chu, template_doc_id, factory_id, soan_thao, xem_xet_placement, phe_duyet_placement, soan_thao_placement, ky_soan_thao_at, so_buoc_tong, buoc_hien_tai, thu_tu_ky_json, nguoi_ky")
        .eq("factory_id", fid)
        .in("trang_thai", ["draft", "cho_xem_xet", "cho_phe_duyet", "tra_ve", "da_phe_duyet"])
        .order("updated_at", { ascending: false })

      const allList = ((data ?? []) as IsoFormInstance[])

      // 1. Hồ sơ đang cần tôi trực tiếp xử lý
      const myTasks = allList.filter((inst) => {
        if (inst.trang_thai === "da_phe_duyet") return false
        if ((inst.so_buoc_tong ?? 0) > 0 && Array.isArray(inst.thu_tu_ky_json)) {
          const firstStep = inst.thu_tu_ky_json[0]
          const firstUid = firstStep ? stepSignerUserId(firstStep) : null
          if (inst.trang_thai === "tra_ve") {
            return inst.nguoi_tao === uid || firstUid === uid
          }
          if (inst.trang_thai === "draft") {
            return inst.nguoi_tao === uid || firstUid === uid
          }
          const curStep = inst.thu_tu_ky_json[inst.buoc_hien_tai ?? 0]
          const curUid = curStep ? stepSignerUserId(curStep) : null
          return curUid === uid
        }
        if (inst.trang_thai === "draft") return inst.nguoi_tao === uid
        if (inst.trang_thai === "cho_xem_xet") return inst.xem_xet_user_id === uid
        if (inst.trang_thai === "cho_phe_duyet") return inst.phe_duyet_user_id === uid
        if (inst.trang_thai === "tra_ve") return true
        return false
      })

      const myTaskIds = new Set(myTasks.map((t) => t.id))

      // 2. Hồ sơ tôi đã tham gia tạo hoặc ký (đang chờ người khác ký tiếp hoặc đã hoàn tất)
      const participated = allList.filter((inst) => {
        if (myTaskIds.has(inst.id)) return false
        if (inst.nguoi_tao === uid && inst.trang_thai !== "draft") return true
        if ((inst.so_buoc_tong ?? 0) > 0 && Array.isArray(inst.thu_tu_ky_json)) {
          const curIdx = inst.trang_thai === "da_phe_duyet" ? 999 : (inst.buoc_hien_tai ?? 0)
          const hasSigned = inst.thu_tu_ky_json.some((s, idx) => stepSignerUserId(s) === uid && idx < curIdx)
          if (hasSigned) return true
        }
        if (inst.nguoi_ky && typeof inst.nguoi_ky === "object") {
          const signedValues = Object.values(inst.nguoi_ky) as Array<{ user_id?: string }>
          if (signedValues.some((v) => v?.user_id === uid)) return true
        }
        return false
      })

      setFormTasks(myTasks)
      setParticipatedForms(participated.slice(0, 25))
    } finally {
      setFormTasksLoading(false)
    }
  }, [])

  useEffect(() => {
    if (factoryId && userId) void loadFormTasks(factoryId, userId)
  }, [factoryId, userId, loadFormTasks])

  // Lắng nghe Realtime để tự động cập nhật khi có hồ sơ mới hoặc ký chuyển bước
  useEffect(() => {
    if (!factoryId || !userId) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const reload = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        void loadTasks(factoryId, userId)
        void loadFormTasks(factoryId, userId)
      }, 600)
    }
    const ch = supabase.channel(`iso-my-tasks-${factoryId}-${userId}-${Date.now()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "iso_documents", filter: `factory_id=eq.${factoryId}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "iso_form_instances", filter: `factory_id=eq.${factoryId}` }, reload)
      .subscribe()
    return () => {
      if (timer) clearTimeout(timer)
      void supabase.removeChannel(ch)
    }
  }, [factoryId, userId, loadTasks, loadFormTasks])

  const getMyRole = (doc: IsoDocument): string => {
    if (doc.trang_thai === "cho_xem_xet" && doc.xem_xet_user_id === userId) return "Cần xem xét"
    if (doc.trang_thai === "cho_phe_duyet" && doc.phe_duyet_user_id === userId) return "Cần phê duyệt"
    if (doc.trang_thai === "bi_tu_choi_phe_duyet" && doc.xem_xet_user_id === userId) return "Phê duyệt từ chối — cần xử lý"
    if (doc.trang_thai === "tra_ve" && doc.soan_thao_user_id === userId) return "Tài liệu bị trả về — cần sửa"
    return "Cần xử lý"
  }

  const isMyPendingDoc = (doc: IsoDocument) =>
    (doc.trang_thai === "cho_xem_xet" && doc.xem_xet_user_id === userId) ||
    (doc.trang_thai === "cho_phe_duyet" && doc.phe_duyet_user_id === userId) ||
    (doc.trang_thai === "bi_tu_choi_phe_duyet" && doc.xem_xet_user_id === userId) ||
    (doc.trang_thai === "tra_ve" && doc.soan_thao_user_id === userId)

  const parentCodeFromChild = (doc: IsoDocument) => {
    const code = doc.ma_tai_lieu || ""
    const type = doc.loai_tai_lieu || ""
    const suffix = new RegExp(`-${type}\\d+$`, "i")
    return code.replace(suffix, "") || "quy trình cha"
  }

  const taskGroups = tasks.filter(isMyPendingDoc).reduce<IsoTaskGroup[]>((groups, item) => {
    const groupKey = item.parent_doc_id || item.id
    const existing = groups.find((group) => (group.doc.parent_doc_id || group.doc.id) === groupKey || group.doc.id === groupKey)
    const isChild = !!item.parent_doc_id || item.phan_loai_tl === "con"
    if (!existing) {
      groups.push({ doc: item, total: 1, childCount: isChild ? 1 : 0 })
      return groups
    }
    existing.total += 1
    if (isChild) existing.childCount += 1
    if (!item.parent_doc_id && existing.doc.parent_doc_id) existing.doc = item
    return groups
  }, [])

  return (
    <IsoShell>
      <div className="space-y-4">
        <PageBackgroundMotif theme="indigo" />
        <PageHeaderBanner
          title="Việc của tôi"
          subtitle="Tài liệu ISO đang chờ bạn xem xét hoặc phê duyệt"
          theme="indigo"
          icon={BadgeCheck}
        />

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-10 text-center text-slate-400 text-sm">Đang tải...</div>
          ) : taskGroups.length === 0 ? (
            <div className="p-10 text-center">
              <ClipboardCheck size={36} className="mx-auto mb-2 text-slate-300" />
              <p className="text-sm text-slate-400">Không có tài liệu nào đang chờ bạn xử lý</p>
            </div>
          ) : (
            <>
              <div className="px-5 py-3 bg-amber-50 border-b border-amber-100 text-sm text-amber-700 font-medium">
                Có {taskGroups.length} đầu việc đang chờ bạn xử lý
              </div>
              <ResponsiveTableWrapper className="rounded-none border-0 shadow-none">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-100">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Mã tài liệu</th>
                    <th className="px-4 py-3 text-left font-semibold">Tên tài liệu</th>
                    <th className="px-4 py-3 text-left font-semibold hidden md:table-cell">Vai trò của tôi</th>
                    <th className="px-4 py-3 text-left font-semibold">Trạng thái</th>
                    <th className="px-4 py-3 text-left font-semibold hidden lg:table-cell">Cập nhật</th>
                    <th className="px-4 py-3 text-right font-semibold">Hành động</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {taskGroups.map((group) => {
                    const doc = group.doc
                    const isStandaloneChild = !!doc.parent_doc_id
                    const isBundle = !isStandaloneChild && group.childCount > 0
                    const isSoatXet = doc.chon_quy_trinh === "Soát xét"
                    const quyTrinhLabel = isSoatXet ? "Soát xét" : "Soạn thảo"
                    const taskLabel = isStandaloneChild
                      ? `${getMyRole(doc)} ${group.childCount} hồ sơ${isSoatXet ? " soát xét" : ""} của quy trình ${parentCodeFromChild(doc)}`
                      : isBundle
                        ? `Bộ tài liệu + ${group.childCount} hồ sơ`
                        : "Tài liệu riêng"
                    return (
                    <tr key={doc.parent_doc_id || doc.id} className="hover:bg-amber-50/50 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-violet-700 font-bold">{doc.ma_tai_lieu || "—"}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-700 line-clamp-1">{doc.ten_tai_lieu}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className="text-[10px] text-slate-400">{doc.loai_tai_lieu || "ISO"} · {doc.cap_tl}</span>
                          {/* Badge quy trình: Soát xét (amber) hoặc Soạn thảo (violet) */}
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${isSoatXet ? "bg-amber-100 text-amber-700" : "bg-violet-100 text-violet-700"}`}>
                            {quyTrinhLabel}
                          </span>
                          {/* Badge mô tả loại đầu việc */}
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${isBundle || isStandaloneChild ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-600"}`}>
                            <FileText size={10} />
                            {taskLabel}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${doc.trang_thai === "tra_ve" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>
                          {getMyRole(doc)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${TRANG_THAI_COLOR[doc.trang_thai]}`}>
                          {TRANG_THAI_LABEL[doc.trang_thai]}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-xs text-slate-500">
                        {fmtDate(doc.updated_at)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/dashboard/iso/documents/${doc.id}`}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold rounded-lg transition-all"
                        >
                          <Eye size={12} /> {isBundle ? "Xử lý bộ" : isStandaloneChild ? "Xử lý hồ sơ" : "Xử lý"}
                        </Link>
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
              </ResponsiveTableWrapper>
            </>
          )}
        </div>

        {/* ── Hồ sơ thực hiện cần xử lý ── */}
        <div>
          <h2 className="text-base font-extrabold text-slate-700 mb-2 flex items-center gap-2">
            <ClipboardList size={16} className="text-emerald-600" />
            Hồ sơ thực hiện cần xử lý
          </h2>
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {formTasksLoading ? (
              <div className="p-10 text-center text-slate-400 text-sm">Đang tải...</div>
            ) : formTasks.length === 0 ? (
              <div className="p-8 text-center">
                <ClipboardCheck size={32} className="mx-auto mb-2 text-slate-300" />
                <p className="text-sm text-slate-400">Không có hồ sơ nào cần xử lý</p>
              </div>
            ) : (
              <>
                <div className="px-5 py-3 bg-emerald-50 border-b border-emerald-100 text-sm text-emerald-700 font-medium">
                  Có {formTasks.length} hồ sơ đang chờ bạn xử lý
                </div>
                <ResponsiveTableWrapper className="rounded-none border-0 shadow-none">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-100">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Tiêu đề</th>
                      <th className="px-4 py-3 text-left font-semibold hidden md:table-cell">Vai trò</th>
                      <th className="px-4 py-3 text-left font-semibold">Trạng thái</th>
                      <th className="px-4 py-3 text-left font-semibold hidden lg:table-cell">Ngày tạo</th>
                      <th className="px-4 py-3 text-right font-semibold">Hành động</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {formTasks.map((inst) => {
                      let roleLabel = "Cần xử lý"
                      if (inst.trang_thai === "draft") {
                        roleLabel = "Cần ký & gửi"
                      } else if (inst.trang_thai === "tra_ve") {
                        roleLabel = "Đã trả về — cần chỉnh sửa"
                      } else if ((inst.so_buoc_tong ?? 0) > 0 && Array.isArray(inst.thu_tu_ky_json)) {
                        const curStep = inst.thu_tu_ky_json[inst.buoc_hien_tai ?? 0]
                        const stepTitle = curStep?.ten?.trim()
                        roleLabel = stepTitle
                          ? `Cần ký: ${stepTitle}`
                          : (inst.trang_thai === "cho_phe_duyet" ? "Cần phê duyệt" : "Cần xem xét")
                      } else if (inst.trang_thai === "cho_xem_xet") {
                        roleLabel = "Cần xem xét"
                      } else if (inst.trang_thai === "cho_phe_duyet") {
                        roleLabel = "Cần phê duyệt"
                      }
                      return (
                        <tr key={inst.id} className="hover:bg-emerald-50/40 transition-colors">
                          <td className="px-4 py-3">
                            <div className="font-medium text-slate-700 line-clamp-1">{inst.tieu_de}</div>
                            {inst.trang_thai === "tra_ve" && inst.ly_do_tra_ve && (
                              <div className="text-[11px] text-rose-500 mt-0.5 line-clamp-1">{inst.ly_do_tra_ve}</div>
                            )}
                          </td>
                          <td className="px-4 py-3 hidden md:table-cell">
                            <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${inst.trang_thai === "tra_ve" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>
                              {roleLabel}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${FORM_INSTANCE_STATUS_COLOR[inst.trang_thai]}`}>
                              {FORM_INSTANCE_STATUS_LABEL[inst.trang_thai]}
                            </span>
                          </td>
                          <td className="px-4 py-3 hidden lg:table-cell text-xs text-slate-500">
                            {fmtDate(inst.created_at)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Link
                              href={`/dashboard/iso/forms/${inst.id}`}
                              className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-all"
                            >
                              <Eye size={12} /> Xử lý
                            </Link>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                </ResponsiveTableWrapper>
              </>
            )}
          </div>
        </div>

        {/* ── Hồ sơ tôi đã tham gia ký / theo dõi tiến độ ── */}
        {participatedForms.length > 0 && (
          <div className="mt-6">
            <h2 className="text-base font-extrabold text-slate-700 mb-2 flex items-center gap-2">
              <History size={16} className="text-sky-600" />
              Hồ sơ tôi đã tham gia tạo hoặc ký ({participatedForms.length})
            </h2>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <ResponsiveTableWrapper className="rounded-none border-0 shadow-none">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-100">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Tiêu đề</th>
                      <th className="px-4 py-3 text-left font-semibold hidden md:table-cell">Tiến độ ký</th>
                      <th className="px-4 py-3 text-left font-semibold">Trạng thái</th>
                      <th className="px-4 py-3 text-left font-semibold hidden lg:table-cell">Cập nhật</th>
                      <th className="px-4 py-3 text-right font-semibold">Hành động</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {participatedForms.map((inst) => {
                      const totalSteps = inst.so_buoc_tong ?? 0
                      const curStepIdx = inst.buoc_hien_tai ?? 0
                      const curStep = Array.isArray(inst.thu_tu_ky_json) ? inst.thu_tu_ky_json[curStepIdx] : null
                      const curStepTitle = curStep?.ten || `Bước ${curStepIdx + 1}`
                      return (
                        <tr key={inst.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="px-4 py-3">
                            <div className="font-medium text-slate-700 line-clamp-1">{inst.tieu_de}</div>
                          </td>
                          <td className="px-4 py-3 hidden md:table-cell text-xs text-slate-600">
                            {inst.trang_thai === "da_phe_duyet" ? (
                              <span className="text-emerald-600 font-semibold">Hoàn tất ({totalSteps > 0 ? `${totalSteps}/${totalSteps} bước` : "Đã duyệt"})</span>
                            ) : totalSteps > 0 ? (
                              <span>Đang chờ bước {curStepIdx + 1}/{totalSteps}: <strong>{curStepTitle}</strong></span>
                            ) : (
                              <span>—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${FORM_INSTANCE_STATUS_COLOR[inst.trang_thai]}`}>
                              {FORM_INSTANCE_STATUS_LABEL[inst.trang_thai]}
                            </span>
                          </td>
                          <td className="px-4 py-3 hidden lg:table-cell text-xs text-slate-500">
                            {fmtDate(inst.updated_at)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Link
                              href={`/dashboard/iso/forms/${inst.id}`}
                              className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-all"
                            >
                              <Eye size={12} /> Xem hồ sơ
                            </Link>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </ResponsiveTableWrapper>
            </div>
          </div>
        )}
      </div>
    </IsoShell>
  )
}
