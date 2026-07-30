"use client"

// Helper gửi thông báo Telegram cho module Nhập Xuất Tồn (Kho vật tư) — nhóm chat riêng
// (XNT_CHAT_TOKEN/XNT_CHAT_ID, xem src/app/api/inventory/notify/route.ts). 2 mẫu tin nhắn
// mirror đúng định dạng tham khảo cung_cap_dl/inven.jpg (icon trước mỗi dòng nội dung).
// Gọi fire-and-forget — lỗi mạng/chưa cấu hình bot không được chặn hành động nghiệp vụ đã
// thực hiện xong (Lưu/Ghi sổ vẫn thành công dù Telegram lỗi).
//
// sendInventoryNxtChangeNotify() gộp 1 tin/PHIẾU (không phải 1 tin/dòng vật tư) — liệt kê mọi
// dòng vật tư trong phiếu, kèm 1 link duy nhất (route server tự ghép domain) để GĐ/PGĐ bấm vào
// phê duyệt (chỉ Nhập/Xuất — Chuyển kho không có bước phê duyệt nên không truyền linkPath).

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function formatNowVi(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

function formatQty(value: number): string {
  return value.toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function sendInventoryText(text: string, linkPath?: string | null): void {
  void fetch("/api/inventory/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, linkPath: linkPath || undefined }),
  }).catch(() => {})
}

export type LowStockAlertInput = {
  itemName: string
  currentStock: number
  unit: string
}

export function sendInventoryLowStockAlert(input: LowStockAlertInput): void {
  const text = [
    `🚨 <b>CẢNH BÁO TỒN KHO:</b>`,
    `<i>Thấp hơn giới hạn dưới sản phẩm</i>`,
    `🕐 Lúc: ${formatNowVi()}`,
    `📦 Tên vật tư: ${escapeHtml(input.itemName)}`,
    `📊 Tồn kho hiện tại: ${formatQty(input.currentStock)} ${escapeHtml(input.unit)}`,
  ].join("\n")
  sendInventoryText(text)
}

export type NxtDocumentNotifyLine = {
  itemName: string
  quantity: number
  unit: string
  currentStock: number
}

export type NxtDocumentNotifyInput = {
  loaiNxt: "Nhập" | "Xuất" | "Chuyển"
  documentCode: string
  warehouseLabel: string
  nguoiNx: string
  ghiChu?: string | null
  lines: NxtDocumentNotifyLine[]
  // Đường dẫn tương đối tới trang phiếu (ví dụ /dashboard/inventory/issues?documentId=...) —
  // server route tự ghép domain (NEXT_PUBLIC_APP_URL). Bỏ trống với Chuyển kho (không có bước
  // phê duyệt).
  linkPath?: string | null
}

export function sendInventoryNxtChangeNotify(input: NxtDocumentNotifyInput): void {
  const lineTexts = input.lines.map(
    (line) =>
      `   • ${escapeHtml(line.itemName)}: ${formatQty(line.quantity)} ${escapeHtml(line.unit)} (tồn: ${formatQty(line.currentStock)} ${escapeHtml(line.unit)})`,
  )
  const text = [
    `🔔 <b>THÔNG BÁO THAY ĐỔI NHẬP XUẤT TỒN:</b>`,
    `🕐 Lúc: ${formatNowVi()}`,
    `🔄 Loại NXT: ${input.loaiNxt}`,
    `🧾 Phiếu: ${escapeHtml(input.documentCode)}`,
    `🏬 Kho: ${escapeHtml(input.warehouseLabel)}`,
    `📦 Vật tư:`,
    ...lineTexts,
    `👤 Người NX: ${escapeHtml(input.nguoiNx || "—")}`,
    `📝 Ghi chú: ${escapeHtml(input.ghiChu?.trim() || "—")}`,
  ].join("\n")
  sendInventoryText(text, input.linkPath)
}
