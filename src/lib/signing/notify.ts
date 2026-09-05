import nodemailer from "nodemailer"
import { after } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { escapeHtml } from "@/lib/html-escape"
import { signingDocLabel } from "./labels"

// Thông báo 3 kênh cho hệ thống ký số dùng chung (Chất lượng / Điều xe / Bảo trì).
//
// Trước file này, TOÀN BỘ luồng ký không gửi bất kỳ thông báo nào: người ký kế tiếp không biết
// tới lượt mình, người bị "Trả về" không biết phải sửa & ký lại. Mirror đúng cách module Bảo trì
// (`api/maintenance/notify`) và Văn bản (`api/documents/notify`) đang làm, cộng thêm chuông
// in-app (bảng `notifications`) — kênh duy nhất làm badge đỏ trên chuông sáng lên.
//
// Kiến trúc: đây là LIB server-side, được gọi thẳng từ 3 route handler ký (không tạo route HTTP
// riêng, không self-fetch — trên Vercel serverless self-fetch là thêm 1 invocation vô ích).
// `requests.ts` (lõi ký) chỉ DỰNG `SigningNotifyPlan` rồi trả về, không gọi hàm ở đây — giữ lõi
// không phụ thuộc `next/server`.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://qlsxkpt.vercel.app"

export type SigningNotifyEvent = "tao_yeu_cau" | "ky_buoc" | "hoan_tat" | "tra_ve"

/**
 * "Kế hoạch thông báo" — do `requests.ts` dựng (nơi duy nhất biết ai là người nhận). CHỈ chứa ID;
 * toàn bộ metadata (mã hồ sơ, tên người, tên nhà máy, email) được query LẠI bên trong `after()`
 * nên không tốn thêm round-trip nào trên đường đi của response ký.
 */
export type SigningNotifyPlan = {
  event: SigningNotifyEvent
  yeuCauId: string
  actorUserId: string
  recipientUserIds: string[]
  lyDo?: string | null
  buoc?: number | null
}

const EVENT_TITLE: Record<SigningNotifyEvent, string> = {
  tao_yeu_cau: "Hồ sơ chờ bạn ký",
  ky_buoc: "Đến lượt bạn ký hồ sơ",
  hoan_tat: "Hồ sơ đã ký hoàn tất",
  tra_ve: "Hồ sơ bị trả về — cần ký lại",
}

const EVENT_NOTIF_TYPE: Record<SigningNotifyEvent, string> = {
  tao_yeu_cau: "ky_so_cho_ky",
  ky_buoc: "ky_so_den_luot",
  hoan_tat: "ky_so_hoan_tat",
  tra_ve: "ky_so_tra_ve",
}

const EVENT_COLOR: Record<SigningNotifyEvent, string> = {
  tao_yeu_cau: "#f97316",
  ky_buoc: "#f97316",
  hoan_tat: "#16a34a",
  tra_ve: "#dc2626",
}

