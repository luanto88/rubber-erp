import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"

export const dynamic = "force-dynamic"

// "Giám đốc nhà máy" là người ký duyệt cố định cho Phiếu điều xe ngày — đúng nhãn đã in
// sẵn trên PDF (xem renderEntrySignatures trong src/lib/dispatch-pdf.ts). Tự nhận diện
// qua maintenance_staff.chuc_vu / chuc_vu_chinh_quyen khớp CHÍNH XÁC "giám đốc" (không
// phải chuỗi con — mirror ý tưởng `giamDocStaff` ở .claude/rules/14-maintenance-module.md
// để tự loại "phó giám đốc"/"tổng giám đốc"), lọc thêm theo quyền dispatch.phe_duyet
// (explicit user_permissions hoặc role_permissions). Không dùng dept-leader/route.ts vì
// route đó bắt buộc phải có `dept` — Giám đốc nhà máy không thuộc riêng 1 phòng ban nào.
//
// Khác `giamDocStaff` gốc (đòi hỏi gõ đúng nguyên văn "Giám đốc", không hậu tố): dữ liệu
// thật ở đây dùng "Giám đốc nhà máy"/"Phó giám đốc nhà máy" (có hậu tố). Chuẩn hoá bằng
// cách bỏ đúng hậu tố " nhà máy" ở cuối trước khi so khớp — "Giám đốc" và "Giám đốc nhà
// máy" đều khớp; "Phó giám đốc nhà máy" sau khi bỏ hậu tố thành "phó giám đốc" nên vẫn bị
// loại đúng như mong đợi; "Tổng giám đốc" (không có hậu tố "nhà máy") không bị đụng tới,
// vẫn bị loại như cũ.

type ProfileRow = { id: string; full_name: string | null; username: string | null; role: string | null }
type StaffRow = { profile_id: string | null; chuc_vu: string | null; chuc_vu_chinh_quyen: string | null }

function normalizeChucVu(text: string | null): string {
  return String(text || "").trim().toLowerCase().replace(/\s+nhà\s+máy$/u, "").trim()
}

function matchesGiamDoc(text: string | null): boolean {
  return normalizeChucVu(text) === "giám đốc"
}

export async function GET(req: NextRequest) {
  const factoryId = req.nextUrl.searchParams.get("factoryId")
  if (!factoryId) {
    return NextResponse.json({ error: "Thiếu factoryId" }, { status: 400 })
  }

  const { data: profiles, error } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, username, role")
    .eq("factory_id", factoryId)
    .eq("status", "active")
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (profiles || []) as ProfileRow[]
  if (rows.length === 0) return NextResponse.json([])
  const profileIds = rows.map((p) => p.id)

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

  const giamDocRows = rows.filter((p) => {
    const staff = staffByProfileId.get(p.id)
    if (!staff) return false
    return matchesGiamDoc(staff.chuc_vu) || matchesGiamDoc(staff.chuc_vu_chinh_quyen)
  })
  if (giamDocRows.length === 0) return NextResponse.json([])

  const { data: permRows } = await supabaseAdmin
    .from("user_permissions")
    .select("user_id")
    .eq("permission_code", "dispatch.phe_duyet")
    .eq("granted", true)
  const explicitUserIds = new Set((permRows || []).map((r: { user_id: string }) => r.user_id))

  const { data: rolePermRows } = await supabaseAdmin
    .from("role_permissions")
    .select("role")
    .eq("permission_code", "dispatch.phe_duyet")
  const rolesWithPerm = new Set((rolePermRows || []).map((r: { role: string }) => r.role))

  const result = giamDocRows
    .filter((p) => explicitUserIds.has(p.id) || (p.role && rolesWithPerm.has(p.role)))
    .map((p) => ({ id: p.id, full_name: p.full_name || p.username || "", username: p.username || "" }))

  return NextResponse.json(result)
}
