"use client"

import Image from "next/image"
import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Building2,
  ChevronDown,
  ClipboardCheck,
  Eye,
  EyeOff,
  Leaf,
  Lock,
  LogIn,
  ShieldCheck,
  TrendingUp,
  Truck,
  User,
  Users,
} from "lucide-react"
import { setRememberMe, supabase } from "@/lib/supabase"
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
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
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

// 3 chứng nhận ISO thật của công ty (logo QUACERT 9001/14001 crop lấy đúng dấu "C" tròn,
// ISO 14067 giữ nguyên dạng huy hiệu tròn) — xem .claude/rules/05-ui-components.md mục
// "Pastel Rừng Cao Su — trang Đăng nhập". Không đổi 3 mã này nếu chưa xác nhận lại với người dùng.
// labelKey/titleKey/subtitleKey trỏ vào STRINGS trong customer-portal-i18n.ts — dịch tại thời
// điểm render bằng t(), không lưu chuỗi đã dịch sẵn ở đây (mirror cách `notice` xử lý ở trên).
const ISO_BADGES = [
  { src: "/badges/iso-9001.png", code: "ISO 9001:2015", labelKey: "isoQualityLabel", crop: true },
  { src: "/badges/iso-14001.png", code: "ISO 14001:2015", labelKey: "isoEnvironmentLabel", crop: true },
  { src: "/badges/iso-14067.png", code: "ISO 14067:2018", labelKey: "isoCarbonLabel", crop: false },
] as const

