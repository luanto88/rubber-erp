"use client"
import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabase"
import { Package, Warehouse, ClipboardCheck, FileOutput, Truck, Plus, Map, TrendingUp, ArrowRight } from "lucide-react"
import { useScrollReveal } from "@/lib/useScrollReveal"
import { useRouter } from "next/navigation"
import { getActiveFactoryId } from "@/lib/auth"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  AreaChart, Area,
} from "recharts"

// ─── Color palette ────────────────────────────────────────────────────────────
const COLORS = {
  emerald: "#10b981",
  blue: "#3b82f6",
  purple: "#8b5cf6",
  amber: "#f59e0b",
  rose: "#f43f5e",
  cyan: "#06b6d4",
  lime: "#84cc16",
  orange: "#f97316",
}

const PIE_COLORS = ["#10b981", "#f59e0b", "#3b82f6", "#8b5cf6", "#f43f5e"]
const BAR_GRADIENT = ["#10b981", "#06b6d4", "#3b82f6", "#8b5cf6", "#f59e0b", "#f97316", "#f43f5e", "#ec4899"]

// ─── Custom Tooltip ───────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white/95 backdrop-blur-lg rounded-xl border border-slate-200 shadow-xl px-4 py-3">
      <p className="text-xs font-bold text-slate-500 mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="text-sm font-bold" style={{ color: p.color }}>
          {p.name}: {typeof p.value === "number" ? p.value.toLocaleString() : p.value}
        </p>
      ))}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter()
  const [stats, setStats] = useState({ lots: 0, ngans: 0, qc: 0, orders: 0, dispatch: 0 })
  const [factoryName, setFactoryName] = useState("")
  const [csrData, setCsrData] = useState<{ name: string; lots: number; banh: number }[]>([])
  const [statusData, setStatusData] = useState<{ name: string; value: number }[]>([])
  const [monthlyData, setMonthlyData] = useState<{ month: string; orders: number; banh: number }[]>([])
  const [recentLots, setRecentLots] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const revealRef = useScrollReveal()

  useEffect(() => {
    const load = async () => {
      const fid = await getActiveFactoryId()
      if (!fid) {
        setLoading(false)
        return
      }

      try {
        // Factory name
        const { data: f } = await supabase.from("factories").select("name, prefix").eq("id", fid).single()
        if (f) setFactoryName(f.name)

        // Counts
        const [lots, ngans, qc, orders, dispatch] = await Promise.all([
          supabase.from("lots").select("id", { count: "exact", head: true }).eq("factory_id", fid),
          supabase.from("ngans").select("id", { count: "exact", head: true }).eq("factory_id", fid),
          supabase.from("qc_results").select("id", { count: "exact", head: true }).eq("factory_id", fid),
          supabase.from("export_orders").select("id", { count: "exact", head: true }).eq("factory_id", fid),
          supabase.from("dispatch_entries").select("id", { count: "exact", head: true }).eq("factory_id", fid),
        ])
        setStats({
          lots: lots.count || 0, ngans: ngans.count || 0, qc: qc.count || 0,
          orders: orders.count || 0, dispatch: dispatch.count || 0
        })

      // ── Charts data ────────────────────────────────────────────────────
      // 1. Lots by CSR type (bar chart)
      const { data: allLots } = await supabase
        .from("lots")
        .select("loai_csr, tong_banh, trang_thai, ngay_sx, ma_lo")
        .eq("factory_id", fid)

      if (allLots) {
        // Group by CSR type
        const csrMap: Record<string, { lots: number; banh: number }> = {}
        const statusMap: Record<string, number> = {}
        allLots.forEach(lot => {
          const csr = lot.loai_csr || "Khác"
          if (!csrMap[csr]) csrMap[csr] = { lots: 0, banh: 0 }
          csrMap[csr].lots++
          csrMap[csr].banh += lot.tong_banh || 0

          const st = lot.trang_thai || "Khác"
          statusMap[st] = (statusMap[st] || 0) + 1
        })

        setCsrData(
          Object.entries(csrMap)
            .map(([name, v]) => ({ name, ...v }))
            .sort((a, b) => b.lots - a.lots)
        )

        setStatusData(
          Object.entries(statusMap)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
        )

        // Recent lots (last 5)
        const sorted = [...allLots]
          .filter(l => l.ngay_sx)
          .sort((a, b) => b.ngay_sx.localeCompare(a.ngay_sx))
          .slice(0, 5)
        setRecentLots(sorted)
      }

      // 2. Export orders by month (area chart)
      const { data: allOrders } = await supabase
        .from("export_orders")
        .select("ngay, tong_banh")
        .eq("factory_id", fid)

      if (allOrders) {
        const monthMap: Record<string, { orders: number; banh: number }> = {}

        // Generate last 12 months
        const now = new Date()
        for (let i = 11; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
          monthMap[key] = { orders: 0, banh: 0 }
        }

        allOrders.forEach(o => {
          if (!o.ngay) return
          const key = o.ngay.slice(0, 7)
          if (monthMap[key]) {
            monthMap[key].orders++
            monthMap[key].banh += o.tong_banh || 0
          }
        })

        setMonthlyData(
          Object.entries(monthMap).map(([month, v]) => {
            const [y, m] = month.split("-")
            return {
              month: `T${parseInt(m)}/${y.slice(2)}`,
              ...v,
            }
          })
        )
      }

      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const cards = [
    { label: "Lô thành phẩm", value: stats.lots, icon: Package, color: "emerald", bg: "from-emerald-500 to-green-600" },
    { label: "Ngăn lưu", value: stats.ngans, icon: Warehouse, color: "blue", bg: "from-blue-500 to-indigo-600" },
    { label: "Kiểm nghiệm", value: stats.qc, icon: ClipboardCheck, color: "purple", bg: "from-purple-500 to-violet-600" },
    { label: "Đơn xuất hàng", value: stats.orders, icon: FileOutput, color: "amber", bg: "from-amber-500 to-orange-600" },
    { label: "Bảng phân xe", value: stats.dispatch, icon: Truck, color: "rose", bg: "from-rose-500 to-red-600" },
  ]

  // Custom pie label
  const renderPieLabel = ({ name, percent }: any) => {
    if (percent < 0.03) return null
    return `${name} (${(percent * 100).toFixed(0)}%)`
  }

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div ref={revealRef} className="flex items-center justify-between scroll-reveal">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">{factoryName || "Đang tải..."}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push("/dashboard/map")}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold rounded-xl text-sm transition-all"
          >
            <Map size={16} /> Bản đồ lô
          </button>
          <button
            onClick={() => router.push("/dashboard/product")}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm shadow-md transition-all"
          >
            <Plus size={16} /> Tạo lô mới
          </button>
        </div>
      </div>

      {/* ── Stat Cards ─────────────────────────────────────────────────── */}
      <div ref={revealRef} className="grid grid-cols-5 gap-4 scroll-reveal">
        {cards.map((c, i) => (
          <div
            key={c.label}
            className="relative overflow-hidden bg-white rounded-2xl border border-slate-200 shadow-md p-5 hover-glow cursor-default group"
            style={{ animationDelay: `${i * 0.05}s` }}
          >
            <div className={`absolute top-0 right-0 w-20 h-20 bg-gradient-to-br ${c.bg} rounded-full opacity-10 -translate-y-6 translate-x-6 group-hover:scale-150 transition-transform duration-500`} />
            <div className="flex items-center gap-3 mb-3 relative">
              <div className={`w-9 h-9 bg-gradient-to-br ${c.bg} rounded-xl flex items-center justify-center`}>
                <c.icon size={18} className="text-white" />
              </div>
              <span className="text-sm font-bold text-slate-600">{c.label}</span>
            </div>
            <div className="text-3xl font-extrabold text-slate-800 relative">
              {loading ? "—" : c.value.toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      {/* ── Charts Row ─────────────────────────────────────────────────── */}
      <div ref={revealRef} className="grid grid-cols-3 gap-4 scroll-reveal">
        {/* Bar Chart: CSR Type Distribution */}
        <div className="col-span-2 bg-white rounded-2xl border border-slate-200 shadow-md p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-slate-700">Sản lượng theo loại CSR</h2>
              <p className="text-xs text-slate-400 mt-0.5">Số lô & tổng bành theo chủng loại sản phẩm</p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Số lô
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-blue-500" /> Tổng bành
              </span>
            </div>
          </div>
          <div className="h-72">
            {loading ? (
              <div className="flex items-center justify-center h-full text-slate-400 text-sm">Đang tải dữ liệu...</div>
            ) : csrData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-400 text-sm">Chưa có dữ liệu</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={csrData} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fontWeight: 600, fill: "#64748b" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 11, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 11, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                    width={50}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar yAxisId="left" dataKey="lots" name="Số lô" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={40} />
                  <Bar yAxisId="right" dataKey="banh" name="Tổng bành" fill="#3b82f6" radius={[6, 6, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Pie Chart: Status Distribution */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-md p-5">
          <div className="mb-4">
            <h2 className="text-base font-bold text-slate-700">Trạng thái lô</h2>
            <p className="text-xs text-slate-400 mt-0.5">Phân bổ theo tình trạng hiện tại</p>
          </div>
          <div className="h-72">
            {loading ? (
              <div className="flex items-center justify-center h-full text-slate-400 text-sm">Đang tải...</div>
            ) : statusData.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-400 text-sm">Chưa có dữ liệu</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="45%"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={3}
                    dataKey="value"
                    label={renderPieLabel}
                    labelLine={{ stroke: "#cbd5e1", strokeWidth: 1 }}
                  >
                    {statusData.map((_, i) => (
                      <Cell
                        key={i}
                        fill={PIE_COLORS[i % PIE_COLORS.length]}
                        stroke="white"
                        strokeWidth={2}
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                  <Legend
                    verticalAlign="bottom"
                    height={36}
                    iconType="circle"
                    iconSize={8}
                    formatter={(value: string) => (
                      <span className="text-xs font-semibold text-slate-600">{value}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* ── Area Chart: Monthly Exports ─────────────────────────────────── */}
      <div ref={revealRef} className="grid grid-cols-3 gap-4 scroll-reveal">
        <div className="col-span-2 bg-white rounded-2xl border border-slate-200 shadow-md p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-slate-700">Xuất hàng theo tháng</h2>
              <p className="text-xs text-slate-400 mt-0.5">12 tháng gần nhất — số đơn & tổng bành xuất</p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-purple-500" /> Số đơn
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-cyan-500" /> Tổng bành
              </span>
            </div>
          </div>
          <div className="h-64">
            {loading ? (
              <div className="flex items-center justify-center h-full text-slate-400 text-sm">Đang tải...</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlyData}>
                  <defs>
                    <linearGradient id="gradOrders" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradBanh" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#06b6d4" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 10, fontWeight: 600, fill: "#64748b" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 11, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                    width={30}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 11, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                    width={50}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="orders"
                    name="Số đơn"
                    stroke="#8b5cf6"
                    strokeWidth={2.5}
                    fill="url(#gradOrders)"
                    dot={{ r: 3, fill: "#8b5cf6", stroke: "white", strokeWidth: 2 }}
                    activeDot={{ r: 5, fill: "#8b5cf6", stroke: "white", strokeWidth: 2 }}
                  />
                  <Area
                    yAxisId="right"
                    type="monotone"
                    dataKey="banh"
                    name="Tổng bành"
                    stroke="#06b6d4"
                    strokeWidth={2.5}
                    fill="url(#gradBanh)"
                    dot={{ r: 3, fill: "#06b6d4", stroke: "white", strokeWidth: 2 }}
                    activeDot={{ r: 5, fill: "#06b6d4", stroke: "white", strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Recent Activity & Quick Actions */}
        <div className="space-y-4">
          {/* Quick Actions */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-md p-5">
            <h2 className="text-base font-bold text-slate-700 mb-3">Thao tác nhanh</h2>
            <div className="space-y-2">
              {[
                { label: "Tạo lô thành phẩm", path: "/dashboard/product", icon: Package, color: "emerald" },
                { label: "Tạo đơn xuất hàng", path: "/dashboard/export", icon: FileOutput, color: "blue" },
                { label: "Xem bản đồ lô", path: "/dashboard/map", icon: Map, color: "purple" },
                { label: "Bảng phân xe", path: "/dashboard/dispatch", icon: Truck, color: "amber" },
              ].map(action => (
                <button
                  key={action.label}
                  onClick={() => router.push(action.path)}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl hover:bg-slate-50 transition-all group text-left"
                >
                  <div className={`w-8 h-8 rounded-lg bg-${action.color}-100 flex items-center justify-center flex-shrink-0`}>
                    <action.icon size={15} className={`text-${action.color}-600`} />
                  </div>
                  <span className="text-sm font-semibold text-slate-700 flex-1">{action.label}</span>
                  <ArrowRight size={14} className="text-slate-300 group-hover:text-slate-500 group-hover:translate-x-0.5 transition-all" />
                </button>
              ))}
            </div>
          </div>

          {/* Recent Lots */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-md p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold text-slate-700">Lô gần đây</h2>
              <button
                onClick={() => router.push("/dashboard/product")}
                className="text-xs font-semibold text-emerald-600 hover:text-emerald-700"
              >
                Xem tất cả →
              </button>
            </div>
            <div className="space-y-2">
              {loading ? (
                <p className="text-xs text-slate-400 text-center py-4">Đang tải...</p>
              ) : recentLots.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4">Chưa có dữ liệu</p>
              ) : (
                recentLots.map((lot, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-50 transition-colors">
                    <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Package size={14} className="text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-slate-700 truncate">{lot.ma_lo}</div>
                      <div className="text-[10px] text-slate-400">
                        {lot.ngay_sx ? new Date(lot.ngay_sx).toLocaleDateString("vi-VN") : "—"} · {lot.loai_csr}
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      lot.trang_thai === "Hoàn thành" ? "bg-emerald-100 text-emerald-700" :
                      lot.trang_thai === "Dở dang" ? "bg-amber-100 text-amber-700" :
                      "bg-slate-100 text-slate-600"
                    }`}>
                      {lot.trang_thai}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
