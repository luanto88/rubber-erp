import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Next.js dev server (Fast Refresh) có thể re-thực-thi module này nhiều lần trong cùng 1 tab mà
// KHÔNG reload trang, tạo ra nhiều GoTrueClient khác nhau cùng đọc/ghi chung 1 key localStorage.
// Vì supabase-js rotate refresh token sau mỗi lần dùng, 2 client song song có thể "đốt" refresh
// token của nhau — 1 bên nhận lỗi "Invalid Refresh Token: Already Used" và tự coi như phiên đã
// hết hạn, dù người dùng vẫn đang có phiên hợp lệ ở client còn lại. Đây là nguyên nhân đã biết
// của lỗi "Phiên đăng nhập đã hết hạn" xuất hiện CHỈ khi chạy `npm run dev`, không xảy ra ở
// production build (không có Fast Refresh nên module chỉ chạy đúng 1 lần).
// Cache instance qua `globalThis` để Fast Refresh tái sử dụng đúng 1 client duy nhất trong suốt
// vòng đời tab — mirror đúng pattern singleton dev quen thuộc (vd Prisma Client trong Next.js).
const globalForSupabase = globalThis as unknown as {
  __supabaseBrowserClient?: SupabaseClient
}

export const supabase: SupabaseClient =
  globalForSupabase.__supabaseBrowserClient ??
  createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })

if (process.env.NODE_ENV !== "production") {
  globalForSupabase.__supabaseBrowserClient = supabase
}
