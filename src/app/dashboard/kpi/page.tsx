"use client"

// Tổng quan module "Quản lý công việc & Đánh giá KPI nhân viên".
// Phase 0 (2026-07-24): route mới tạo, chỉ có shell + hướng dẫn "sắp có" — Task/5S/Bảng điểm
// KPI chưa có bảng dữ liệu, sẽ thêm dần theo đúng roadmap tại .claude/rules/27-kpi-module.md.

import { useCallback, useEffect, useState } from "react"
import { CheckSquare, Target, Trophy } from "lucide-react"
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { supabase } from "@/lib/supabase"
import { useScrollReveal } from "@/lib/useScrollReveal"
import { KpiShell } from "./_components/kpi-shell"

type PrimaryGroupRow = {
  group_id: string
  personnel_groups: Array<{ name: string | null }> | null
}

// "Công việc" (giao việc) và "Đánh giá 5S" đã có tab riêng trong KpiShell — không còn liệt kê
// ở đây nữa. Chỉ giữ các phần CHƯA build theo roadmap.
const ROADMAP_CARDS = [
  {
    icon: CheckSquare,
    title: "Chấm điểm chuyên môn",
    desc: "Nhập điểm theo khung tiêu chí KPI riêng của từng nhóm/vị trí, hàng tháng.",
  },
  {
    icon: Trophy,
    title: "Bảng điểm KPI",
    desc: "Tổng hợp điểm tháng theo công thức Hoàn thành + Đúng hạn + 5S + Chuyên môn.",
  },
] as const

export default function KpiOverviewPage() {
  const revealRef = useScrollReveal()
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [primaryGroupName, setPrimaryGroupName] = useState<string | null>(null)
  const [primaryGroupChecked, setPrimaryGroupChecked] = useState(false)

  useEffect(() => {
    const bootstrap = async () => {
      const cachedUser = JSON.parse(localStorage.getItem("erp_user") || "null") as SessionUser | null
      if (!hasPermission(cachedUser, "kpi.view")) {
        setLoading(false)
        window.location.replace("/dashboard")
        return
      }
      try {
        const fid = await getActiveFactoryId()
        if (!fid) { setLoading(false); return }
        const { user: sessionUser } = await hydrateActiveSession()
        if (!sessionUser) { setLoading(false); return }
        setFactoryId(fid)
        setUser(sessionUser)
      } finally {
        setLoading(false)
      }
    }
    void bootstrap()
  }, [])

  const loadPrimaryGroup = useCallback(async (fid: string, userId: string) => {
    try {
      const { data } = await supabase
        .from("personnel_group_members")
        .select("group_id, personnel_groups(name), maintenance_staff!inner(profile_id)")
        .eq("factory_id", fid)
        .eq("is_primary", true)
        .eq("maintenance_staff.profile_id", userId)
        .maybeSingle()
      const row = data as PrimaryGroupRow | null
      setPrimaryGroupName(row?.personnel_groups?.[0]?.name?.trim() || null)
    } catch {
      // Bảng/cột chưa sẵn sàng (chưa chạy migration) hoặc lỗi mạng — bỏ qua êm, chỉ là gợi ý phụ.
      setPrimaryGroupName(null)
    } finally {
      setPrimaryGroupChecked(true)
    }
  }, [])

  useEffect(() => {
    if (factoryId && user) void loadPrimaryGroup(factoryId, user.id)
  }, [factoryId, user, loadPrimaryGroup])

  if (loading) {
    return <div className="p-12 text-center text-slate-400">Đang tải...</div>
  }

  return (
    <KpiShell>
      <div className="space-y-4">
        <div ref={revealRef} className="scroll-reveal flex items-center gap-3">
          <div className="hover-lift shrink-0 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-200 via-fuchsia-100 to-indigo-100 shadow-sm">
            <Target size={22} className="text-violet-700" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800">Quản lý công việc &amp; Đánh giá KPI</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Giao việc, theo dõi tiến độ, đánh giá 5S theo khu vực và chấm điểm KPI hàng tháng.
            </p>
          </div>
        </div>

        {primaryGroupChecked && !primaryGroupName && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Bạn chưa được gán <strong>&quot;Nhóm chính&quot;</strong> — nhóm chính quyết định hệ số ×10
            khi tính điểm chuyên môn (các nhóm khác bạn thuộc vẫn tính điểm đầy đủ với hệ số ×5). Liên hệ
            Admin cấu hình tại <strong>Cài đặt → Hệ thống → Nhân sự</strong>.
          </div>
        )}
        {primaryGroupName && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Nhóm chính của bạn: <strong>{primaryGroupName}</strong>
          </div>
        )}

        <div ref={revealRef} className="scroll-reveal bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <h2 className="text-sm font-extrabold text-slate-700 mb-3">Sắp có</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {ROADMAP_CARDS.map((card) => (
              <div key={card.title} className="hover-lift rounded-xl border border-slate-200 bg-gradient-to-br from-white to-violet-50/60 p-4">
                <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100">
                  <card.icon size={16} className="text-violet-600" />
                </div>
                <div className="text-sm font-bold text-slate-700">{card.title}</div>
                <p className="text-xs text-slate-500 mt-1">{card.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </KpiShell>
  )
}
