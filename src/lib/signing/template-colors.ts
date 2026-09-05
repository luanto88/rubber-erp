// Bảng màu vai trò của mẫu vị trí ký (`mau_vi_tri`) — dùng cho MODAL KÝ của module Văn bản
// (`dashboard/documents/[id]/page.tsx`): vẽ lại khung ký trên canvas + thumbnail để người ký nhận
// ra "khung của mình" bằng ĐÚNG màu người soạn thảo đã cài đặt.
//
// ⚠️ ĐÂY LÀ BẢN SAO CÓ CHỦ ĐÍCH của bảng màu trong `dashboard/ky/mau-vi-tri/page.tsx`
// (ROLE_COLORS + KY_BUOC_CLONE_PALETTE, khoảng dòng 110-131). Màn cài đặt vị trí là MẪU THAM
// CHIẾU, người dùng yêu cầu giữ nguyên 100% — không refactor cho nó import từ đây.
// => Nếu đổi màu ở màn cài đặt vị trí thì PHẢI sửa đồng bộ trong file này, nếu không màu người ký
//    nhìn thấy sẽ lệch với màu người soạn thảo đã đặt (đúng thứ tính năng này sinh ra để tránh).
//
// Không dùng token Tailwind ở đây vì màu còn được đưa thẳng vào `style` inline (viền/nền khung
// vẽ trên canvas pdfjs, bề rộng/vị trí tính bằng px) — literal hex, không qua `var(--color-*)`.

export type TemplateRoleColor = { fg: string; bg: string }

/** 5 vai trò gốc của mẫu vị trí. */
export type TemplateBaseRoleId = "ky_buoc" | "phe_duyet" | "qr" | "ngay_ky" | "ghi_chu"

export const ROLE_COLORS: Record<TemplateBaseRoleId, TemplateRoleColor> = {
  ky_buoc: { fg: "#f59e0b", bg: "rgba(245,158,11,.14)" },
  phe_duyet: { fg: "#10b981", bg: "rgba(16,185,129,.14)" },
  qr: { fg: "#8b5cf6", bg: "rgba(139,92,246,.14)" },
  ngay_ky: { fg: "#f43f5e", bg: "rgba(244,63,94,.14)" },
  ghi_chu: { fg: "#0d9488", bg: "rgba(13,148,136,.14)" },
}

// Bảng màu riêng cho từng slot NHÂN BẢN của family "ky_buoc" — index 0 giữ đúng màu amber cũ
// (không đổi màu bản gốc để tránh phá layout đã quen mắt), các slot sau luân phiên màu khác để
// dễ phân biệt bằng mắt khi nhiều người cùng ký 1 bước. Chỉ áp dụng cho "ky_buoc" — qr/phe_duyet/
// ngay_ky/ghi_chu giữ nguyên đúng 1 màu cố định kể cả khi bị nhân bản.
export const KY_BUOC_CLONE_PALETTE: TemplateRoleColor[] = [
  { fg: "#f59e0b", bg: "rgba(245,158,11,.14)" }, // amber — bản gốc / bản 1
  { fg: "#0ea5e9", bg: "rgba(14,165,233,.14)" }, // sky
  { fg: "#db2777", bg: "rgba(219,39,119,.14)" }, // pink
  { fg: "#65a30d", bg: "rgba(101,163,13,.14)" }, // lime
  { fg: "#6366f1", bg: "rgba(99,102,241,.14)" }, // indigo
  { fg: "#ea580c", bg: "rgba(234,88,12,.14)" }, // orange
  { fg: "#06b6d4", bg: "rgba(6,182,212,.14)" }, // cyan
  { fg: "#a16207", bg: "rgba(161,98,7,.14)" }, // amber đậm
]

/** Màu của slot "Ký bước" thứ `stepNo` (1-based) — khớp `roleCloneIndex` của màn cài đặt vị trí. */
export function getKyBuocColor(stepNo: number): TemplateRoleColor {
  const idx = (Math.max(1, stepNo) - 1) % KY_BUOC_CLONE_PALETTE.length
  return KY_BUOC_CLONE_PALETTE[idx]
}

/**
 * Màu theo KEY của `van_ban_documents.placement_ky`.
 *
 * Key số ("1", "2", …) là các bước ký lần lượt — map 1-1 với các slot nhân bản "ky_buoc" của mẫu,
 * nên phải dùng đúng `KY_BUOC_CLONE_PALETTE` theo thứ tự bước thì màu người ký nhìn thấy mới
 * trùng với màu người soạn thảo đã cài đặt.
 */
export function getPlacementKeyColor(key: string): TemplateRoleColor {
  const stepNo = Number(key)
  if (Number.isFinite(stepNo) && stepNo >= 1) return getKyBuocColor(stepNo)
  if (key === "phe_duyet" || key === "qr" || key === "ngay_ky" || key === "ghi_chu") {
    return ROLE_COLORS[key]
  }
  return ROLE_COLORS.ky_buoc
}