type NotifyContext = {
  event: SigningNotifyEvent
  yeuCauId: string
  factoryId: string
  modun: string
  loaiTaiLieu: string
  maHoSo: string | null
  docLabel: string
  actorName: string
  factoryName: string
  recipients: string[]
  lyDo?: string | null
  buoc?: number | null
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function signLink(yeuCauId: string): string {
  return `/dashboard/ky/${yeuCauId}`
}

/**
 * Nhóm Telegram riêng theo module. Hiện CỐ Ý để rỗng: tất cả module đều rơi về nhóm mặc định
 * của Bảo trì (`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`) theo đúng quyết định vận hành. Muốn tách
 * nhóm riêng cho Chất lượng/Điều xe sau này thì chỉ cần thêm 1 entry vào map này (và 2 biến môi
 * trường tương ứng), không đụng chỗ nào khác.
 */
const TELEGRAM_BY_MODUN: Record<string, { tokenEnv: string; chatEnv: string }> = {}

function resolveTelegram(modun: string): { token?: string; chat?: string } {
  const cfg = TELEGRAM_BY_MODUN[modun]
  if (cfg) return { token: process.env[cfg.tokenEnv], chat: process.env[cfg.chatEnv] }
  return { token: process.env.TELEGRAM_BOT_TOKEN, chat: process.env.TELEGRAM_CHAT_ID }
}

// ── Kênh 1: chuông in-app ────────────────────────────────────────────────────

async function sendInApp(ctx: NotifyContext): Promise<void> {
  if (!ctx.recipients.length) return

  const title = EVENT_TITLE[ctx.event]
  let body = `${ctx.docLabel} — ${ctx.actorName}`
  if (ctx.event === "tao_yeu_cau") body += " vừa gửi ký duyệt"
  else if (ctx.event === "ky_buoc") body += " đã ký xong bước trước"
  else if (ctx.event === "hoan_tat") body += " đã ký, hồ sơ hoàn tất"
  else if (ctx.event === "tra_ve") body += " trả về"
  if (ctx.event === "tra_ve" && ctx.lyDo) body += `\nLý do: ${ctx.lyDo}`

  const rows = ctx.recipients.map((uid) => ({
    factory_id: ctx.factoryId,
    user_id: uid,
    type: EVENT_NOTIF_TYPE[ctx.event],
    doc_id: ctx.yeuCauId,
    doc_type: "yeu_cau_ky",
    title,
    body,
    is_read: false,
    link: signLink(ctx.yeuCauId),
  }))

  const { error } = await getSupabaseAdmin().from("notifications").insert(rows)
  if (error) throw new Error(error.message)
}

// ── Kênh 2: Telegram ─────────────────────────────────────────────────────────

async function sendTelegram(ctx: NotifyContext): Promise<void> {
  const { token, chat } = resolveTelegram(ctx.modun)
  if (!token || !chat) return

  // BẮT BUỘC escape mọi giá trị đến từ DB: parse_mode="HTML" gặp ký tự & < > chưa escape sẽ trả
  // HTTP 400 "can't parse entities" và mất trắng cả tin nhắn, không chỉ hỏng định dạng.
  const lines = [
    `🔔 <b>${escapeHtml(EVENT_TITLE[ctx.event])}</b>`,
    ``,
    `🏭 ${escapeHtml(ctx.factoryName)}`,
    `📄 ${escapeHtml(ctx.docLabel)}`,
    `👤 ${escapeHtml(ctx.actorName)}`,
    ctx.event === "tra_ve" && ctx.lyDo ? `⚠️ Lý do: ${escapeHtml(ctx.lyDo)}` : null,
    ``,
    `<a href="${APP_URL}${signLink(ctx.yeuCauId)}">📎 Mở hồ sơ ký</a>`,
  ].filter((l) => l !== null)

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text: lines.join("\n"), parse_mode: "HTML" }),
  })
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { description?: string } | null
    throw new Error(detail?.description || `HTTP ${res.status}`)
  }
}

// ── Kênh 3: Email (Gmail SMTP) ───────────────────────────────────────────────

