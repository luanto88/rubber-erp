"use client"

// Cài đặt → Cấu hình nhà máy → "Thành phẩm" (2026-11-16): 2 bảng nhỏ
//  - Tồn thành phẩm đầu kỳ (product_opening_stock — mốc tồn cho F12, lũy kế F09)
//  - Xuất bù kho (tech_norm_export_extra — chỉ cộng Mẫu 8A mục 3; chuyển từ Định mức → Nhập liệu)

import { useState } from "react"
import { PackageCheck, Truck } from "lucide-react"
import { SegmentedTabs } from "@/app/dashboard/_components/doc-ui/segmented-tabs"
import { OpeningStockTab } from "./opening-stock-tab"
import { ExportExtraTab } from "./export-extra-tab"

type Sub = "opening" | "export_extra"

export function FinishedProductTab({ factoryId, canManage }: { factoryId: string | null; canManage: boolean }) {
  const [sub, setSub] = useState<Sub>("opening")
  return (
    <div className="space-y-4">
      <SegmentedTabs
        size="sm"
        ariaLabel="Cấu hình thành phẩm"
        value={sub}
        onChange={setSub}
        items={[
          { key: "opening", label: "Tồn thành phẩm đầu kỳ", icon: PackageCheck },
          { key: "export_extra", label: "Xuất bù kho", icon: Truck },
        ]}
      />
      {sub === "opening" && <OpeningStockTab factoryId={factoryId} canManage={canManage} />}
      {sub === "export_extra" && <ExportExtraTab factoryId={factoryId} canManage={canManage} />}
    </div>
  )
}
