"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertTriangle, CheckCircle2, Clock, Eye, FileText, Loader2, Plus, Wrench } from "lucide-react"
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { supabase } from "@/lib/supabase"
import { MaintenanceShell } from "./_components/maintenance-shell"
import { currencySymbol } from "./_components/maintenance-data"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { PageHeaderBanner } from "@/app/dashboard/_components/page-header-banner"
import { PageBackgroundMotif } from "@/app/dashboard/_components/page-background-motif"
import { MaintenanceSignStatusBadge, type MaintenanceSigningStatus } from "./records/_components/maintenance-sign-status"
import type { MaintenanceSignBundle } from "@/lib/maintenance-pdf"

type KpiData = {
  totalMonth: number
  pendingApproval: number
  approvedMonth: number
  totalCostUSD: number
}

type RecentRecord = {
  id: string
  ma_bb: string | null
  hang_muc: string
  bo_phan: string
  ngay: string
  trang_thai: string
  nguoi_tao: string | null
  created_by: string | null
  lines_count: number
  maintenance_record_lines: { loai_sua_chua: string | null }[]
}

// Suy ra bundle ký số (nếu có) — mirror đúng resolveSignBundle() trong records/page.tsx.
function resolveSignBundle(r: RecentRecord): MaintenanceSignBundle | null {
  if (r.hang_muc === "Sửa chữa") {
    const loaiSuaChua = r.maintenance_record_lines[0]?.loai_sua_chua || "lon"
    const isXeNho = r.bo_phan === "Đội xe" && loaiSuaChua === "nho"
    return isXeNho ? "sua_chua_nho_xe" : "su_co_nho"
  }
  if (r.hang_muc === "Bảo dưỡng") {
    return r.bo_phan === "Đội xe" ? "bao_duong_xe" : "bao_duong"
  }
  return null
}

