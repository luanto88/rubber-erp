import { forceRefreshAuthSession, getFreshAuthSession } from "@/lib/auth"

// Gọi các route `/api/<module>/signing-status` an toàn cho cột "Ký duyệt" ở danh sách.
//
// Bug báo 2026-09-26: cột "Ký duyệt" lúc hiện lúc không, nút PDF lúc mở bản đã ký lúc render bản
// chưa ký. Nguyên nhân phía client: lấy token bằng `supabase.auth.getSession()` (có thể đã hết
// hạn) và KHÔNG kiểm tra `res.ok` — response lỗi `{error}` bị coi như danh sách rỗng, ghi đè map
// trạng thái đúng. Hàm này: token luôn còn hạn, gặp 401 tự làm mới 1 lần, lỗi thì NÉM để nơi gọi
// GIỮ NGUYÊN dữ liệu cũ thay vì xoá trắng.

export class SigningStatusFetchError extends Error {}

export async function fetchSigningStatusList<T>(url: string, body: Record<string, unknown>): Promise<T[]> {
  const call = async (token: string) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })

  const session = await getFreshAuthSession()
  if (!session?.access_token) throw new SigningStatusFetchError("Phiên đăng nhập chưa sẵn sàng")

  let res = await call(session.access_token)
  if (res.status === 401) {
    const refreshed = await forceRefreshAuthSession()
    if (!refreshed?.access_token) throw new SigningStatusFetchError("Phiên đăng nhập đã hết hạn")
    res = await call(refreshed.access_token)
  }

  const json = (await res.json().catch(() => null)) as unknown
  if (!res.ok || !Array.isArray(json)) {
    const msg = (json as { error?: string } | null)?.error || `HTTP ${res.status}`
    throw new SigningStatusFetchError(msg)
  }
  return json as T[]
}
