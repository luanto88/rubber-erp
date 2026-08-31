import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import {
  buildSuCoNhoSigningRoles, buildBaoDuongSigningRoles, buildBaoDuongXeSigningRoles,
  buildSuaChuaNhoXeSigningRoles,
  type MaintenanceSignBundle, type MaintenanceSignRoleId, type MaintenanceSigningRole,
} from "@/lib/maintenance-pdf"

export const dynamic = "force-dynamic"

// Resolve vai trò ký của MỘT trong 4 bundle Bảo trì (su_co_nho/bao_duong/bao_duong_xe/
// sua_chua_nho_xe — query param `type`, mặc định `su_co_nho` cho tương thích ngược) từ TÊN đã
// snapshot sẵn trên chính biên bản (không tự nhận diện qua chức vụ như Chất lượng/Điều xe — Bảo
// trì đã có sẵn dropdown chọn tay các vai trò này lúc soạn biên bản) sang tài khoản đăng nhập
// thật qua `maintenance_staff.profile_id`. Tên file/route giữ nguyên "su-co-nho-signers" dù giờ
// dùng chung cho cả 4 bundle — đổi tên route sẽ cần sửa thêm caller, không cần thiết.
//
// Riêng 2 vai trò lãnh đạo — "giam_doc" (Giám đốc) và "bgd_phu_trach" (BGĐ phụ trách = Phó
// giám đốc) — còn phải kiểm tra thêm quyền `maintenance.phe_duyet` (migration
// 20260909_maintenance_phe_duyet_permission.sql): trước đây chỉ dựa vào CHỨC VỤ đã chọn trên
// biên bản, không có lớp phân quyền nào xác nhận người đó thực sự được phép ký duyệt điện tử.
// Các vai trò còn lại ("nv_phu_trach", "to_co_dien", "tai_xe") KHÔNG cần quyền này — chỉ là
// người xác nhận nội dung kỹ thuật, không phải người phê duyệt cuối cùng.
//
// "to_co_dien" (Tổ trưởng cơ điện/cơ khí) và "tai_xe" (Tài xế) hiện KHÔNG có tài khoản đăng
// nhập — Nhân viên phụ trách ký thay (xem các hàm buildXxxSigningRoles trong
// maintenance-pdf.ts), nên 2 roleId này luôn resolve về CÙNG người/CÙNG tài khoản với
// "nv_phu_trach".

const ROLE_BUILDERS: Record<MaintenanceSignBundle, (input: {
  bo_phan: string; bgd_phu_trach: string | null; nv_phu_trach: string | null
  giam_doc: string | null; nguoi_thuc_hien: string[]
}) => MaintenanceSigningRole[]> = {
  su_co_nho: buildSuCoNhoSigningRoles,
  bao_duong: buildBaoDuongSigningRoles,
  bao_duong_xe: buildBaoDuongXeSigningRoles,
  sua_chua_nho_xe: buildSuaChuaNhoXeSigningRoles,
}

const APPROVAL_ROLE_IDS: MaintenanceSignRoleId[] = ["bgd_phu_trach", "giam_doc"]
const APPROVAL_PERMISSION_CODE = "maintenance.phe_duyet"

type ResolvedSigner = MaintenanceSigningRole & {
  userId: string | null
  fullName: string | null
  resolved: boolean
  reason: string | null
}

type MaintenanceStaffRow = { ten: string; profile_id: string | null }
type ProfileRow = { id: string; full_name: string | null; username: string | null; status: string; role: string | null }

