/**
 * Escape 5 ký tự đặc biệt của HTML.
 *
 * Bắt buộc dùng cho MỌI giá trị lấy từ DB trước khi nội suy vào:
 *   - tin nhắn Telegram gửi với `parse_mode: "HTML"` — nếu không escape, một tên/mã hồ sơ
 *     chứa `&`, `<`, `>` sẽ khiến Telegram trả HTTP 400 `can't parse entities` và MẤT TRẮNG
 *     cả tin nhắn (không chỉ hỏng định dạng).
 *   - thân email HTML (nodemailer).
 *
 * Ghi chú dọn dẹp: repo hiện có 2 bản copy y hệt hàm này ở `src/app/api/kpi/notify/route.ts`
 * và `src/lib/inventory-notify.ts`, cộng 2 route KHÔNG escape gì cả
 * (`src/app/api/documents/notify/route.ts`, `src/app/api/maintenance/notify/route.ts`).
 * Cố ý chưa gom lại trong lần này để không đụng luồng ISO/Văn bản/Bảo trì đang chạy thật.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
