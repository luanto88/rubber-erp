import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"
import {
  EudrFileOpError,
  ensureExportViewPermission,
  loadOrderForFileOps,
  normalizeEudrFiles,
} from "@/app/api/eudr/_lib/eudr-file-permissions"

const EUDR_BUCKET = "eudr-files"

// Xóa (hoặc chuẩn bị thay bằng file mới) 1 tệp đính kèm EUDR. Trước đây thao tác này
// chỉ là 1 câu UPDATE export_orders.files trực tiếp từ client, không kiểm tra ai được
// xóa, và không xóa file thật khỏi Storage (rác tồn mãi trong bucket). Giờ:
//   - Admin luôn xóa được.
//   - Không phải admin: chỉ xóa được khi đơn CHƯA khóa (chưa phê duyệt, chưa cấp quyền
//     khách hàng) VÀ chính là người đã tải file đó lên (hoặc file cũ chưa từng ghi nhận
//     người tải lên — dữ liệu trước khi có tính năng này).
export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const body = (await req.json().catch(() => null)) as { orderId?: string; fileUrl?: string } | null

    const orderId = body?.orderId?.trim() || ""
    const fileUrl = body?.fileUrl?.trim() || ""

    if (!orderId || !fileUrl) {
      return NextResponse.json({ error: "Thieu thong tin file can xoa." }, { status: 400 })
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("factory_id, status, role")
      .eq("id", authUser.id)
      .single()

    if (profileError || !profile) {
      throw new Error(profileError?.message || "Khong tai duoc ho so nguoi dung.")
    }

    if (profile.status !== "active") {
      return NextResponse.json({ error: "Tai khoan khong con hoat dong." }, { status: 403 })
    }

    const role = (profile.role as string) || ""

    try {
      await ensureExportViewPermission(authUser.id, role)
    } catch (permError) {
      const message = permError instanceof Error ? permError.message : "Khong co quyen."
      return NextResponse.json({ error: message }, { status: 403 })
    }

    const { order, locked } = await loadOrderForFileOps(orderId, profile.factory_id)
    const files = normalizeEudrFiles(order.files)
    const target = files.find((f) => f.url === fileUrl)

    if (!target) {
      return NextResponse.json({ error: "Khong tim thay tep dinh kem nay." }, { status: 404 })
    }

    const isOwner = target.uploadedBy == null || target.uploadedBy === authUser.id
    const canManage = role === "admin" || (!locked && isOwner)

    if (!canManage) {
      const message = locked
        ? "Don hang da duoc phe duyet hoac da cap quyen cho khach hang — chi Admin duoc xoa tep dinh kem."
        : "Chi nguoi da tai file nay len (hoac Admin) moi duoc xoa."
      return NextResponse.json({ error: message }, { status: 403 })
    }

    if (target.path) {
      const { error: removeError } = await supabaseAdmin.storage.from(EUDR_BUCKET).remove([target.path])
      if (removeError) {
        console.error("EUDR remove-file: xoa storage that bai (van tiep tuc go khoi danh sach)", removeError)
      }
    }

    const nextFiles = files.filter((f) => f.url !== fileUrl)

    const { error: updateError } = await supabaseAdmin
      .from("export_orders")
      .update({ files: nextFiles })
      .eq("id", orderId)

    if (updateError) throw updateError

    return NextResponse.json({ files: nextFiles })
  } catch (error) {
    if (error instanceof EudrFileOpError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("EUDR remove-file failed", error)
    const message = error instanceof Error ? error.message : "Khong xoa duoc tep dinh kem."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
