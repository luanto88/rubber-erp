import { NextRequest, NextResponse } from "next/server"
import { normalizeUsername } from "@/lib/auth"
import { maskEmail, resolveOtpRecipient, supabaseAdmin } from "../../_lib/security"
import { assertNotPubliclyRateLimited, getClientIp } from "../_shared"

// Bước 1 của luồng Quên mật khẩu 2 bước — route CÔNG KHAI (không có phiên đăng nhập), không
// dùng requireAuthUser(). Khác hẳn thiết kế "generic response" cũ: route này CỐ Ý tiết lộ tài
// khoản có tồn tại hay không + gợi ý email che bớt ký tự — quyết định đã chốt với người dùng để
// đổi lấy trải nghiệm rõ ràng hơn (xem Context trong plan). Rate-limit riêng, độc lập với Bước 2
// (request/route.ts), để "dò username" và "dò email" là 2 ngân sách thử riêng.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const rawUsername = typeof body.username === "string" ? body.username : ""
    const normalizedUsername = normalizeUsername(rawUsername)

    if (!normalizedUsername) {
      return NextResponse.json(
        { error: "Vui lòng nhập Tên đăng nhập", code: "MISSING_FIELDS" },
        { status: 400 },
      )
    }

    const ip = getClientIp(req)

    try {
      await assertNotPubliclyRateLimited(`forgot_password_check:username:${normalizedUsername}`)
      if (ip) await assertNotPubliclyRateLimited(`forgot_password_check:ip:${ip}`)
    } catch (rateErr) {
      return NextResponse.json(
        {
          error: rateErr instanceof Error ? rateErr.message : "Yêu cầu quá nhanh, vui lòng thử lại sau.",
          code: "RATE_LIMITED",
        },
        { status: 429 },
      )
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, factory_id, full_name, status")
      .eq("username", normalizedUsername)
      .maybeSingle()

    if (profileError || !profile || profile.status !== "active" || !profile.factory_id) {
      return NextResponse.json(
        { found: false, code: "NOT_FOUND", error: "Không tìm thấy tài khoản này hoặc tài khoản không còn hoạt động." },
        { status: 404 },
      )
    }

    let realEmail = ""
    try {
      realEmail = (
        await resolveOtpRecipient(profile.id, profile.factory_id, profile.full_name)
      )
        .trim()
        .toLowerCase()
    } catch {
      return NextResponse.json(
        {
          found: true,
          hasEmail: false,
          code: "NO_EMAIL_CONFIGURED",
          error: "Tài khoản này chưa cấu hình email cá nhân. Vui lòng liên hệ quản trị viên.",
        },
        { status: 200 },
      )
    }

    return NextResponse.json({
      found: true,
      hasEmail: true,
      code: "OK",
      maskedEmail: maskEmail(realEmail),
    })
  } catch {
    return NextResponse.json({ error: "Lỗi máy chủ", code: "SERVER_ERROR" }, { status: 500 })
  }
}
