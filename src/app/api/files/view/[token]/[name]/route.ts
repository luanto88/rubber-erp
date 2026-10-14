import { NextRequest, NextResponse } from "next/server"
import { verifyFileViewToken } from "@/lib/file-view-token"
import { mintSignedUrlForPath } from "@/lib/secure-file-url"

export const dynamic = "force-dynamic"

// GET — xem file inline với ĐÚNG tên (xem src/lib/file-view-token.ts). Không cần đăng nhập: chỉ
// tin token ngắn hạn do route đã xác thực mint ra. Đoạn `[name]` trên URL chỉ để trình xem có tên
// dự phòng — tên thật lấy từ token.
//
// File > 4MB: chuyển hướng về Signed URL (vẫn xem được, nhưng tên là tên object) — tránh giới hạn
// ~4,5MB response của Vercel (người dùng đã chốt 2026-10-14).

const MAX_STREAM_BYTES = 4 * 1024 * 1024

function expiredPage(message: string, status: number) {
  return new NextResponse(
    `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Không mở được file</title></head>` +
      `<body style="font-family:system-ui,sans-serif;padding:32px;color:#334155"><h2 style="margin:0 0 8px">Không mở được file</h2><p>${message}</p></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  )
}

function asciiFallback(name: string) {
  const ascii = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D")
  return ascii.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_")
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string; name: string }> }) {
  const { token } = await params
  const claims = await verifyFileViewToken(token)
  if (!claims) {
    return expiredPage("Liên kết đã hết hạn hoặc không hợp lệ. Hãy mở lại file từ ứng dụng.", 401)
  }

  const signedUrl = await mintSignedUrlForPath(claims.path, { bucket: claims.bucket })
  if (!signedUrl) return expiredPage("File không còn tồn tại trong kho lưu trữ.", 404)

  let upstream: Response
  try {
    upstream = await fetch(signedUrl, { cache: "no-store" })
  } catch {
    return NextResponse.redirect(signedUrl, 302)
  }
  if (!upstream.ok || !upstream.body) {
    return expiredPage("Không tải được file từ kho lưu trữ.", 502)
  }
  const length = Number(upstream.headers.get("content-length") || "")
  if (!Number.isFinite(length) || length <= 0 || length > MAX_STREAM_BYTES) {
    void upstream.body.cancel().catch(() => {})
    return NextResponse.redirect(signedUrl, 302)
  }

  const name = claims.fileName
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "application/pdf",
      "Content-Length": String(length),
      "Content-Disposition": `inline; filename="${asciiFallback(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
