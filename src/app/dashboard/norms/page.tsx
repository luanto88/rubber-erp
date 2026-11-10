"use client"

// Module Định mức Kinh tế Kỹ thuật chế biến (rule 30). GĐ1: tab "Cấu hình định mức".
// GĐ2–GĐ4 (Nhập liệu theo ngày, Đối soát & cảnh báo, Báo cáo kỳ + ký số) thêm tab sau.

import { useEffect, useState } from "react"
import { Scale, Settings2 } from "lucide-react"
import { getActiveFactoryId, hasPermission, type SessionUser } from "@/lib/auth"
import { PageHeaderBanner } from "@/app/dashboard/_components/page-header-banner"
import { moduleThemeClass } from "@/app/dashboard/_components/doc-ui/module-theme"
import { SegmentedTabs } from "@/app/dashboard/_components/doc-ui/segmented-tabs"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import { NormsConfig } from "./_components/norms-config"

type TabKey = "config"

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
        items={[{ key: "config", label: "Cấu hình định mức", icon: Settings2 }]}
      />
      {loading ? <ListState kind="loading" /> : !factoryId ? <ListState kind="error" message="Không xác định được nhà máy." /> : <NormsConfig factoryId={factoryId} user={user} />}
    </div>
  )
}
