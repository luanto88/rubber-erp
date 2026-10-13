"use client"

import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { useRouter } from "next/navigation"
import { getActiveFactoryId } from "@/lib/auth"
import { canCreateIsoDocument, canSeeIsoOverview, readCachedIsoUser } from "./_components/iso-access"
import { IsoShell } from "./_components/iso-shell"
import { ResponsiveTableWrapper } from "../_components/responsive-table-wrapper"
import { fmtDate, type IsoDocument } from "./_components/iso-types"
import { FileText, CheckCircle2, Clock, AlertTriangle, Plus, BadgeCheck } from "lucide-react"
import Link from "next/link"
import { PageHeaderBanner } from "../_components/page-header-banner"
import { PageBackgroundMotif } from "../_components/page-background-motif"
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"
import { DocCodePill } from "@/app/dashboard/_components/doc-ui/doc-code-pill"

type KpiData = {
  total: number
  co_hieu_luc: number
  cho_duyet: number  // cho_xem_xet + cho_phe_duyet
  het_hieu_luc: number
}

export default function IsoOverviewPage() {
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [kpi, setKpi] = useState<KpiData>({ total: 0, co_hieu_luc: 0, cho_duyet: 0, het_hieu_luc: 0 })
  const [recentDocs, setRecentDocs] = useState<IsoDocument[]>([])
  const [canCreate, setCanCreate] = useState(false)
  const router = useRouter()

  const loadData = useCallback(async (fid: string) => {
    setLoading(true)
    try {
      const { data } = await supabase
        .from("iso_documents")
        .select("id, ma_tai_lieu, ten_tai_lieu, loai_tai_lieu, trang_thai, cap_tl, ngay_hieu_luc, updated_at")
        .eq("factory_id", fid)
        .order("updated_at", { ascending: false })

      const docs = (data || []) as IsoDocument[]
      setRecentDocs(docs.slice(0, 10))
      setKpi({
        total: docs.length,
        co_hieu_luc: docs.filter((d) => d.trang_thai === "co_hieu_luc").length,
        cho_duyet: docs.filter((d) => d.trang_thai === "cho_xem_xet" || d.trang_thai === "cho_phe_duyet").length,
        het_hieu_luc: docs.filter((d) => d.trang_thai === "het_hieu_luc").length,
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const bootstrap = async () => {
      // Quyền vào module (iso.view) đã được iso/layout.tsx kiểm. Tổng quan chỉ dành cho người
      // duyệt — người khác chuyển thẳng sang "Việc của tôi" (chỉ cần iso.view ⇒ không vòng lặp).
      const cachedUser = readCachedIsoUser()
      if (!canSeeIsoOverview(cachedUser)) {
        router.replace("/dashboard/iso/my-tasks")
        return
      }
      setCanCreate(canCreateIsoDocument(cachedUser))
      const fid = await getActiveFactoryId()
      if (!fid) { setLoading(false); return }
      setFactoryId(fid)
    }
    void bootstrap()
  }, [router])

  useEffect(() => {
    if (factoryId) void loadData(factoryId)
  }, [factoryId, loadData])

  const kpiCards = [
    { label: "Tổng tài liệu", value: kpi.total, icon: FileText, color: "bg-slate-100 text-slate-700" },
    { label: "Có hiệu lực", value: kpi.co_hieu_luc, icon: CheckCircle2, color: "bg-brand-50 text-brand-700" },
    { label: "Chờ phê duyệt", value: kpi.cho_duyet, icon: Clock, color: "bg-amber-50 text-amber-700" },
    { label: "Hết hiệu lực", value: kpi.het_hieu_luc, icon: AlertTriangle, color: "bg-rose-50 text-rose-700" },
  ]

  return (
    <IsoShell>
      <div className="space-y-6">
        <PageBackgroundMotif theme="rubber" />
        <PageHeaderBanner
          title="Quản lý ISO"
          subtitle="Tài liệu quy trình, hướng dẫn và biểu mẫu"
          theme="rubber"
          icon={BadgeCheck}
          collapsible={true}
          storageKey="banner_collapsed_iso_overview"
          action={canCreate ? (
            <Link
              href="/dashboard/iso/documents/new"
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-white text-brand-800 hover:bg-brand-50 font-bold rounded-xl shadow-md transition-all"
            >
              <Plus size={16} /> Tạo tài liệu
            </Link>
          ) : undefined}
        />

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {kpiCards.map((card) => (
            <div key={card.label} className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${card.color}`}>
                <card.icon size={20} />
              </div>
              <div className="text-2xl font-extrabold text-slate-800">
                {loading ? "—" : card.value}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">{card.label}</div>
            </div>
          ))}
        </div>

        {/* Recent documents */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <span className="font-bold text-slate-700 text-sm">Tài liệu gần đây</span>
            <Link href="/dashboard/iso/documents" className="text-xs text-brand-700 hover:underline font-semibold">
              Xem tất cả →
            </Link>
          </div>
          {loading ? (
            <div className="p-8 text-center text-slate-400 text-sm">Đang tải...</div>
          ) : recentDocs.length === 0 ? (
            <div className="p-8 text-center">
              <FileText size={32} className="mx-auto mb-2 text-slate-300" />
              <p className="text-sm text-slate-400">Chưa có tài liệu nào</p>
              {canCreate && (
                <Link href="/dashboard/iso/documents/new" className="mt-3 inline-flex items-center gap-1 text-sm text-brand-700 hover:underline font-semibold">
                  <Plus size={14} /> Tạo tài liệu đầu tiên
                </Link>
              )}
            </div>
          ) : (
            <ResponsiveTableWrapper className="rounded-none border-0 shadow-none">
            <table className="enterprise-table">
              <thead>
                <tr>
                  <th>Mã tài liệu</th>
                  <th>Tên tài liệu</th>
                  <th className="hidden md:table-cell">Loại</th>
                  <th>Trạng thái</th>
                  <th className="hidden lg:table-cell">Cập nhật</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentDocs.map((doc) => (
                  <tr key={doc.id} className="cursor-pointer">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/iso/documents/${doc.id}`} className="hover:opacity-80">
                        <DocCodePill code={doc.ma_tai_lieu || "(chưa có)"} muted={!doc.ma_tai_lieu} />
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/iso/documents/${doc.id}`} className="hover:underline text-slate-700 font-medium line-clamp-1">
                        {doc.ten_tai_lieu}
                      </Link>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-700 border border-slate-200 rounded-md text-xs font-bold">
                        {doc.loai_tai_lieu || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge domain="iso" status={doc.trang_thai} />
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-slate-500 text-xs">
                      {fmtDate(doc.updated_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </ResponsiveTableWrapper>
          )}
        </div>
      </div>
    </IsoShell>
  )
}
