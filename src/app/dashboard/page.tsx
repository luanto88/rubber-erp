"use client"
import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabase"
import { Package, Warehouse, ClipboardCheck, FileOutput, Truck } from "lucide-react"
import { useScrollReveal } from "@/lib/useScrollReveal"

export default function DashboardPage() {
  const [stats, setStats] = useState({ lots: 0, ngans: 0, qc: 0, orders: 0, dispatch: 0 })
  const [factoryName, setFactoryName] = useState("")
  const revealRef = useScrollReveal()

  useEffect(() => {
    const load = async () => {
      const fid = localStorage.getItem("erp_factory")
      if (!fid) return
      const { data: f } = await supabase.from("factories").select("name, prefix").eq("id", fid).single()
      if (f) setFactoryName(f.name)
      const [lots, ngans, qc, orders, dispatch] = await Promise.all([
        supabase.from("lots").select("id", { count: "exact", head: true }).eq("factory_id", fid),
        supabase.from("ngans").select("id", { count: "exact", head: true }).eq("factory_id", fid),
        supabase.from("qc_results").select("id", { count: "exact", head: true }).eq("factory_id", fid),
        supabase.from("export_orders").select("id", { count: "exact", head: true }).eq("factory_id", fid),
        supabase.from("dispatch_entries").select("id", { count: "exact", head: true }).eq("factory_id", fid),
      ])
      setStats({ lots: lots.count || 0, ngans: ngans.count || 0, qc: qc.count || 0, orders: orders.count || 0, dispatch: dispatch.count || 0 })
    }
    load()
  }, [])

  const cards = [
    { label: "Lô thành phẩm", value: stats.lots, icon: Package, color: "emerald" },
    { label: "Ngăn lưu", value: stats.ngans, icon: Warehouse, color: "blue" },
    { label: "Kiểm nghiệm", value: stats.qc, icon: ClipboardCheck, color: "purple" },
    { label: "Đơn xuất hàng", value: stats.orders, icon: FileOutput, color: "amber" },
    { label: "Bảng phân xe", value: stats.dispatch, icon: Truck, color: "rose" },
  ]

  return (
    <div>
      <div className="mb-8" ref={revealRef}>
        <h1 className="text-2xl font-extrabold text-slate-800 scroll-reveal">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">{factoryName || "Đang tải..."}</p>
      </div>
      <div ref={revealRef} className="grid grid-cols-5 gap-4 mb-8 scroll-reveal">
        {cards.map(c => (
          <div key={c.label} className="bg-white rounded-2xl border border-slate-200 shadow-md p-5 hover-glow cursor-default">
            <div className="flex items-center gap-3 mb-3">
              <c.icon size={20} className="text-emerald-600" />
              <span className="text-sm font-bold text-slate-600">{c.label}</span>
            </div>
            <div className="text-3xl font-extrabold text-slate-800">{c.value}</div>
          </div>
        ))}
      </div>
      <div ref={revealRef} className="bg-white rounded-2xl border border-slate-200 shadow-md p-6 scroll-reveal">
        <h2 className="text-lg font-bold text-slate-700 mb-4">Hệ thống đã sẵn sàng</h2>
        <p className="text-sm text-slate-500">Chọn module từ menu bên trái để bắt đầu.</p>
      </div>
    </div>
  )
}