import { getFreshAuthSession } from "@/lib/auth"

/**
 * `fetch` kèm header `Authorization: Bearer <access_token>` của phiên hiện tại — dùng cho mọi
 * route API server-side xác thực bằng `requireAuthUser()`. Chỉ chạy ở trình duyệt.
 *
 * Không có phiên → vẫn gửi request không kèm token để server trả 401 rõ ràng (thay vì ném lỗi
 * ở client làm caller phải tự xử lý thêm một nhánh).
 */
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const session = await getFreshAuthSession()
  const headers = new Headers(init.headers)
  if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`)
  return fetch(input, { ...init, headers })
}
