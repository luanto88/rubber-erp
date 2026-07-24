import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"
import nodemailer from "nodemailer"

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://qlsxkpt.vercel.app"
const TG_TOKEN = process.env.ISO_TELEGRAM_BOT_TOKEN || ""
const TG_CHAT = process.env.ISO_TELEGRAM_CHAT_ID || ""

// Xác thực + kiểm tra quyền `documents.distribute` — trước đây route này hoàn toàn
// không có bước này (chỉ ẩn/hiện nút "Phân phối" ở UI), nghĩa là bất kỳ ai đăng nhập
// được (kể cả không có quyền) đều có thể gọi thẳng API để phân phối. Mirror đúng
// ngữ nghĩa `fetchPermissionCodesForUser()` (src/lib/auth.ts): nếu user có BẤT KỲ
// quyền explicit nào trong `user_permissions`, CHỈ dùng đúng tập đó (không cộng thêm
// `role_permissions`); ngược lại mới fallback theo quyền mặc định của role. Trả kèm
// `factoryId` thật của người gọi để chặn luôn thao tác chéo nhà máy (route dùng
// service role nên không có RLS nào chặn giúp).
async function requireDistributePermission(req: NextRequest) {
  const authUser = await requireAuthUser(req)
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("role, factory_id")
    .eq("id", authUser.id)
    .single()
  if (profileErr || !profile) {
    throw new Error("Không tìm thấy hồ sơ người dùng")
  }

  const role = (profile.role as string) || ""
  const isAdmin = role === "admin"

  if (!isAdmin) {
    const { data: explicitRows } = await supabaseAdmin
      .from("user_permissions")
      .select("permission_code")
      .eq("user_id", authUser.id)
      .eq("granted", true)

    let allowed: boolean
    if (explicitRows && explicitRows.length > 0) {
      allowed = explicitRows.some((r) => r.permission_code === "documents.distribute")
    } else {
      const { data: roleRows } = await supabaseAdmin
        .from("role_permissions")
        .select("permission_code")
        .eq("role", role)
        .eq("permission_code", "documents.distribute")
      allowed = (roleRows?.length || 0) > 0
    }
    if (!allowed) {
      throw new Error("Bạn không có quyền phân phối văn bản")
    }
  }

  return { userId: authUser.id, factoryId: (profile.factory_id as string | null) }
}

function errorStatus(msg: string): number {
  if (msg.includes("đăng nhập")) return 401
  if (msg.includes("quyền")) return 403
  return 500
}

