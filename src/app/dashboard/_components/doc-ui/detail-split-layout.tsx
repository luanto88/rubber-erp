"use client"

import { useState, type ReactNode } from "react"
import { FileText, PanelRight } from "lucide-react"
import { SegmentedTabs } from "./segmented-tabs"

/**
 * Khung trang chi tiết dùng chung (Doc-UI, GĐ2): cột tài liệu ~70% + bảng điều khiển ~30%.
 * Dưới `lg` chuyển sang tab "Tài liệu / Thông tin". Ẩn bằng `hidden`, KHÔNG unmount — giữ
 * nguyên state form/modal của trang.
 */
export function DetailSplitLayout({
  header,
  banners,
  document,
  inspector,
  defaultMobileTab = "info",
}: {
  header?: ReactNode
  banners?: ReactNode
  document: ReactNode
  inspector: ReactNode
  defaultMobileTab?: "doc" | "info"
}) {
  const [tab, setTab] = useState<"doc" | "info">(defaultMobileTab)
  return (
    <div className="font-doc space-y-4">
      {header}
      {banners}
      <div className="lg:hidden">
        <SegmentedTabs
          fullWidth
          ariaLabel="Chuyển giữa tài liệu và thông tin"
          value={tab}
          onChange={setTab}
          items={[
            { key: "doc", label: "Tài liệu", icon: FileText },
            { key: "info", label: "Thông tin", icon: PanelRight },
          ]}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(320px,3fr)] lg:items-start">
        <div className={`min-w-0 space-y-4 ${tab === "doc" ? "" : "hidden"} lg:block`}>{document}</div>
        <aside className={`min-w-0 space-y-4 lg:sticky lg:top-4 ${tab === "info" ? "" : "hidden"} lg:block`}>
          {inspector}
        </aside>
      </div>
    </div>
  )
}
