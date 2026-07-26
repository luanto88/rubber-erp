import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

// Thông báo module KPI (Quản lý công việc & Đánh giá KPI) — CHỈ Telegram (không in-app, không
// email), theo đúng yêu cầu người dùng. Dùng riêng bot QL_CONG_VIEC_CHAT_TOKEN/CHAT_ID (mirror
// pattern các module khác — mỗi module 1 bot riêng: ISO_FORM_*, INVENTORY_*, CONG_VAN_DI_DEN_*).
//
// Cố ý KHÔNG insert vào bảng `notifications` dùng chung — Bell badge của module KPI đã là
// "live-computed" (module-tasks.ts, xem .claude/rules/24-notification-bell-module-tasks.md),
// không persist; ghi thêm vào notifications sẽ tạo 1 luồng thông báo song song không đồng bộ
// với chuông, dễ gây trùng lặp/khó hiểu.
//
// Thiết kế đơn giản có chủ đích: module KPI có RẤT NHIỀU loại sự kiện (giao việc, tiến độ, nộp,
// nghiệm thu, trả về, chuyển giao, gia hạn, người thay thế, khiếu nại, phân công 5S...) — thay vì
// 1 map tiêu đề/nội dung khổng lồ ở server (như ISO Forms làm với 4 loại), để nơi GỌI (đã có sẵn
// đầy đủ ngữ cảnh) tự build `title`/`lines`, route chỉ ghép khung tin nhắn cố định rồi gửi.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://qlsxkpt.vercel.app"

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

export async function POST(req: NextRequest) {
  try {
    const { factoryId, title, lines, link } = (await req.json()) as {
      factoryId?: string
      title: string
      lines: string[]
      link?: string
    }

    if (!title || !Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json({ error: "Thiếu tham số" }, { status: 400 })
    }

    const botToken = process.env.QL_CONG_VIEC_CHAT_TOKEN
    const chatId = process.env.QL_CONG_VIEC_CHAT_ID
    if (!botToken || !chatId) {
      // Chưa cấu hình bot — im lặng bỏ qua, không chặn hành động nghiệp vụ đã thực hiện xong.
      return NextResponse.json({ ok: true, skipped: "telegram_not_configured" })
    }

    let factoryLabel = ""
    if (factoryId) {
      const { data } = await supabaseAdmin.from("factories").select("name").eq("id", factoryId).maybeSingle()
      if (data?.name) factoryLabel = ` — ${data.name}`
    }

    const fullLink = link ? (link.startsWith("http") ? link : `${APP_URL}${link}`) : null

    const tgMsg = [
      `🔔 <b>${escapeHtml(title)}${escapeHtml(factoryLabel)}</b>`,
      ``,
      ...lines.map(escapeHtml),
      fullLink ? `` : null,
      fullLink ? `🔗 <a href="${fullLink}">Xem chi tiết</a>` : null,
    ]
      .filter((l) => l !== null)
      .join("\n")

    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: tgMsg, parse_mode: "HTML" }),
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
