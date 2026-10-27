"use client"

import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"
import type { StatusTone } from "@/app/dashboard/_components/doc-ui/status-registry"
import { WARN_LABELS, WARN_SEVERITY, type ProductionRecord } from "./output-types"

// Badge cảnh báo / nguồn mủ của Sản lượng (rule 29 — trạng thái chỉ qua StatusBadge).
// Không đặt domain trong status-registry: file đó phải thuần, nhãn cảnh báo nằm ở output-types.

const SEVERITY_TONE: Record<"red" | "amber" | "slate", StatusTone> = {
  red: "danger",
  amber: "warn",
  slate: "draft",
}

export function OutputWarnBadge({ code }: { code: string }) {
  const tone = SEVERITY_TONE[WARN_SEVERITY[code] ?? "slate"]
  return <StatusBadge tone={tone} label={WARN_LABELS[code] ?? code} size="xs" />
}

export function OutputSourceCell({ record }: { record: Pick<ProductionRecord, "ma_nguon" | "doi"> }) {
  if (record.ma_nguon === "m" || record.doi === 0) return <StatusBadge tone="warn" label="Thu mua" size="xs" />
  if (record.ma_nguon === "gctpk") return <StatusBadge tone="info" label="GC Tân Biên" size="xs" />
  if (record.ma_nguon === "gccpk") return <StatusBadge tone="info" label="GC Chư Păh" size="xs" />
  if (record.ma_nguon === "tl") return <StatusBadge tone="returned" label="Thanh lý" size="xs" />
  return <>{record.doi ? `Đội ${record.doi}` : "—"}</>
}
