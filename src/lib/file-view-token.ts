import { SignJWT, jwtVerify } from "jose"
import { safeDownloadFileName, extFromStorageUrl } from "@/lib/storage-download"

// Link XEM file (mở tab, trình xem PDF) mà vẫn giữ đúng TÊN FILE khi người dùng bấm Lưu.
//
// Vì sao cần: Signed URL của Supabase chỉ đặt được tên khi TẢI VỀ (`download=` → attachment).
// Khi xem inline, trình xem PDF lấy tên theo đoạn cuối đường dẫn object ("v4.pdf"). Vì vậy file
// phải đi qua route của app (`/api/files/view/<token>/<tên>`) để trả `Content-Disposition: inline`
// kèm tên có dấu.
//
// App không dùng cookie đăng nhập (phiên nằm ở localStorage) nên tab mới mở URL thẳng không mang
// được phiên ⇒ route xem tin 1 TOKEN NGẮN HẠN ký HMAC. Token chỉ được mint bởi các route đã xác
// thực Bearer + kiểm quyền (vd `api/maintenance/records/[id]/file-url?view=1`). Server-only.

const SECRET = new TextEncoder().encode(
  process.env.SIGN_JWT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "",
)

const DEFAULT_TTL_SECONDS = 120

export type FileViewClaims = { bucket: string; path: string; fileName: string }

export async function mintFileViewUrl({
  bucket,
  path,
  fileName,
  ttlSeconds = DEFAULT_TTL_SECONDS,
}: {
  bucket: string
  path: string
  fileName: string
  ttlSeconds?: number
}): Promise<string> {
  const name = safeDownloadFileName(fileName, extFromStorageUrl(path))
  const token = await new SignJWT({ b: bucket, p: path, n: name, k: "file_view" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(SECRET)
  return `/api/files/view/${token}/${encodeURIComponent(name)}`
}

/** Trả `null` khi token sai/hết hạn — không throw. */
export async function verifyFileViewToken(token: string): Promise<FileViewClaims | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET)
    if (payload.k !== "file_view") return null
    const { b, p, n } = payload as { b?: unknown; p?: unknown; n?: unknown }
    if (typeof b !== "string" || typeof p !== "string" || typeof n !== "string" || !b || !p) return null
    return { bucket: b, path: p, fileName: n || "file.pdf" }
  } catch {
    return null
  }
}