async function sendEmail(ctx: NotifyContext): Promise<void> {
  const gmailUser = process.env.GMAIL_USER
  const gmailPass = process.env.GMAIL_APP_PASSWORD
  if (!gmailUser || !gmailPass || !ctx.recipients.length) return

  // Tra email theo `profile_id` (KHÔNG theo `maintenance_staff.ten` như api/maintenance/notify —
  // khớp chuỗi tiếng Việt có dấu, sai chính tả là mất email im lặng). Cũng KHÔNG dùng
  // `profiles.auth_email` — đó là email tổng hợp `username@AUTH_EMAIL_DOMAIN`, không phải hòm
  // thư thật (xem src/lib/auth.ts).
  const { data: staffRows } = await getSupabaseAdmin()
    .from("maintenance_staff")
    .select("email, profile_id")
    .in("profile_id", ctx.recipients)

  const emailMap = new Map<string, string>()
  for (const row of (staffRows || []) as { email: string | null; profile_id: string | null }[]) {
    if (row.profile_id && row.email?.includes("@")) emailMap.set(row.profile_id, row.email)
  }

  const toEmails = ctx.recipients.map((uid) => emailMap.get(uid)).filter(Boolean) as string[]
  if (!toEmails.length) {
    // Không phải lỗi hệ thống: người ký chưa được điền email trong Cài đặt → Bảo trì → Nhân sự.
    console.warn(`[signing/notify] ${ctx.event} ${ctx.yeuCauId}: không có hòm thư cho người nhận`)
    return
  }

  const title = EVENT_TITLE[ctx.event]
  const color = EVENT_COLOR[ctx.event]
  const lyDoRow =
    ctx.event === "tra_ve" && ctx.lyDo
      ? `<tr><td style="padding:4px 0;color:#dc2626">Lý do:</td><td style="padding:4px 8px;color:#dc2626;font-weight:600">${escapeHtml(ctx.lyDo)}</td></tr>`
      : ""

  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:${color};color:#fff;padding:16px 24px;border-radius:8px 8px 0 0">
    <h2 style="margin:0;font-size:18px">${escapeHtml(title)}</h2>
    <p style="margin:4px 0 0;opacity:.9;font-size:13px">${escapeHtml(ctx.factoryName)}</p>
  </div>
  <div style="background:#f8fafc;padding:20px 24px;border:1px solid #e2e8f0;border-top:none">
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:4px 0;color:#64748b;width:150px">Hồ sơ:</td><td style="padding:4px 8px;font-weight:600">${escapeHtml(ctx.docLabel)}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">Người thực hiện:</td><td style="padding:4px 8px">${escapeHtml(ctx.actorName)}</td></tr>
      ${lyDoRow}
    </table>
  </div>
  <div style="padding:16px 24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;text-align:center">
    <a href="${APP_URL}${signLink(ctx.yeuCauId)}" style="display:inline-block;background:${color};color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px">
      Mở hồ sơ ký
    </a>
  </div>
</div>`

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser, pass: gmailPass },
  })

  await transporter.sendMail({
    from: `"Ký duyệt điện tử" <${gmailUser}>`,
    to: toEmails.join(", "),
    subject: `[Ký duyệt] ${title}: ${ctx.docLabel}`,
    html,
  })
}

// ── Điều phối ────────────────────────────────────────────────────────────────

export async function sendSigningNotifications(plan: SigningNotifyPlan): Promise<void> {
  const supabase = getSupabaseAdmin()

  const { data: yeuCau } = await supabase
    .from("yeu_cau_ky")
    .select("id, factory_id, ma_ho_so, modun, loai_tai_lieu")
    .eq("id", plan.yeuCauId)
    .maybeSingle()
  if (!yeuCau) return

  // Không tự báo cho chính người vừa thao tác + khử trùng lặp.
  const recipients = [...new Set(plan.recipientUserIds)].filter(
    (id) => !!id && id !== plan.actorUserId,
  )
  if (!recipients.length) return

  const [actorRes, factoryRes] = await Promise.all([
    supabase.from("profiles").select("full_name, username").eq("id", plan.actorUserId).maybeSingle(),
    supabase.from("factories").select("name").eq("id", yeuCau.factory_id).maybeSingle(),
  ])
  const actor = actorRes.data as { full_name?: string | null; username?: string | null } | null

  const ctx: NotifyContext = {
    event: plan.event,
    yeuCauId: plan.yeuCauId,
    factoryId: yeuCau.factory_id as string,
    modun: yeuCau.modun as string,
    loaiTaiLieu: yeuCau.loai_tai_lieu as string,
    maHoSo: (yeuCau.ma_ho_so as string | null) ?? null,
    docLabel: signingDocLabel(
      yeuCau.modun as string,
      yeuCau.loai_tai_lieu as string,
      yeuCau.ma_ho_so as string | null,
    ),
    actorName: actor?.full_name || actor?.username || "Người dùng",
    factoryName: ((factoryRes.data as { name?: string } | null)?.name as string) || "Nhà máy",
    recipients,
    lyDo: plan.lyDo,
    buoc: plan.buoc,
  }

  // 3 kênh độc lập: lỗi 1 kênh không được chặn 2 kênh còn lại, và không kênh nào được ném ra
  // ngoài — thông báo tuyệt đối không được làm hỏng hành động ký ĐÃ thành công.
  const errors: string[] = []
  await sendInApp(ctx).catch((e) => errors.push(`in-app: ${errMsg(e)}`))
  await sendTelegram(ctx).catch((e) => errors.push(`telegram: ${errMsg(e)}`))
  await sendEmail(ctx).catch((e) => errors.push(`email: ${errMsg(e)}`))

  if (errors.length) {
    console.error(`[signing/notify] ${plan.event} ${plan.yeuCauId}: ${errors.join(" | ")}`)
  }
}

/**
 * Lên lịch gửi thông báo SAU khi response đã trả về (`after()` map sang `waitUntil` trên Vercel,
 * giữ invocation sống tới khi task xong). Gửi Telegram + SMTP mất 1-3s — không được cộng vào
 * thời gian chờ của người vừa bấm "Ký".
 *
 * `after()` ném lỗi nếu gọi ngoài request scope (vd script/cron sau này) — khi đó chạy inline và
 * nuốt lỗi, vì mất thông báo vẫn tốt hơn làm hỏng một lượt ký đã thành công.
 */
export function scheduleSigningNotify(plan: SigningNotifyPlan | null): void {
  if (!plan) return
  const task = () =>
    sendSigningNotifications(plan).catch((e) => {
      console.error("[signing/notify] lỗi gửi thông báo:", errMsg(e))
    })
  try {
    after(task)
  } catch {
    void task()
  }
}
