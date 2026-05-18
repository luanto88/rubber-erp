import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import nodemailer from "nodemailer"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

function fmtDate(d: string | null) {
  if (!d) return ""
  const [y, m, day] = d.split("-")
  return `${day}/${m}/${y}`
}

export async function POST(req: NextRequest) {
  try {
    const { recordId, factoryId } = await req.json()
    if (!recordId || !factoryId) {
      return NextResponse.json({ error: "Thiếu tham số" }, { status: 400 })
    }

    // Lấy biên bản + các dòng thiết bị
    const { data: rec, error: recErr } = await supabaseAdmin
      .from("maintenance_records")
      .select("ma_bb, hang_muc, bo_phan, ngay, nguoi_tao, bgd_phu_trach, giam_doc, trang_thai")
      .eq("id", recordId)
      .eq("factory_id", factoryId)
      .single()

    if (recErr || !rec) {
      return NextResponse.json({ error: "Không tìm thấy biên bản" }, { status: 404 })
    }

    const { data: lines } = await supabaseAdmin
      .from("maintenance_record_lines")
      .select("ten_tb")
      .eq("record_id", recordId)
      .order("sort_order")

    const tenTbs = (lines || []).map((l: { ten_tb: string }) => l.ten_tb).filter(Boolean).join(", ")

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://qlsxkpt.vercel.app"
    const recordUrl = `${appUrl}/dashboard/maintenance/records/${recordId}`

    const errors: string[] = []

    // ── 1. Gửi Telegram ──────────────────────────────────────────────────────
    const botToken = process.env.TELEGRAM_BOT_TOKEN
    const chatId = process.env.TELEGRAM_CHAT_ID

    if (botToken && chatId) {
      const tgMsg = [
        `🔔 <b>Biên bản bảo trì cần phê duyệt</b>`,
        ``,
        `📋 Mã biên bản: <code>${rec.ma_bb || "(chưa có)"}</code>`,
        `📌 Hạng mục: <b>${rec.hang_muc}</b>`,
        `🏭 Bộ phận: ${rec.bo_phan}`,
        `📅 Ngày: ${fmtDate(rec.ngay)}`,
        `👤 Người tạo: ${rec.nguoi_tao || ""}`,
        tenTbs ? `🔧 Thiết bị: ${tenTbs}` : null,
        rec.bgd_phu_trach ? `👥 BGĐ phụ trách: ${rec.bgd_phu_trach}` : null,
        rec.giam_doc ? `🎖 Giám đốc: ${rec.giam_doc}` : null,
        ``,
        `🔗 <a href="${recordUrl}">Xem và phê duyệt biên bản</a>`,
      ]
        .filter((l) => l !== null)
        .join("\n")

      const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: tgMsg, parse_mode: "HTML" }),
      })
      if (!tgRes.ok) {
        const err = await tgRes.json()
        errors.push(`Telegram: ${err.description || "Lỗi không xác định"}`)
      }
    }

    // ── 2. Gửi Email qua Gmail ────────────────────────────────────────────────
    const gmailUser = process.env.GMAIL_USER
    const gmailPass = process.env.GMAIL_APP_PASSWORD

    if (!gmailUser || !gmailPass) {
      // Báo lỗi rõ để admin biết cần cấu hình env vars
      errors.push("Email: Chưa cấu hình GMAIL_USER / GMAIL_APP_PASSWORD trong biến môi trường server.")
    } else {
      // Tìm email của BGĐ phụ trách và Giám đốc
      const recipients = [rec.bgd_phu_trach, rec.giam_doc].filter(Boolean) as string[]

      if (recipients.length === 0) {
        errors.push("Email: Biên bản chưa chọn Giám đốc hoặc BGĐ phụ trách.")
      } else {
        const { data: staffRows, error: staffErr } = await supabaseAdmin
          .from("maintenance_staff")
          .select("ten, email")
          .eq("factory_id", factoryId)
          .in("ten", recipients)

        if (staffErr) {
          errors.push(`Email: Lỗi truy vấn nhân sự — ${staffErr.message}`)
        } else {
          const emails = (staffRows || [])
            .map((s: { ten: string; email: string | null }) => s.email)
            .filter((e): e is string => !!e && e.includes("@"))

          if (emails.length === 0) {
            errors.push(`Email: Chưa có địa chỉ email cho ${recipients.join(", ")} — vào Cài đặt → Bảo trì → Nhân sự để điền email.`)
          } else {
            const transporter = nodemailer.createTransport({
              service: "gmail",
              auth: { user: gmailUser, pass: gmailPass },
            })

            const recipientNames = recipients.join(", ")
            const subject = `[Bảo trì] ${rec.ma_bb || "Biên bản mới"} — ${rec.hang_muc} ${rec.bo_phan} cần phê duyệt`

            const htmlBody = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
  <div style="background:#f97316;padding:16px 24px">
    <h2 style="color:white;margin:0;font-size:16px">🔔 Biên bản bảo trì cần phê duyệt</h2>
  </div>
  <div style="padding:24px;background:white">
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:6px 0;color:#64748b;width:160px">Mã biên bản</td><td style="padding:6px 0;font-weight:bold;font-family:monospace">${rec.ma_bb || "(chưa có)"}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Hạng mục</td><td style="padding:6px 0;font-weight:bold">${rec.hang_muc}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Bộ phận</td><td style="padding:6px 0">${rec.bo_phan}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Ngày</td><td style="padding:6px 0">${fmtDate(rec.ngay)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Người tạo</td><td style="padding:6px 0">${rec.nguoi_tao || ""}</td></tr>
      ${tenTbs ? `<tr><td style="padding:6px 0;color:#64748b">Thiết bị</td><td style="padding:6px 0">${tenTbs}</td></tr>` : ""}
      ${rec.bgd_phu_trach ? `<tr><td style="padding:6px 0;color:#64748b">BGĐ phụ trách</td><td style="padding:6px 0">${rec.bgd_phu_trach}</td></tr>` : ""}
      ${rec.giam_doc ? `<tr><td style="padding:6px 0;color:#64748b">Giám đốc</td><td style="padding:6px 0">${rec.giam_doc}</td></tr>` : ""}
    </table>
    <div style="margin-top:24px">
      <a href="${recordUrl}" style="display:inline-block;padding:10px 20px;background:#f97316;color:white;text-decoration:none;border-radius:6px;font-weight:bold;font-size:14px">
        Xem và phê duyệt biên bản →
      </a>
    </div>
  </div>
  <div style="padding:12px 24px;background:#f8fafc;font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0">
    Gửi đến: ${recipientNames} | Nhà máy chế biến Phước Hòa KPT
  </div>
</div>`

            try {
              await transporter.sendMail({
                from: `"Bảo trì Phước Hòa" <${gmailUser}>`,
                to: emails.join(", "),
                subject,
                html: htmlBody,
              })
            } catch (emailErr) {
              errors.push(`Email: ${emailErr instanceof Error ? emailErr.message : "Lỗi gửi mail"}`)
            }
          }
        }
      }
    }

    if (errors.length > 0) {
      return NextResponse.json({ ok: false, errors }, { status: 207 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi server" },
      { status: 500 },
    )
  }
}
