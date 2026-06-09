import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { getFreshAuthSession } from "@/lib/auth"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ recipientId: string }> },
) {
  try {
    const session = await getFreshAuthSession()
    const uid = session?.user?.id
    if (!uid) {
      return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 })
    }

    const { recipientId } = await params
    if (!recipientId) {
      return NextResponse.json({ error: "Thiếu recipientId" }, { status: 400 })
    }

    // Lấy thông tin recipient + batch để validate quyền
    const { data: recipient, error: fetchErr } = await supabaseAdmin
      .from("iso_distribution_recipients")
      .select(
        "id, batch_id, first_viewed_at, first_downloaded_at, recipient_user_id, factory_id",
      )
      .eq("id", recipientId)
      .single()

    if (fetchErr || !recipient) {
      return NextResponse.json(
        { error: "Không tìm thấy bản ghi" },
        { status: 404 },
      )
    }

    // Kiểm tra xem người đang thao tác có quyền thu hồi không
    // Phải là distributor của batch cha hoặc admin
    const { data: batch } = await supabaseAdmin
      .from("iso_distribution_batches")
      .select("distributed_by, factory_id")
      .eq("id", recipient.batch_id as string)
      .single()

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", uid)
      .single()

    const isAdmin =
      (profile?.role as string | null) === "admin"
    const isDistributor =
      batch && (batch.distributed_by as string) === uid

    if (!isAdmin && !isDistributor) {
      return NextResponse.json(
        { error: "Không có quyền thu hồi phân phối này" },
        { status: 403 },
      )
    }

    // Chỉ được thu hồi nếu chưa xem VÀ chưa tải
    if (
      (recipient.first_viewed_at as string | null) ||
      (recipient.first_downloaded_at as string | null)
    ) {
      return NextResponse.json(
        {
          error:
            "Không thể thu hồi: người dùng đã xem hoặc đã tải tài liệu này rồi.",
        },
        { status: 409 },
      )
    }

    // Xóa recipient row
    const { error: deleteErr } = await supabaseAdmin
      .from("iso_distribution_recipients")
      .delete()
      .eq("id", recipientId)

    if (deleteErr) {
      return NextResponse.json({ error: deleteErr.message }, { status: 500 })
    }

    // Xóa in-app notification tương ứng (best-effort)
    await supabaseAdmin
      .from("notifications")
      .delete()
      .eq("user_id", recipient.recipient_user_id as string)
      .eq("type", "phan_phoi")
      .eq("factory_id", recipient.factory_id as string)

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi server" },
      { status: 500 },
    )
  }
}
