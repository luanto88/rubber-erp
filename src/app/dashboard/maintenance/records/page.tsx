"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Filter, Plus, Search, Wrench } from "lucide-react"
import { getActiveFactoryId, hasPermission, type SessionUser } from "@/lib/auth"
import { getFreshAuthSession } from "@/lib/auth"
import { supabase } from "@/lib/supabase"
import { MaintenanceShell } from "../_components/maintenance-shell"
import { BO_PHAN_LIST } from "../_components/maintenance-data"

type RecordRow = {
  id: string
  ma_bb: string | null
  hang_muc: string
  bo_phan: string
  ngay: string
  tu_gio: string | null
  den_gio: string | null
  trang_thai: string
  nguoi_tao: string | null
  created_at: string
}

export default function MaintenanceRecordsPage() {
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [records, setRecords] = useState<RecordRow[]>([])

  const [filterHangMuc, setFilterHangMuc] = useState("")
  const [filterBoPhan, setFilterBoPhan] = useState("")
  const [filterTrangThai, setFilterTrangThai] = useState("")
  const [filterSearch, setFilterSearch] = useState("")

  const loadRecords = useCallback(async (fid: string) => {
    setLoading(true)
    try {
      let q = supabase
        .from("maintenance_records")
        .select("id, ma_bb, hang_muc, bo_phan, ngay, tu_gio, den_gio, trang_thai, nguoi_tao, created_at")
        .eq("factory_id", fid)
        .order("ngay", { ascending: false })
        .order("created_at", { ascending: false })

      if (filterHangMuc) q = q.eq("hang_muc", filterHangMuc)
      if (filterBoPhan) q = q.eq("bo_phan", filterBoPhan)
      if (filterTrangThai) q = q.eq("trang_thai", filterTrangThai)

      const { data } = await q
      setRecords((data || []) as RecordRow[])
    } finally {
      setLoading(false)
    }
  }, [filterHangMuc, filterBoPhan, filterTrangThai])

  useEffect(() => {
    const bootstrap = async () => {
      const fid = await getActiveFactoryId()
      if (!fid) { setLoading(false); return }
      const session = await getFreshAuthSession()
      if (session?.user) {
        const { data: profile } = await supabase.from("profiles").select("*").eq("id", session.user.id).single()
        if (profile) setUser(profile as SessionUser)
      }
      setFactoryId(fid)
    }
    void bootstrap()
  }, [])

  useEffect(() => {
    if (factoryId) void loadRecords(factoryId)
  }, [factoryId, loadRecords])

  const canCreate = hasPermission(user, "maintenance.create")

  const filtered = records.filter((r) => {
    if (!filterSearch) return true
    const q = filterSearch.toLowerCase()
    return (r.ma_bb || "").toLowerCase().includes(q) || r.bo_phan.toLowerCase().includes(q)
  })

  const statusBadge = (s: string) => {
    if (s === "da_duyet") return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">Đã duyệt</span>
    if (s === "huy") return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-600">Đã hủy</span>
    return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">Chờ duyệt</span>
  }

  const hangMucBadge = (h: string) =>
    h === "Sửa chữa"
      ? <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-50 text-red-600">{h}</span>
      : <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700">{h}</span>

  return (
    <MaintenanceShell>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Biên bản bảo trì</h1>
          <p className="text-sm text-slate-500 mt-0.5">Sửa chữa và bảo dưỡng thiết bị, xe</p>
        </div>
        {canCreate && (
          <Link
            href="/dashboard/maintenance/records/new"
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all"
          >
            <Plus size={16} /> Tạo biên bản
          </Link>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-wrap gap-3 items-center">
        <Filter size={15} className="text-slate-400" />
        <select
          value={filterHangMuc}
          onChange={(e) => setFilterHangMuc(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
        >
          <option value="">Tất cả hạng mục</option>
          <option value="Sửa chữa">Sửa chữa</option>
          <option value="Bảo dưỡng">Bảo dưỡng</option>
        </select>
        <select
          value={filterBoPhan}
          onChange={(e) => setFilterBoPhan(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
        >
          <option value="">Tất cả bộ phận</option>
          {BO_PHAN_LIST.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select
          value={filterTrangThai}
          onChange={(e) => setFilterTrangThai(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
        >
          <option value="">Tất cả trạng thái</option>
          <option value="cho_duyet">Chờ duyệt</option>
          <option value="da_duyet">Đã duyệt</option>
          <option value="huy">Đã hủy</option>
        </select>
        <div className="flex items-center gap-2 border border-slate-300 rounded-xl px-3 py-2 flex-1 min-w-[180px]">
          <Search size={14} className="text-slate-400" />
          <input
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
            placeholder="Tìm mã biên bản, bộ phận..."
            className="flex-1 text-sm outline-none bg-transparent"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400">Đang tải...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Wrench size={40} className="mx-auto mb-3 opacity-30" />
            <p>Không có biên bản nào</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {["Mã biên bản", "Hạng mục", "Bộ phận", "Ngày", "Người tạo", "Trạng thái", ""].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((r) => (
                <tr key={r.id} className="row-hover">
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/maintenance/records/${r.id}`} className="font-mono text-xs font-bold text-emerald-700 hover:underline">
                      {r.ma_bb || "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{hangMucBadge(r.hang_muc)}</td>
                  <td className="px-4 py-3 text-slate-600">{r.bo_phan}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{r.ngay ? new Date(r.ngay).toLocaleDateString("vi-VN") : "—"}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{r.nguoi_tao || "—"}</td>
                  <td className="px-4 py-3">{statusBadge(r.trang_thai)}</td>
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/maintenance/records/${r.id}`} className="text-xs font-bold text-blue-600 hover:underline">Chi tiết</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </MaintenanceShell>
  )
}
