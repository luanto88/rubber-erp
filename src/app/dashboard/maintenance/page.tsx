"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CheckCircle2, ClipboardList, Clock, Plus, Wrench } from "lucide-react"
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { supabase } from "@/lib/supabase"
import { MaintenanceShell } from "./_components/maintenance-shell"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { PageHeaderBanner } from "@/app/dashboard/_components/page-header-banner"
import { PageBackgroundMotif } from "@/app/dashboard/_components/page-background-motif"
import { type MaintenanceSigningStatus } from "./records/_components/maintenance-sign-types"
import { MaintenanceLinesDetail, MaintenanceRowActions, MaintenanceSignCell, type MaintenanceLineSummary } from "./_components/maintenance-row-cells"
import { ExpandableRow, ExpandHeaderCell, ExpandAllToggle } from "@/app/dashboard/_components/doc-ui/expandable-row"
import { HangMucLabel } from "./_components/hang-muc-label"
import { StatCard, StatGrid } from "@/app/dashboard/_components/doc-ui/stat-card"
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"
import { DocCodePill } from "@/app/dashboard/_components/doc-ui/doc-code-pill"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import type { MaintenanceSignBundle } from "@/lib/maintenance-pdf"
import { fetchSigningStatusList } from "@/app/dashboard/_components/signing-status-fetch"
import { KtShortageBanner } from "@/app/dashboard/_components/kt-shortage-banner"

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
  maintenance_record_lines: (MaintenanceLineSummary & { loai_sua_chua: string | null })[]
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
  // Lỗi tải trạng thái ký: GIỮ map cũ + hiện nút thử lại, KHÔNG coi như "chưa gửi ký" (trước đây
  // lỗi bị nuốt → map rỗng → badge sai và nút PDF render bản CHƯA ký — bug báo 2026-09-26).
  const [signingStatusError, setSigningStatusError] = useState(false)
  const signingReqSeq = useRef(0)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const toggleExpanded = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  // Mirror đúng loadSigningStatuses() ở records/page.tsx — chỉ fetch cho các biên bản thực sự
  // thuộc 1 bundle ký số (Sửa chữa/Bảo dưỡng), bỏ qua hạng mục khác.
  const loadSigningStatuses = useCallback(async (fid: string, recs: RecentRecord[]) => {
    const seq = ++signingReqSeq.current
    const ids = recs.filter((r) => resolveSignBundle(r)).map((r) => r.id)
    if (ids.length === 0) {
      setSigningStatusByRecord(new Map())
      setSigningStatusError(false)
      setSigningStatusLoaded(true)
      return
    }
    try {
      const list = await fetchSigningStatusList<MaintenanceSigningStatus>(
        "/api/maintenance/signing-status",
        { factoryId: fid, recordIds: ids },
      )
      if (seq !== signingReqSeq.current) return // response cũ về muộn — bỏ qua
      const map = new Map<string, MaintenanceSigningStatus>()
      for (const s of list) map.set(s.recordId, s)
      setSigningStatusByRecord(map)
      setSigningStatusError(false)
    } catch {
      if (seq !== signingReqSeq.current) return
      setSigningStatusError(true)
    } finally {
      if (seq === signingReqSeq.current) setSigningStatusLoaded(true)
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
          .select("id, ma_bb, hang_muc, bo_phan, ngay, trang_thai, nguoi_tao, created_by, maintenance_record_lines(ma_tb, ten_tb, noi_dung, cac_khac_phuc, chi_phi_dk, loai_tien, ten_tai_xe, loai_sua_chua, sort_order)")
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
            className="flex items-center gap-2 px-5 py-2.5 bg-white text-brand-800 font-bold rounded-xl shadow-sm transition-all hover:bg-white/90"
          >
            <Plus size={16} /> Tạo biên bản
          </Link>
        }
      />

      <KtShortageBanner />

      {/* KPI Cards */}
      <StatGrid cols={4}>
        <StatCard icon={Wrench} label="Biên bản tháng này" value={kpi.totalMonth} loading={loading} />
        <StatCard
          icon={Clock}
          label="Chờ duyệt"
          value={kpi.pendingApproval}
          valueTone={kpi.pendingApproval > 0 ? "warn" : "default"}
          loading={loading}
        />
        <StatCard icon={CheckCircle2} label="Đã duyệt tháng này" value={kpi.approvedMonth} loading={loading} />
        <StatCard icon={ClipboardList} label="Biên bản gần đây" value={recent.length} loading={loading} />
      </StatGrid>

      {/* Recent records */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <span className="font-extrabold text-slate-800">Biên bản gần đây</span>
          <div className="flex items-center gap-3">
            {(() => {
              const ids = recent.filter((r) => (r.maintenance_record_lines || []).length > 0).map((r) => r.id)
              const allExpanded = ids.length > 0 && ids.every((id) => expandedIds.has(id))
              return (
                <ExpandAllToggle
                  allExpanded={allExpanded}
                  disabled={ids.length === 0}
                  onExpandAll={() => setExpandedIds(new Set(ids))}
                  onCollapseAll={() => setExpandedIds(new Set())}
                />
              )
            })()}
            <Link href="/dashboard/maintenance/records" className="text-xs font-bold text-brand-700 hover:underline">Xem tất cả →</Link>
          </div>
        </div>
        {loading && recent.length === 0 ? (
          <ListState kind="loading" />
        ) : recent.length === 0 ? (
          <ListState kind="empty" message="Chưa có biên bản nào" />
        ) : (
          <ResponsiveTableWrapper className="rounded-none border-0 shadow-none">
          <table className="enterprise-table dense min-w-[800px]">
            <thead>
              <tr>
                <th>Mã biên bản</th>
                <th>Hạng mục</th>
                <th>Bộ phận</th>
                <th>Ngày</th>
                <th>Trạng thái</th>
                <th>Ký duyệt</th>
                <ExpandHeaderCell>Thao tác</ExpandHeaderCell>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => {
                const sign = {
                  bundle: resolveSignBundle(r),
                  status: signingStatusByRecord.get(r.id),
                  loaded: signingStatusLoaded,
                  error: signingStatusError,
                }
                const lines = r.maintenance_record_lines || []
                return (
                <ExpandableRow
                  key={r.id}
                  expanded={expandedIds.has(r.id)}
                  onToggle={() => toggleExpanded(r.id)}
                  canExpand={lines.length > 0}
                  colSpan={7}
                  label="Xem thiết bị trong biên bản"
                  endCell={<MaintenanceRowActions recordId={r.id} maBb={r.ma_bb} sign={sign} canPrint={canPrint} onError={(msg) => setToast({ msg, ok: false })} />}
                  detail={<MaintenanceLinesDetail lines={lines} isXe={r.bo_phan === "Đội xe"} />}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    <Link href={`/dashboard/maintenance/records/${r.id}`} className="hover:opacity-80">
                      <DocCodePill code={r.ma_bb} />
                    </Link>
                  </td>
                  <td><HangMucLabel hangMuc={r.hang_muc} /></td>
                  <td className="text-slate-500">{r.bo_phan}</td>
                  <td className="text-slate-500 text-xs whitespace-nowrap">{r.ngay ? new Date(r.ngay).toLocaleDateString("vi-VN") : "—"}</td>
                  <td><StatusBadge domain="maintenance" status={r.trang_thai} /></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <MaintenanceSignCell
                      sign={sign}
                      user={user}
                      canCreate={canCreate && canOwnerAct(r)}
                      onRetry={() => { if (factoryId) void loadSigningStatuses(factoryId, recent) }}
                      onOpenSignPrompt={() => router.push(`/dashboard/maintenance/records/${r.id}`)}
                      onCancelled={() => { if (factoryId) void loadSigningStatuses(factoryId, recent) }}
                      showToast={(msg, ok = true) => setToast({ msg, ok })}
                    />
                  </td>
                </ExpandableRow>
                )
              })}
            </tbody>
          </table>
          </ResponsiveTableWrapper>
        )}
      </div>
    </MaintenanceShell>
  )
}
