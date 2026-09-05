// Quy đổi `van_ban_documents.placement_ky` thành danh sách khung để VẼ XEM TRƯỚC (thumbnail trang
// PDF + lớp mờ trên canvas) trong modal ký của module Văn bản.
//
// CHỈ phục vụ TRÌNH BÀY — tuyệt đối không import vào `api/documents/sign/route.ts` hay
// `apply-template.ts`: toạ độ thật lúc đóng dấu vẫn do server tự tính/kẹp như cũ.

// CHỈ được import từ các module THUẦN (không kéo `fs`/`pdf-lib`) — file này chạy trong client
// component. Trước đây lấy `MAU_META_KEY` từ `apply-template.ts` khiến cả `stamp-pdf.ts`
// (`import fs`) bị kéo vào bundle trình duyệt: build hỏng "Module not found: Can't resolve 'fs'".
import { MAU_META_KEY, resolveAnchorPages, type TemplateAnchorBox } from "@/lib/signing/template-layout"
import { getPlacementKeyColor, type TemplateRoleColor } from "@/lib/signing/template-colors"

/**
 * - `mine`: khung của chính người đang ký ở lượt này → "sáng lên" đúng màu vai trò.
 * - `done`: khung của bước đã ký xong.
 * - `other`: khung của bước/vai trò khác chưa tới lượt.
 */
export type PreviewTier = "mine" | "done" | "other"

export type PreviewBox = {
  page: number
  /** Key trong `placement_ky`: "1" | "2" | … | "phe_duyet" | "qr" | "ngay_ky" | "ghi_chu". */
  key: string
  label: string
  tier: PreviewTier
  color: TemplateRoleColor
  /** Vị trí trên trang theo %, gốc TRÊN-TRÁI (đơn vị dùng trực tiếp cho `style` của thumbnail). */
  pct: { x: number; y: number; w: number; h: number }
}

type PageDim = { w: number; h: number }

function isFiniteBox(box: TemplateAnchorBox): boolean {
  return (
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.width) &&
    Number.isFinite(box.height) &&
    box.width > 0 &&
    box.height > 0
  )
}

/**
 * Point (gốc DƯỚI-trái, như pdf-lib / `mau_vi_tri`) → % (gốc TRÊN-trái, như CSS).
 * Cùng công thức mà màn cài đặt vị trí dùng khi nạp mẫu đã lưu (`boxPctFromTemplate`).
 */
function toPct(box: TemplateAnchorBox, dim: PageDim) {
  return {
    x: (box.x / dim.w) * 100,
    y: ((dim.h - box.y - box.height) / dim.h) * 100,
    w: (box.width / dim.w) * 100,
    h: (box.height / dim.h) * 100,
  }
}

/** Đọc mảng `boxes` của một entry `placement_ky`, bỏ qua entry không phải khung mẫu hợp lệ. */
function readBoxes(value: unknown): TemplateAnchorBox[] {
  if (!value || typeof value !== "object") return []
  const entry = value as { tu_mau?: boolean; boxes?: unknown }
  if (entry.tu_mau !== true || !Array.isArray(entry.boxes)) return []
  return entry.boxes.filter(
    (b): b is TemplateAnchorBox => !!b && typeof b === "object" && isFiniteBox(b as TemplateAnchorBox),
  )
}

export function collectPreviewBoxes(params: {
  placementKy: Record<string, unknown> | null | undefined
  pageCount: number
  /** Kích thước THẬT từng trang (point, scale 1) — thiếu trang nào thì bỏ qua khung của trang đó. */
  dims: Record<number, PageDim>
  /** Key của bước đang ký (`signStepKey` ở component cha). */
  myKey: string
  /** Các key đã ký xong (bước đã có người ký / văn bản đã phê duyệt). */
  signedKeys: string[]
  /** Nhãn hiển thị theo key — vd `{ "1": "Bước 1: NMCB", phe_duyet: "Phê duyệt" }`. */
  stepLabels: Record<string, string>
  /**
   * Người ký hiện tại còn được thao tác khung QR (lượt ký đầu tiên) → tính là khung "của tôi".
   * Các lượt sau QR đã chốt, chỉ còn là khung tham chiếu.
   */
  qrIsMine?: boolean
  /** Bước phê duyệt có khung "Ghi chú" (ý kiến chỉ đạo) → cũng là khung "của tôi". */
  ghiChuIsMine?: boolean
}): PreviewBox[] {
  const { placementKy, pageCount, dims, myKey, signedKeys, stepLabels } = params
  if (!placementKy || pageCount <= 0) return []

  const signed = new Set(signedKeys)
  const out: PreviewBox[] = []

  for (const [key, value] of Object.entries(placementKy)) {
    if (key === MAU_META_KEY) continue
    const boxes = readBoxes(value)
    if (boxes.length === 0) continue

    const isMine =
      key === myKey ||
      (key === "qr" && !!params.qrIsMine) ||
      (key === "ghi_chu" && !!params.ghiChuIsMine)
    const tier: PreviewTier = isMine ? "mine" : signed.has(key) ? "done" : "other"
    const color = getPlacementKeyColor(key)
    const label = stepLabels[key] || key

    for (const box of boxes) {
      for (const page of resolveAnchorPages(box, pageCount)) {
        const dim = dims[page]
        if (!dim || !Number.isFinite(dim.w) || !Number.isFinite(dim.h) || dim.w <= 0 || dim.h <= 0) {
          continue
        }
        out.push({ page, key, label, tier, color, pct: toPct(box, dim) })
      }
    }
  }

  // Khung "của tôi" vẽ sau cùng để luôn nằm trên các khung mờ khác.
  const order: Record<PreviewTier, number> = { other: 0, done: 1, mine: 2 }
  return out.sort((a, b) => order[a.tier] - order[b.tier])
}

/** Gom theo số trang để rail thumbnail tra nhanh. */
export function groupPreviewBoxesByPage(boxes: PreviewBox[]): Record<number, PreviewBox[]> {
  const map: Record<number, PreviewBox[]> = {}
  for (const b of boxes) {
    ;(map[b.page] ||= []).push(b)
  }
  return map
}
