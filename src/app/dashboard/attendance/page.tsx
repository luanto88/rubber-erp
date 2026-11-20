"use client"

// Module Chấm công (rule 31). GĐ C1: tab "Lịch công tháng". Các tab Điểm danh ca / Phiếu chờ duyệt (C2), Sổ phép (C4)
// sẽ bổ sung sau. Kế hoạch: .claude/plans/cham-cong-2026-11-19.md.

import { useEffect, useState } from "react"
import { CalendarDays, ClipboardCheck } from "lucide-react"
import { getActiveFactoryId, hasPermission, type SessionUser } from "@/lib/auth"
import { PageHeaderBanner } from "@/app/dashboard/_components/page-header-banner"
import { moduleThemeClass } from "@/app/dashboard/_components/doc-ui/module-theme"
import { SegmentedTabs } from "@/app/dashboard/_components/doc-ui/segmented-tabs"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import { AttendanceCalendar } from "./_components/attendance-calendar"

type TabKey = "calendar"

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
      const fid = await getActiveFactoryId()
      setFactoryId(fid)
      setLoading(false)
    }
    void bootstrap()
  }, [])

  return (
    <div className={`${moduleThemeClass("mint")} space-y-4`}>
      <PageHeaderBanner
        theme="mint"
        icon={ClipboardCheck}
        title="Chấm công"
        subtitle="Ngày công của nhân viên và công nhân theo tháng — điểm danh ca, chấm bổ sung có lý do, nhật ký không sửa được"
      />
      <SegmentedTabs
        ariaLabel="Chấm công"
        value={tab}
        onChange={setTab}
        items={[{ key: "calendar", label: "Lịch công tháng", icon: CalendarDays }]}
      />
      {loading ? (
        <ListState kind="loading" />
      ) : !factoryId ? (
        <ListState kind="error" message="Không xác định được nhà máy." />
      ) : (
        <AttendanceCalendar factoryId={factoryId} user={user} />
      )}
    </div>
  )
}
