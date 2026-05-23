import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import nodemailer from "nodemailer"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://qlsxkpt.vercel.app"

type ActionLabel = { title: string; body: (maTl: string, tenTl: string, actor: string, lyDo?: string) => string }

const ACTION_LABELS: Record<string, ActionLabel> = {
  gui_xem_xet: {
    title: "Tài liệu cần xem xét",
    body: (maTl, tenTl, actor) => `Tài liệu ${maTl} — "${tenTl}" đã được ${actor} gửi yêu cầu xem xét.`,
  },
  gui_phe_duyet: {
    title: "Tài liệu cần phê duyệt",
    body: (maTl, tenTl, actor) => `Tài liệu ${maTl} — "${tenTl}" đã được ${actor} gửi yêu cầu phê duyệt.`,
  },
  phe_duyet: {
    title: "Tài liệu đã được phê duyệt",
    body: (maTl, tenTl, actor) => `Tài liệu ${maTl} — "${tenTl}" đã được ${actor} phê duyệt và có hiệu lực.`,
  },
  tra_ve: {
    title: "Tài liệu bị trả về",
    body: (maTl, tenTl, actor, lyDo) => `Tài liệu ${maTl} — "${tenTl}" đã bị ${actor} trả về.${lyDo ? ` Lý do: ${lyDo}` : ""}`,
  },
  khong_xem_xet: {
    title: "Tài liệu bị từ chối xem xét",
    body: (maTl, tenTl, actor, lyDo) => `Tài liệu ${maTl} — "${tenTl}" đã bị ${actor} từ chối xem xét.${lyDo ? ` Lý do: ${lyDo}` : ""}`,
  },
}

export async function POST(req: NextRequest) {
  try {
    const { docId, factoryId, action, recipientUserIds, lyDo, actorUserId } =
      await req.json() as {
        docId: string
        factoryId: string
        action: string
        recipientUserIds: string[]
        lyDo?: string
        actorUserId?: string
      }

    if (!docId || !factoryId || !action || !recipientUserIds?.length) {
      return NextResponse.json({ error: "Thiếu tham số" }, { status: 400 })
    }

    const { data: doc, error: docErr } = await supabaseAdmin
      .from("iso_documents")
      .select("ma_tai_lieu, ten_tai_lieu")
      .eq("id", docId)
      .eq("factory_id", factoryId)
      .single()

    if (docErr || !doc) {
      return NextResponse.json({ error: "Không tìm thấy tài liệu" }, { status: 404 })
    }

    const maTl = (doc.ma_tai_lieu as string) || "—"
    const tenTl = doc.ten_tai_lieu as string

    // Lấy tên người thực hiện action
    let actorName = "Hệ thống"
    if (actorUserId) {
      const { data: actorProfile } = await supabaseAdmin
        .from("profiles")
        .select("full_name, username")
        .eq("id", actorUserId)
        .single()
      if (actorProfile) {
        actorName = (actorProfile.full_name as string) || (actorProfile.username as string) || "Hệ thống"
      }
    }

    const labelInfo = ACTION_LABELS[action] || {
      title: `ISO: ${action}`,
      body: (m: string, t: string) => `Tài liệu ${m} — "${t}" có cập nhật mới.`,
    }

    const title = `[ISO] ${labelInfo.title}: ${maTl}`
    const body = labelInfo.body(maTl, tenTl, actorName, lyDo)
    const link = `${APP_URL}/dashboard/iso/documents/${docId}`

    const errors: string[] = []

    // ── 1. In-app notifications ────────────────────────────────────────────────
    const notifRows = recipientUserIds.map((uid) => ({
      factory_id: factoryId,
      user_id: uid,
      type: "cho_ky",
      doc_id: docId,
      doc_type: "iso",
      title,
      body,
      is_read: false,
      link,
    }))

    const { error: notifErr } = await supabaseAdmin.from("notifications").insert(notifRows)
    if (notifErr) {
      errors.push(`In-app: ${notifErr.message}`)
    }

    // Lấy profiles người nhận (cần full_name để tra email)
    const { data: recipientProfiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, username")
      .in("id", recipientUserIds)

    // ── 2. Telegram ────────────────────────────────────────────────────────────
    const botToken = process.env.TELEGRAM_BOT_TOKEN
    const chatId = process.env.TELEGRAM_CHAT_ID

    if (botToken && chatId) {
      const recipientNames = (recipientProfiles || [])
        .map((p: { full_name: string | null; username: string | null }) => p.full_name || p.username || "")
        .filter(Boolean)
        .join(", ")

      const tgMsg = [
        `🔔 <b>${labelInfo.title}</b>`,
        ``,
        `📄 Mã tài liệu: <code>${maTl}</code>`,
        `📋 Tên tài liệu: ${tenTl}`,
        `👤 Người thực hiện: ${actorName}`,
        recipientNames ? `📬 Gửi đến: ${recipientNames}` : null,
        lyDo ? `📝 Lý do: ${lyDo}` : null,
        ``,
        `🔗 <a href="${link}">Xem tài liệu</a>`,
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
        errors.push(`Telegram: ${(err as { description?: string }).description || "Lỗi không xác định"}`)
      }
    }

    // ── 3. Email ────────────────────────────────────────────────────────────────
    const gmailUser = process.env.GMAIL_USER
    const gmailPass = process.env.GMAIL_APP_PASSWORD

    if (gmailUser && gmailPass) {
      const recipientFullNames = (recipientProfiles || [])
        .map((p: { full_name: string | null; username: string | null }) => p.full_name || p.username)
        .filter(Boolean) as string[]

      if (recipientFullNames.length > 0) {
        const { data: staffRows } = await supabaseAdmin
          .from("maintenance_staff")
          .select("ten, email")
          .eq("factory_id", factoryId)
          .in("ten", recipientFullNames)

        const emails = ((staffRows || []) as Array<{ ten: string; email: string | null }>)
          .map((s) => s.email)
          .filter((e): e is string => !!e && e.includes("@"))

        if (emails.length > 0) {
          const isWarning = action === "tra_ve" || action === "khong_xem_xet"
          const headerColor = isWarning ? "#e11d48" : "#7c3aed"
          const subject = `[ISO] ${labelInfo.title} — ${maTl}`

          const htmlBody = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
  <div style="background:${headerColor};padding:16px 24px">
    <h2 style="color:white;margin:0;font-size:16px">🔔 ${labelInfo.title}</h2>
  </div>
  <div style="padding:24px;background:white">
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:6px 0;color:#64748b;width:160px">Mã tài liệu</td><td style="padding:6px 0;font-weight:bold;font-family:monospace">${maTl}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Tên tài liệu</td><td style="padding:6px 0;font-weight:bold">${tenTl}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Người thực hiện</td><td style="padding:6px 0">${actorName}</td></tr>
      ${lyDo ? `<tr><td style="padding:6px 0;color:#64748b">Lý do</td><td style="padding:6px 0;color:#e11d48">${lyDo}</td></tr>` : ""}
    </table>
    <div style="margin-top:24px">
      <a href="${link}" style="display:inline-block;padding:10px 20px;background:${headerColor};color:white;text-decoration:none;border-radius:6px;font-weight:bold;font-size:14px">
        Xem tài liệu →
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
