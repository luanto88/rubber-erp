// SERVER-ONLY (service role) — không import từ component client.
import { createHash } from "node:crypto"
import { getSupabaseAdmin } from "@/lib/supabase-admin"

// Giới hạn lượt truy cập trang CÔNG KHAI (không đăng nhập) — đếm theo cửa sổ 1 phút trong bảng
// `public_rate_limits` (migration 20261111). Mục đích chống spam, KHÔNG phải chống dò mã (token QR
// 128 bit nên dò là bất khả thi) ⇒ giới hạn vừa phải.
//
// IP lưu dạng băm (SHA-256 + khoá bí mật) — không lưu IP thô.

type HeaderReader = { get(name: string): string | null }

/** IP người gọi theo header Vercel: `x-real-ip`, rồi phần tử ĐẦU của `x-forwarded-for`. */
export function clientIpFromHeaders(headers: HeaderReader): string {
  const real = headers.get("x-real-ip")?.trim()
  if (real) return real
  const fwd = headers.get("x-forwarded-for")
  const first = fwd?.split(",")[0]?.trim()
  return first || "unknown"
}

function hashKey(scope: string, ip: string) {
  const salt = process.env.RATE_LIMIT_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || ""
  return createHash("sha256").update(`${scope}|${ip}|${salt}`).digest("hex")
}

/**
 * Cộng 1 lượt cho (scope, IP). Trả `false` khi vượt `limitPerMinute`.
 * Lỗi DB (vd migration chưa chạy) ⇒ CHO QUA (ưu tiên trang vẫn mở được) và ghi log.
 */
export async function checkPublicRateLimit(
  scope: string,
  headers: HeaderReader,
  limitPerMinute = 60,
): Promise<boolean> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc("public_rate_limit_hit", {
      p_key_hash: hashKey(scope, clientIpFromHeaders(headers)),
    })
    if (error) {
      console.warn("[public-rate-limit]", error.message)
      return true
    }
    return Number(data ?? 0) <= limitPerMinute
  } catch (err) {
    console.warn("[public-rate-limit]", err instanceof Error ? err.message : err)
    return true
  }
}
