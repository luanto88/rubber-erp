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

// Tăng từ 8s → 15s: trên mạng mobile chậm (chuyển 4G↔wifi, sóng yếu), 8s hay không đủ để tải
// xong danh sách nhà máy, khiến dropdown "Chọn nhà máy" chỉ còn placeholder rỗng một cách im
// lặng. 15s vẫn đủ nhanh cho trải nghiệm bình thường, đồng thời có nút "Thử lại" bên dưới cho
// trường hợp thực sự thất bại thay vì để người dùng không biết vì sao dropdown trống.
const LOGIN_BOOT_TIMEOUT_MS = 15000

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
  // Tăng số này để chủ động chạy lại effect bootstrap bên dưới (nút "Thử lại" khi tải danh
  // sách nhà máy thất bại do mạng chậm) — không dùng router.refresh()/window.location.reload()
  // để tránh mất state form (username/password đã gõ dở, tab đang chọn...).
  const [bootAttempt, setBootAttempt] = useState(0)
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
    setBooting(true)

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
  }, [bootAttempt])

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
    <div className="relative flex min-h-screen w-full flex-col overflow-hidden bg-white lg:flex-row">
      {/* ── Cột trái: nhận diện thương hiệu — đầy đủ trên desktop, thu gọn trên mobile ── */}
      <div className="relative flex shrink-0 flex-col justify-between overflow-hidden bg-gradient-to-br from-brand to-brand-deep px-8 py-8 text-white sm:px-12 sm:py-10 lg:w-[42%] lg:px-14 lg:py-14 xl:w-[38%]">
        {/* Hoa văn "rãnh cạo mủ" — đồng bộ với sidebar dashboard (bg-brand), xem
            .claude/rules/05-ui-components.md mục "Pastel Rừng Cao Su". Literal rgba,
            không dùng var() trong style inline (bài học 2026-08-24 mục 6). */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "repeating-linear-gradient(52deg, rgba(255,255,255,0.07) 0 2px, transparent 2px 22px)",
          }}
        />
        {/* Minh hoạ rừng cao su rất mờ phía dưới — SVG tự vẽ, không tải asset ngoài.
            Path giữ nguyên như bản 1 cột cũ, chỉ đổi stroke sang trắng cho nền tối. */}
        <svg
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[42%] w-full opacity-[0.16] lg:h-[36%]"
          viewBox="0 0 800 320"
          preserveAspectRatio="xMidYMax slice"
          aria-hidden="true"
        >
          <g fill="none" stroke="#ffffff" strokeWidth="2.4">
            <path d="M60 320 V220 M60 220 C10 200 10 150 60 140 C60 100 110 90 110 140 C160 150 160 200 110 220 V320" />
            <path d="M180 320 V190 M180 190 C130 170 130 110 180 100 C180 50 240 40 240 100 C290 110 290 170 240 190 V320" />
            <path d="M310 320 V230 M310 230 C265 214 265 168 310 158 C310 122 360 114 360 158 C405 168 405 214 360 230 V320" />
            <path d="M450 320 V170 M450 170 C395 148 395 82 450 70 C450 14 518 4 518 70 C573 82 573 148 518 170 V320" />
            <path d="M600 320 V220 M600 220 C555 204 555 158 600 148 C600 112 650 104 650 148 C695 158 695 204 650 220 V320" />
            <path d="M730 320 V210 M730 210 C685 194 685 148 730 138 C730 102 780 94 780 138 C825 148 825 194 780 210 V320" />
          </g>
        </svg>

        <div className="relative z-10">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white/30 bg-white shadow-md">
              <Image
                src="/logo-nha-may-5.jpg"
                alt="Logo nhà máy Phước Hòa KPT"
                width={56}
                height={56}
                className="h-11 w-11 object-contain"
                priority
              />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-extrabold uppercase tracking-tight">
                CTY TNHH PTCS PHƯỚC HÒA
              </div>
              <div className="truncate text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-200">
                Kampong Thom
              </div>
            </div>
          </div>
          <h1 className="text-2xl font-extrabold leading-snug sm:text-3xl">{t("factorySubtitle")}</h1>
          <p className="mt-3 text-sm font-medium uppercase tracking-[0.18em] text-emerald-100/80">
            {t("systemSubtitle")}
          </p>
        </div>

        <ul className="relative z-10 mt-10 hidden flex-col gap-3 text-sm text-emerald-50/90 lg:flex">
          <li className="flex items-center gap-2.5">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300" />
            Điều xe · Kho nguyên liệu · Thành phẩm — theo dõi xuyên suốt dây chuyền
          </li>
          <li className="flex items-center gap-2.5">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300" />
            Kiểm nghiệm chất lượng theo TCCS/TCVN, gắn liền xuất hàng
          </li>
          <li className="flex items-center gap-2.5">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300" />
            Truy xuất chuỗi cung ứng EUDR đến từng lô vườn cao su
          </li>
        </ul>

        <p className="relative z-10 mt-8 text-xs text-emerald-100/60 lg:mt-0">
          v2.0 · NMCB Phước Hòa KPT © 2026
        </p>
      </div>

      {/* ── Cột phải: form đăng nhập / đăng ký — toàn bộ logic/state giữ nguyên ── */}
      <div className="relative flex flex-1 items-center justify-center bg-app-bg px-4 py-10 sm:px-8">
      <div className="relative w-full max-w-md">
        <div className="mb-3 flex justify-end">
          <CustomerPortalLangToggle lang={lang} onChange={changeLang} />
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
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

            {!booting && factoryOptions.length === 0 && (
              <div className="flex items-center justify-between gap-3 rounded-xl bg-amber-50 px-4 py-2.5 text-xs text-amber-700">
                <span>{t("factoriesLoadFailedHint")}</span>
                <button
                  type="button"
                  onClick={() => setBootAttempt((n) => n + 1)}
                  className="shrink-0 rounded-lg bg-amber-100 px-3 py-1.5 font-bold hover:bg-amber-200"
                >
                  {t("retryLoadFactories")}
                </button>
              </div>
            )}

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
      </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-app-bg">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  )
}
