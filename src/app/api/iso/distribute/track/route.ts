import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { isoAuthErrorStatus, resolveIsoActor } from "../../_lib/iso-actor"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: NextRequest) {
  try {
    // getFreshAuthSession() chỉ chạy ở trình duyệt — gọi ở route server luôn trả null nên route
    // này trước đây LUÔN báo 401 (không bao giờ ghi được mốc đã xem/đã tải). Dùng Bearer token.
    let uid: string
    try {
      uid = (await resolveIsoActor(req)).userId
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Phiên đăng nhập không hợp lệ" },
        { status: isoAuthErrorStatus(err) },
      )
    }

    const { docId, action, itemType } = (await req.json()) as {
      docId: string
      action: "view" | "download"
      /** "form" = hồ sơ thực hiện (iso_form_instance_id); mặc định tài liệu (iso_document_id). */
      itemType?: "document" | "form"
    }

    if (!docId || !["view", "download"].includes(action)) {
      return NextResponse.json({ error: "Thiếu tham số" }, { status: 400 })
    }

    // Tìm recipient row của user này cho tài liệu / hồ sơ này. Trước 2026-10-13 route chỉ lọc
    // theo iso_document_id nên hồ sơ thực hiện được phân phối không bao giờ ghi được mốc.
    const { data: recipient, error: fetchErr } = await supabaseAdmin
      .from("iso_distribution_recipients")
      .select("id, first_viewed_at, first_downloaded_at")
      .eq(itemType === "form" ? "iso_form_instance_id" : "iso_document_id", docId)
      .eq("recipient_user_id", uid)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 })
    }
    if (!recipient) {
      // Không có recipient row (vd tài liệu "của bạn", không do phân phối) — không phải lỗi
      return NextResponse.json({ ok: true, noRecord: true })
    }

    const updatePayload: Record<string, string> = {}

    if (action === "view" && !(recipient.first_viewed_at as string | null)) {
      updatePayload.first_viewed_at = new Date().toISOString()
    } else if (
      action === "download" &&
      !(recipient.first_downloaded_at as string | null)
    ) {
      updatePayload.first_downloaded_at = new Date().toISOString()
    } else {
      // Đã track rồi — idempotent no-op
      return NextResponse.json({
        ok: true,
        alreadyTracked: true,
        first_viewed_at: recipient.first_viewed_at,
        first_downloaded_at: recipient.first_downloaded_at,
      })
    }

    const { error: updateErr } = await supabaseAdmin
      .from("iso_distribution_recipients")
      .update(updatePayload)
      .eq("id", recipient.id as string)

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      first_viewed_at: updatePayload.first_viewed_at ?? recipient.first_viewed_at,
      first_downloaded_at: updatePayload.first_downloaded_at ?? recipient.first_downloaded_at,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi server" },
      { status: 500 },
    )
  }
}
