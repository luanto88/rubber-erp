"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Map, Plus } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { useScrollReveal } from "@/lib/useScrollReveal"
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { ModuleLauncherFallback } from "./_components/module-launcher-fallback"
import { QuickNotesWidget } from "./_components/quick-notes-widget"
import { OverviewKpiStrip } from "./_components/widgets/overview-kpi-strip"
import { QuickActionsPanel } from "./_components/widgets/quick-actions-panel"
import { ProductionWidget } from "./_components/widgets/production-widget"
import { ProcessDryingWidget } from "./_components/widgets/process-drying-widget"
import { FinishedGoodsWidget } from "./_components/widgets/finished-goods-widget"
import { ExportWidget } from "./_components/widgets/export-widget"
import { QualityWidget } from "./_components/widgets/quality-widget"
import { DispatchWidget } from "./_components/widgets/dispatch-widget"
import { InventoryAlertsWidget } from "./_components/widgets/inventory-alerts-widget"
import { TasksSummaryWidget } from "./_components/widgets/tasks-summary-widget"

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-extrabold text-slate-700 mb-3">{children}</h2>
}

export default function DashboardPage() {
  const router = useRouter()
  const [factoryName, setFactoryName] = useState("")
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)
  const revealRef = useScrollReveal()

  useEffect(() => {
    const load = async () => {
      const { user } = await hydrateActiveSession().catch(() => ({ user: null as SessionUser | null }))
      setCurrentUser(user)
      const fid = user?.factory_id || (await getActiveFactoryId())
      if (!fid) {
        setLoading(false)
        return
      }
      setFactoryId(fid)
      const { data: f } = await supabase.from("factories").select("name").eq("id", fid).single()
      if (f) setFactoryName(f.name)
      setLoading(false)
    }
    void load()
  }, [])

  if (loading) {
    return <div className="p-12 text-center text-slate-400 text-sm">Đang tải...</div>
  }

  if (!factoryId) {
    return <div className="p-12 text-center text-slate-400 text-sm">Không xác định được nhà máy hiện tại.</div>
  }

  if (!hasPermission(currentUser, "dashboard.view")) {
    return <ModuleLauncherFallback user={currentUser} factoryName={factoryName} />
  }

  const widgetProps = { factoryId, user: currentUser }

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div ref={revealRef} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between scroll-reveal">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">{factoryName || "—"}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => router.push("/dashboard/map")}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold rounded-xl text-sm transition-all"
          >
            <Map size={16} /> Bản đồ lô
          </button>
          {hasPermission(currentUser, "settings.manage_config") && (
            <button
              onClick={() => router.push("/dashboard/settings?tab=cau_hinh_nha_may&sub=lo_vuon&action=add")}
              className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm shadow-md transition-all"
            >
              <Plus size={16} /> Tạo Polygon mới
            </button>
          )}
        </div>
      </div>

      {/* ── Tổng quan ──────────────────────────────────────────────────── */}
      <div ref={revealRef} className="scroll-reveal">
        <OverviewKpiStrip {...widgetProps} />
      </div>

      <div ref={revealRef} className="grid grid-cols-1 lg:grid-cols-4 gap-4 scroll-reveal items-stretch">
        <div className="lg:col-span-1 h-full">
          <QuickActionsPanel {...widgetProps} />
        </div>
        <div className="lg:col-span-3 h-full">
          <ProcessDryingWidget {...widgetProps} />
        </div>
      </div>

      {/* ── Sản xuất ───────────────────────────────────────────────────── */}
      <div ref={revealRef} className="scroll-reveal">
        <SectionTitle>Sản xuất</SectionTitle>
        <ProductionWidget {...widgetProps} />
      </div>

      {/* ── Kho & Thành phẩm ───────────────────────────────────────────── */}
      <div ref={revealRef} className="scroll-reveal">
        <SectionTitle>Kho & Thành phẩm</SectionTitle>
        <FinishedGoodsWidget {...widgetProps} />
      </div>

      {/* ── Kinh doanh ─────────────────────────────────────────────────── */}
      <div ref={revealRef} className="scroll-reveal">
        <SectionTitle>Kinh doanh</SectionTitle>
        <ExportWidget {...widgetProps} />
      </div>

      {/* ── Chất lượng ─────────────────────────────────────────────────── */}
      <div ref={revealRef} className="scroll-reveal">
        <SectionTitle>Chất lượng</SectionTitle>
        <QualityWidget {...widgetProps} />
      </div>

      {/* ── Vận chuyển ─────────────────────────────────────────────────── */}
      <div ref={revealRef} className="scroll-reveal">
        <SectionTitle>Vận chuyển</SectionTitle>
        <DispatchWidget {...widgetProps} />
      </div>

      {/* ── Cảnh báo & việc cần làm ────────────────────────────────────── */}
      <div ref={revealRef} className="scroll-reveal">
        <SectionTitle>Cảnh báo & việc cần làm</SectionTitle>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <InventoryAlertsWidget {...widgetProps} />
          <TasksSummaryWidget {...widgetProps} />
        </div>
      </div>

      {/* ── Ghi chú nhanh ─────────────────────────────────────────────── */}
      <QuickNotesWidget factoryId={factoryId} user={currentUser} />
    </div>
  )
}
