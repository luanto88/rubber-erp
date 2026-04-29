"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import {
  authBlockReason,
  clearLegacySession,
  hydrateActiveSession,
  normalizeUsername,
  signInWithUsername,
  signOutEverywhere,
  signUpWithUsername,
  type SessionUser,
} from "@/lib/auth"

type FactoryOption = {
  id: string
  code: string
  name: string
  prefix: string
}

const REASON_MESSAGES: Record<string, string> = {
  pending: "Tài khoản đã đăng nhập nhưng đang chờ admin phê duyệt.",
  disabled: "Tài khoản đã bị khóa. Vui lòng liên hệ admin.",
  no_factory: "Tài khoản chưa được gán nhà máy.",
}

function LoginPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [factories, setFactories] = useState<FactoryOption[]>([])
  const [factoryId, setFactoryId] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<"login" | "register">("login")
  const [fullName, setFullName] = useState("")
  const [dept, setDept] = useState("")
  const [booting, setBooting] = useState(true)
  const [notice, setNotice] = useState("")
  const [activeSessionUser, setActiveSessionUser] = useState<SessionUser | null>(null)

  const reason = searchParams.get("reason") || ""

  const factoryOptions = useMemo(
    () =>
      factories.map((item) => ({
        id: item.id,
        label: `${item.name} (${item.prefix})`,
      })),
    [factories],
  )

  useEffect(() => {
    let alive = true

    const bootstrap = async () => {
      const { data } = await supabase
        .from("factories")
        .select("id, code, name, prefix")
        .order("name")

      if (alive) {
        const nextFactories = (data || []) as FactoryOption[]
        setFactories(nextFactories)
        if (nextFactories[0] && !factoryId) setFactoryId(nextFactories[0].id)
      }

      try {
        const { user } = await hydrateActiveSession()
        const blockReason = authBlockReason(user)

        if (user && !blockReason) {
          if (alive) setActiveSessionUser(user)
          return
        }

        if (blockReason && blockReason !== "missing") {
          await signOutEverywhere()
          if (alive) setNotice(REASON_MESSAGES[blockReason] || "")
        }
      } catch {
        clearLegacySession()
      } finally {
        if (alive) setBooting(false)
      }
    }

    bootstrap()

    return () => {
      alive = false
    }
  }, [factoryId, router])

  useEffect(() => {
    if (reason) setNotice(REASON_MESSAGES[reason] || "")
  }, [reason])

  const handleLogin = async () => {
    setError("")
    setNotice("")
    setActiveSessionUser(null)

    if (!username.trim() || !password) {
      setError("Vui lòng nhập tên đăng nhập và mật khẩu")
      return
    }

    setLoading(true)

    try {
      const { data, error: authError } = await signInWithUsername(username, password)
      if (authError || !data.user) {
        setError("Sai tên đăng nhập hoặc mật khẩu")
        setLoading(false)
        return
      }

      const { user } = await hydrateActiveSession()
      const blockReason = authBlockReason(user)

      if (blockReason) {
        await signOutEverywhere()
        setError(REASON_MESSAGES[blockReason] || "Tài khoản không thể truy cập hệ thống")
        setLoading(false)
        return
      }

      router.replace("/dashboard")
    } catch {
      setError("Không thể đăng nhập. Vui lòng thử lại.")
    }

    setLoading(false)
  }

  const handleRegister = async () => {
    setError("")
    setNotice("")
    setActiveSessionUser(null)

    const normalizedUsername = normalizeUsername(username)
    if (!normalizedUsername || !password || !fullName.trim() || !factoryId) {
      setError("Vui lòng nhập đầy đủ thông tin bắt buộc")
      return
    }

    setLoading(true)

    try {
      const existingProfile = await supabase
        .from("profiles")
        .select("id")
        .eq("username", normalizedUsername)
        .maybeSingle()

      if (existingProfile.error) {
        setError(existingProfile.error.message)
        setLoading(false)
        return
      }

      if (existingProfile.data) {
        setError("Tên đăng nhập đã tồn tại")
        setLoading(false)
        return
      }

      const { error: signupError } = await signUpWithUsername({
        username: normalizedUsername,
        password,
        fullName,
        department: dept,
        factoryId,
      })

      if (signupError) {
        setError(
          signupError.message.includes("already")
            ? "Tên đăng nhập đã tồn tại"
            : signupError.message,
        )
        setLoading(false)
        return
      }

      await supabase.auth.signOut()
      clearLegacySession()
      setNotice("Đăng ký thành công. Tài khoản đang ở trạng thái chờ phê duyệt.")
      setTab("login")
      setPassword("")
    } catch {
      setError("Không thể đăng ký. Vui lòng thử lại.")
    }

    setLoading(false)
  }

  if (booting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-emerald-100">
        <div className="animate-spin w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-emerald-100">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3" aria-hidden="true">🏭</div>
          <h1 className="text-2xl font-extrabold text-slate-800">PTCS Phước Hòa</h1>
          <p className="text-sm text-slate-500 mt-1">Hệ thống Quản lý Sản xuất</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8">
          {activeSessionUser ? (
            <div className="space-y-5">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
                <p className="text-sm font-semibold text-emerald-800">Bạn đang đăng nhập</p>
                <p className="mt-1 text-base font-bold text-slate-800">{activeSessionUser.full_name}</p>
                <p className="mt-1 text-sm text-slate-600">
                  {activeSessionUser.role} · {activeSessionUser.username}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3">
                <button
                  onClick={() => router.replace("/dashboard")}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all"
                >
                  Vào dashboard
                </button>
                <button
                  onClick={async () => {
                    setLoading(true)
                    setError("")
                    try {
                      await signOutEverywhere()
                      setActiveSessionUser(null)
                      setNotice("Đã đăng xuất. Bạn có thể đăng nhập bằng tài khoản khác.")
                    } catch {
                      setError("Không thể đăng xuất. Vui lòng thử lại.")
                    } finally {
                      setLoading(false)
                    }
                  }}
                  disabled={loading}
                  className="w-full py-3 bg-white hover:bg-slate-50 text-slate-700 font-bold rounded-xl border border-slate-300 transition-all disabled:opacity-50"
                >
                  {loading ? "Đang xử lý..." : "Đăng xuất để đổi tài khoản"}
                </button>
              </div>
            </div>
          ) : (
            <>
          <div className="flex gap-2 mb-6">
            {(["login", "register"] as const).map((item) => (
              <button
                key={item}
                onClick={() => {
                  setTab(item)
                  setError("")
                  setNotice("")
                }}
                className={
                  "flex-1 py-2.5 rounded-full text-sm font-bold transition-all " +
                  (tab === item
                    ? "bg-emerald-600 text-white shadow-md"
                    : "text-slate-500 hover:bg-emerald-50")
                }
              >
                {item === "login" ? "Đăng nhập" : "Đăng ký"}
              </button>
            ))}
          </div>

          <div className="space-y-4">
            <select
              value={factoryId}
              onChange={(e) => setFactoryId(e.target.value)}
              className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm bg-slate-50 outline-none focus:border-emerald-500"
            >
              {factoryOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>

            {tab === "register" && (
              <>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Họ tên *"
                  className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm bg-slate-50 outline-none focus:border-emerald-500"
                />
                <input
                  value={dept}
                  onChange={(e) => setDept(e.target.value)}
                  placeholder="Phòng ban"
                  className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm bg-slate-50 outline-none focus:border-emerald-500"
                />
              </>
            )}

            <input
              value={username}
              onChange={(e) => setUsername(normalizeUsername(e.target.value))}
              placeholder="Tên đăng nhập *"
              className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm bg-slate-50 outline-none focus:border-emerald-500"
            />

            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mật khẩu *"
              onKeyDown={(e) =>
                e.key === "Enter" && (tab === "login" ? handleLogin() : handleRegister())
              }
              className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm bg-slate-50 outline-none focus:border-emerald-500"
            />

            {notice && (
              <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
                {notice}
              </div>
            )}

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
                {error}
              </div>
            )}

            <button
              onClick={tab === "login" ? handleLogin : handleRegister}
              disabled={loading}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all disabled:opacity-50"
            >
              {loading ? "Đang xử lý..." : tab === "login" ? "Đăng nhập" : "Đăng ký"}
            </button>
          </div>
            </>
          )}
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">v2.0 · PTCS Phước Hòa © 2019-2026</p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-emerald-100">
          <div className="animate-spin w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full" />
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  )
}
