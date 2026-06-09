import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import nodemailer from "nodemailer"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://qlsxkpt.vercel.app"

export async function POST(req: NextRequest) {
  try {
    const { obsoleteDocId, newDocId, factoryId } = (await req.json()) as {
      obsoleteDocId: string
      newDocId: string
      factoryId: string
    }

    if (!obsoleteDocId || !factoryId) {
      return NextResponse.json({ error: "Thiếu tham số" }, { status: 400 })
    }

    // Tìm tất cả người đã nhận bản cũ
    const { data: recipients, error: recErr } = await supabaseAdmin
      .from("iso_distribution_recipients")
      .select("recipient_user_id")
      .eq("iso_document_id", obsoleteDocId)
      .eq("factory_id", factoryId)

    if (recErr) {
      return NextResponse.json({ error: recErr.message }, { status: 500 })
    }

    if (!recipients?.length) {
      return NextResponse.json({ ok: true, notified: 0 })
    }

    // Distinct recipient user IDs
    const recipientUserIds = [
      ...new Set(
        (recipients as Array<{ recipient_user_id: string }>).map(
          (r) => r.recipient_user_id,
        ),
      ),
    ]

    // Lấy info tài liệu cũ
    const { data: obsoleteDoc } = await supabaseAdmin
      .from("iso_documents")
      .select("ma_tai_lieu, ten_tai_lieu, lan_ban_hanh")
      .eq("id", obsoleteDocId)
      .single()

    const { data: newDoc } = newDocId
      ? await supabaseAdmin
          .from("iso_documents")
          .select("id, ma_tai_lieu, ten_tai_lieu")
          .eq("id", newDocId)
          .single()
      : { data: null }

    const ma = (obsoleteDoc?.ma_tai_lieu as string | null) || ""
    const ten = (obsoleteDoc?.ten_tai_lieu as string) || "Tài liệu"
    const lanBanHanh = (obsoleteDoc?.lan_ban_hanh as string | null) || ""

    const errors: string[] = []

    // ── 1. In-app notifications ──────────────────────────────────────────────
    const newDocLink = newDocId
      ? `${APP_URL}/dashboard/iso/documents/${newDocId}`
      : `${APP_URL}/dashboard/iso/kho`

    const notifRows = recipientUserIds.map((uid) => ({
      factory_id: factoryId,
      user_id: uid,
      type: "het_hieu_luc",
      doc_id: obsoleteDocId,
      doc_type: "iso_document",
      title: `Tài liệu ${ma} bạn đã nhận đã hết hiệu lực`,
      body: `"${ten}" (Lần ban hành ${lanBanHanh || "cũ"}) đã hết hiệu lực.${
        newDoc ? ` Đã có bản mới ${(newDoc.ma_tai_lieu as string | null) || ""}` : ""
      } Hãy liên hệ Ban ISO để nhận bản cập nhật.`,
      is_read: false,
      link: newDocLink,
    }))

    const { error: notifErr } = await supabaseAdmin
      .from("notifications")
      .insert(notifRows)
    if (notifErr) errors.push(`In-app: ${notifErr.message}`)

    // Lấy profiles người nhận
    const { data: recipientProfiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, username")
      .in("id", recipientUserIds)

    // ── 2. Telegram ──────────────────────────────────────────────────────────
    const botToken = process.env.ISO_TELEGRAM_BOT_TOKEN
    const chatId = process.env.ISO_TELEGRAM_CHAT_ID

    if (botToken && chatId) {
      const recipientNames = (
        recipientProfiles as Array<{
          full_name: string | null
          username: string | null
        }>
      )
        .map((p) => p.full_name || p.username || "")
        .filter(Boolean)
        .join(", ")

      const tgMsg = [
        `⚠️ <b>Tài liệu ISO hết hiệu lực</b>`,
        ``,
        `📋 Tài liệu: ${ma} — ${ten}`,
        lanBanHanh ? `📌 Lần ban hành: ${lanBanHanh}` : null,
        newDoc
          ? `✅ Bản mới: ${(newDoc.ma_tai_lieu as string | null) || ""} — ${newDoc.ten_tai_lieu as string}`
          : null,
        recipientNames
          ? `👥 Người đã nhận (${recipientUserIds.length} người): ${recipientNames}`
          : null,
        ``,
        newDocId
          ? `🔗 <a href="${newDocLink}">Xem bản mới</a>`
          : `🔗 <a href="${APP_URL}/dashboard/iso/kho">Kho của tôi</a>`,
      ]
        .filter((l) => l !== null)
        .join("\n")

      const tgRes = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: tgMsg,
            parse_mode: "HTML",
          }),
        },
      )
      if (!tgRes.ok) {
        const err = await tgRes.json()
        errors.push(
          `Telegram: ${(err as { description?: string }).description || "Lỗi không xác định"}`,
        )
      }
    }

    // ── 3. Email ─────────────────────────────────────────────────────────────
    const gmailUser = process.env.GMAIL_USER
    const gmailPass = process.env.GMAIL_APP_PASSWORD

    if (gmailUser && gmailPass) {
      const recipientFullNames = (
        recipientProfiles as Array<{
          full_name: string | null
          username: string | null
        }>
      )
        .map((p) => p.full_name || p.username)
        .filter(Boolean) as string[]

      if (recipientFullNames.length > 0) {
        const [staffByProfileRes, staffByNameRes] = await Promise.all([
          supabaseAdmin
            .from("maintenance_staff")
            .select("id, ten, email, profile_id")
            .eq("factory_id", factoryId)
            .in("profile_id", recipientUserIds),
          supabaseAdmin
            .from("maintenance_staff")
            .select("id, ten, email, profile_id")
            .eq("factory_id", factoryId)
            .in("ten", recipientFullNames),
        ])

        const emailSet = new Set<string>()
        for (const row of [
          ...(staffByProfileRes.data || []),
          ...(staffByNameRes.data || []),
        ] as Array<{ email: string | null }>) {
          if (row.email && row.email.includes("@")) emailSet.add(row.email)
        }

        if (emailSet.size > 0) {
          const subject = `[ISO] Tài liệu ${ma} bạn đã nhận đã hết hiệu lực`

          const htmlBody = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
  <div style="background:#dc2626;padding:16px 24px">
    <h2 style="color:white;margin:0;font-size:16px">⚠️ Tài liệu ISO hết hiệu lực</h2>
  </div>
  <div style="padding:24px;background:white">
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:6px 0;color:#64748b;width:160px">Mã tài liệu</td><td style="padding:6px 0;font-weight:bold">${ma}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Tên tài liệu</td><td style="padding:6px 0">${ten}</td></tr>
      ${lanBanHanh ? `<tr><td style="padding:6px 0;color:#64748b">Lần ban hành</td><td style="padding:6px 0">${lanBanHanh}</td></tr>` : ""}
      ${newDoc ? `<tr><td style="padding:6px 0;color:#64748b">Bản mới</td><td style="padding:6px 0;color:#059669">${(newDoc.ma_tai_lieu as string | null) || ""} — ${newDoc.ten_tai_lieu as string}</td></tr>` : ""}
    </table>
    <p style="color:#374151;font-size:13px;margin:16px 0 0 0">
      Bản tài liệu bạn đã nhận trước đây đã được cập nhật và không còn hiệu lực.
      Hãy liên hệ Ban ISO để nhận bản mới nhất.
    </p>
    <div style="margin-top:24px">
      <a href="${newDocLink}" style="display:inline-block;padding:10px 20px;background:#dc2626;color:white;text-decoration:none;border-radius:6px;font-weight:bold;font-size:14px">
        ${newDocId ? "Xem bản mới →" : "Vào Kho của tôi →"}
      </a>
    </div>
  </div>
  <div style="padding:12px 24px;background:#f8fafc;font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0">
    Hệ thống ISO — Nhà máy chế biến Phước Hòa KPT
  </div>
</div>`

          const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: { user: gmailUser, pass: gmailPass },
          })

          try {
            await transporter.sendMail({
              from: `"ISO Phước Hòa" <${gmailUser}>`,
              to: [...emailSet].join(", "),
              subject,
              html: htmlBody,
            })
          } catch (emailErr) {
            errors.push(
              `Email: ${emailErr instanceof Error ? emailErr.message : "Lỗi gửi mail"}`,
            )
          }
        }
      }
    }

    return NextResponse.json(
      {
        ok: true,
        notified: recipientUserIds.length,
        errors: errors.length > 0 ? errors : undefined,
      },
      { status: errors.length > 0 ? 207 : 200 },
    )
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi server" },
      { status: 500 },
    )
  }
}
