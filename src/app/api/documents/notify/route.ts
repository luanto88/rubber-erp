import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import nodemailer from "nodemailer"

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://qlsxkpt.vercel.app"
const TG_TOKEN = process.env.ISO_TELEGRAM_BOT_TOKEN || ""
const TG_CHAT = process.env.ISO_TELEGRAM_CHAT_ID || ""

// ── Action labels ─────────────────────────────────────────────────────────────

const ACTION_LABEL: Record<string, string> = {
  gui_ky: "Văn bản cần ký duyệt",
  ky_buoc: "Văn bản cần ký bước tiếp theo",
  phe_duyet: "Văn bản đã được phê duyệt",
  tra_ve: "Văn bản bị trả về",
}

// ── Channel: in-app ───────────────────────────────────────────────────────────

async function sendInApp(
  docId: string,
  factoryId: string,
  action: string,
  recipientUserIds: string[],
  docTen: string,
  actorName: string,
  lyDo?: string,
): Promise<void> {
  if (!recipientUserIds.length) return

  const title = ACTION_LABEL[action] || action
  let body = `${actorName} — "${docTen}"`
  if (action === "tra_ve" && lyDo) body += `\nLý do: ${lyDo}`

  const rows = recipientUserIds.map((uid) => ({
    factory_id: factoryId,
    user_id: uid,
    type: "van_ban_ky",
    doc_id: docId,
    doc_type: "van_ban",
    title,
    body,
    is_read: false,
    link: `/dashboard/documents/${docId}`,
  }))

  await supabaseAdmin.from("notifications").insert(rows)
}

// ── Channel: Telegram ────────────────────────────────────────────────────────

async function sendTelegram(
  docId: string,
  action: string,
  docTen: string,
  docMa: string | null,
  actorName: string,
  factoryName: string,
  lyDo?: string,
  stepN?: number,
): Promise<void> {
  if (!TG_TOKEN || !TG_CHAT) return

  const title = ACTION_LABEL[action] || action
  const link = `${APP_URL}/dashboard/documents/${docId}`
  const stepLine = stepN ? `\n📋 Bước ký: ${stepN}` : ""
  const maLine = docMa ? `\n📄 Mã: <b>${docMa}</b>` : ""
  const lyDoLine = action === "tra_ve" && lyDo ? `\n⚠️ Lý do: ${lyDo}` : ""

  const text =
    `🏭 <b>${factoryName}</b>\n` +
    `📌 <b>${title}</b>\n` +
    `📝 Văn bản: <b>${docTen}</b>${maLine}${stepLine}${lyDoLine}\n` +
    `👤 ${actorName}\n\n` +
    `<a href="${link}">📎 Xem và ký duyệt</a>`

  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: "HTML" }),
  })
}

// ── Channel: Email ────────────────────────────────────────────────────────────

