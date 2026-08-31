import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"
import { createSigningRequest, type SigningSignerInput } from "@/lib/signing/requests"

export const dynamic = "force-dynamic"

type Body = {
  factoryId: string
  modun: string
  loaiTaiLieu: string
  banGhiId?: string | null
  maHoSo?: string | null
  fileBase64: string
  fileExt: string
  signers: SigningSignerInput[]
  hanXuLy?: string | null
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const body = (await req.json()) as Body

    if (!body.factoryId || !body.modun || !body.loaiTaiLieu || !body.fileBase64 || !body.fileExt) {
      return NextResponse.json({ error: "Thiếu tham số" }, { status: 400 })
    }
    if (!Array.isArray(body.signers) || body.signers.length === 0) {
      return NextResponse.json({ error: "Cần ít nhất 1 người ký" }, { status: 400 })
    }

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("factory_id")
      .eq("id", authUser.id)
      .single()
    if (profileErr || !profile || profile.factory_id !== body.factoryId) {
      return NextResponse.json({ error: "Không có quyền tạo yêu cầu ký cho nhà máy này" }, { status: 403 })
    }

    const fileBytes = Buffer.from(body.fileBase64, "base64")
    if (!fileBytes.length) {
      return NextResponse.json({ error: "File rỗng" }, { status: 400 })
    }

    const { yeuCauId } = await createSigningRequest({
      factoryId: body.factoryId,
      modun: body.modun,
      loaiTaiLieu: body.loaiTaiLieu,
      banGhiId: body.banGhiId ?? null,
      maHoSo: body.maHoSo ?? null,
      nguoiTaoId: authUser.id,
      fileBytes,
      fileExt: body.fileExt,
      signers: body.signers,
      hanXuLy: body.hanXuLy ?? null,
    })

    return NextResponse.json({ yeuCauId })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: 400 })
  }
}
