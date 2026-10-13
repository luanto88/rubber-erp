"use client"

// Badge trạng thái Hồ sơ thực hiện ISO — gộp 3 bản `StatusBadge` copy y hệt ở forms/page.tsx,
// forms/[id]/page.tsx, my-tasks/page.tsx (Doc-UI, 2026-10-13). Nhãn suy động theo luồng N bước
// (`thu_tu_ky_json` + `buoc_hien_tai`) — giữ nguyên logic cũ, chỉ đổi phần hiển thị sang
// `StatusBadge` dùng chung.

import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"
import { resolveStatus, type StatusTone } from "@/app/dashboard/_components/doc-ui/status-registry"
import type { IsoFormInstance, IsoFormInstanceStatus } from "./iso-types"

export function formInstanceStatusView(
  status: IsoFormInstanceStatus,
  inst?: IsoFormInstance | null,
): { label: string; tone: StatusTone } {
  const base = resolveStatus("form", status)
  let label = base.label
  let tone: StatusTone = base.tone

  if (inst) {
    const steps = Array.isArray(inst.thu_tu_ky_json) && inst.thu_tu_ky_json.length > 0 ? inst.thu_tu_ky_json : null
    const cur = inst.buoc_hien_tai ?? 0

    if (status === "da_phe_duyet") {
      const lastStepTen = steps ? steps[steps.length - 1]?.ten?.trim() : undefined
      label = lastStepTen
        ? (lastStepTen.toLowerCase().startsWith("phê duyệt") ? "Đã phê duyệt" : `Đã ${lastStepTen.toLowerCase()}`)
        : "Đã phê duyệt"
      tone = "valid"
    } else if (status === "tra_ve") {
      label = "Bị trả về"
      tone = "returned"
    } else if (status === "draft") {
      label = "Bản nháp"
      tone = "draft"
    } else if (steps) {
      const stepName = steps[cur]?.ten?.trim()
      const isLast = cur >= steps.length - 1
      label = isLast
        ? (stepName ? `Chờ ${stepName.toLowerCase()}` : "Chờ phê duyệt")
        : (stepName ? `Chờ ${stepName}` : `Chờ ký bước ${cur + 1}`)
      tone = "pending"
    }
  }
  return { label, tone }
}

export function FormStatusBadge({
  status,
  inst,
  size = "sm",
}: {
  status: IsoFormInstanceStatus
  inst?: IsoFormInstance | null
  size?: "xs" | "sm" | "md"
}) {
  const v = formInstanceStatusView(status, inst)
  return <StatusBadge tone={v.tone} label={v.label} size={size} />
}