async function sendEmail(
  docId: string,
  action: string,
  docTen: string,
  docMa: string | null,
  actorName: string,
  factoryName: string,
  recipientUserIds: string[],
  lyDo?: string,
  stepN?: number,
): Promise<void> {
  const gmailUser = process.env.GMAIL_USER
  const gmailPass = process.env.GMAIL_APP_PASSWORD
  if (!gmailUser || !gmailPass || !recipientUserIds.length) return

  // Lookup emails qua maintenance_staff theo profile_id (KHÔNG dùng profiles.auth_email)
  const { data: staffRows } = await supabaseAdmin
    .from("maintenance_staff")
    .select("email, profile_id")
    .in("profile_id", recipientUserIds)

  const emailMap = new Map<string, string>()
  for (const row of staffRows || []) {
    if (row.profile_id && row.email?.includes("@")) {
      emailMap.set(row.profile_id as string, row.email as string)
    }
  }

  const toEmails = recipientUserIds
    .map((uid) => emailMap.get(uid))
    .filter(Boolean) as string[]
  if (!toEmails.length) return

  const title = ACTION_LABEL[action] || action
  const link = `${APP_URL}/dashboard/documents/${docId}`
  const headerColor = action === "tra_ve" ? "#dc2626" : action === "phe_duyet" ? "#16a34a" : "#f97316"
  const stepLine = stepN ? `<tr><td style="padding:4px 0; color:#64748b">Bước ký:</td><td style="padding:4px 8px; font-weight:600">${stepN}</td></tr>` : ""
  const maLine = docMa ? `<tr><td style="padding:4px 0; color:#64748b">Mã văn bản:</td><td style="padding:4px 8px; font-weight:600">${docMa}</td></tr>` : ""
  const lyDoLine =
    action === "tra_ve" && lyDo
      ? `<tr><td style="padding:4px 0; color:#dc2626">Lý do:</td><td style="padding:4px 8px; color:#dc2626; font-weight:600">${lyDo}</td></tr>`
      : ""

  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:${headerColor};color:#fff;padding:16px 24px;border-radius:8px 8px 0 0">
    <h2 style="margin:0;font-size:18px">${title}</h2>
    <p style="margin:4px 0 0;opacity:.9;font-size:13px">${factoryName}</p>
  </div>
  <div style="background:#f8fafc;padding:20px 24px;border:1px solid #e2e8f0;border-top:none">
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:4px 0; color:#64748b">Văn bản:</td><td style="padding:4px 8px; font-weight:600">${docTen}</td></tr>
      ${maLine}
      ${stepLine}
      <tr><td style="padding:4px 0; color:#64748b">Người thực hiện:</td><td style="padding:4px 8px">${actorName}</td></tr>
      ${lyDoLine}
    </table>
  </div>
  <div style="padding:16px 24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;text-align:center">
    <a href="${link}" style="display:inline-block;background:${headerColor};color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px">
      Xem và xử lý văn bản
    </a>
  </div>
</div>`

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser, pass: gmailPass },
  })

  await transporter.sendMail({
    from: `"Rubber ERP" <${gmailUser}>`,
    to: toEmails.join(", "),
    subject: `[Văn bản] ${title}: ${docTen}`,
    html,
  })
}

// ── Resolve dept leadership (Thường) ─────────────────────────────────────────

// Khi targetDeptCode có giá trị (phân loại Thường), trả về danh sách IDs của
// trưởng/phó (role admin/manager) trong phòng ban đó trong cùng nhà máy
async function resolveDeptLeaderIds(factoryId: string, deptCode: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id, department")
    .eq("factory_id", factoryId)
    .eq("status", "active")
    .in("role", ["admin", "manager"])

  if (!data?.length) return []

  // Lọc theo department text — có thể là tên hoặc code, so sánh case-insensitive
  const deptUpper = deptCode.toUpperCase()
  const rows = data as { id: string; department: string | null }[]
  return rows
    .filter(
      (p) =>
        p.department &&
        (p.department === deptCode || p.department.toUpperCase() === deptUpper),
    )
    .map((p) => p.id)
}

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      docId: string
      factoryId: string
      action: string
      recipientUserIds: string[]
      targetDeptCode?: string | null
      lyDo?: string
      actorUserId?: string
      stepN?: number
    }

    const {
      docId,
      factoryId,
      action,
      recipientUserIds: explicitIds = [],
      targetDeptCode,
      lyDo,
      actorUserId,
      stepN,
    } = body
    if (!docId || !factoryId || !action) {
      return NextResponse.json({ error: "Thiếu tham số" }, { status: 400 })
    }

    // Thường: resolve trưởng/phó phòng ban từ targetDeptCode
    let deptLeaderIds: string[] = []
    if (targetDeptCode) {
      deptLeaderIds = await resolveDeptLeaderIds(factoryId, targetDeptCode).catch(() => [])
    }

    // Gộp explicit + dept leaders, loại trùng
    const recipientUserIds = [...new Set([...explicitIds, ...deptLeaderIds])]

    // Fetch metadata từ DB
    const [{ data: docRow }, { data: factoryRow }, actorNameResult] = await Promise.all([
      supabaseAdmin
        .from("van_ban_documents")
        .select("ten_van_ban, ma_van_ban")
        .eq("id", docId)
        .single(),
      supabaseAdmin
        .from("factories")
        .select("name")
        .eq("id", factoryId)
        .single(),
      actorUserId
        ? supabaseAdmin
            .from("profiles")
            .select("full_name, username")
            .eq("id", actorUserId)
            .single()
        : Promise.resolve({ data: null }),
    ])

    const docTen = (docRow?.ten_van_ban as string) || "Văn bản nội bộ"
    const docMa = (docRow?.ma_van_ban as string | null) || null
    const factoryName = (factoryRow?.name as string) || "Nhà máy"
    const actorProfile = actorNameResult?.data as { full_name?: string; username?: string } | null
    const actorName =
      actorProfile?.full_name || actorProfile?.username || "Người dùng"

    const errors: string[] = []

    // Channel 1: In-app
    await sendInApp(docId, factoryId, action, recipientUserIds, docTen, actorName, lyDo).catch(
      (e: unknown) => errors.push(`in-app: ${e instanceof Error ? e.message : String(e)}`),
    )

    // Channel 2: Telegram
    await sendTelegram(docId, action, docTen, docMa, actorName, factoryName, lyDo, stepN).catch(
      (e: unknown) => errors.push(`telegram: ${e instanceof Error ? e.message : String(e)}`),
    )

    // Channel 3: Email
    await sendEmail(
      docId,
      action,
      docTen,
      docMa,
      actorName,
      factoryName,
      recipientUserIds,
      lyDo,
      stepN,
    ).catch((e: unknown) =>
      errors.push(`email: ${e instanceof Error ? e.message : String(e)}`),
    )

    if (errors.length) {
      return NextResponse.json({ ok: true, errors }, { status: 207 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi không xác định" },
      { status: 500 },
    )
  }
}