export async function GET(req: NextRequest) {
  const factoryId = req.nextUrl.searchParams.get("factoryId")
  const recordId = req.nextUrl.searchParams.get("recordId")
  const bundleType = (req.nextUrl.searchParams.get("type") || "su_co_nho") as MaintenanceSignBundle
  if (!factoryId || !recordId) {
    return NextResponse.json({ error: "Thiếu factoryId hoặc recordId" }, { status: 400 })
  }
  const buildRoles = ROLE_BUILDERS[bundleType]
  if (!buildRoles) {
    return NextResponse.json({ error: `Loại chứng từ không hợp lệ: ${bundleType}` }, { status: 400 })
  }

  const { data: record, error: recordErr } = await supabaseAdmin
    .from("maintenance_records")
    .select("factory_id, bo_phan, bgd_phu_trach, nv_phu_trach, giam_doc, nguoi_thuc_hien")
    .eq("id", recordId)
    .single()
  if (recordErr || !record || record.factory_id !== factoryId) {
    return NextResponse.json({ error: "Không tìm thấy biên bản" }, { status: 404 })
  }

  const { data: staffRows } = await supabaseAdmin
    .from("maintenance_staff")
    .select("ten, profile_id")
    .eq("factory_id", factoryId)
    .eq("active", true)

  const profileIdByName = new Map<string, string>()
  for (const s of (staffRows || []) as MaintenanceStaffRow[]) {
    if (s.ten && s.profile_id) profileIdByName.set(s.ten, s.profile_id)
  }

  const roles = buildRoles({
    bo_phan: record.bo_phan,
    bgd_phu_trach: record.bgd_phu_trach,
    nv_phu_trach: record.nv_phu_trach,
    giam_doc: record.giam_doc,
    nguoi_thuc_hien: (record.nguoi_thuc_hien as string[] | null) || [],
  })

  const candidateUserIds = [...new Set(
    roles.map((r) => (r.name ? profileIdByName.get(r.name) : undefined)).filter((id): id is string => !!id),
  )]
  const profilesById = new Map<string, ProfileRow>()
  if (candidateUserIds.length) {
    const { data: profileRows } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, username, status, role")
      .in("id", candidateUserIds)
    for (const p of (profileRows || []) as ProfileRow[]) profilesById.set(p.id, p)
  }

  // Quyền phê duyệt điện tử — chỉ cần fetch khi thực sự có candidate cho 2 vai trò lãnh đạo.
  const explicitApprovalUserIds = new Set<string>()
  const rolesWithApprovalPerm = new Set<string>()
  if (candidateUserIds.length) {
    const [{ data: permRows }, { data: rolePermRows }] = await Promise.all([
      supabaseAdmin.from("user_permissions").select("user_id")
        .eq("permission_code", APPROVAL_PERMISSION_CODE).eq("granted", true),
      supabaseAdmin.from("role_permissions").select("role").eq("permission_code", APPROVAL_PERMISSION_CODE),
    ])
    for (const r of (permRows || []) as { user_id: string }[]) explicitApprovalUserIds.add(r.user_id)
    for (const r of (rolePermRows || []) as { role: string }[]) rolesWithApprovalPerm.add(r.role)
  }
  const hasApprovalPermission = (userId: string): boolean => {
    const profile = profilesById.get(userId)
    if (profile?.role === "admin") return true
    if (explicitApprovalUserIds.has(userId)) return true
    return !!profile?.role && rolesWithApprovalPerm.has(profile.role)
  }

  const result: ResolvedSigner[] = roles.map((role) => {
    if (!role.name) {
      return { ...role, userId: null, fullName: null, resolved: false, reason: `Biên bản chưa gán ${role.roleLabel}` }
    }
    const userId = profileIdByName.get(role.name) || null
    if (!userId) {
      return {
        ...role, userId: null, fullName: null, resolved: false,
        reason: `${role.name} (${role.roleLabel}) chưa liên kết tài khoản đăng nhập — vào Cài đặt → Bảo trì → Nhân sự bảo trì để liên kết`,
      }
    }
    const profile = profilesById.get(userId)
    if (!profile || profile.status !== "active") {
      return {
        ...role, userId, fullName: profile?.full_name || profile?.username || role.name, resolved: false,
        reason: `Tài khoản của ${role.name} chưa được duyệt hoặc đã bị khóa`,
      }
    }
    const fullName = profile.full_name || profile.username || role.name
    if (APPROVAL_ROLE_IDS.includes(role.roleId) && !hasApprovalPermission(userId)) {
      return {
        ...role, userId, fullName, resolved: false,
        reason: `${role.name} chưa được cấp quyền phê duyệt điện tử (maintenance.phe_duyet) — vào Cài đặt → Phân quyền để cấp`,
      }
    }
    return { ...role, userId, fullName, resolved: true, reason: null }
  })

  return NextResponse.json({ signers: result })
}
