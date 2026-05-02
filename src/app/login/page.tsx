"use client"

import Image from "next/image"
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
          if (alive) router.replace("/dashboard")
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (reason) setNotice(REASON_MESSAGES[reason] || "")
  }, [reason])

  const handleLogin = async () => {
    setError("")
    setNotice("")

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
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-emerald-100">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-emerald-100">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex justify-center">
            <Image
              src="/logo-nha-may-5.jpg"
              alt="Logo nhà máy Phước Hòa KPT"
              width={120}
              height={120}
              className="h-28 w-28 rounded-full object-cover shadow-md"
              priority
            />
          </div>
          <h1 className="text-2xl font-extrabold uppercase tracking-tight text-slate-800">
            CTY TNHH PTCS PHƯỚC HÒA KAMPONG THOM
          </h1>
          <p className="mt-2 text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
            NHÀ MÁY CHẾ BIẾN
          </p>
          <p className="mt-2 text-sm font-medium uppercase tracking-[0.18em] text-slate-400">
            HỆ THỐNG QUẢN LÝ SẢN XUẤT
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
          <div className="mb-6 flex gap-2">
            {(["login", "register"] as const).map((item) => (
              <button
                key={item}
                onClick={() => {
                  setTab(item)
                  setError("")
                  setNotice("")
                }}
                className={
                  "flex-1 rounded-full py-2.5 text-sm font-bold transition-all " +
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
              className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-emerald-500"
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
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-emerald-500"
                />
                <input
                  value={dept}
                  onChange={(e) => setDept(e.target.value)}
                  placeholder="Phòng ban"
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-emerald-500"
                />
              </>
            )}

            <input
              value={username}
              onChange={(e) => setUsername(normalizeUsername(e.target.value))}
              placeholder="Tên đăng nhập *"
              className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-emerald-500"
            />

            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mật khẩu *"
              onKeyDown={(e) =>
                e.key === "Enter" && (tab === "login" ? handleLogin() : handleRegister())
              }
              className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-emerald-500"
            />

            {notice && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
                {notice}
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600">
                {error}
              </div>
            )}

            <button
              onClick={tab === "login" ? handleLogin : handleRegister}
              disabled={loading}
              className="w-full rounded-xl bg-emerald-600 py-3 font-bold text-white shadow-md transition-all hover:bg-emerald-700 disabled:opacity-50"
            >
              {loading ? "Đang xử lý..." : tab === "login" ? "Đăng nhập" : "Đăng ký"}
            </button>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">v2.0 · NMCB Phước Hòa KPT © 2026</p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-emerald-100">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  )
}
