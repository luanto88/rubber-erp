import { createHash } from "crypto"

/**
 * SHA-256 (hex) của file đã ký, tính ngay sau khi stamp và TRƯỚC khi upload lên Storage —
 * dùng để chứng minh tính toàn vẹn của file tại đúng thời điểm ký (lưu vào
 * doc_approval_log.content_hash). Đặt trước trong src/lib/signing/ dù thư viện ký dùng chung
 * chưa được tách đầy đủ (Giai đoạn 1) — đây là hàm mới hoàn toàn, không phụ thuộc code cũ.
 */
export function computeIntegrityHash(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}
