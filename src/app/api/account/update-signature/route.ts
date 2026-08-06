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

    await verifySensitiveActionToken(actionToken, userId, "change_signature")

    const profile = await getProfileAuthRow(userId)
    if (!profile.factory_id) {
      return NextResponse.json({ error: "Tài khoản chưa gắn nhà máy" }, { status: 400 })
    }

    const sigPath = `signatures/${profile.factory_id}/${userId}/chu_ky.png`
    const arrayBuffer = await file.arrayBuffer()

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
