import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"

export const dynamic = "force-dynamic"

// RLS của `profiles` chỉ cho đọc đúng dòng của chính mình (mirror lý do đã ghi ở
// dept-users/share-candidates/documents-approvers) — SignScreen cần tên của MỌI
// người ký cùng hồ sơ (không chỉ chính mình) để hiển thị panel "Luồng ký hồ sơ",
// nên phải đi qua route service-role này, có xác thực người gọi thật sự liên quan
// tới đúng yeu_cau_id trước khi trả tên.

type ProfileRow = { id: string; full_name: string | null; username: string | null }

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const yeuCauId = req.nextUrl.searchParams.get("yeuCauId")
    if (!yeuCauId) return NextResponse.json({ error: "Thiếu yeuCauId" }, { status: 400 })

    const { data: yeuCau } = await supabaseAdmin
      .from("yeu_cau_ky")
      .select("id, nguoi_tao")
      .eq("id", yeuCauId)
      .single()
    if (!yeuCau) return NextResponse.json({ error: "Không tìm thấy hồ sơ" }, { status: 404 })

    const { data: signerRows } = await supabaseAdmin
      .from("nguoi_ky")
      .select("user_id")
      .eq("yeu_cau_id", yeuCauId)
    const signerIds = (signerRows || []).map((r: { user_id: string }) => r.user_id)

    const { data: callerProfile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", authUser.id)
      .single()
    const isAdmin = callerProfile?.role === "admin"
    const isOwner = yeuCau.nguoi_tao === authUser.id
    const isParticipant = signerIds.includes(authUser.id)
    if (!isAdmin && !isOwner && !isParticipant) {
      return NextResponse.json({ error: "Không có quyền xem hồ sơ này" }, { status: 403 })
    }

    if (!signerIds.length) return NextResponse.json([])
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, username")
      .in("id", signerIds)

    const result = (profiles || []).map((p: ProfileRow) => ({
      id: p.id,
      full_name: p.full_name || p.username || "",
    }))
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: 400 })
  }
}
