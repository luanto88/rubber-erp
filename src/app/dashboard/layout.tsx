"use client"
import { useState, useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import { Home, Truck, Warehouse, Package, ClipboardCheck, FileOutput, Settings, LogOut, ChevronRight, Menu, Factory, Map, Shield } from "lucide-react"

const NAV = [
  { key: "/dashboard", label: "Dashboard", icon: Home },
  { key: "/dashboard/map", label: "Bản đồ lô", icon: Map },
  { key: "/dashboard/eudr", label: "EUDR / Truy xuất", icon: Shield },
  { key: "production", label: "Quản lý Sản xuất", icon: Factory, children: [
    { key: "/dashboard/dispatch", label: "Điều xe", icon: Truck },
    { key: "/dashboard/storage", label: "Ngăn lưu", icon: Warehouse },
    { key: "/dashboard/product", label: "Thành phẩm", icon: Package },
    { key: "/dashboard/quality", label: "Chất lượng", icon: ClipboardCheck },
    { key: "/dashboard/export", label: "Xuất hàng", icon: FileOutput },
  ]},
  { key: "/dashboard/settings", label: "Cài đặt", icon: Settings },
]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<any>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ production: true })

  useEffect(() => {
    const u = localStorage.getItem("erp_user")
    if (!u) { router.push("/login"); return }
    setUser(JSON.parse(u))
  }, [router])

  const handleLogout = () => { localStorage.removeItem("erp_user"); localStorage.removeItem("erp_factory"); router.push("/login") }

  if (!user) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full" /></div>

  return (
    <div className="flex min-h-screen">
      <aside className={(collapsed ? "w-16" : "w-64") + " bg-slate-900 text-white transition-all duration-300 flex flex-col flex-shrink-0"}>
        <div className="p-4 flex items-center gap-3 border-b border-slate-700">
          {!collapsed && <><span className="text-2xl">🏭</span><div className="flex-1 min-w-0"><div className="font-extrabold text-sm truncate">PTCS Phước Hòa</div><div className="text-[10px] text-emerald-400 truncate">Quản lý Sản xuất v2.0</div></div></>}
          <button onClick={() => setCollapsed(!collapsed)} className="text-slate-400 hover:text-white"><Menu size={18} /></button>
        </div>
        <nav className="flex-1 py-3 overflow-y-auto">
          {NAV.map(item => {
            if (item.children) {
              const isOpen = expanded[item.key]
              const isChildActive = item.children.some(c => pathname === c.key)
              return (<div key={item.key}>
                <button onClick={() => setExpanded(p => ({ ...p, [item.key]: !p[item.key] }))}
                  className={"w-full flex items-center gap-3 px-4 py-2.5 text-sm font-semibold transition-colors " + (isChildActive ? "text-emerald-400" : "text-slate-300 hover:text-white hover:bg-slate-800")}>
                  <item.icon size={18} />
                  {!collapsed && <><span className="flex-1 text-left">{item.label}</span><ChevronRight size={14} className={"transition-transform " + (isOpen ? "rotate-90" : "")} /></>}
                </button>
                {isOpen && !collapsed && item.children.map(child => (
                  <button key={child.key} onClick={() => router.push(child.key)}
                    className={"w-full flex items-center gap-3 pl-10 pr-4 py-2 text-sm transition-colors " + (pathname === child.key ? "text-emerald-400 bg-slate-800 font-bold" : "text-slate-400 hover:text-white hover:bg-slate-800")}>
                    <child.icon size={15} /><span>{child.label}</span>
                  </button>
                ))}
              </div>)
            }
            return (<button key={item.key} onClick={() => router.push(item.key)}
              className={"w-full flex items-center gap-3 px-4 py-2.5 text-sm font-semibold transition-colors " + (pathname === item.key ? "text-emerald-400 bg-slate-800" : "text-slate-300 hover:text-white hover:bg-slate-800")}>
              <item.icon size={18} />{!collapsed && <span>{item.label}</span>}
            </button>)
          })}
        </nav>
        <div className="p-4 border-t border-slate-700">
          <div className={"flex items-center gap-3 " + (collapsed ? "justify-center" : "")}>
            <div className="w-8 h-8 bg-emerald-600 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">{user.full_name?.[0] || "U"}</div>
            {!collapsed && <div className="flex-1 min-w-0"><div className="text-sm font-bold truncate">{user.full_name}</div><div className="text-[10px] text-slate-400">{user.role}</div></div>}
            <button onClick={handleLogout} className="text-slate-400 hover:text-red-400" title="Đăng xuất"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto"><div className="p-6">{children}</div></main>
    </div>
  )
}