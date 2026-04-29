"use client"

import { useEffect, useMemo, useState } from "react"
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
  pending: "Tai khoan da dang nhap nhung dang cho admin phe duyet.",
  disabled: "Tai khoan da bi khoa. Vui long lien he admin.",
  no_factory: "Tai khoan chua duoc gan nha may.",
}

export default function LoginPage() {
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
          router.replace("/dashboard")
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

    if (!username.trim() || !password) {
      setError("Vui long nhap ten dang nhap va mat khau")
      return
    }

    setLoading(true)

    try {
      const { data, error: authError } = await signInWithUsername(username, password)
      if (authError || !data.user) {
        setError("Sai ten dang nhap hoac mat khau")
        setLoading(false)
        return
      }

      const { user } = await hydrateActiveSession()
      const blockReason = authBlockReason(user)

      if (blockReason) {
        await signOutEverywhere()
        setError(REASON_MESSAGES[blockReason] || "Tai khoan khong the truy cap he thong")
        setLoading(false)
        return
      }

      router.replace("/dashboard")
    } catch {
      setError("Khong the dang nhap. Vui long thu lai.")
    }

    setLoading(false)
  }

  const handleRegister = async () => {
    setError("")
    setNotice("")

    const normalizedUsername = normalizeUsername(username)
    if (!normalizedUsername || !password || !fullName.trim() || !factoryId) {
      setError("Vui long nhap day du thong tin bat buoc")
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
        setError("Ten dang nhap da ton tai")
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
            ? "Ten dang nhap da ton tai"
            : signupError.message,
        )
        setLoading(false)
        return
      }

      await supabase.auth.signOut()
      clearLegacySession()
      setNotice("Dang ky thanh cong. Tai khoan dang o trang thai cho phe duyet.")
      setTab("login")
      setPassword("")
    } catch {
      setError("Khong the dang ky. Vui long thu lai.")
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
          <div className="text-5xl mb-3">🏭</div>
          <h1 className="text-2xl font-extrabold text-slate-800">PTCS Phuoc Hoa</h1>
          <p className="text-sm text-slate-500 mt-1">He thong Quan ly San xuat</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8">
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
                {item === "login" ? "Dang nhap" : "Dang ky"}
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
                  placeholder="Ho ten *"
                  className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm bg-slate-50 outline-none focus:border-emerald-500"
                />
                <input
                  value={dept}
                  onChange={(e) => setDept(e.target.value)}
                  placeholder="Phong ban"
                  className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm bg-slate-50 outline-none focus:border-emerald-500"
                />
              </>
            )}

            <input
              value={username}
              onChange={(e) => setUsername(normalizeUsername(e.target.value))}
              placeholder="Ten dang nhap *"
              className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm bg-slate-50 outline-none focus:border-emerald-500"
            />

            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mat khau *"
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
              {loading ? "Dang xu ly..." : tab === "login" ? "Dang nhap" : "Dang ky"}
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">v2.0 · PTCS Phuoc Hoa © 2019-2026</p>
      </div>
    </div>
  )
}
