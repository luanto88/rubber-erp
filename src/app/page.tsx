"use client"
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
}