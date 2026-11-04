// Lỗi trả về từ Supabase (PostgrestError, AuthError...) là object thường có `message`, KHÔNG phải
// instance của `Error` — nên `err instanceof Error ? err.message : fallback` luôn rơi vào nhánh fallback
// và nuốt mất lý do thật (vi phạm RLS, lỗi raise trong RPC...). Dùng hàm này ở mọi catch block.
export function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message?: unknown }).message
    if (typeof msg === "string" && msg) return msg
  }
  return fallback
}
