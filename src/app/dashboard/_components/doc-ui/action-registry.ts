// Doc-UI — TỪ ĐIỂN HÀNH ĐỘNG trong dòng bảng (U0, 2026-10-14). Một icon = một nghĩa trên toàn app.
// Nguồn: .claude/plans/ke-hoach-dong-bo-ui-toan-app.md mục 2.4. Muốn thêm nghĩa mới: thêm `kind`
// ở đây, KHÔNG dùng icon đã có cho nghĩa khác (vd con mắt chỉ là "Xem chi tiết", không phải mở file).

import {
  Ban,
  CircleCheck,
  Copy,
  Download,
  Eye,
  FileCheck2,
  FileText,
  Pencil,
  Plus,
  Printer,
  Trash2,
  type LucideIcon,
} from "lucide-react"
import type { IconActionTone } from "./icon-action"

export type RowActionKind =
  | "view"
  | "signed"
  | "download"
  | "draft"
  | "print"
  | "edit"
  | "copy"
  | "delete"
  | "add"
  | "approve"
  | "cancel"

export type RowActionDef = { icon: LucideIcon; label: string; tone: IconActionTone }

export const ROW_ACTIONS: Record<RowActionKind, RowActionDef> = {
  view: { icon: Eye, label: "Xem chi tiết", tone: "neutral" },
  signed: { icon: FileCheck2, label: "Xem file đã ký", tone: "brand" },
  download: { icon: Download, label: "Tải file đã ký", tone: "sky" },
  draft: { icon: FileText, label: "PDF chưa ký", tone: "neutral" },
  print: { icon: Printer, label: "In", tone: "neutral" },
  edit: { icon: Pencil, label: "Sửa", tone: "amber" },
  copy: { icon: Copy, label: "Nhân bản", tone: "neutral" },
  delete: { icon: Trash2, label: "Xoá", tone: "danger" },
  add: { icon: Plus, label: "Thêm", tone: "brand" },
  approve: { icon: CircleCheck, label: "Duyệt", tone: "brand" },
  cancel: { icon: Ban, label: "Huỷ phiếu", tone: "danger" },
}

/**
 * Thứ tự cố định trong cột Thao tác: [Ký ngay] → view → signed → download → draft/print →
 * (icon riêng module) → edit → copy → delete. `add` đứng đầu cụm khi có (thêm vào nhóm ngày).
 * approve/cancel là hành động chính ⇒ nút có chữ, thường đặt ở header/thẻ, không trong cụm icon.
 */
export const ROW_ACTION_ORDER: RowActionKind[] = [
  "add",
  "view",
  "signed",
  "download",
  "draft",
  "print",
  "edit",
  "copy",
  "delete",
  "approve",
  "cancel",
]
