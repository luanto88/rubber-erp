"use client"

// Module Định mức Kinh tế Kỹ thuật chế biến (rule 30). GĐ1: tab "Cấu hình định mức". GĐ2: tab "Nhập liệu"
// (đồng hồ điện nước, kiểm kê tồn xưởng). GĐ3: tab "Đối soát". GĐ4: tab "Báo cáo" (báo cáo kỳ + ký số).

import { useEffect, useState } from "react"
import { Calculator, FileSignature, NotebookPen, Scale, Settings2 } from "lucide-react"
import { getActiveFactoryId, hasPermission, type SessionUser } from "@/lib/auth"
import { PageHeaderBanner } from "@/app/dashboard/_components/page-header-banner"
import { moduleThemeClass } from "@/app/dashboard/_components/doc-ui/module-theme"
import { SegmentedTabs } from "@/app/dashboard/_components/doc-ui/segmented-tabs"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import { NormsConfig } from "./_components/norms-config"
import { NormsEntry } from "./_components/norms-entry"
import { NormsReconcile } from "./_components/norms-reconcile"
import { NormsReports } from "./_components/norms-reports"

type TabKey = "config" | "entry" | "reconcile" | "reports"

function readCachedUser(): SessionUser | null {
  try {
    return JSON.parse(localStorage.getItem("erp_user") || "null") as SessionUser | null
  } catch {
    return null
  }
}

export default function NormsPage() {
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabKey>("config")

  useEffect(() => {
    const bootstrap = async () => {
      const cached = readCachedUser()
      if (!hasPermission(cached, "norms.view")) {
        setLoading(false)
        window.location.replace("/dashboard")
        return
      }
      setUser(cached)
      try {
        const t = new URLSearchParams(window.location.search).get("tab")
        if (t === "entry" || t === "reconcile" || t === "reports") setTab(t)
      } catch {
        /* bỏ qua */
      }
      const fid = await getActiveFactoryId()
      setFactoryId(fid)
      setLoading(false)
    }
    void bootstrap()
  }, [])

  return (
    <div className={`${moduleThemeClass("moss")} space-y-4`}>
      <PageHeaderBanner
        theme="moss"
        icon={Scale}
        title="Định mức Kinh tế Kỹ thuật"
        subtitle="Khung định mức tiêu hao theo dây chuyền, loại CSR và nguồn gốc — có ngày hiệu lực, dùng cho đối soát kỳ"
      />
      <SegmentedTabs
        ariaLabel="Định mức KTKT"
        value={tab}
        onChange={setTab}
        items={[
          { key: "config", label: "Cấu hình định mức", icon: Settings2 },
          { key: "entry", label: "Nhập liệu", icon: NotebookPen },
          { key: "reconcile", label: "Đối soát", icon: Calculator },
          { key: "reports", label: "Báo cáo", icon: FileSignature },
        ]}
      />
      {loading ? <ListState kind="loading" /> : !factoryId ? <ListState kind="error" message="Không xác định được nhà máy." /> : tab === "entry" ? (
        <NormsEntry factoryId={factoryId} user={user} />
      ) : tab === "reconcile" ? (
        <NormsReconcile factoryId={factoryId} user={user} />
      ) : tab === "reports" ? (
        <NormsReports factoryId={factoryId} user={user} />
      ) : (
        <NormsConfig factoryId={factoryId} user={user} />
      )}
    </div>
  )
}
