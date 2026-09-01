import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"
import { closeActiveSigningRequestForKey } from "@/lib/signing/requests"

export const dynamic = "force-dynamic"

// Tự động đóng (nếu có) yêu cầu ký đang hoạt động cho 1 khóa nghiệp vụ — dùng ngay sau khi xóa
// dữ liệu nguồn (vd xóa hết phiếu kiểm nghiệm của 1 ngày) để lần "Gửi ký duyệt" tiếp theo tạo
// được yêu cầu MỚI, không kẹt ở unique index. Tự truy vấn lại DB theo khóa nghiệp vụ (không
// nhận yeuCauId từ client) — xem chi tiết lý do ở closeActiveSigningRequestForKey().
export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const { factoryId, modun, loaiTaiLieu, maHoSo } = (await req.json()) as {
      factoryId?: string
      modun?: string
      loaiTaiLieu?: string
      maHoSo?: string
    }
    if (!factoryId || !modun || !loaiTaiLieu || !maHoSo) {
      return NextResponse.json({ error: "Thiếu factoryId/modun/loaiTaiLieu/maHoSo" }, { status: 400 })
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role, factory_id")
      .eq("id", authUser.id)
      .single()
    if (!profile || profile.factory_id !== factoryId) {
      return NextResponse.json({ error: "Không có quyền thao tác trên nhà máy này" }, { status: 403 })
    }
    const isAdmin = profile.role === "admin"

    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || ""
    const thietBi = req.headers.get("user-agent") || ""

    const result = await closeActiveSigningRequestForKey({
      factoryId, modun, loaiTaiLieu, maHoSo, userId: authUser.id, isAdmin, ip, thietBi,
    })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: 400 })
  }
}
