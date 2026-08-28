import { getSupabaseAdmin } from "@/lib/supabase-admin"

// Bucket dùng chung cho toàn bộ ảnh chữ ký cá nhân, bất kể module ký (ISO PDF,
// ISO Office, Văn bản, Thực hiện hồ sơ ISO) — xem `.claude/rules/16-iso-vanban-module.md`
// mục "Storage bucket iso-documents".
const SIGNATURE_BUCKET = "iso-documents"

/**
 * Tải ảnh chữ ký cá nhân (PNG) của 1 người dùng trong 1 nhà máy từ Storage.
 *
 * Hợp nhất từ 4 bản `getSigImage()` copy-paste giống hệt nhau ở
 * `api/sign/generate-pdf/route.ts`, `api/sign/generate-office/route.ts`,
 * `api/documents/sign/route.ts`, `api/iso/forms/[id]/finalize/route.ts` — cả 4
 * đều tải đúng path `signatures/{factoryId}/{userId}/chu_ky.png` trong cùng
 * bucket `iso-documents`.
 *
 * Trả về `null` nếu chưa có ảnh hoặc tải lỗi — KHÔNG throw. `generate-office`
 * trước đây throw khi thiếu ảnh (chặn cứng workflow Office nếu chưa upload chữ
 * ký); 3 route còn lại tolerate null (bỏ qua vẽ chữ ký, không chặn). Để giữ
 * đúng hành vi riêng của từng route, việc throw-hay-không vẫn do route gọi tự
 * quyết định ngay sau khi gọi hàm này, không đưa vào đây.
 */
export async function getSignatureImage(factoryId: string, userId: string): Promise<Buffer | null> {
  const storagePath = `signatures/${factoryId}/${userId}/chu_ky.png`
  const { data, error } = await getSupabaseAdmin().storage.from(SIGNATURE_BUCKET).download(storagePath)
  if (error || !data) return null
  return Buffer.from(await data.arrayBuffer())
}
