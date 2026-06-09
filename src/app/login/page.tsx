"use client"

import Image from "next/image"
import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ChevronDown } from "lucide-react"
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

type DepartmentOption = {
  id: string
  code: string
  name: string
  sort_order: number
}

const LOGIN_BOOT_TIMEOUT_MS = 8000

const REASON_MESSAGES: Record<string, string> = {
  pending: "Tài khoản đã đăng nhập nhưng đang chờ admin phê duyệt.",
  disabled: "Tài khoản đã bị khóa. Vui lòng liên hệ admin.",
  no_factory: "Tài khoản chưa được gán nhà máy.",
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  return Promise.race<T>([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs)
    }),
  ])
}

function LoginPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [factories, setFactories] = useState<FactoryOption[]>([])
  const [departments, setDepartments] = useState<DepartmentOption[]>([])
  const [factoryId, setFactoryId] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<"login" | "register">("login")
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [dept, setDept] = useState("")
  const [deptOpen, setDeptOpen] = useState(false)
  const deptRef = useRef<HTMLDivElement>(null)
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
      try {
        const [factoryResult, deptResult, sessionResult] = await Promise.allSettled([
          withTimeout(
            supabase.from("factories").select("id, code, name, prefix").order("name").then((r) => r),
            LOGIN_BOOT_TIMEOUT_MS,
            "load factories",
          ),
          withTimeout(
            supabase
              .from("departments")
              .select("id, code, name, sort_order")
              .eq("is_active", true)
              .order("sort_order")
              .then((r) => r),
            LOGIN_BOOT_TIMEOUT_MS,
            "load departments",
          ),
          withTimeout(hydrateActiveSession(), LOGIN_BOOT_TIMEOUT_MS, "hydrate session"),
        ])

        if (!alive) return

        if (factoryResult.status === "fulfilled") {
          const nextFactories = ((factoryResult.value.data || []) as FactoryOption[]) || []
          setFactories(nextFactories)
          if (nextFactories.length && !factoryId) {
            const preferred =
              nextFactories.find((f) => f.prefix === "CSR" || f.name.toLowerCase().includes("kampong")) ??
              nextFactories[0]
            setFactoryId(preferred.id)
          }
        } else {
          setFactories([])
        }

        if (deptResult.status === "fulfilled") {
          setDepartments(((deptResult.value.data || []) as DepartmentOption[]) || [])
        } else {
          setDepartments([])
        }

        if (sessionResult.status === "fulfilled") {
          const { user } = sessionResult.value
          const blockReason = authBlockReason(user)

          if (user && !blockReason) {
            router.replace("/dashboard")
            return
          }

          if (blockReason && blockReason !== "missing") {
            await signOutEverywhere()
            if (alive) setNotice(REASON_MESSAGES[blockReason] || "")
          }
        } else {
          clearLegacySession()
        }
      } catch {
        if (alive) {
          setFactories([])
          setDepartments([])
          clearLegacySession()
          setNotice("Không thể tải phiên đăng nhập tự động. Bạn vẫn có thể đăng nhập thủ công.")
        }
      } finally {
        if (alive) setBooting(false)
      }
    }

    void bootstrap()

    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (reason) setNotice(REASON_MESSAGES[reason] || "")
  }, [reason])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (deptRef.current && !deptRef.current.contains(e.target as Node)) {
        setDeptOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

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
    const normalizedEmail = email.trim().toLowerCase()

    if (!normalizedUsername || !password || !fullName.trim() || !normalizedEmail || !factoryId) {
      setError("Vui lòng nhập đầy đủ thông tin bắt buộc")
      return
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError("Vui lòng nhập email hợp lệ")
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
        email: normalizedEmail,
        department: dept,
        factoryId,
      })

      if (signupError) {
        setError(
          signupError.message.includes("already") ? "Tên đăng nhập đã tồn tại" : signupError.message,
        )
        setLoading(false)
        return
      }

      await supabase.auth.signOut()
      clearLegacySession()
      setNotice("Đăng ký thành công. Tài khoản đang ở trạng thái chờ phê duyệt.")
      setTab("login")
      setPassword("")
      setEmail("")
    } catch {
      setError("Không thể đăng ký. Vui lòng thử lại.")
    }

    setLoading(false)
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
          {booting && (
            <div className="mb-4 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
              <span>Đang kiểm tra phiên đăng nhập và tải dữ liệu ban đầu...</span>
            </div>
          )}

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
                  (tab === item ? "bg-emerald-600 text-white shadow-md" : "text-slate-500 hover:bg-emerald-50")
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
              {factoryOptions.length === 0 && <option value="">Chọn nhà máy</option>}
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
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email cá nhân *"
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-emerald-500"
                />
                <div ref={deptRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setDeptOpen((open) => !open)}
                    className={
                      "flex w-full items-center justify-between rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-emerald-500 " +
                      (dept ? "text-slate-800" : "text-slate-400")
                    }
                  >
                    <span>
                      {dept
                        ? departments.find((d) => d.name === dept)
                          ? `${dept} (${departments.find((d) => d.name === dept)?.code || ""})`
                          : dept
                        : "Phòng ban"}
                    </span>
                    <ChevronDown size={16} className={"transition-transform " + (deptOpen ? "rotate-180" : "")} />
                  </button>
                  {deptOpen && (
                    <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
                      <button
                        type="button"
                        onClick={() => {
                          setDept("")
                          setDeptOpen(false)
                        }}
                        className={
                          "w-full px-4 py-2.5 text-left text-sm hover:bg-emerald-50 " +
                          (!dept ? "bg-emerald-50 font-semibold text-emerald-700" : "text-slate-400")
                        }
                      >
                        Phòng ban
                      </button>
                      {departments.map((department) => (
                        <button
                          key={department.id}
                          type="button"
                          onClick={() => {
                            setDept(department.name)
                            setDeptOpen(false)
                          }}
                          className={
                            "w-full px-4 py-2.5 text-left text-sm hover:bg-emerald-50 " +
                            (dept === department.name
                              ? "bg-emerald-50 font-semibold text-emerald-700"
                              : "text-slate-700")
                          }
                        >
                          {department.name} ({department.code})
                        </button>
                      ))}
                    </div>
                  )}
                </div>
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
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void (tab === "login" ? handleLogin() : handleRegister())
                }
              }}
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
              onClick={() => void (tab === "login" ? handleLogin() : handleRegister())}
              disabled={loading || (tab === "register" && !factoryId)}
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
