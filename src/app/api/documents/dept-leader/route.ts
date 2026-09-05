import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"

export const dynamic = "force-dynamic"

// Từ khóa xác định "lãnh đạo" từ chuc_vu / chuc_vu_chinh_quyen trong maintenance_staff.
// "phó giám đốc" đã được bao phủ bởi substring "giám đốc" — không cần pattern riêng.
const LEADER_KEYWORDS = ["trưởng phòng", "phó phòng", "giám đốc"]

type ProfileRow = {
  id: string
  full_name: string | null
  username: string | null
  role: string | null
  department: string | null
  department_id: string | null
}

type StaffRow = {
  profile_id: string | null
  chuc_vu: string | null
  chuc_vu_chinh_quyen: string | null
}

function matchesLeaderKeyword(text: string | null): boolean {
  if (!text) return false
  const lower = text.toLowerCase()
  return LEADER_KEYWORDS.some((kw) => lower.includes(kw))
}

// GET ?factoryId=xxx&dept=KTNN&permission=documents.phe_duyet
// Trả về danh sách người đủ điều kiện làm "lãnh đạo phòng ban" cho vòng ký Nội bộ đơn vị:
// - thuộc phòng ban đã chọn (theo profiles.department_id / department)
// - có chuc_vu hoặc chuc_vu_chinh_quyen trong maintenance_staff (liên kết qua profile_id) chứa
//   từ khóa lãnh đạo (Trưởng/phó phòng, Giám đốc/phó giám đốc)
// - được cấp đúng quyền `permission` (explicit user_permissions hoặc role_permissions)
//
// `permission` optional, mặc định "documents.phe_duyet" — giữ nguyên hành vi gốc cho 2 nơi gọi
// hiện có (documents/new/page.tsx, documents/new/upload/page.tsx). Route này giờ dùng CHUNG cho
// nhiều module cần "tự nhận diện lãnh đạo 1 phòng ban cụ thể" (vd Kiểm nghiệm gọi với
// dept=QLCL&permission=quality.phe_duyet) — dù đường dẫn còn giữ tiền tố /documents/ vì đó là
// nơi tính năng này ra đời đầu tiên, không đổi để tránh rủi ro không cần thiết cho 2 trang Văn
// bản đang chạy ổn định.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const factoryId = searchParams.get("factoryId")
  const dept = searchParams.get("dept")
  const permissionCode = searchParams.get("permission") || "documents.phe_duyet"

  if (!factoryId) {
    return NextResponse.json({ error: "Thiếu factoryId" }, { status: 400 })
  }
  if (!dept) {
    return NextResponse.json({ error: "Thiếu dept" }, { status: 400 })
  }

  const { data: profiles, error } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, username, role, department, department_id")
    .eq("factory_id", factoryId)
    .eq("status", "active")

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let rows = (profiles || []) as ProfileRow[]

  // Lọc theo phòng ban (3-way match giống dept-users/route.ts)
  const deptTrim = dept.trim()
  const deptUpper = deptTrim.toUpperCase()
  const { data: deptRow } = await supabaseAdmin
    .from("departments")
    .select("id, name, code")
    .or(`code.ilike.${deptUpper},name.ilike.${deptTrim}`)
    .maybeSingle()

  rows = rows.filter((p) => {
    if (deptRow?.id && p.department_id === deptRow.id) return true
    if (deptRow?.name && p.department?.trim().toLowerCase() === deptRow.name.toLowerCase()) return true
    if (deptRow?.code && p.department?.trim().toUpperCase() === deptRow.code.toUpperCase()) return true
    if (p.department?.trim().toUpperCase() === deptUpper) return true
    if (p.department?.trim().toLowerCase() === deptTrim.toLowerCase()) return true
    return false
  })

  if (rows.length === 0) {
    return NextResponse.json([])
  }

  const profileIds = rows.map((p) => p.id)

  // Đọc chuc_vu / chuc_vu_chinh_quyen qua liên kết maintenance_staff.profile_id
  const { data: staffRows } = await supabaseAdmin
    .from("maintenance_staff")
    .select("profile_id, chuc_vu, chuc_vu_chinh_quyen")
    .eq("factory_id", factoryId)
    .eq("active", true)
    .in("profile_id", profileIds)

  const staffByProfileId = new Map<string, StaffRow>()
  for (const s of (staffRows || []) as StaffRow[]) {
    if (s.profile_id) staffByProfileId.set(s.profile_id, s)
  }

  // Lọc còn lại: profile có staff row khớp từ khóa lãnh đạo
  const leaderRows = rows
    .map((p) => {
      const staff = staffByProfileId.get(p.id)
      if (!staff) return null
      const chucVuChinhQuyenMatch = matchesLeaderKeyword(staff.chuc_vu_chinh_quyen)
      const chucVuMatch = matchesLeaderKeyword(staff.chuc_vu)
      if (!chucVuChinhQuyenMatch && !chucVuMatch) return null
      const chuc_vu = chucVuChinhQuyenMatch ? staff.chuc_vu_chinh_quyen! : staff.chuc_vu!
      return { profile: p, chuc_vu }
    })
    .filter((x): x is { profile: ProfileRow; chuc_vu: string } => x !== null)

  if (leaderRows.length === 0) {
    return NextResponse.json([])
  }

  // Lọc tiếp: chỉ giữ người có quyền `permissionCode` (explicit hoặc theo role)
  const { data: permRows } = await supabaseAdmin
    .from("user_permissions")
    .select("user_id")
    .eq("permission_code", permissionCode)
    .eq("granted", true)

  const explicitUserIds = new Set((permRows || []).map((r: { user_id: string }) => r.user_id))

  const { data: rolePermRows } = await supabaseAdmin
    .from("role_permissions")
    .select("role")
    .eq("permission_code", permissionCode)

  const rolesWithPerm = new Set((rolePermRows || []).map((r: { role: string }) => r.role))

  const result = leaderRows
    .filter(
      ({ profile }) =>
        explicitUserIds.has(profile.id) || (profile.role && rolesWithPerm.has(profile.role)),
    )
    .map(({ profile, chuc_vu }) => ({
      id: profile.id,
      full_name: profile.full_name || profile.username || "",
      username: profile.username || "",
      chuc_vu,
    }))

  return NextResponse.json(result)
}
