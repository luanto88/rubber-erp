"use client"

import { useState } from "react"
import { Lock, ShieldAlert } from "lucide-react"
import { getFreshAuthSession } from "@/lib/auth"

// Trang bắt buộc đổi mật khẩu sau khi đăng nhập bằng mật khẩu tạm do luồng "Quên mật khẩu" sinh
// ra (profiles.must_change_password = true). dashboard/layout.tsx tự redirect vào đây, bypass
// toàn bộ sidebar/permission gate — chỉ cần đăng nhập hợp lệ là vào được, không cần quyền gì.
export default function ForceChangePasswordPage() {
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  const handleSubmit = async () => {
    setError("")

    if (newPassword.length < 6) {
      setError("Mật khẩu mới phải có ít nhất 6 ký tự")
      return
    }
    if (newPassword !== confirmPassword) {
      setError("Xác nhận mật khẩu không khớp")
      return
    }

    setSaving(true)
    try {
      const session = await getFreshAuthSession()
      const token = session?.access_token
      if (!token) {
        setError("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại")
        setSaving(false)
        return
      }

      const res = await fetch("/api/account/force-change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ newPassword }),
      })
      const json = await res.json()

      if (!res.ok) {
        setError(json.error || "Không đổi được mật khẩu")
        setSaving(false)
        return
      }

      // Hard nav (không phải router.push) để dashboard/layout.tsx tự bootstrap lại session mới
      // và đọc must_change_password = false từ DB — tránh state client cũ khiến gate redirect
      // ngược lại đúng trang này.
      window.location.replace("/dashboard")
    } catch {
      setError("Lỗi không xác định, vui lòng thử lại")
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-app-bg px-4">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
            <ShieldAlert size={20} />
          </div>
          <div>
            <h1 className="text-lg font-extrabold text-slate-800">Bắt buộc đổi mật khẩu</h1>
            <p className="text-xs text-slate-500">Mật khẩu hiện tại là mật khẩu tạm được cấp qua email</p>
          </div>
        </div>

        <p className="mb-5 text-sm text-slate-600">
          Bạn đang đăng nhập bằng mật khẩu tạm thời được gửi qua email. Vui lòng đặt mật khẩu mới
          do bạn tự chọn trước khi tiếp tục sử dụng hệ thống.
        </p>

        <div className="space-y-4">
          <div className="relative">
            <Lock
              size={16}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Mật khẩu mới (tối thiểu 6 ký tự)"
              className="w-full rounded-xl border border-slate-300 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none focus:border-emerald-500"
            />
          </div>
          <div className="relative">
            <Lock
              size={16}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Xác nhận mật khẩu mới"
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSubmit()
              }}
              className="w-full rounded-xl border border-slate-300 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none focus:border-emerald-500"
            />
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600">
              {error}
            </div>
          )}

          <button
            onClick={() => void handleSubmit()}
            disabled={saving}
            className="w-full rounded-xl bg-emerald-600 py-3 font-bold text-white shadow-md transition-all hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? "Đang lưu..." : "Đổi mật khẩu"}
          </button>
        </div>
      </div>
    </div>
  )
}
