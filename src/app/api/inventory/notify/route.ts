import { NextRequest, NextResponse } from "next/server"

// Thông báo Telegram module Nhập Xuất Tồn (Kho vật tư) — CHỈ Telegram, dùng bot riêng
// XNT_CHAT_TOKEN/XNT_CHAT_ID (mirror pattern các module khác — mỗi module 1 bot riêng, xem
// src/app/api/kpi/notify/route.ts). Nội dung tin nhắn (2 mẫu: cảnh báo tồn thấp và thông báo
// thay đổi NXT) được build sẵn ở phía gọi (src/lib/inventory-notify.ts), route này chỉ gửi
// thẳng text đã format HTML — không cần discriminate "type" ở server.
//
// `linkPath` (tuỳ chọn) là đường dẫn tương đối tới trang phiếu — route tự ghép domain
// (NEXT_PUBLIC_APP_URL, cùng convention các route notify khác trong repo) để GĐ/PGĐ bấm thẳng
// từ Telegram vào phê duyệt, không cần gõ lại đường dẫn.
//
// Fire-and-forget, không chặn nghiệp vụ chính: chưa cấu hình bot → bỏ qua êm; lỗi Telegram →
// trả 207, không throw.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://qlsxkpt.vercel.app"

export async function POST(req: NextRequest) {
  try {
    const { text, linkPath } = (await req.json()) as { text?: string; linkPath?: string | null }
    if (!text) {
      return NextResponse.json({ error: "Thiếu nội dung tin nhắn" }, { status: 400 })
    }

    const botToken = process.env.XNT_CHAT_TOKEN
    const chatId = process.env.XNT_CHAT_ID
    if (!botToken || !chatId) {
      return NextResponse.json({ ok: true, skipped: "telegram_not_configured" })
    }

    const finalText = linkPath ? `${text}\n🔗 Xem &amp; phê duyệt: ${APP_URL}${linkPath}` : text

    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: finalText, parse_mode: "HTML" }),
    })

    if (!tgRes.ok) {
      const err = await tgRes.json().catch(() => ({}))
      return NextResponse.json(
        { ok: false, error: (err as { description?: string }).description || "Lỗi gửi Telegram" },
        { status: 207 },
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: 500 })
  }
}
