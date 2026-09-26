import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"
import { isUuid, buildMaintenanceDocLabel, formatMaHoSoDisplay } from "@/lib/signing/labels"

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
      .select("id, nguoi_tao, factory_id, modun, loai_tai_lieu, ma_ho_so, ban_ghi_id")
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

    // Tự động phân giải và sửa dữ liệu lịch sử nếu ma_ho_so đang là UUID
    let resolvedMaHoSo: string | null = null
    const currentMa = yeuCau.ma_ho_so as string | null
    if (currentMa && isUuid(currentMa)) {
      const targetId = (yeuCau.ban_ghi_id as string | null) || currentMa
      if (yeuCau.modun === "maintenance" && targetId) {
        const { data: rec } = await supabaseAdmin
          .from("maintenance_records")
          .select("id, ma_bb, ngay, bo_phan, maintenance_record_lines(ma_tb)")
          .eq("id", targetId)
          .maybeSingle()
        if (rec) {
          const lines = (rec.maintenance_record_lines || []) as { ma_tb?: string | null }[]
          resolvedMaHoSo = buildMaintenanceDocLabel({
            ma_bb: rec.ma_bb,
            ngay: rec.ngay,
            bo_phan: rec.bo_phan,
            lines,
          })
        }
      } else if (yeuCau.modun === "dispatch" && targetId) {
        const { data: entry } = await supabaseAdmin
          .from("dispatch_entries")
          .select("id, ngay")
          .eq("id", targetId)
          .maybeSingle()
        if (entry?.ngay) {
          resolvedMaHoSo = formatMaHoSoDisplay(entry.ngay)
        }
      }

      if (resolvedMaHoSo && resolvedMaHoSo !== currentMa) {
        await supabaseAdmin
          .from("yeu_cau_ky")
          .update({
            ma_ho_so: resolvedMaHoSo,
            ban_ghi_id: targetId,
          })
          .eq("id", yeuCau.id)
      }
    }

    if (!signerIds.length) {
      return NextResponse.json({ profiles: [], maHoSo: resolvedMaHoSo || (isUuid(currentMa) ? null : currentMa) })
    }

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, username")
      .in("id", signerIds)

    const result = (profiles || []).map((p: ProfileRow) => ({
      id: p.id,
      full_name: p.full_name || p.username || "",
    }))
    return NextResponse.json({
      profiles: result,
      maHoSo: resolvedMaHoSo || (isUuid(currentMa) ? null : currentMa),
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: 400 })
  }
}

