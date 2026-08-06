"use client"

import Image from "next/image"
import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ChevronDown } from "lucide-react"
import { supabase } from "@/lib/supabase"
import {
  authBlockReason,
  clearLegacySession,
  describeAuthError,
  hydrateActiveSession,
  normalizeUsername,
  signInWithUsername,
  signOutEverywhere,
  signUpWithUsername,
} from "@/lib/auth"
import {
  broadcastCustomerPortalLangChange,
  getStoredCustomerPortalLang,
  hasStoredCustomerPortalLang,
  onCustomerPortalLangChange,
  tCustomerPortal,
  type CustomerPortalLang,
} from "@/lib/customer-portal-i18n"
import { CustomerPortalLangToggle } from "@/app/dashboard/customer-portal/_components/lang-toggle"

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
  // Lưu dưới dạng key/reason thay vì chuỗi đã dịch sẵn — thông báo này được set bên trong
  // 1 effect chỉ chạy 1 lần lúc mount (closure có thể "cũ" nếu người dùng đổi ngôn ngữ
  // ngay sau đó); dịch tại thời điểm render (dùng `lang` hiện tại) để luôn đúng ngôn ngữ.
  const [notice, setNotice] = useState<{ kind: "reason"; reason: string } | { kind: "key"; key: Parameters<typeof tCustomerPortal>[1] } | null>(null)
  const [lang, setLang] = useState<CustomerPortalLang>("vi")
  const t = (key: Parameters<typeof tCustomerPortal>[1]) => tCustomerPortal(lang, key)

  const reason = searchParams.get("reason") || ""

  // Mặc định tiếng Việt (đa số người dùng là nhân viên nhà máy) — chỉ theo lựa chọn đã
  // lưu trước đó nếu người dùng (hoặc Customer Portal) đã từng đổi ngôn ngữ tường minh.
  useEffect(() => {
    setLang(hasStoredCustomerPortalLang() ? getStoredCustomerPortalLang() : "vi")
    return onCustomerPortalLangChange(setLang)
  }, [])

  const changeLang = (next: CustomerPortalLang) => {
    setLang(next)
    broadcastCustomerPortalLangChange(next)
  }

  const reasonMessage = (r: string): string => {
    if (r === "pending") return t("reasonPending")
    if (r === "disabled") return t("reasonDisabled")
    if (r === "no_factory") return t("reasonNoFactory")
    return ""
  }

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
            Promise.resolve(supabase.from("factories").select("id, code, name, prefix").order("name")),
            LOGIN_BOOT_TIMEOUT_MS,
            "load factories",
          ),
          withTimeout(
            Promise.resolve(
              supabase
                .from("departments")
                .select("id, code, name, sort_order")
                .eq("is_active", true)
                .order("sort_order"),
            ),
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
            if (alive) setNotice({ kind: "reason", reason: blockReason })
          }
        } else {
          clearLegacySession()
        }
      } catch {
        if (alive) {
          setFactories([])
          setDepartments([])
          clearLegacySession()
          setNotice({ kind: "key", key: "errorCannotLoadSession" })
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
    if (reason) setNotice({ kind: "reason", reason })
  }, [reason])

  const noticeText = notice ? (notice.kind === "reason" ? reasonMessage(notice.reason) : t(notice.key)) : ""

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
    setNotice(null)

    if (!username.trim() || !password) {
      setError(t("errorFillCreds"))
      return
    }

    setLoading(true)

    try {
      const { data, error: authError } = await signInWithUsername(username, password)
      if (authError || !data.user) {
        setError(authError ? describeAuthError(authError) : t("errorWrongCreds"))
        setLoading(false)
        return
      }

      const { user } = await hydrateActiveSession()
      const blockReason = authBlockReason(user)

      if (blockReason) {
        await signOutEverywhere()
        setError(reasonMessage(blockReason) || t("reasonGeneric"))
        setLoading(false)
        return
      }

      router.replace("/dashboard")
    } catch (err) {
      setError(describeAuthError(err))
    }

    setLoading(false)
  }

  const handleRegister = async () => {
    setError("")
    setNotice(null)

    const normalizedUsername = normalizeUsername(username)
    const normalizedEmail = email.trim().toLowerCase()

    if (!normalizedUsername || !password || !fullName.trim() || !normalizedEmail || !factoryId) {
      setError(t("errorFillAllRequired"))
      return
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError(t("errorInvalidEmail"))
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
        setError(t("errorUsernameTaken"))
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
          signupError.message.includes("already") ? t("errorUsernameTaken") : signupError.message,
        )
        setLoading(false)
        return
      }

      await supabase.auth.signOut()
      clearLegacySession()
      setNotice({ kind: "key", key: "registerSuccessNotice" })
      setTab("login")
      setPassword("")
      setEmail("")
    } catch {
      setError(t("errorCannotRegister"))
    }

    setLoading(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-emerald-100">
      <div className="w-full max-w-md">
        <div className="mb-3 flex justify-end">
          <CustomerPortalLangToggle lang={lang} onChange={changeLang} />
        </div>
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
            {t("factorySubtitle")}
          </p>
          <p className="mt-2 text-sm font-medium uppercase tracking-[0.18em] text-slate-400">
            {t("systemSubtitle")}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
          {booting && (
            <div className="mb-4 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
              <span>{t("bootingMessage")}</span>
            </div>
          )}

          <div className="mb-6 flex gap-2">
            {(["login", "register"] as const).map((item) => (
              <button
                key={item}
                onClick={() => {
                  setTab(item)
                  setError("")
                  setNotice(null)
                }}
                className={
                  "flex-1 rounded-full py-2.5 text-sm font-bold transition-all " +
                  (tab === item ? "bg-emerald-600 text-white shadow-md" : "text-slate-500 hover:bg-emerald-50")
                }
              >
                {item === "login" ? t("loginTab") : t("registerTab")}
              </button>
            ))}
          </div>

          <div className="space-y-4">
            <select
              value={factoryId}
              onChange={(e) => setFactoryId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-emerald-500"
            >
              {factoryOptions.length === 0 && <option value="">{t("selectFactoryPlaceholder")}</option>}
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
                  placeholder={t("fullNamePlaceholder")}
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-emerald-500"
                />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("emailPlaceholder")}
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
                        : t("departmentPlaceholder")}
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
                        {t("departmentPlaceholder")}
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
              placeholder={t("usernamePlaceholder")}
              className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-emerald-500"
            />

            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("passwordPlaceholder")}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void (tab === "login" ? handleLogin() : handleRegister())
                }
              }}
              className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-emerald-500"
            />

            {noticeText && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
                {noticeText}
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
              {loading ? t("processingButton") : tab === "login" ? t("loginTab") : t("registerTab")}
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
