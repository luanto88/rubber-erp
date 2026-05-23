"use client"

import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, getFreshAuthSession } from "@/lib/auth"
import { IsoShell } from "../_components/iso-shell"
import { TRANG_THAI_LABEL, TRANG_THAI_COLOR, fmtDate, type IsoDocument } from "../_components/iso-types"
import { ClipboardCheck, Eye, FileText } from "lucide-react"
import Link from "next/link"

export default function IsoMyTasksPage() {
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tasks, setTasks] = useState<IsoDocument[]>([])

  const loadTasks = useCallback(async (fid: string, uid: string) => {
    setLoading(true)
    try {
      // Tài liệu cần tôi xem xét hoặc phê duyệt
      const { data } = await supabase
        .from("iso_documents")
        .select("id, ma_tai_lieu, ten_tai_lieu, loai_tai_lieu, trang_thai, cap_tl, soan_thao, xem_xet, phe_duyet, xem_xet_user_id, phe_duyet_user_id, updated_at")
        .eq("factory_id", fid)
        .or(`xem_xet_user_id.eq.${uid},phe_duyet_user_id.eq.${uid}`)
        .in("trang_thai", ["cho_xem_xet", "cho_phe_duyet"])
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

  const getMyRole = (doc: IsoDocument): string => {
    if (doc.trang_thai === "cho_xem_xet" && doc.xem_xet_user_id === userId) return "Cần xem xét"
    if (doc.trang_thai === "cho_phe_duyet" && doc.phe_duyet_user_id === userId) return "Cần phê duyệt"
    return "Cần xử lý"
  }

  return (
    <IsoShell>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Việc của tôi</h1>
          <p className="text-sm text-slate-500 mt-0.5">Tài liệu ISO đang chờ bạn xem xét hoặc phê duyệt</p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-10 text-center text-slate-400 text-sm">Đang tải...</div>
          ) : tasks.length === 0 ? (
            <div className="p-10 text-center">
              <ClipboardCheck size={36} className="mx-auto mb-2 text-slate-300" />
              <p className="text-sm text-slate-400">Không có tài liệu nào đang chờ bạn xử lý</p>
            </div>
          ) : (
            <>
              <div className="px-5 py-3 bg-amber-50 border-b border-amber-100 text-sm text-amber-700 font-medium">
                Có {tasks.length} tài liệu đang chờ bạn xử lý
              </div>
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
                  {tasks.map((doc) => (
                    <tr key={doc.id} className="hover:bg-amber-50/50 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-violet-700 font-bold">{doc.ma_tai_lieu || "—"}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-700 line-clamp-1">{doc.ten_tai_lieu}</div>
                        {doc.loai_tai_lieu && (
                          <span className="text-[10px] text-slate-400">{doc.loai_tai_lieu} · {doc.cap_tl}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-bold rounded-full">
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
                          <Eye size={12} /> Xử lý
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </IsoShell>
  )
}
