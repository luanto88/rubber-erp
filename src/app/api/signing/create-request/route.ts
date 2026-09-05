import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"
import { createSigningRequest, type SigningSignerInput } from "@/lib/signing/requests"
import { scheduleSigningNotify } from "@/lib/signing/notify"

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
      .select("factory_id, role")
      .eq("id", authUser.id)
      .single()
    if (profileErr || !profile || profile.factory_id !== body.factoryId) {
      return NextResponse.json({ error: "Không có quyền tạo yêu cầu ký cho nhà máy này" }, { status: 403 })
    }
    const isAdmin = profile.role === "admin"

    // Kiểm tra sở hữu bản ghi nghiệp vụ — trước đây chỉ check factory_id ở trên,
    // bất kỳ ai cùng nhà máy cũng tạo được yêu cầu ký cho bản ghi của người khác.
    if (!isAdmin) {
      if (body.modun === "dispatch") {
        if (!body.banGhiId) {
          return NextResponse.json({ error: "Thiếu bản ghi phiếu điều xe" }, { status: 403 })
        }
        const { data: entry } = await supabaseAdmin
          .from("dispatch_entries")
          .select("created_by")
          .eq("id", body.banGhiId)
          .eq("factory_id", body.factoryId)
          .maybeSingle()
        if (!entry || entry.created_by !== authUser.id) {
          return NextResponse.json({ error: "Bạn không có quyền gửi ký duyệt phiếu điều xe này" }, { status: 403 })
        }
      } else if (body.modun === "quality") {
        if (!body.maHoSo) {
          return NextResponse.json({ error: "Thiếu ngày kiểm nghiệm" }, { status: 403 })
        }
        const { data: rows } = await supabaseAdmin
          .from("qc_results")
          .select("id")
          .eq("factory_id", body.factoryId)
          .eq("ngay_kn", body.maHoSo)
          .eq("created_by", authUser.id)
          .limit(1)
        if (!rows || rows.length === 0) {
          return NextResponse.json({ error: "Bạn không có quyền gửi ký duyệt phiếu kiểm nghiệm ngày này" }, { status: 403 })
        }
      } else if (body.modun === "maintenance") {
        if (!body.banGhiId) {
          return NextResponse.json({ error: "Thiếu bản ghi biên bản bảo trì" }, { status: 403 })
        }
        const { data: rec } = await supabaseAdmin
          .from("maintenance_records")
          .select("created_by")
          .eq("id", body.banGhiId)
          .eq("factory_id", body.factoryId)
          .maybeSingle()
        if (!rec || rec.created_by !== authUser.id) {
          return NextResponse.json({ error: "Bạn không có quyền gửi ký duyệt biên bản này" }, { status: 403 })
        }
      } else {
        return NextResponse.json({ error: "Module không được hỗ trợ để tạo yêu cầu ký" }, { status: 400 })
      }
    }

    const fileBytes = Buffer.from(body.fileBase64, "base64")
    if (!fileBytes.length) {
      return NextResponse.json({ error: "File rỗng" }, { status: 400 })
    }

    const { yeuCauId, notifyPlan } = await createSigningRequest({
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

    // Báo cho người ký đầu tiên SAU khi response đã trả về (Telegram + SMTP mất 1-3s).
    scheduleSigningNotify(notifyPlan)

    return NextResponse.json({ yeuCauId })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: 400 })
  }
}
