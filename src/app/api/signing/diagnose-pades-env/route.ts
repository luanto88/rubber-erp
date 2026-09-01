import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"
import { diagnosePadesEnv } from "@/lib/signing/pades"

export const dynamic = "force-dynamic"

// Chẩn đoán CẤU TRÚC 2 biến môi trường root CA (SIGN_PADES_ROOT_CA_CERT_PEM/_KEY_PEM) trên
// đúng môi trường đang chạy (dùng để kiểm tra ngay trên production sau khi sửa Vercel env vars,
// không cần ký thử 1 tài liệu thật mới biết đúng/sai — bug đã báo 2026-09-01, redeploy nhiều
// lần vẫn không biết biến nào còn sai định dạng). CHỈ trả metadata (độ dài, có bắt đầu bằng
// "-----BEGIN" không, parse được không, thông báo lỗi nếu có) — KHÔNG bao giờ trả nội dung
// khoá/chứng thư thật. Chỉ admin mới gọi được (mirror /api/signing/cancel-request).
export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", authUser.id)
      .single()
    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Chỉ admin mới xem được chẩn đoán này" }, { status: 403 })
    }
    return NextResponse.json(diagnosePadesEnv())
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: 400 })
  }
}
