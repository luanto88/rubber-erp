const fs = require("fs");
const path = require("path");

const files = {
  ".env.local": `NEXT_PUBLIC_SUPABASE_URL=https://kaoeenrewvltnrbxmjfe.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_cYvSxJUCByOIPO4Psbj9Tw_s_zbZb5Y
NEXTAUTH_SECRET=rubber-erp-secret-change-in-production
NEXTAUTH_URL=http://localhost:3000`,

  "src/lib/supabase.ts": `import { createClient } from '@supabase/supabase-js'
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
export const supabase = createClient(supabaseUrl, supabaseKey)`,

  "src/lib/utils.ts": `export const fmtKg = (v: number) => v.toLocaleString("vi-VN")
export const fmtDate = (d: string) => {
  if (!d) return ""
  if (d.includes("-")) return d.split("-").reverse().join("/")
  return d
}
export const fmtNum = (n: number) => String(n).padStart(2, "0")`,

  "src/app/globals.css": `@tailwind base;
@tailwind components;
@tailwind utilities;
body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }`,

  "src/app/layout.tsx": `import type { Metadata } from "next"
import "./globals.css"
export const metadata: Metadata = {
  title: "Rubber Factory ERP | PTCS Phước Hòa",
  description: "Hệ thống quản lý sản xuất cao su",
}
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="vi"><body className="bg-slate-100 min-h-screen">{children}</body></html>)
}`,

  "src/app/page.tsx": `"use client"
import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabase"
import { useRouter } from "next/navigation"

export default function LoginPage() {
  const router = useRouter()
  const [factory, setFactory] = useState("phuochoa_kt")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState("login")
  const [fullName, setFullName] = useState("")
  const [dept, setDept] = useState("")

  useEffect(() => {
    const user = localStorage.getItem("erp_user")
    if (user) router.push("/dashboard")
  }, [router])

  const handleLogin = async () => {
    setError(""); setLoading(true)
    try {
      const { data, error: err } = await supabase
        .from("users").select("*").eq("username", username).eq("status", "active").single()
      if (err || !data) { setError("Tài khoản không tồn tại hoặc chưa được duyệt"); setLoading(false); return }
      if (data.password_hash !== password) { setError("Sai mật khẩu"); setLoading(false); return }
      localStorage.setItem("erp_user", JSON.stringify(data))
      localStorage.setItem("erp_factory", data.factory_id)
      router.push("/dashboard")
    } catch(e) { setError("Lỗi kết nối"); }
    setLoading(false)
  }

  const handleRegister = async () => {
    if (!username || !password || !fullName) { setError("Vui lòng nhập đầy đủ"); return }
    setError(""); setLoading(true)
    try {
      const { data: fData } = await supabase.from("factories").select("id").eq("code", factory).single()
      if (!fData) { setError("Nhà máy không hợp lệ"); setLoading(false); return }
      const { error: err } = await supabase.from("users").insert({
        username, password_hash: password, full_name: fullName,
        role: "user", factory_id: fData.id, department: dept, status: "pending",
      })
      if (err) { setError(err.code === "23505" ? "Tên đăng nhập đã tồn tại" : err.message); setLoading(false); return }
      setError(""); setTab("login")
      alert("Đăng ký thành công! Chờ Admin duyệt tài khoản.")
    } catch(e) { setError("Lỗi kết nối"); }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-emerald-100">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🏭</div>
          <h1 className="text-2xl font-extrabold text-slate-800">PTCS Phước Hòa</h1>
          <p className="text-sm text-slate-500 mt-1">Hệ thống Quản lý Sản xuất</p>
        </div>
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8">
          <div className="flex gap-2 mb-6">
            {["login", "register"].map(t => (
              <button key={t} onClick={() => { setTab(t); setError(""); }}
                className={"flex-1 py-2.5 rounded-full text-sm font-bold transition-all " + (tab === t ? "bg-emerald-600 text-white shadow-md" : "text-slate-500 hover:bg-emerald-50")}>
                {t === "login" ? "Đăng nhập" : "Đăng ký"}
              </button>
            ))}
          </div>
          <div className="space-y-4">
            <select value={factory} onChange={e => setFactory(e.target.value)}
              className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm bg-slate-50 outline-none focus:border-emerald-500">
              <option value="phuochoa_kt">Phước Hòa Kampong Thom (CSR)</option>
              <option value="cuaparis">Cuaparis HCM (SVR)</option>
            </select>
            {tab === "register" && (<>
              <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Họ tên *"
                className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm bg-slate-50 outline-none focus:border-emerald-500" />
              <input value={dept} onChange={e => setDept(e.target.value)} placeholder="Phòng ban"
                className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm bg-slate-50 outline-none focus:border-emerald-500" />
            </>)}
            <input value={username} onChange={e => setUsername(e.target.value)} placeholder="Tên đăng nhập *"
              className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm bg-slate-50 outline-none focus:border-emerald-500" />
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Mật khẩu *"
              onKeyDown={e => e.key === "Enter" && (tab === "login" ? handleLogin() : handleRegister())}
              className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm bg-slate-50 outline-none focus:border-emerald-500" />
            {error && <div className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2.5">{error}</div>}
            <button onClick={tab === "login" ? handleLogin : handleRegister} disabled={loading}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all disabled:opacity-50">
              {loading ? "..." : tab === "login" ? "Đăng nhập" : "Đăng ký"}
            </button>
          </div>
        </div>
        <p className="text-center text-xs text-slate-400 mt-6">v2.0 · PTCS Phước Hòa © 2025</p>
      </div>
    </div>
  )
}`,

  "src/app/dashboard/layout.tsx": `"use client"
import { useState, useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import { Home, Truck, Warehouse, Package, ClipboardCheck, FileOutput, Settings, LogOut, ChevronRight, Menu, Factory } from "lucide-react"

const NAV = [
  { key: "/dashboard", label: "Dashboard", icon: Home },
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
    if (!u) { router.push("/"); return }
    setUser(JSON.parse(u))
  }, [router])

  const handleLogout = () => { localStorage.removeItem("erp_user"); localStorage.removeItem("erp_factory"); router.push("/") }

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
}`,

  "src/app/dashboard/page.tsx": `"use client"
import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabase"
import { Package, Warehouse, ClipboardCheck, FileOutput, Truck } from "lucide-react"

export default function DashboardPage() {
  const [stats, setStats] = useState({ lots: 0, ngans: 0, qc: 0, orders: 0, dispatch: 0 })
  const [factoryName, setFactoryName] = useState("")

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
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold text-slate-800">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">{factoryName || "Đang tải..."}</p>
      </div>
      <div className="grid grid-cols-5 gap-4 mb-8">
        {cards.map(c => (
          <div key={c.label} className="bg-white rounded-2xl border border-slate-200 shadow-md p-5 hover:shadow-lg transition-all">
            <div className="flex items-center gap-3 mb-3">
              <c.icon size={20} className="text-emerald-600" />
              <span className="text-sm font-bold text-slate-600">{c.label}</span>
            </div>
            <div className="text-3xl font-extrabold text-slate-800">{c.value}</div>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-md p-6">
        <h2 className="text-lg font-bold text-slate-700 mb-4">Hệ thống đã sẵn sàng</h2>
        <p className="text-sm text-slate-500">Chọn module từ menu bên trái để bắt đầu.</p>
      </div>
    </div>
  )
}`,
};

// Module placeholders
const modules = {
  "dispatch": "Điều xe", "storage": "Ngăn lưu", "product": "Thành phẩm",
  "quality": "Chất lượng", "export": "Xuất hàng", "settings": "Cài đặt"
};
Object.entries(modules).forEach(([key, label]) => {
  files[`src/app/dashboard/${key}/page.tsx`] = `"use client"\nexport default function Page() {\n  return (\n    <div>\n      <h1 className="text-2xl font-extrabold text-slate-800 mb-4">${label}</h1>\n      <div className="bg-white rounded-2xl border border-slate-200 shadow-md p-8 text-center">\n        <p className="text-slate-400">Module đang được phát triển...</p>\n      </div>\n    </div>\n  )\n}`;
});

// Write all files
let count = 0;
Object.entries(files).forEach(([filePath, content]) => {
  const fullPath = path.join(process.cwd(), filePath);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
  count++;
  console.log("  ✓ " + filePath);
});

console.log("\n✅ " + count + " files created successfully!");
console.log("\nNext steps:");
console.log("  1. npm install @supabase/supabase-js lucide-react xlsx");
console.log("  2. npm run dev");
console.log("  3. Open http://localhost:3000");
console.log("  4. Login: admin / admin123");