const COMMITMENTS = [
  { icon: ShieldCheck, titleKey: "commitQualityTitle", subtitleKey: "commitQualitySubtitle" },
  { icon: Leaf, titleKey: "commitEnvironmentTitle", subtitleKey: "commitEnvironmentSubtitle" },
  { icon: Users, titleKey: "commitResponsibilityTitle", subtitleKey: "commitResponsibilitySubtitle" },
  { icon: TrendingUp, titleKey: "commitGrowthTitle", subtitleKey: "commitGrowthSubtitle" },
] as const

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
  // "Ghi nhớ đăng nhập" — logic thật nằm ở src/lib/supabase.ts (routedAuthStorage đọc/ghi
  // localStorage hay sessionStorage tuỳ theo cờ này). Đồng bộ ngay khi đổi checkbox (không chờ
  // tới lúc bấm đăng nhập) để có hiệu lực đúng ngay trong lần đăng nhập kế tiếp.
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMeState] = useState(true)

  // Modal "Quên mật khẩu?" — nhập Tên đăng nhập + Email đúng → BE xác nhận khớp hồ sơ → sinh
  // mật khẩu mới, gửi qua email. Server luôn trả cùng 1 thông điệp chung (ok hay không-khớp),
  // không phân biệt để chống dò tài khoản — modal chỉ hiển thị nguyên văn message đó.
  const [forgotOpen, setForgotOpen] = useState(false)
  const [forgotUsername, setForgotUsername] = useState("")
  const [forgotEmail, setForgotEmail] = useState("")
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotMessage, setForgotMessage] = useState("")
  const [forgotError, setForgotError] = useState("")
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

    // Đồng bộ lại cờ ngay trước khi đăng nhập, phòng khi checkbox chưa từng bị đổi (giá trị
    // mặc định true chưa từng ghi localStorage) — đảm bảo routedAuthStorage đọc đúng lựa chọn
    // hiện tại của người dùng cho đúng phiên vừa tạo.
    setRememberMe(rememberMe)
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

  const openForgotPassword = () => {
    setForgotUsername(username)
    setForgotEmail("")
    setForgotMessage("")
    setForgotError("")
    setForgotOpen(true)
  }

  const closeForgotPassword = () => {
    setForgotOpen(false)
    setForgotLoading(false)
  }

  const handleForgotPasswordSubmit = async () => {
    setForgotError("")
    setForgotMessage("")

    if (!forgotUsername.trim() || !forgotEmail.trim()) {
      setForgotError(t("forgotMissingFields"))
      return
    }

    setForgotLoading(true)
    try {
      const res = await fetch("/api/account/forgot-password/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: forgotUsername, email: forgotEmail }),
      })
      const json = await res.json()

      if (!res.ok) {
        // Dịch theo `code` (không phụ thuộc chuỗi tiếng Việt cố định từ server) — 429 (rate-limit)
        // là thông tin an toàn để hiện riêng, không lộ gì về tài khoản.
        const message =
          json.code === "RATE_LIMITED"
            ? t("forgotRateLimited")
            : json.code === "MISSING_FIELDS"
              ? t("forgotMissingFields")
              : t("forgotServerError")
        setForgotError(message)
        setForgotLoading(false)
        return
      }

      // Luôn hiển thị thông điệp đã dịch của client — server chỉ trả `code: "OK"` (xem
      // route.ts), không tin theo `message` tiếng Việt cố định để tránh kẹt ngôn ngữ.
      setForgotMessage(t("forgotSuccessMessage"))
    } catch {
      setForgotError(t("forgotConnectionError"))
    }
    setForgotLoading(false)
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

  // Input màu kem "Pastel Rừng Cao Su" — dùng chung cho username/password (icon prefix bên
  // trái). Không dùng var(--color-x) trong style, chỉ literal hex (bài học 2026-08-24).
  const creamInputClass =
    "w-full rounded-xl border border-[#f0e2b8] bg-[#fdf3d9] py-3 pl-10 pr-4 text-sm text-slate-800 outline-none placeholder:text-slate-500 focus:border-emerald-500"

  return (
    <div className="relative flex min-h-screen w-full flex-col overflow-hidden bg-app-bg lg:block">
      {/* ══ Mobile/tablet (<lg): giữ nguyên hoàn toàn thiết kế cũ đã ổn định — gradient +
          minh hoạ SVG rừng cao su, xếp chồng theo flex-col. Không đổi để tránh rủi ro hồi quy
          trên các màn hình đã test trước đó. ══ */}
      <div className="relative flex shrink-0 flex-col justify-between overflow-hidden bg-gradient-to-br from-brand to-brand-deep px-8 py-8 text-white sm:px-12 sm:py-10 lg:hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "repeating-linear-gradient(52deg, rgba(255,255,255,0.07) 0 2px, transparent 2px 22px)",
          }}
        />
        <svg
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[42%] w-full opacity-[0.16]"
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

        <p className="relative z-10 mt-8 text-xs text-emerald-100/60">v2.0 · NMCB Phước Hòa KPT © 2026</p>
      </div>

      {/* ══ Desktop (lg+): thiết kế mới — ảnh cạo mủ thật (r1.jpg) lấn dần sang phải rồi mờ
          dần hoà vào nền form, không còn cạnh cong cứng. Đã duyệt qua file tham khảo
          cung_cap_dl/thiet_ke_dang_nhap_moi.html trước khi áp dụng vào đây. ══ */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 hidden w-[58%] overflow-hidden lg:block"
      >
        <div
          className="absolute inset-0"
          style={{
            WebkitMaskImage:
              "linear-gradient(to right, #000 0%, #000 52%, rgba(0,0,0,.55) 68%, transparent 92%)",
            maskImage:
              "linear-gradient(to right, #000 0%, #000 52%, rgba(0,0,0,.55) 68%, transparent 92%)",
          }}
        >
          <Image
            src="/login-bg-forest.jpg"
            alt=""
            fill
            priority
            sizes="60vw"
            className="object-cover"
            style={{ objectPosition: "center 30%" }}
          />
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(115deg, rgba(28,58,50,.95) 0%, rgba(28,58,50,.8) 26%, rgba(28,58,50,.4) 48%, rgba(242,248,245,0) 66%)",
            }}
          />
        </div>
      </div>

      <div className="relative z-10 hidden h-screen max-w-[540px] flex-col justify-between py-11 pl-12 text-white lg:flex">
        <div>
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
          <h1 className="text-[44px] font-extrabold leading-[1.12]">{t("factorySubtitle")}</h1>
          <p className="mt-3.5 text-[13px] font-bold uppercase tracking-[0.18em] text-emerald-100/90">
            {t("systemSubtitle")}
          </p>
          <div className="mt-3.5 h-1 w-14 rounded-full bg-emerald-400" />

          <ul className="mt-8 flex flex-col gap-4 text-[13.5px] leading-relaxed text-emerald-50/90">
            <li className="flex items-start gap-3">
              <span className="flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-full bg-[#3f7c66] shadow">
                <Truck size={16} className="text-white" />
              </span>
              {t("featureDispatchBullet")}
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-full bg-[#3f7c66] shadow">
                <ClipboardCheck size={16} className="text-white" />
              </span>
              {t("featureQualityBullet")}
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-full bg-[#3f7c66] shadow">
                <ShieldCheck size={16} className="text-white" />
              </span>
              {t("featureEudrBullet")}
            </li>
          </ul>
        </div>

        <div className="flex items-center gap-3">
          <span className="rounded-full border border-white/25 bg-white/15 px-3 py-1 text-[11px] font-bold">
            v2.0
          </span>
          <span className="text-[11px] text-emerald-100/70">NMCB Phước Hòa KPT © 2026</span>
        </div>
      </div>

      {/* ── Cột phải: form đăng nhập / đăng ký — toàn bộ logic/state giữ nguyên ── */}
      <div className="relative flex flex-1 items-center justify-center px-4 py-10 sm:px-8 lg:absolute lg:inset-0 lg:flex lg:pl-[38%]">
      <div className="relative w-full max-w-md">
        <div className="mb-3 flex justify-end">
          <CustomerPortalLangToggle lang={lang} onChange={changeLang} />
        </div>

        <div className="relative rounded-3xl border border-slate-200 bg-white p-8 pt-14 shadow-xl">
          {/* Avatar tròn nổi lên mép trên card */}
          <div
            className="absolute -top-8 left-1/2 flex h-16 w-16 -translate-x-1/2 items-center justify-center rounded-full border-4 border-white shadow-lg"
            style={{ backgroundImage: "linear-gradient(135deg,#3fae66,#1f8a4c)" }}
            aria-hidden="true"
          >
            <User size={30} className="text-white" />
          </div>

          <h1 className="text-center text-xl font-extrabold text-brand-deep">{t("loginHeading")}</h1>
          <p className="mt-1.5 text-center text-[12.5px] text-slate-500">{t("loginSubheading")}</p>

          <div className="my-5 flex items-center gap-2.5" aria-hidden="true">
            <div className="h-px flex-1 bg-slate-100" />
            <Leaf size={16} className="text-brand" />
            <div className="h-px flex-1 bg-slate-100" />
          </div>

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
            <div className="relative">
              <Building2 size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <select
                value={factoryId}
                onChange={(e) => setFactoryId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none focus:border-emerald-500"
              >
                {factoryOptions.length === 0 && <option value="">{t("selectFactoryPlaceholder")}</option>}
                {factoryOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

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

            <div className="relative">
              <User size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={username}
                onChange={(e) => setUsername(normalizeUsername(e.target.value))}
                placeholder={t("usernamePlaceholder")}
                className={creamInputClass}
              />
            </div>

            <div className="relative">
              <Lock size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("passwordPlaceholder")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void (tab === "login" ? handleLogin() : handleRegister())
                  }
                }}
                className={creamInputClass + " pr-10"}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                aria-label={showPassword ? t("hidePasswordAria") : t("showPasswordAria")}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            {tab === "login" && (
              <div className="flex items-center justify-between text-[12.5px]">
                <label className="flex items-center gap-2 text-slate-600">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => {
                      setRememberMeState(e.target.checked)
                      setRememberMe(e.target.checked)
                    }}
                    className="h-4 w-4 accent-emerald-600"
                  />
                  {t("rememberMeLabel")}
                </label>
                <button
                  type="button"
                  onClick={openForgotPassword}
                  className="font-bold text-brand hover:text-brand-deep"
                >
                  {t("forgotPasswordLabel")}
                </button>
              </div>
            )}

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
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 font-bold uppercase tracking-wide text-white shadow-md transition-all hover:bg-emerald-700 disabled:opacity-50"
            >
              <LogIn size={16} />
              {loading ? t("processingButton") : tab === "login" ? t("loginTab") : t("registerTab")}
            </button>
          </div>

          {/* 3 chứng nhận ISO thật của công ty */}
          <div className="mt-4.5 flex gap-2">
            {ISO_BADGES.map((badge) => (
              <div key={badge.code} className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-white p-2 shadow-[0_2px_10px_rgba(28,58,50,0.08)]">
                <div
                  className="h-8.5 w-8.5 shrink-0 rounded-full border border-slate-100 bg-slate-50 bg-no-repeat"
                  style={
                    badge.crop
                      ? { backgroundImage: `url(${badge.src})`, backgroundSize: "235% auto", backgroundPosition: "2% 4%" }
                      : { backgroundImage: `url(${badge.src})`, backgroundSize: "contain", backgroundPosition: "center" }
                  }
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <b className="block truncate text-[10px] font-extrabold leading-tight text-brand-deep">{badge.code}</b>
                  <span className="block truncate text-[8.5px] text-slate-500">{t(badge.labelKey)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Hàng cam kết thương hiệu */}
        <div className="mt-6 flex justify-between gap-1.5">
          {COMMITMENTS.map((item) => (
            <div key={item.titleKey} className="flex flex-1 flex-col items-center gap-1.5 text-center">
              <div className="flex h-7.5 w-7.5 items-center justify-center rounded-full bg-[#e3f0ea] text-brand">
                <item.icon size={15} />
              </div>
              <b className="text-[10.5px] text-slate-700">{t(item.titleKey)}</b>
              <span className="-mt-1 text-[9px] text-slate-400">{t(item.subtitleKey)}</span>
            </div>
          ))}
        </div>
      </div>
      </div>

      {forgotOpen && (
        <ModalShell title={t("forgotPasswordModalTitle")} onClose={closeForgotPassword} maxWidth="sm">
          {forgotMessage ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {forgotMessage}
              </div>
              <button
                type="button"
                onClick={closeForgotPassword}
                className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white shadow-md transition-all hover:bg-emerald-700"
              >
                {t("closeLabel")}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-slate-500">{t("forgotPasswordDescription")}</p>
              <div className="relative">
                <User size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={forgotUsername}
                  onChange={(e) => setForgotUsername(normalizeUsername(e.target.value))}
                  placeholder={t("forgotUsernamePlaceholder")}
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none focus:border-emerald-500"
                />
              </div>
              <input
                type="email"
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                placeholder={t("forgotEmailPlaceholder")}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleForgotPasswordSubmit()
                }}
                className="w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-emerald-500"
              />
              {forgotError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600">
                  {forgotError}
                </div>
              )}
              <button
                type="button"
                onClick={() => void handleForgotPasswordSubmit()}
                disabled={forgotLoading}
                className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white shadow-md transition-all hover:bg-emerald-700 disabled:opacity-50"
              >
                {forgotLoading ? t("forgotSubmitting") : t("forgotSubmitButton")}
              </button>
            </div>
          )}
        </ModalShell>
      )}
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
