import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"
import { parseOutputReport } from "@/lib/output-parser"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)

    // Kiểm tra quyền: Admin hoặc có quyền output.tech_support / output.import
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("id, role, factory_id")
      .eq("id", authUser.id)
      .single()

    if (profileErr || !profile) {
      return NextResponse.json({ success: false, error: "Không tìm thấy hồ sơ người dùng" }, { status: 401 })
    }

    if (profile.role !== "admin") {
      const { data: userPerms } = await supabaseAdmin
        .from("user_permissions")
        .select("permission_code, granted")
        .eq("user_id", authUser.id)

      let hasPerm = false
      if (userPerms && userPerms.length > 0) {
        hasPerm = userPerms.some(
          (p: { permission_code: string; granted: boolean }) =>
            (p.permission_code === "output.tech_support" || p.permission_code === "output.import") &&
            p.granted === true,
        )
      } else {
        const { data: rolePerms } = await supabaseAdmin
          .from("role_permissions")
          .select("permission_code")
          .eq("role", profile.role)

        hasPerm = (rolePerms || []).some(
          (p: { permission_code: string }) =>
            p.permission_code === "output.tech_support" || p.permission_code === "output.import",
        )
      }

      if (!hasPerm) {
        return NextResponse.json(
          { success: false, error: "Bạn không có quyền thực hiện chức năng hỗ trợ kỹ thuật sản lượng" },
          { status: 403 },
        )
      }
    }

    // Đọc file từ multipart/form-data hoặc JSON base64
    const contentType = req.headers.get("content-type") || ""
    let fileBuffer: Buffer
    let filename = "BaoCaoSanLuong.xlsx"

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData()
      const file = formData.get("file") as File | null
      if (!file) {
        return NextResponse.json({ success: false, error: "Chưa chọn file báo cáo sản lượng" }, { status: 400 })
      }
      filename = file.name || "BaoCaoSanLuong.xlsx"
      const arrayBuf = await file.arrayBuffer()
      fileBuffer = Buffer.from(arrayBuf)
    } else {
      const body = await req.json()
      if (!body.file_base64) {
        return NextResponse.json({ success: false, error: "Thiếu dữ liệu file (file_base64)" }, { status: 400 })
      }
      fileBuffer = Buffer.from(body.file_base64, "base64")
      if (body.filename) filename = String(body.filename)
    }

    const report = await parseOutputReport(fileBuffer, filename)
    return NextResponse.json(report)
  } catch (error) {
    console.error("Lỗi parse báo cáo sản lượng:", error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Đã xảy ra lỗi trong quá trình bóc tách báo cáo",
      },
      { status: 500 },
    )
  }
}
