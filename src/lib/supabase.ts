import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// "Ghi nhớ đăng nhập" (checkbox ở login/page.tsx) — cờ này quyết định phiên Supabase được lưu ở
// localStorage (sống qua tắt/mở lại trình duyệt — mặc định, đúng hành vi gốc trước khi có tính
// năng này) hay sessionStorage (chỉ sống trong đúng tab/cửa sổ hiện tại, mất khi đóng hẳn trình
// duyệt). Mặc định (chưa từng set, hoặc mọi tài khoản đã đăng nhập trước khi tính năng này tồn
// tại) là "nhớ" — không đổi hành vi hiện có của người dùng cũ.
const REMEMBER_KEY = "erp_remember_me"

// Một số trình duyệt nhúng trong ứng dụng (Telegram, Zalo, Facebook...) chặn hoặc giới hạn
// localStorage/sessionStorage: chỉ cần ĐỌC thuộc tính `window.localStorage` cũng ném SecurityError,
// làm sập toàn bộ app thành màn trắng (bug mở link từ nhóm Telegram, 2026-10-13). Mọi truy cập
// storage ở đây đều qua `safeStorage()`; bị chặn thì rơi về bộ nhớ RAM (phiên chỉ sống trong tab).
const memoryStore = new Map<string, string>()
const memoryStorage = {
  getItem: (key: string) => memoryStore.get(key) ?? null,
  setItem: (key: string, value: string) => { memoryStore.set(key, value) },
  removeItem: (key: string) => { memoryStore.delete(key) },
}
type MiniStorage = typeof memoryStorage

const storageUsable: Partial<Record<"localStorage" | "sessionStorage", boolean>> = {}
function safeStorage(kind: "localStorage" | "sessionStorage"): MiniStorage {
  if (storageUsable[kind] === false) return memoryStorage
  try {
    const store = window[kind]
    if (storageUsable[kind] === undefined) {
      const probe = "__erp_probe__"
      store.setItem(probe, "1")
      store.removeItem(probe)
      storageUsable[kind] = true
    }
    return store
  } catch {
    storageUsable[kind] = false
    return memoryStorage
  }
}

export function setRememberMe(remember: boolean) {
  if (typeof window === "undefined") return
  try {
    safeStorage("localStorage").setItem(REMEMBER_KEY, remember ? "1" : "0")
  } catch {
    // storage đầy / bị chặn — giữ mặc định "nhớ đăng nhập"
  }
}

// CHỈ 1 client Supabase duy nhất trong suốt vòng đời tab (không tạo 2 client khác `storage` rồi
// chọn 1 — nếu tạo song song, cả 2 đều `persistSession:true` nên cùng giành Web Locks API theo
// cùng `storageKey` mặc định, dù chỉ 1 client thực sự được dùng). Thay vào đó, adapter `storage`
// truyền cho client tự "định tuyến" đọc/ghi vào localStorage hay sessionStorage tuỳ theo giá trị
// SỐNG của REMEMBER_KEY tại đúng thời điểm gọi getItem/setItem/removeItem — nhờ vậy checkbox có
// hiệu lực thật ngay trong cùng 1 lần tải trang (kể cả vừa mới bỏ tick rồi bấm đăng nhập ngay),
// không cần reload lại trang để "chọn client mới".
function activeAuthStorage(): MiniStorage {
  const local = safeStorage("localStorage")
  return local.getItem(REMEMBER_KEY) === "0" ? safeStorage("sessionStorage") : local
}

const routedAuthStorage = {
  getItem: (key: string) => {
    if (typeof window === "undefined") return null
    try { return activeAuthStorage().getItem(key) } catch { return memoryStorage.getItem(key) }
  },
  setItem: (key: string, value: string) => {
    if (typeof window === "undefined") return
    try { activeAuthStorage().setItem(key, value) } catch { memoryStorage.setItem(key, value) }
  },
  removeItem: (key: string) => {
    if (typeof window === "undefined") return
    try { activeAuthStorage().removeItem(key) } catch { memoryStorage.removeItem(key) }
  },
}

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
      storage: routedAuthStorage,
    },
  })

if (process.env.NODE_ENV !== "production") {
  globalForSupabase.__supabaseBrowserClient = supabase
}