// GET: Danh sách người dùng active trong cùng factory để chọn nhận phân phối
// + flag alreadyReceived cho từng văn bản
export async function GET(req: NextRequest) {
  try {
    const { factoryId: callerFactoryId } = await requireDistributePermission(req)

    const { searchParams } = new URL(req.url)
    const factoryId = searchParams.get("factoryId")
    const docIds = searchParams.get("docIds")?.split(",").filter(Boolean) || []

    if (!factoryId) return NextResponse.json({ error: "Thiếu factoryId" }, { status: 400 })
    if (factoryId !== callerFactoryId) {
      return NextResponse.json({ error: "Bạn không có quyền truy cập nhà máy này" }, { status: 403 })
    }

    const { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, username, department, role")
      .eq("factory_id", factoryId)
      .eq("status", "active")
      .order("full_name")

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Nếu có docIds, tính alreadyReceived per user per doc
    const alreadyReceived: Record<string, string[]> = {}
    if (docIds.length) {
      const { data: existing } = await supabaseAdmin
        .from("van_ban_distribution_recipients")
        .select("recipient_user_id, van_ban_document_id")
        .in("van_ban_document_id", docIds)
        .eq("factory_id", factoryId)

      for (const row of existing || []) {
        const uid = row.recipient_user_id as string
        const did = row.van_ban_document_id as string
        if (!alreadyReceived[uid]) alreadyReceived[uid] = []
        if (!alreadyReceived[uid].includes(did)) alreadyReceived[uid].push(did)
      }
    }

    const result = (profiles || []).map((p) => ({
      id: p.id,
      full_name: (p.full_name as string | null) || (p.username as string) || "",
      department: (p.department as string | null) || "",
      role: (p.role as string) || "user",
      alreadyReceived: alreadyReceived[p.id as string] || [],
    }))

    return NextResponse.json({ users: result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Lỗi"
    return NextResponse.json({ error: msg }, { status: errorStatus(msg) })
  }
}

// POST: Tạo batch phân phối
export async function POST(req: NextRequest) {
  try {
    const { userId, factoryId: callerFactoryId } = await requireDistributePermission(req)

    const body = (await req.json()) as {
      factoryId: string
      docIds: string[]
      recipientUserIds: string[]
      ghiChu?: string
    }

    const { factoryId, docIds, recipientUserIds, ghiChu } = body
    if (!factoryId || !docIds?.length || !recipientUserIds?.length) {
      return NextResponse.json({ error: "Thiếu tham số" }, { status: 400 })
    }
    if (factoryId !== callerFactoryId) {
      return NextResponse.json({ error: "Bạn không có quyền truy cập nhà máy này" }, { status: 403 })
    }

    // "Người phân phối" luôn lấy từ danh tính đã xác thực server-side (userId), KHÔNG
    // tin trường distributedBy do client gửi lên — trước đây route tin thẳng giá trị
    // này, cho phép giả mạo gán hành động phân phối cho một người dùng khác.
    const distributedBy = userId

    // Tạo batch
    const { data: batch, error: batchErr } = await supabaseAdmin
      .from("van_ban_distribution_batches")
      .insert({ factory_id: factoryId, distributed_by: distributedBy, ghi_chu: ghiChu || null })
      .select("id")
      .single()

    if (batchErr || !batch) {
      return NextResponse.json({ error: batchErr?.message || "Không tạo được batch" }, { status: 500 })
    }

    // Insert recipients (doc x user)
    const rows = docIds.flatMap((docId) =>
      recipientUserIds.map((uid) => ({
        batch_id: batch.id as string,
        van_ban_document_id: docId,
        factory_id: factoryId,
        recipient_user_id: uid,
      })),
    )

    const { error: recErr } = await supabaseAdmin.from("van_ban_distribution_recipients").insert(rows)
    if (recErr) {
      return NextResponse.json({ error: recErr.message }, { status: 500 })
    }

    // Fetch doc metadata for notification
    const { data: docs } = await supabaseAdmin
      .from("van_ban_documents")
      .select("id, ten_van_ban, ma_van_ban")
      .in("id", docIds)

    const { data: factory } = await supabaseAdmin
      .from("factories")
      .select("name")
      .eq("id", factoryId)
      .single()

    const { data: actorProfile } = await supabaseAdmin
      .from("profiles")
      .select("full_name, username")
      .eq("id", distributedBy)
      .single()

    const factoryName = (factory?.name as string) || "Nhà máy"
    const actorName =
      (actorProfile?.full_name as string) || (actorProfile?.username as string) || "Người dùng"
    const docList = docs || []

    const errors: string[] = []

    // In-app notifications
    for (const doc of docList) {
      const title = `Văn bản được phân phối: ${(doc.ten_van_ban as string) || ""}`
      const body = `${actorName} — ${factoryName}`
      const notifRows = recipientUserIds.map((uid) => ({
        factory_id: factoryId,
        user_id: uid,
        type: "van_ban_phan_phoi",
        doc_id: doc.id as string,
        doc_type: "van_ban",
        title,
        body,
        is_read: false,
        link: `/dashboard/documents/${doc.id as string}`,
      }))
      const { error: notifErr } = await supabaseAdmin
        .from("notifications")
        .insert(notifRows)
      if (notifErr) errors.push(`in-app: ${notifErr.message}`)
    }

    // Telegram
    if (TG_TOKEN && TG_CHAT) {
      const docNames = docList.map((d) => (d.ma_van_ban || d.id) as string).join(", ")
      const text =
        `🏭 <b>${factoryName}</b>\n` +
        `📤 <b>Phân phối văn bản</b>\n` +
        `📝 Tài liệu: <b>${docNames}</b>\n` +
        `👥 Đến ${recipientUserIds.length} người nhận\n` +
        `👤 ${actorName}`

      await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: "HTML" }),
      }).catch((e: unknown) => errors.push(`telegram: ${e instanceof Error ? e.message : String(e)}`))
    }

    // Email
    const gmailUser = process.env.GMAIL_USER
    const gmailPass = process.env.GMAIL_APP_PASSWORD
    if (gmailUser && gmailPass && recipientUserIds.length) {
      const { data: staffRows } = await supabaseAdmin
        .from("maintenance_staff")
        .select("email, profile_id")
        .in("profile_id", recipientUserIds)

      const toEmails = (staffRows || [])
        .filter((r) => r.profile_id && (r.email as string)?.includes("@"))
        .map((r) => r.email as string)

      if (toEmails.length) {
        const docLines = docList
          .map((d) => `<li><a href="${APP_URL}/dashboard/documents/${d.id as string}">${d.ma_van_ban || d.ten_van_ban}</a></li>`)
          .join("")

        const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#2563eb;color:#fff;padding:16px 24px;border-radius:8px 8px 0 0">
    <h2 style="margin:0;font-size:18px">Văn bản được phân phối đến bạn</h2>
    <p style="margin:4px 0 0;opacity:.9;font-size:13px">${factoryName}</p>
  </div>
  <div style="background:#f8fafc;padding:20px 24px;border:1px solid #e2e8f0;border-top:none">
    <p style="margin:0 0 12px;font-size:14px">${actorName} đã phân phối các văn bản sau đến bạn:</p>
    <ul style="margin:0;padding-left:20px;font-size:14px">${docLines}</ul>
    ${ghiChu ? `<p style="margin:12px 0 0;font-size:13px;color:#64748b">Ghi chú: ${ghiChu}</p>` : ""}
  </div>
  <div style="padding:16px 24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;text-align:center">
    <a href="${APP_URL}/dashboard/documents" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px">
      Xem tất cả văn bản
    </a>
  </div>
</div>`

        const transporter = nodemailer.createTransport({
          service: "gmail",
          auth: { user: gmailUser, pass: gmailPass },
        })

        await transporter
          .sendMail({
            from: `"Rubber ERP" <${gmailUser}>`,
            to: toEmails.join(", "),
            subject: `[Văn bản] Phân phối tài liệu từ ${actorName}`,
            html,
          })
          .catch((e: unknown) => errors.push(`email: ${e instanceof Error ? e.message : String(e)}`))
      }
    }

    if (errors.length) {
      return NextResponse.json({ ok: true, batchId: batch.id, errors }, { status: 207 })
    }
    return NextResponse.json({ ok: true, batchId: batch.id })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Lỗi không xác định"
    return NextResponse.json({ error: msg }, { status: errorStatus(msg) })
  }
}
