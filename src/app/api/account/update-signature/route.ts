import { NextRequest, NextResponse } from "next/server"
import {
  accountErrorResponse,
  getProfileAuthRow,
  requireAuthUser,
  supabaseAdmin,
  verifySensitiveActionToken,
} from "../_lib/security"

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const formData = await req.formData()

    const userId = String(formData.get("userId") || "")
    const actionToken = String(formData.get("actionToken") || "")
    const file = formData.get("file")

    if (!userId || !actionToken || !(file instanceof File)) {
      return NextResponse.json({ error: "Thiếu tham số" }, { status: 400 })
    }

    if (authUser.id !== userId) {
      return NextResponse.json({ error: "Không có quyền thực hiện thao tác này" }, { status: 403 })
    }

    if (file.type !== "image/png") {
      return NextResponse.json({ error: "Vui lòng chọn file chữ ký định dạng PNG" }, { status: 400 })
    }

    // Audit bảo mật 2026-08-07, mục #5: `file.type` ở trên là Content-Type do TRÌNH DUYỆT tự khai
    // báo — giả mạo được (đổi tên file/dựng lại FormData thủ công). Kiểm tra thêm 8 byte đầu đúng
    // magic number PNG chuẩn để chắc chắn nội dung thật sự là ảnh PNG trước khi lưu vào bucket
    // công khai, không chỉ tin nhãn client tự khai.
    const arrayBuffer = await file.arrayBuffer()
    const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    const headerBytes = new Uint8Array(arrayBuffer.slice(0, PNG_MAGIC.length))
    const isRealPng = PNG_MAGIC.every((byte, i) => headerBytes[i] === byte)
    if (!isRealPng) {
      return NextResponse.json({ error: "File không phải ảnh PNG hợp lệ" }, { status: 400 })
    }

    await verifySensitiveActionToken(actionToken, userId, "change_signature")

    const profile = await getProfileAuthRow(userId)
    if (!profile.factory_id) {
      return NextResponse.json({ error: "Tài khoản chưa gắn nhà máy" }, { status: 400 })
    }

    const sigPath = `signatures/${profile.factory_id}/${userId}/chu_ky.png`

    const { error } = await supabaseAdmin.storage
      .from("iso-documents")
      .upload(sigPath, arrayBuffer, { contentType: "image/png", upsert: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const { data } = supabaseAdmin.storage.from("iso-documents").getPublicUrl(sigPath)
    return NextResponse.json({ ok: true, publicUrl: data.publicUrl })
  } catch (err) {
    return accountErrorResponse(err, "Lỗi máy chủ")
  }
}
