import { getFreshAuthSession } from "@/lib/auth"

// Helper client dùng chung để mở/tải file qua route "signed URL" mới (thay thế việc đọc thẳng
// cột file_*_url public rồi render <a href>) — xem src/lib/secure-file-url.ts và kế hoạch vá
// bucket iso-documents (2026-09-20). `<a href>` tĩnh không gắn được header Authorization, nên
// mọi nơi cần mở/tải file giờ phải fetch có Bearer TRƯỚC, nhận Signed URL rồi mới điều hướng —
// mirror đúng pattern `handleDownload` đã có sẵn ở iso/forms/[id]/page.tsx.

export type SecureFileOpenResult = { ok: true } | { ok: false; error: string }
export type SecureUrlResult = { ok: true; url: string } | { ok: false; error: string }

/**
 * Fetch route mint Signed URL (có Bearer), trả nguyên chuỗi URL — dùng khi cần gán vào `<img
 * src>`/`pdfjs.getDocument({url})` thay vì điều hướng ngay. TTL của URL do route quyết định
 * (thường 60–300 giây), đủ cho 1 lần render/xem, không nên cache lâu ở client.
 */
export async function fetchSecureUrl(endpoint: string): Promise<SecureUrlResult> {
  const session = await getFreshAuthSession()
  const token = session?.access_token
  if (!token) return { ok: false, error: "Phiên đăng nhập đã hết hạn, vui lòng tải lại trang." }

  try {
    const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } })
    const json = (await res.json()) as { url?: string; error?: string }
    if (!res.ok || !json.url) return { ok: false, error: json.error || "Không mở được file" }
    return { ok: true, url: json.url }
  } catch {
    return { ok: false, error: "Lỗi kết nối khi mở file" }
  }
}

/**
 * Mở/tải 1 file qua route mint Signed URL. `endpoint` là URL đầy đủ tới route đó (vd
 * `/api/iso/documents/{id}/file-url?variant=main`), có thể kèm `&download=1` để server trả kèm
 * `Content-Disposition: attachment` (trình duyệt tải về thay vì mở tab xem).
 */
export async function openSecureFile(endpoint: string): Promise<SecureFileOpenResult> {
  const result = await fetchSecureUrl(endpoint)
  if (!result.ok) return result
  window.open(result.url, "_blank", "noopener,noreferrer")
  return { ok: true }
}
