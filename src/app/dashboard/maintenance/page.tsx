"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, CheckCircle2, Clock, Plus, Wrench } from "lucide-react"
import { getActiveFactoryId } from "@/lib/auth"
import { supabase } from "@/lib/supabase"
import { MaintenanceShell } from "./_components/maintenance-shell"
import { currencySymbol } from "./_components/maintenance-data"

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
  lines_count: number
}

export default function MaintenanceDashboardPage() {
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [kpi, setKpi] = useState<KpiData>({ totalMonth: 0, pendingApproval: 0, approvedMonth: 0, totalCostUSD: 0 })
  const [recent, setRecent] = useState<RecentRecord[]>([])

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
          .select("id, ma_bb, hang_muc, bo_phan, ngay, trang_thai")
          .eq("factory_id", fid)
          .order("created_at", { ascending: false })
          .limit(8),
      ])

      const allRows = allRes.data || []
      const totalMonth = allRows.length
      const pendingApproval = allRows.filter((r) => r.trang_thai === "cho_duyet").length
      const approvedMonth = allRows.filter((r) => r.trang_thai === "da_duyet").length

      setKpi({ totalMonth, pendingApproval, approvedMonth, totalCostUSD: 0 })
      setRecent((recentRes.data || []) as RecentRecord[])
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

  const statusBadge = (s: string) => {
    if (s === "da_duyet") return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">Đã duyệt</span>
    if (s === "huy") return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-600">Đã hủy</span>
    return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">Chờ duyệt</span>
  }

  return (
    <MaintenanceShell>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Bảo trì</h1>
          <p className="text-sm text-slate-500 mt-0.5">Quản lý sửa chữa và bảo dưỡng thiết bị, xe</p>
        </div>
        <Link
          href="/dashboard/maintenance/records/new"
          className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all"
        >
          <Plus size={16} /> Tạo biên bản
        </Link>
      </div>

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
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {["Mã biên bản", "Hạng mục", "Bộ phận", "Ngày", "Trạng thái"].map((h) => (
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
                  <td className="px-4 py-3">{statusBadge(r.trang_thai)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </MaintenanceShell>
  )
}
