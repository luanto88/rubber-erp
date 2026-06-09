import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import nodemailer from "nodemailer"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://qlsxkpt.vercel.app"

// GET /api/iso/distribute?factoryId=xxx&docIds=id1,id2
// Trả về danh sách active profiles + thông tin đã nhận trước đó
// Dùng supabaseAdmin để bypass RLS (manager cần xem tất cả users trong factory)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const factoryId = searchParams.get("factoryId")
    const docIdsParam = searchParams.get("docIds")

    if (!factoryId) {
      return NextResponse.json({ error: "Thiếu factoryId" }, { status: 400 })
    }

    const docIds = docIdsParam ? docIdsParam.split(",").filter(Boolean) : []

    const [profilesRes, deptsRes, existingRes] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, full_name, username, department")
        .eq("factory_id", factoryId)
        .eq("status", "active")
        .order("full_name"),
      supabaseAdmin.from("departments").select("id, code, name").eq("is_active", true),
      docIds.length > 0
        ? supabaseAdmin
            .from("iso_distribution_recipients")
            .select("recipient_user_id, iso_document_id")
            .eq("factory_id", factoryId)
            .in("iso_document_id", docIds)
        : Promise.resolve({ data: [], error: null }),
    ])

    if (profilesRes.error) {
      return NextResponse.json({ error: profilesRes.error.message }, { status: 500 })
    }

    const depts = (deptsRes.data || []) as Array<{ id: string; code: string; name: string }>
    const deptNameByCode = new Map(depts.map((d) => [d.code, d.name]))
    const deptNameValues = new Set(depts.map((d) => d.name))

    const existingSet = new Set(
      ((existingRes.data || []) as Array<{ recipient_user_id: string }>).map(
        (r) => r.recipient_user_id,
      ),
    )

    const recipients = (
      profilesRes.data as Array<{
        id: string
        full_name: string | null
        username: string | null
        department: string | null
      }>
    ).map((p) => {
      let deptName: string | null = null
      if (p.department) {
        deptName = deptNameValues.has(p.department)
          ? p.department
          : (deptNameByCode.get(p.department) ?? p.department)
      }
      return {
        id: p.id,
        full_name: p.full_name,
        username: p.username,
        department: deptName,
        alreadyReceived: existingSet.has(p.id),
      }
    })

    return NextResponse.json({ recipients, departments: depts })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi server" },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const { factoryId, docIds, recipientUserIds, ghiChu, distributorUserId } =
      (await req.json()) as {
        factoryId: string
        docIds: string[]
        recipientUserIds: string[]
        ghiChu?: string
        distributorUserId: string
      }

    if (
      !factoryId ||
      !docIds?.length ||
      !recipientUserIds?.length ||
      !distributorUserId
    ) {
      return NextResponse.json({ error: "Thiếu tham số" }, { status: 400 })
    }

    // Validate docs đều co_hieu_luc và thuộc factory
    const { data: docs, error: docErr } = await supabaseAdmin
      .from("iso_documents")
      .select(
        "id, ma_tai_lieu, ten_tai_lieu, loai_tai_lieu, trang_thai, ngay_hieu_luc, lan_ban_hanh",
      )
      .eq("factory_id", factoryId)
      .in("id", docIds)

    if (docErr) {
      return NextResponse.json({ error: docErr.message }, { status: 500 })
    }

    const invalidDocs = (docs || []).filter(
      (d) => (d.trang_thai as string) !== "co_hieu_luc",
    )
    if (invalidDocs.length > 0) {
      return NextResponse.json(
        {
          error: `Chỉ phân phối tài liệu đang có hiệu lực. Tài liệu không hợp lệ: ${invalidDocs.map((d) => d.ma_tai_lieu).join(", ")}`,
        },
        { status: 400 },
      )
    }

    // Kiểm tra duplicate: tìm tất cả (docId, userId) đã tồn tại
    const pairs = docIds.flatMap((docId) =>
      recipientUserIds.map((uid) => ({ docId, uid })),
    )

    const { data: existingRows } = await supabaseAdmin
      .from("iso_distribution_recipients")
      .select("iso_document_id, recipient_user_id")
      .eq("factory_id", factoryId)
      .in("iso_document_id", docIds)
      .in("recipient_user_id", recipientUserIds)

    const existingSet = new Set(
      (existingRows || []).map(
        (r) =>
          `${r.iso_document_id as string}|${r.recipient_user_id as string}`,
      ),
    )

    const newPairs = pairs.filter(
      (p) => !existingSet.has(`${p.docId}|${p.uid}`),
    )
    const skippedPairs = pairs.filter((p) =>
      existingSet.has(`${p.docId}|${p.uid}`),
    )

    if (newPairs.length === 0) {
      return NextResponse.json(
        {
          error: "Tất cả người được chọn đã nhận tài liệu này rồi.",
          skipped: skippedPairs.length,
        },
        { status: 400 },
      )
    }

    // Tạo batch
    const { data: batch, error: batchErr } = await supabaseAdmin
      .from("iso_distribution_batches")
      .insert({
        factory_id: factoryId,
        distributed_by: distributorUserId,
        ghi_chu: ghiChu || null,
      })
      .select("id")
      .single()

    if (batchErr || !batch) {
      return NextResponse.json(
        { error: batchErr?.message || "Lỗi tạo batch" },
        { status: 500 },
      )
    }

    // Insert recipients
    const recipientRows = newPairs.map((p) => ({
      batch_id: batch.id as string,
      iso_document_id: p.docId,
      factory_id: factoryId,
      recipient_user_id: p.uid,
    }))

    const { error: recErr } = await supabaseAdmin
      .from("iso_distribution_recipients")
      .insert(recipientRows)

    if (recErr) {
      return NextResponse.json({ error: recErr.message }, { status: 500 })
    }

    const errors: string[] = []

    // Lấy profiles người nhận
    const uniqueRecipientIds = [...new Set(newPairs.map((p) => p.uid))]
    const { data: recipientProfiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, username")
      .in("id", uniqueRecipientIds)

    // Lấy tên người phân phối
    const { data: distributorProfile } = await supabaseAdmin
      .from("profiles")
      .select("full_name, username")
      .eq("id", distributorUserId)
      .single()
    const distributorName =
      (distributorProfile?.full_name as string | null) ||
      (distributorProfile?.username as string | null) ||
      "Hệ thống"

    // Tên docs được phân phối
    const docSummary = (docs || [])
      .map(
        (d) =>
          `${(d.ma_tai_lieu as string | null) || ""} — ${d.ten_tai_lieu as string}`,
      )
      .join(", ")

    // ── 1. In-app notifications ──────────────────────────────────────────────
    const notifRows = newPairs.map((p) => {
      const doc = (docs || []).find((d) => d.id === p.docId)
      const ma = (doc?.ma_tai_lieu as string | null) || ""
      const ten = (doc?.ten_tai_lieu as string) || ""
      return {
        factory_id: factoryId,
        user_id: p.uid,
        type: "phan_phoi",
        doc_id: p.docId,
        doc_type: "iso_document",
        title: `Tài liệu ${ma} đã được phân phối đến bạn`,
        body: `"${ten}" đã được phân phối. Truy cập Kho của tôi để xem.`,
        is_read: false,
        link: `${APP_URL}/dashboard/iso/kho`,
      }
    })

    const { error: notifErr } = await supabaseAdmin
      .from("notifications")
      .insert(notifRows)
    if (notifErr) errors.push(`In-app: ${notifErr.message}`)

    // ── 2. Telegram ──────────────────────────────────────────────────────────
    const botToken = process.env.ISO_TELEGRAM_BOT_TOKEN
    const chatId = process.env.ISO_TELEGRAM_CHAT_ID

    if (botToken && chatId) {
      const recipientNames = (
        recipientProfiles as Array<{
          id: string
          full_name: string | null
          username: string | null
        }>
      )
        .map((p) => p.full_name || p.username || "")
        .filter(Boolean)
        .join(", ")

      const tgMsg = [
        `📤 <b>Phân phối tài liệu ISO</b>`,
        ``,
        `📋 Tài liệu: ${docSummary}`,
        `👤 Người phân phối: ${distributorName}`,
        recipientNames ? `📬 Gửi đến (${uniqueRecipientIds.length} người): ${recipientNames}` : null,
        ghiChu ? `📝 Ghi chú: ${ghiChu}` : null,
        skippedPairs.length > 0
          ? `⚠️ Bỏ qua ${skippedPairs.length} người đã nhận trước đó`
          : null,
        ``,
        `🔗 <a href="${APP_URL}/dashboard/iso/kho">Xem trong Kho của tôi</a>`,
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
            .in("profile_id", uniqueRecipientIds),
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
          const khoLink = `${APP_URL}/dashboard/iso/kho`
          const subject = `[ISO] Tài liệu mới được phân phối đến bạn`

          const docListHtml = (docs || [])
            .map(
              (d) => `<tr>
            <td style="padding:4px 8px;border:1px solid #e2e8f0">${(d.ma_tai_lieu as string | null) || ""}</td>
            <td style="padding:4px 8px;border:1px solid #e2e8f0">${d.ten_tai_lieu as string}</td>
            <td style="padding:4px 8px;border:1px solid #e2e8f0">${(d.ngay_hieu_luc as string | null) ? new Date(d.ngay_hieu_luc as string).toLocaleDateString("vi-VN") : ""}</td>
          </tr>`,
            )
            .join("")

          const htmlBody = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
  <div style="background:#7c3aed;padding:16px 24px">
    <h2 style="color:white;margin:0;font-size:16px">📤 Tài liệu ISO mới được phân phối</h2>
  </div>
  <div style="padding:24px;background:white">
    <p style="color:#374151;font-size:14px;margin:0 0 16px 0">Bạn vừa nhận được ${docIds.length} tài liệu từ <strong>${distributorName}</strong>:</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#f8fafc">
          <th style="padding:6px 8px;border:1px solid #e2e8f0;text-align:left">Mã tài liệu</th>
          <th style="padding:6px 8px;border:1px solid #e2e8f0;text-align:left">Tên tài liệu</th>
          <th style="padding:6px 8px;border:1px solid #e2e8f0;text-align:left">Ngày hiệu lực</th>
        </tr>
      </thead>
      <tbody>${docListHtml}</tbody>
    </table>
    ${ghiChu ? `<p style="color:#64748b;font-size:13px;margin:16px 0 0 0">📝 Ghi chú: ${ghiChu}</p>` : ""}
    <div style="margin-top:24px">
      <a href="${khoLink}" style="display:inline-block;padding:10px 20px;background:#7c3aed;color:white;text-decoration:none;border-radius:6px;font-weight:bold;font-size:14px">
        Xem trong Kho của tôi →
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
        batchId: batch.id as string,
        distributed: newPairs.length,
        skipped: skippedPairs.length,
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
