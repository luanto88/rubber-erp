"use client"

// Định mức KTKT GĐ2 — tab "Nhập liệu": Chỉ số đồng hồ | Kiểm kê tồn xưởng | Xuất kho bù | Danh mục (đồng hồ, vị trí). Rule 30.

import { useState } from "react"
import { ClipboardList, Gauge, ListChecks, Truck } from "lucide-react"
import type { SessionUser } from "@/lib/auth"
import { SegmentedTabs } from "@/app/dashboard/_components/doc-ui/segmented-tabs"
import { NormsMeterEntry } from "./norms-meter-entry"
import { NormsFloorEntry } from "./norms-floor-entry"
import { NormsEntryCatalog } from "./norms-entry-catalog"
import { NormsExportExtra } from "./norms-export-extra"
import { useToast } from "./norms-ui"

type Sub = "meters" | "floor" | "export_extra" | "catalog"

export function NormsEntry({ factoryId, user }: { factoryId: string; user: SessionUser | null }) {
  const [sub, setSub] = useState<Sub>("meters")
  const { showToast, toastNode } = useToast()
  return (
    <div className="space-y-4">
      {toastNode}
      <SegmentedTabs
        size="sm"
        ariaLabel="Nhập liệu định mức"
        value={sub}
        onChange={setSub}
        items={[
          { key: "meters", label: "Chỉ số đồng hồ", icon: Gauge },
          { key: "floor", label: "Kiểm kê tồn xưởng", icon: ClipboardList },
          { key: "export_extra", label: "Xuất kho bù", icon: Truck },
          { key: "catalog", label: "Danh mục", icon: ListChecks },
        ]}
      />
      {sub === "meters" && <NormsMeterEntry factoryId={factoryId} user={user} showToast={showToast} />}
      {sub === "floor" && <NormsFloorEntry factoryId={factoryId} user={user} showToast={showToast} />}
      {sub === "export_extra" && <NormsExportExtra factoryId={factoryId} user={user} showToast={showToast} />}
      {sub === "catalog" && <NormsEntryCatalog factoryId={factoryId} user={user} showToast={showToast} />}
    </div>
  )
}
