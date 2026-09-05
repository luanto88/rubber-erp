import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"
import { getSupabaseAdmin } from "@/lib/supabase-admin"

export const dynamic = "force-dynamic"

// GET ?factoryId=xxx&userIds=id1,id2,id3
//
// Tra tên/chức vụ thật + xác nhận CÓ ảnh chữ ký lưu sẵn hay không cho 1 danh sách user cụ
// thể — dùng cho màn "Cài đặt vị trí ký" (mau-vi-tri/page.tsx) khi mở kèm 1 văn bản thật, để
// hiện đúng người đã được chọn ở new/page.tsx (thu_tu_ky_json[].user_id / phe_duyet_user_id)
// thay vì placeholder giả. KHÔNG lọc theo từ khoá lãnh đạo như dept-leader/route.ts — ở đây
// người đã được chọn sẵn, chỉ cần hiển thị đúng thông tin của họ.
//
// Mirror cách dept-leader/route.ts tra `maintenance_staff.chuc_vu`/`chuc_vu_chinh_quyen` qua
// `profile_id` — KHÔNG tự nghĩ cách tra mới.

type ProfileRow = { id: string; full_name: string | null; username: string | null }
type StaffRow = { profile_id: string | null; chuc_vu: string | null; chuc_vu_chinh_quyen: string | null }

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const { searchParams } = req.nextUrl
    const factoryId = searchParams.get("factoryId")
    const userIdsParam = searchParams.get("userIds") || ""
    if (!factoryId) return NextResponse.json({ error: "Thiếu factoryId" }, { status: 400 })

    const { data: callerProfile } = await supabaseAdmin
      .from("profiles")
      .select("factory_id")
      .eq("id", authUser.id)
      .single()
    if (!callerProfile || callerProfile.factory_id !== factoryId) {
      return NextResponse.json({ error: "Không có quyền xem nhà máy này" }, { status: 403 })
    }

    const userIds = Array.from(new Set(userIdsParam.split(",").map((s) => s.trim()).filter(Boolean)))
    if (userIds.length === 0) return NextResponse.json([])

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, username")
      .eq("factory_id", factoryId)
      .in("id", userIds)
    const rows = (profiles || []) as ProfileRow[]
    if (rows.length === 0) return NextResponse.json([])

    const { data: staffRows } = await supabaseAdmin
      .from("maintenance_staff")
      .select("profile_id, chuc_vu, chuc_vu_chinh_quyen")
      .eq("factory_id", factoryId)
      .eq("active", true)
      .in("profile_id", userIds)
    const staffByProfileId = new Map<string, StaffRow>()
    for (const s of (staffRows || []) as StaffRow[]) {
      if (s.profile_id) staffByProfileId.set(s.profile_id, s)
    }

    const storage = getSupabaseAdmin().storage.from("iso-documents")
    const result = await Promise.all(
      rows.map(async (p) => {
        const staff = staffByProfileId.get(p.id)
        const chuc_vu = staff?.chuc_vu_chinh_quyen || staff?.chuc_vu || ""
        let has_signature = false
        try {
          const { data: listData } = await storage.list(`signatures/${factoryId}/${p.id}`, {
            search: "chu_ky.png",
          })
          has_signature = !!listData && listData.length > 0
        } catch {
          has_signature = false
        }
        return {
          id: p.id,
          full_name: p.full_name || p.username || "",
          chuc_vu,
          has_signature,
        }
      }),
    )

    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: 400 })
  }
}
