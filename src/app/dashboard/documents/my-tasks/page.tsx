"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, hydrateActiveSession, hasPermission } from "@/lib/auth"
import { DocumentsShell } from "../_components/documents-shell"
import {
  LOAI_VAN_BAN_LABEL,
  TRANG_THAI_COLOR,
  TRANG_THAI_LABEL,
  canSignStep,
  fmtDate,
  type VanBanDocument,
  type ThuTuKyStep,
} from "../_components/documents-types"
import { ClipboardList, ArrowRight, FileSignature, Lock } from "lucide-react"
import type { SessionUser } from "@/lib/auth"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { PageHeaderBanner } from "@/app/dashboard/_components/page-header-banner"
import { PageBackgroundMotif } from "@/app/dashboard/_components/page-background-motif"

type TaskItem = {
  doc: VanBanDocument
  role: "soan_thao" | "ky_buoc" | "phe_duyet"
  action_label: string
  action_color: string
}

export default function MyTasksPage() {
  const [userDeptCode, setUserDeptCode] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [hasViewPerm, setHasViewPerm] = useState<boolean | null>(null)

  const resolveUserDeptCode = useCallback(async (uid: string) => {
    try {
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token || ""
      const res = await fetch(`/api/documents/dept-code?userId=${uid}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const json = (await res.json()) as { code: string | null }
        return json.code
      }
    } catch { /* ignore */ }
    return null
  }, [])

  const loadTasks = useCallback(async (fid: string, uid: string, deptCode: string | null, sessionUser: SessionUser) => {
    setLoading(true)
    try {
      // Fetch all pending docs for the factory
      const { data } = await supabase
        .from("van_ban_documents")
        .select(
          "id, ma_van_ban, ten_van_ban, loai_van_ban, phong_ban, trang_thai, thu_tu_ky_json, buoc_hien_tai, so_buoc_tong, nguoi_ky, soan_thao_user_id, phe_duyet_user_id, is_uploaded, ngay_phe_duyet, nguoi_soan_thao_display, created_at, updated_at, tra_ve_step, tra_ve_ly_do, tra_ve_nguoi, tra_ve_at, phe_duyet, ghi_chu, placement_ky, file_goc_url, file_signed_pdf_url, file_signed_office_url, file_signed_office_type, auto_convert_pdf, phong_ban_ky_display, mo_ta_tim_kiem, so_van_ban, nam"
        )
        .eq("factory_id", fid)
        .in("trang_thai", ["draft", "cho_ky_phong_ban", "cho_phe_duyet", "tra_ve"])
        .order("updated_at", { ascending: false })

      const docs = (data || []) as VanBanDocument[]
      const isAdmin = sessionUser.role === "admin"

      const result: TaskItem[] = []

      for (const doc of docs) {
        // draft / tra_ve → người soạn thảo cần gửi lại
        if (doc.trang_thai === "draft" || doc.trang_thai === "tra_ve") {
          if (doc.soan_thao_user_id === uid || isAdmin) {
            result.push({
              doc,
              role: "soan_thao",
              action_label: doc.trang_thai === "tra_ve" ? "Xử lý trả về" : "Gửi ký",
              action_color: "bg-blue-100 text-blue-700",
            })
          }
          continue
        }

        // cho_ky_phong_ban → kiểm tra bước hiện tại có khớp phòng ban không
        if (doc.trang_thai === "cho_ky_phong_ban") {
          const stepIndex = doc.buoc_hien_tai
          const step = (doc.thu_tu_ky_json || [])[stepIndex] as ThuTuKyStep | undefined
          // Dùng helper chung — xem `canSignStep` trong documents-types.ts
          if (canSignStep(step, uid, deptCode, isAdmin)) {
            result.push({
              doc,
              role: "ky_buoc",
              action_label: "Ký phòng ban",
              action_color: "bg-amber-100 text-amber-700",
            })
          }
          continue
        }

        // cho_phe_duyet → chỉ đúng người được chỉ định phe_duyet_user_id hoặc admin
        // (không gate theo quyền chung documents.phe_duyet — quyền đó có thể cấp cho
        // nhiều lãnh đạo/trưởng phòng khác không phải người được chỉ định trên văn bản này)
        if (doc.trang_thai === "cho_phe_duyet") {
          if (isAdmin || doc.phe_duyet_user_id === uid) {
            result.push({
              doc,
              role: "phe_duyet",
              action_label: "Phê duyệt",
              action_color: "bg-emerald-100 text-emerald-700",
            })
          }
          continue
        }
      }

      setTasks(result)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const bootstrap = async () => {
      setLoading(true)
      const fid = await getActiveFactoryId()
      if (!fid) { setLoading(false); return }

      const { user: sessionUser } = await hydrateActiveSession()
      if (!sessionUser) { setLoading(false); setHasViewPerm(false); return }

      const canView = hasPermission(sessionUser, "documents.view")
      setHasViewPerm(canView)
      if (!canView) {
        setLoading(false)
        return
      }

      const deptCode = await resolveUserDeptCode(sessionUser.id)
      setUserDeptCode(deptCode)
      void loadTasks(fid, sessionUser.id, deptCode, sessionUser)
    }
    void bootstrap()
  }, [resolveUserDeptCode, loadTasks])

  if (hasViewPerm === false) {
    return (
      <DocumentsShell>
        <PageBackgroundMotif theme="cyan" />
        <div className="max-w-md mx-auto my-16 p-8 bg-white border border-slate-200 rounded-2xl shadow-sm text-center">
          <div className="w-14 h-14 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Lock size={28} />
          </div>
          <h2 className="text-lg font-bold text-slate-800 mb-2">Không có quyền truy cập</h2>
          <p className="text-sm text-slate-500 mb-6">
            Bạn chưa được phân quyền xem module Văn bản nội bộ. Vui lòng liên hệ Quản trị viên để được cấp quyền <code className="px-1.5 py-0.5 bg-slate-100 rounded text-xs text-slate-700 font-mono">documents.view</code> trong Cài đặt.
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center px-5 py-2.5 bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold rounded-xl transition-all"
          >
            Về Bảng điều khiển
          </Link>
        </div>
      </DocumentsShell>
    )
  }

  return (
    <DocumentsShell>
      <PageBackgroundMotif theme="cyan" />
      <PageHeaderBanner
        title="Việc của tôi"
        subtitle={`Văn bản cần bạn xử lý${userDeptCode ? ` — Phòng ban: ${userDeptCode}` : ""}`}
        theme="cyan"
        icon={FileSignature}
      />

      <ResponsiveTableWrapper>
        {loading ? (
          <div className="p-12 text-center text-slate-400">Đang tải...</div>
        ) : tasks.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <ClipboardList size={40} className="mx-auto mb-3 opacity-30" />
            <p className="font-semibold">Không có việc nào cần xử lý</p>
            <p className="text-xs mt-1">Các văn bản cần bạn ký hoặc phê duyệt sẽ hiện ở đây</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Số văn bản</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Tên văn bản</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Loại</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Trạng thái</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Việc cần làm</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Cập nhật</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tasks.map(({ doc, action_label, action_color }) => (
                <tr
                  key={doc.id}
                  className="hover:bg-slate-50 transition-colors cursor-pointer"
                  onClick={() => window.location.href = `/dashboard/documents/${doc.id}`}
                >
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">
                    {doc.ma_van_ban || <span className="text-slate-300 italic">—</span>}
                  </td>
                  <td className="px-4 py-3 font-semibold text-slate-800 max-w-xs truncate">
                    <Link
                      href={`/dashboard/documents/${doc.id}`}
                      className="hover:text-blue-700"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {doc.ten_van_ban}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600 text-xs">
                    {doc.loai_van_ban ? (LOAI_VAN_BAN_LABEL[doc.loai_van_ban] || doc.loai_van_ban) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-bold ${TRANG_THAI_COLOR[doc.trang_thai] || "bg-slate-100 text-slate-600"}`}>
                      {TRANG_THAI_LABEL[doc.trang_thai] || doc.trang_thai}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2.5 py-1 rounded-lg text-xs font-bold ${action_color}`}>
                      {action_label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    {fmtDate(doc.updated_at)}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/documents/${doc.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-all whitespace-nowrap"
                    >
                      Xử lý
                      <ArrowRight size={12} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ResponsiveTableWrapper>

      {tasks.length > 0 && (
        <p className="text-xs text-slate-400 mt-2 text-right">{tasks.length} việc cần xử lý</p>
      )}
    </DocumentsShell>
  )
}
