import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"
import { getLatestSignTemplate, saveSignTemplate, type SignTemplateBox } from "@/lib/signing/templates"

export const dynamic = "force-dynamic"

// GET  ?factoryId=&loaiTaiLieu=  → trả mẫu vị trí mới nhất (hoặc null nếu chưa có)
// POST { factoryId, loaiTaiLieu, khung } → tạo phiên bản mới (không bao giờ ghi đè)
//
// Chỉ đọc/ghi bảng `mau_vi_tri` — KHÔNG đụng `yeu_cau_ky`/`truong_ky`/route ký
// thật nào. RLS của `mau_vi_tri` chỉ có SELECT nên mọi INSERT bắt buộc qua route
// service-role này (đúng thiết kế ghi trong migration `20260902_signing_core_tables.sql`).

async function loadCallerProfile(userId: string) {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("factory_id, role")
    .eq("id", userId)
    .single()
  return data as { factory_id: string | null; role: string | null } | null
}

// Mirror đúng logic 2 bước (explicit user_permissions.granted=true, rồi
// role_permissions.role) đã dùng ở dept-users/route.ts — KHÔNG được quên
// `.eq("granted", true)` (bug đã từng xảy ra ở approvers/route.ts, xem
// .claude/rules/22-documents-module.md).
async function hasDocumentsCreatePermission(userId: string, role: string | null): Promise<boolean> {
  const { data: explicit } = await supabaseAdmin
    .from("user_permissions")
    .select("granted")
    .eq("user_id", userId)
    .eq("permission_code", "documents.create")
    .maybeSingle()
  if (explicit) return explicit.granted === true
  if (!role) return false
  const { data: roleGrant } = await supabaseAdmin
    .from("role_permissions")
    .select("role")
    .eq("role", role)
    .eq("permission_code", "documents.create")
    .maybeSingle()
  return !!roleGrant
}

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const factoryId = req.nextUrl.searchParams.get("factoryId")
    const loaiTaiLieu = req.nextUrl.searchParams.get("loaiTaiLieu")
    if (!factoryId || !loaiTaiLieu) {
      return NextResponse.json({ error: "Thiếu factoryId hoặc loaiTaiLieu" }, { status: 400 })
    }
    const profile = await loadCallerProfile(authUser.id)
    if (!profile || profile.factory_id !== factoryId) {
      return NextResponse.json({ error: "Không có quyền xem nhà máy này" }, { status: 403 })
    }
    const template = await getLatestSignTemplate(factoryId, loaiTaiLieu)
    return NextResponse.json({ template })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: 400 })
  }
}

type SaveBody = {
  factoryId: string
  loaiTaiLieu: string
  khung: SignTemplateBox[]
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const body = (await req.json()) as SaveBody
    if (!body.factoryId || !body.loaiTaiLieu || !Array.isArray(body.khung)) {
      return NextResponse.json({ error: "Thiếu tham số" }, { status: 400 })
    }
    const profile = await loadCallerProfile(authUser.id)
    if (!profile || profile.factory_id !== body.factoryId) {
      return NextResponse.json({ error: "Không có quyền lưu mẫu cho nhà máy này" }, { status: 403 })
    }
    if (profile.role !== "admin") {
      const allowed = await hasDocumentsCreatePermission(authUser.id, profile.role)
      if (!allowed) {
        return NextResponse.json({ error: "Bạn không có quyền lưu mẫu vị trí ký" }, { status: 403 })
      }
    }
    const template = await saveSignTemplate({
      factoryId: body.factoryId,
      loaiTaiLieu: body.loaiTaiLieu,
      khung: body.khung,
      taoBoi: authUser.id,
    })
    return NextResponse.json({ template })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: 400 })
  }
}