export default function MaintenanceDashboardPage() {
  const router = useRouter()
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [kpi, setKpi] = useState<KpiData>({ totalMonth: 0, pendingApproval: 0, approvedMonth: 0, totalCostUSD: 0 })
  const [recent, setRecent] = useState<RecentRecord[]>([])
  const [signingStatusByRecord, setSigningStatusByRecord] = useState<Map<string, MaintenanceSigningStatus>>(new Map())
  const [signingStatusLoaded, setSigningStatusLoaded] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  // Mirror đúng loadSigningStatuses() ở records/page.tsx — chỉ fetch cho các biên bản thực sự
  // thuộc 1 bundle ký số (Sửa chữa/Bảo dưỡng), bỏ qua hạng mục khác.
  const loadSigningStatuses = useCallback(async (fid: string, recs: RecentRecord[]) => {
    const ids = recs.filter((r) => resolveSignBundle(r)).map((r) => r.id)
    if (ids.length === 0) {
      setSigningStatusByRecord(new Map())
      setSigningStatusLoaded(true)
      return
    }
    setSigningStatusLoaded(false)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) { setSigningStatusLoaded(true); return }
      const res = await fetch(`/api/maintenance/signing-status?factoryId=${fid}&recordIds=${ids.join(",")}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const json = (await res.json()) as MaintenanceSigningStatus[] | { error?: string }
      const map = new Map<string, MaintenanceSigningStatus>()
      if (Array.isArray(json)) for (const s of json) map.set(s.recordId, s)
      setSigningStatusByRecord(map)
    } catch {
      // Badge chỉ là thông tin phụ — lỗi tải không được chặn danh sách biên bản.
    } finally {
      setSigningStatusLoaded(true)
    }
  }, [])

  const loadData = useCallback(async (fid: string) => {
    setLoading(true)
    try {
      const now = new Date()
      const firstOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`

      const [allRes, recentRes] = await Promise.all([
        supabase
          .from("maintenance_records")
          .select("id, trang_thai, ngay")
          .eq("factory_id", fid)
          .gte("ngay", firstOfMonth),
        supabase
          .from("maintenance_records")
          .select("id, ma_bb, hang_muc, bo_phan, ngay, trang_thai, nguoi_tao, created_by, maintenance_record_lines(loai_sua_chua)")
          .eq("factory_id", fid)
          .order("created_at", { ascending: false })
          .limit(8),
      ])

      const allRows = allRes.data || []
      const totalMonth = allRows.length
      const pendingApproval = allRows.filter((r) => r.trang_thai === "cho_duyet").length
      const approvedMonth = allRows.filter((r) => r.trang_thai === "da_duyet").length

      setKpi({ totalMonth, pendingApproval, approvedMonth, totalCostUSD: 0 })
      const recentRows = (recentRes.data || []) as RecentRecord[]
      setRecent(recentRows)
      void loadSigningStatuses(fid, recentRows)
    } finally {
      setLoading(false)
    }
  }, [loadSigningStatuses])

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const authState = await hydrateActiveSession().catch(() => ({ session: null, user: null as SessionUser | null }))
        setUser(authState.user)
        if (!hasPermission(authState.user, "maintenance.view")) {
          setLoading(false)
          window.location.replace("/dashboard")
          return
        }
        const fid = authState.user?.factory_id || (await getActiveFactoryId())
        if (!fid) { setLoading(false); return }
        setFactoryId(fid)
      } catch {
        setLoading(false)
      }
    }
    void bootstrap()
  }, [])

  useEffect(() => {
    if (factoryId) void loadData(factoryId)
  }, [factoryId, loadData])

  const canCreate = hasPermission(user, "maintenance.create")
  const canPrint = hasPermission(user, "maintenance.print")
  const isAdmin = user?.role === "admin"
  // "Gửi ký duyệt" chỉ dành cho người tạo chính biên bản đó (created_by, hoặc admin) —
  // mirror ĐÚNG công thức isCreator ở records/[id]/page.tsx và canOwnerAct ở records/page.tsx.
  // canCreate ở trên chỉ là quyền chung, KHÔNG được dùng trực tiếp cho badge Ký duyệt per-row.
  // Biên bản CŨ (created_by NULL) chỉ admin xử lý được — không fallback về so khớp nguoi_tao
  // (TEXT) như trước, đồng bộ rule đã tighten 2026-08-31.
  const canOwnerAct = (r: RecentRecord) =>
    isAdmin || (r.created_by != null && r.created_by === user?.id)

  return (
    <MaintenanceShell>
      {toast && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-2xl text-sm font-bold text-white ${
            toast.ok ? "bg-emerald-600" : "bg-red-600"
          }`}
        >
          {toast.msg}
        </div>
      )}
      <PageBackgroundMotif theme="slate"/>
      <PageHeaderBanner
        title="Bảo trì"
        subtitle="Quản lý sửa chữa và bảo dưỡng thiết bị, xe"
        theme="slate"
        icon={Wrench}
        action={
          <Link
            href="/dashboard/maintenance/records/new"
            className="flex items-center gap-2 px-5 py-2.5 bg-white text-slate-800 font-bold rounded-xl shadow-sm transition-all hover:bg-white/90"
          >
            <Plus size={16} /> Tạo biên bản
          </Link>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <Wrench size={16} className="text-orange-500" />
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Biên bản tháng này</span>
          </div>
          <div className="text-3xl font-extrabold text-slate-800">{loading ? "—" : kpi.totalMonth}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock size={16} className="text-amber-500" />
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Chờ duyệt</span>
          </div>
          <div className={`text-3xl font-extrabold ${kpi.pendingApproval > 0 ? "text-amber-600" : "text-slate-800"}`}>
            {loading ? "—" : kpi.pendingApproval}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 size={16} className="text-emerald-500" />
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Đã duyệt tháng này</span>
          </div>
          <div className="text-3xl font-extrabold text-slate-800">{loading ? "—" : kpi.approvedMonth}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-blue-500" />
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Biên bản gần đây</span>
          </div>
          <div className="text-3xl font-extrabold text-slate-800">{loading ? "—" : recent.length}</div>
        </div>
      </div>

      {/* Recent records */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <span className="font-extrabold text-slate-700">Biên bản gần đây</span>
          <Link href="/dashboard/maintenance/records" className="text-xs font-bold text-emerald-600 hover:underline">Xem tất cả</Link>
        </div>
        {loading ? (
          <div className="p-8 text-center text-slate-400 text-sm">Đang tải...</div>
        ) : recent.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Wrench size={36} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">Chưa có biên bản nào</p>
          </div>
        ) : (
          <ResponsiveTableWrapper className="rounded-none border-0 shadow-none">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {["Mã biên bản", "Hạng mục", "Bộ phận", "Ngày", "Ký duyệt"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recent.map((r) => (
                <tr key={r.id} className="row-hover">
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/maintenance/records/${r.id}`} className="font-mono text-xs font-bold text-emerald-700 hover:underline">
                      {r.ma_bb || "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-700">{r.hang_muc}</td>
                  <td className="px-4 py-3 text-slate-500">{r.bo_phan}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{r.ngay ? new Date(r.ngay).toLocaleDateString("vi-VN") : "—"}</td>
                  <td className="px-4 py-3">
                    {(() => {
                      const bundle = resolveSignBundle(r)
                      if (!bundle) return <span className="text-xs text-slate-300">—</span>
                      if (!signingStatusLoaded) return <Loader2 size={14} className="animate-spin text-slate-300" />
                      const status = signingStatusByRecord.get(r.id)
                      return (
                        <div className="flex items-center gap-1.5">
                          {status?.fileHienTai ? (
                            <a
                              href={status.fileHienTai}
                              target="_blank"
                              rel="noreferrer"
                              title={status.trangThai === "hoan_tat" ? "Xem file đã ký duyệt" : "Xem file đã ký (đang chờ ký tiếp)"}
                              className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
                            >
                              <Eye size={15} />
                            </a>
                          ) : canPrint ? (
                            <Link
                              href={`/dashboard/maintenance/print?type=${bundle}&record_id=${r.id}`}
                              target="_blank"
                              title="In biên bản (chưa ký)"
                              className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors"
                            >
                              <FileText size={15} />
                            </Link>
                          ) : null}
                          {user && (
                            <MaintenanceSignStatusBadge
                              status={status}
                              currentUser={user}
                              canCreate={canCreate && canOwnerAct(r)}
                              onOpenSignPrompt={() => router.push(`/dashboard/maintenance/records/${r.id}`)}
                              onCancelled={() => { if (factoryId) void loadSigningStatuses(factoryId, recent) }}
                              showToast={(msg, ok = true) => setToast({ msg, ok })}
                            />
                          )}
                        </div>
                      )
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </ResponsiveTableWrapper>
        )}
      </div>
    </MaintenanceShell>
  )
}
