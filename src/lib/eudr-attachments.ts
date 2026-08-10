// Tiện ích dùng CHUNG cho cả client (`EudrClient.tsx`, upload thẳng lên Supabase Storage) lẫn
// server (`api/eudr/upload`, `api/eudr/register-file`) — path build ra phải khớp CHÍNH XÁC với
// điều kiện RLS Storage `(storage.foldername(name))[1] = current_profile_factory_id()::text`
// (xem `supabase/migrations/20260819_eudr_storage_bucket_lockdown.sql`). Nếu client/server tự
// duplicate 2 hàm sanitize rồi lệch nhau (khác regex ký tự cho phép) sẽ gây bug khó phát hiện —
// bắt buộc dùng chung đúng 1 nguồn này, không tự viết lại ở nơi khác.

export const EUDR_BUCKET = "eudr-files"

export function sanitizeSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, "_")
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_")
}

export function buildEudrStoragePath(factoryId: string, orderCode: string, fileName: string): string {
  return `${sanitizeSegment(factoryId)}/${sanitizeSegment(orderCode)}/${Date.now()}_${sanitizeFilename(fileName)}`
}
