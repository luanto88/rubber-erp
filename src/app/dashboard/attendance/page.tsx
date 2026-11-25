"use client"

// Module Chấm công (rule 31). GĐ C1: tab "Lịch công tháng". GĐ C2: tab "Phiếu điểm danh" (văn phòng duyệt / trả về
// từng phần) + nút mở màn điểm danh của trực ca. GĐ C4: tab "Sổ phép" (phép thưởng + chuỗi 3 tháng). Kế hoạch: .claude/plans/cham-cong-2026-11-19.md.

import { useEffect, useState } from "react"
import Link from "next/link"
import { Award, CalendarDays, ClipboardCheck, ClipboardList, ScanLine } from "lucide-react"
import { getActiveFactoryId, hasPermission, type SessionUser } from "@/lib/auth"
import { PageHeaderBanner } from "@/app/dashboard/_components/page-header-banner"
import { moduleThemeClass } from "@/app/dashboard/_components/doc-ui/module-theme"
import { SegmentedTabs } from "@/app/dashboard/_components/doc-ui/segmented-tabs"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import { AttendanceCalendar } from "./_components/attendance-calendar"
import { SheetReviewList } from "./_components/sheet-review-list"
import { BonusLeaveBook } from "./_components/bonus-leave-book"

type TabKey = "calendar" | "sheets" | "leave"

function readCachedUser(): SessionUser | null {
  try {
    return JSON.parse(localStorage.getItem("erp_user") || "null") as SessionUser | null
  } catch {
    return null
  }
}

export default function AttendancePage() {
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabKey>("calendar")

  useEffect(() => {
    const bootstrap = async () => {
      const cached = readCachedUser()
      if (!hasPermission(cached, "attendance.view")) {
        setLoading(false)
        window.location.replace("/dashboard")
        return
      }
      setUser(cached)
      try {
        const t = new URLSearchParams(window.location.search).get("tab")
        if (t === "sheets" || t === "leave") setTab(t)
      } catch {
        /* bỏ qua */
      }
      const fid = await getActiveFactoryId()
      setFactoryId(fid)
      setLoading(false)
    }
    void bootstrap()
  }, [])

  const isAdmin = user?.role === "admin"
  const canShift = isAdmin || ["attendance.shift_check", "attendance.mark", "attendance.mark_all"].some((p) => hasPermission(user, p))
  const canSeeSheets = canShift || isAdmin || hasPermission(user, "attendance.approve")

  return (
    <div className={`${moduleThemeClass("mint")} space-y-4`}>
      <PageHeaderBanner
        theme="mint"
        icon={ClipboardCheck}
        title="Chấm công"
        subtitle="Ngày công của nhân viên và công nhân theo tháng — điểm danh ca, chấm bổ sung có lý do, nhật ký không sửa được"
        action={
          canShift ? (
            <Link
              href="/dashboard/attendance/shift"
              className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-sm font-bold text-emerald-700 shadow-sm hover:bg-emerald-50"
            >
              <ScanLine size={16} /> Điểm danh ca
            </Link>
          ) : undefined
        }
      />
      <SegmentedTabs
        ariaLabel="Chấm công"
        value={tab}
        onChange={setTab}
        items={[
          { key: "calendar", label: "Lịch công tháng", icon: CalendarDays },
          ...(canSeeSheets ? [{ key: "sheets" as const, label: "Phiếu điểm danh", icon: ClipboardList }] : []),
          { key: "leave", label: "Sổ phép", icon: Award },
        ]}
      />
      {loading ? (
        <ListState kind="loading" />
      ) : !factoryId ? (
        <ListState kind="error" message="Không xác định được nhà máy." />
      ) : tab === "sheets" && canSeeSheets ? (
        <SheetReviewList factoryId={factoryId} />
      ) : tab === "leave" ? (
        <BonusLeaveBook factoryId={factoryId} user={user} />
      ) : (
        <AttendanceCalendar factoryId={factoryId} user={user} />
      )}
    </div>
  )
}
