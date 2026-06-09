import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { getFreshAuthSession } from "@/lib/auth"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: NextRequest) {
  try {
    const session = await getFreshAuthSession()
    const uid = session?.user?.id
    if (!uid) {
      return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 })
    }

    const { docId, action } = (await req.json()) as {
      docId: string
      action: "view" | "download"
    }

    if (!docId || !["view", "download"].includes(action)) {
      return NextResponse.json({ error: "Thiếu tham số" }, { status: 400 })
    }

    // Tìm recipient row của user này cho doc này
    const { data: recipient, error: fetchErr } = await supabaseAdmin
      .from("iso_distribution_recipients")
      .select("id, first_viewed_at, first_downloaded_at")
      .eq("iso_document_id", docId)
      .eq("recipient_user_id", uid)
      .order("created_at", { ascending: true })
      .limit(1)
      .single()

    if (fetchErr || !recipient) {
      // Không có recipient row — không phải lỗi, chỉ không làm gì
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
      return NextResponse.json({ ok: true, alreadyTracked: true })
    }

    const { error: updateErr } = await supabaseAdmin
      .from("iso_distribution_recipients")
      .update(updatePayload)
      .eq("id", recipient.id as string)

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi server" },
      { status: 500 },
    )
  }
}
