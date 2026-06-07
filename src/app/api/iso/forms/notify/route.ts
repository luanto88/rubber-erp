import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import nodemailer from "nodemailer"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://qlsxkpt.vercel.app"

type ActionLabel = {
  title: string
  body: (tieu_de: string, actor: string, lyDo?: string) => string
}

const ACTION_LABELS: Record<string, ActionLabel> = {
  soan_thao: {
    title: "Hồ sơ cần xem xét / phê duyệt",
    body: (tieu_de, actor) =>
      `Hồ sơ "${tieu_de}" đã được ${actor} ký và gửi yêu cầu xem xét / phê duyệt.`,
  },
  xem_xet: {
    title: "Hồ sơ cần phê duyệt",
    body: (tieu_de, actor) =>
      `Hồ sơ "${tieu_de}" đã được ${actor} xem xét và gửi yêu cầu phê duyệt.`,
  },
  phe_duyet: {
    title: "Hồ sơ đã được phê duyệt",
    body: (tieu_de, actor) =>
      `Hồ sơ "${tieu_de}" đã được ${actor} phê duyệt.`,
  },
  tra_ve: {
    title: "Hồ sơ bị trả về",
    body: (tieu_de, actor, lyDo) =>
      `Hồ sơ "${tieu_de}" đã bị ${actor} trả về.${lyDo ? ` Lý do: ${lyDo}` : ""}`,
  },
}

export async function POST(req: NextRequest) {
  try {
    const { instanceId, factoryId, action, recipientUserIds, lyDo, actorUserId } =
      (await req.json()) as {
        instanceId: string
        factoryId: string
        action: string
        recipientUserIds: string[]
        lyDo?: string
        actorUserId?: string
      }

    if (!instanceId || !factoryId || !action || !recipientUserIds?.length) {
      return NextResponse.json({ error: "Thiếu tham số" }, { status: 400 })
    }

    const { data: inst, error: instErr } = await supabaseAdmin
      .from("iso_form_instances")
      .select("tieu_de")
      .eq("id", instanceId)
      .eq("factory_id", factoryId)
      .single()

    if (instErr || !inst) {
      return NextResponse.json({ error: "Không tìm thấy hồ sơ" }, { status: 404 })
    }

    const tieu_de = (inst.tieu_de as string) || "Hồ sơ không có tiêu đề"

    // Lấy tên người thực hiện action
    let actorName = "Hệ thống"
    if (actorUserId) {
      const { data: actorProfile } = await supabaseAdmin
        .from("profiles")
        .select("full_name, username")
        .eq("id", actorUserId)
        .single()
      if (actorProfile) {
        actorName =
          (actorProfile.full_name as string) ||
          (actorProfile.username as string) ||
          "Hệ thống"
      }
    }

    const labelInfo = ACTION_LABELS[action] ?? {
      title: `Hồ sơ: ${action}`,
      body: (t: string) => `Hồ sơ "${t}" có cập nhật mới.`,
    }

    const title = `[ISO Forms] ${labelInfo.title}`
    const body = labelInfo.body(tieu_de, actorName, lyDo)
    const link = `${APP_URL}/dashboard/iso/forms/${instanceId}`

    const errors: string[] = []

    // ── 1. In-app notifications ────────────────────────────────────────────────
    const notifRows = recipientUserIds.map((uid) => ({
      factory_id: factoryId,
      user_id: uid,
      type: "cho_ky",
      doc_id: instanceId,
      doc_type: "iso_form",
      title,
      body,
      is_read: false,
      link,
    }))

    const { error: notifErr } = await supabaseAdmin
      .from("notifications")
      .insert(notifRows)
    if (notifErr) {
      errors.push(`In-app: ${notifErr.message}`)
    }

    // Lấy profiles người nhận (cần full_name để tra email)
    const { data: recipientProfiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, username")
      .in("id", recipientUserIds)

    // ── 2. Telegram ────────────────────────────────────────────────────────────
    const botToken = process.env.ISO_FORM_TOKEN
    const chatId = process.env.ISO_FORM_CHAT_ID

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
        `🔔 <b>${labelInfo.title}</b>`,
        ``,
        `📋 Hồ sơ: ${tieu_de}`,
        `👤 Người thực hiện: ${actorName}`,
        recipientNames ? `📬 Gửi đến: ${recipientNames}` : null,
        lyDo ? `📝 Lý do: ${lyDo}` : null,
        ``,
        `🔗 <a href="${link}">Xem hồ sơ</a>`,
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

    // ── 3. Email ────────────────────────────────────────────────────────────────
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

        const staffMap = new Map<
          string,
          { ten: string; email: string | null; profile_id: string | null }
        >()
        for (const row of [
          ...(staffByProfileRes.data || []),
          ...(staffByNameRes.data || []),
        ] as Array<{
          id: string
          ten: string
          email: string | null
          profile_id: string | null
        }>) {
          staffMap.set(row.id, {
            ten: row.ten,
            email: row.email,
            profile_id: row.profile_id,
          })
        }

        const emails = [...staffMap.values()]
          .map((s) => s.email)
          .filter((e): e is string => !!e && e.includes("@"))

        if (emails.length > 0) {
          const isWarning = action === "tra_ve"
          const headerColor = isWarning ? "#e11d48" : "#7c3aed"
          const subject = `[ISO Forms] ${labelInfo.title} — ${tieu_de}`

          const htmlBody = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
  <div style="background:${headerColor};padding:16px 24px">
    <h2 style="color:white;margin:0;font-size:16px">🔔 ${labelInfo.title}</h2>
  </div>
  <div style="padding:24px;background:white">
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:6px 0;color:#64748b;width:160px">Hồ sơ</td><td style="padding:6px 0;font-weight:bold">${tieu_de}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Người thực hiện</td><td style="padding:6px 0">${actorName}</td></tr>
      ${lyDo ? `<tr><td style="padding:6px 0;color:#64748b">Lý do</td><td style="padding:6px 0;color:#e11d48">${lyDo}</td></tr>` : ""}
    </table>
    <div style="margin-top:24px">
      <a href="${link}" style="display:inline-block;padding:10px 20px;background:${headerColor};color:white;text-decoration:none;border-radius:6px;font-weight:bold;font-size:14px">
        Xem hồ sơ →
      </a>
    </div>
  </div>
  <div style="padding:12px 24px;background:#f8fafc;font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0">
    Hệ thống ISO Forms — Nhà máy chế biến Phước Hòa KPT
  </div>
</div>`

          const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: { user: gmailUser, pass: gmailPass },
          })

          try {
            await transporter.sendMail({
              from: `"ISO Forms Phước Hòa" <${gmailUser}>`,
              to: emails.join(", "),
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
