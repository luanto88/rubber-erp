import type { Session, User as AuthUser } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"

export type AppRole = "admin" | "manager" | "user" | "customer"
export type AppStatus = "pending" | "active" | "disabled"

export type Profile = {
  id: string
  username: string
  auth_email: string
  full_name: string
  factory_id: string | null
  department: string | null
  role: AppRole
  status: AppStatus
  approved_by: string | null
  approved_at: string | null
  disabled_by: string | null
  disabled_at: string | null
}

export type PermissionCode = string

export type SessionUser = Profile & {
  permissions: PermissionCode[]
}

const AUTH_EMAIL_DOMAIN = "auth.rubber-erp.example.com"
const LEGACY_AUTH_EMAIL_DOMAIN = "auth.rubber-erp.local"
const SESSION_REFRESH_LEEWAY_SECONDS = 300

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase()
}

export function usernameToAuthEmail(username: string) {
  return `${normalizeUsername(username)}@${AUTH_EMAIL_DOMAIN}`
}

export function legacyUsernameToAuthEmail(username: string) {
  return `${normalizeUsername(username)}@${LEGACY_AUTH_EMAIL_DOMAIN}`
}

export function authEmailsForUsername(username: string) {
  const primaryEmail = usernameToAuthEmail(username)
  const legacyEmail = legacyUsernameToAuthEmail(username)
  return primaryEmail === legacyEmail ? [primaryEmail] : [primaryEmail, legacyEmail]
}

export function clearLegacySession() {
  localStorage.removeItem("erp_user")
  localStorage.removeItem("erp_factory")
  // Draft phiếu kho lưu theo thiết bị, không theo user — dọn khi đăng xuất để tránh tên người
  // dùng cũ (Người lập phiếu) rò rỉ sang tài khoản khác đăng nhập sau trên cùng máy.
  localStorage.removeItem("inventory-issue-draft-v4")
  localStorage.removeItem("inventory-receipt-draft-v5")
  localStorage.removeItem("inventory-transfer-draft-v3")
}

export function clearSupabaseBrowserSession() {
  if (typeof window === "undefined") return

  const clearStore = (store: Storage) => {
    const keysToRemove: string[] = []
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i)
      if (!key) continue
      if (key.startsWith("sb-") || key.includes("supabase")) {
        keysToRemove.push(key)
      }
    }
    for (const key of keysToRemove) {
      store.removeItem(key)
    }
  }

  clearStore(window.localStorage)
  clearStore(window.sessionStorage)
}

export function persistLegacySession(user: SessionUser) {
  localStorage.setItem("erp_user", JSON.stringify(user))
  localStorage.setItem("erp_factory", user.factory_id || "")
}

export async function getAuthSession() {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session
}

function isSessionExpiringSoon(session: Session | null) {
  if (!session?.expires_at) return !session
  return session.expires_at - Math.floor(Date.now() / 1000) <= SESSION_REFRESH_LEEWAY_SECONDS
}

export function isAuthSessionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "")
  const normalized = message.toLowerCase()
  return (
    normalized.includes("jwt") ||
    normalized.includes("token") ||
    normalized.includes("session") ||
    normalized.includes("refresh") ||
    normalized.includes("auth") ||
    normalized.includes("401") ||
    normalized.includes("403")
  )
}

// Bug thật đã xác nhận 2026-08-07 qua console log + stack trace đầy đủ (không phải suy đoán):
// khi refresh token đã bị Supabase server thu hồi thật sự (AuthSessionMissingError / error_code
// "session_not_found", status 400 — đã verify token?grant_type=refresh_token trả về đúng 400
// này qua tab Network, không phải bị treo ở tầng mạng), lệnh gọi supabase.auth.refreshSession()
// đôi khi KHÔNG BAO GIỜ resolve/reject phía JS dù request HTTP bên dưới đã hoàn tất — đã đối
// chiếu source `@supabase/auth-js` (GoTrueClient.ts _refreshAccessToken/_callRefreshToken,
// dùng `_acquireLock` qua Web Locks API ở locks.ts) nhưng không xác định được chắc chắn nút thắt
// chính xác nằm ở đâu bên trong SDK. Vì đây là code vendor (node_modules), không sửa trực tiếp
// được — giải pháp phòng thủ là bọc timeout cứng ở TẦNG APP để đảm bảo UI luôn thoát khỏi trạng
// thái "Đang xử lý..." trong một khoảng thời gian xác định, bất kể nguyên nhân treo bên trong SDK
// là gì. Timeout không "hủy" được promise gốc (JS không có cơ chế hủy Promise thật), chỉ ngừng
// chờ nó ở phía app — nếu SDK thực sự bị kẹt 1 Web Lock ở nền, lock đó sẽ tự giải phóng khi tab
// được tải lại/điều hướng đi nơi khác (vd sau khi bị đăng xuất và chuyển về /login).
const AUTH_OP_TIMEOUT_MS = 8_000

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label}: hết thời gian chờ sau ${ms}ms — có thể do phiên đăng nhập đã bị thu hồi`))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

// Nhiều nơi trong app gọi getFreshAuthSession() độc lập với nhau (interval 60s, focus/visibility
// listener trong dashboard/layout.tsx, các lệnh gọi trực tiếp từ settings.tsx khi đổi PIN/chữ
// ký/mật khẩu...). Nếu 2 lệnh gọi này rơi đúng lúc access token sắp hết hạn, cả 2 có thể cùng
// gọi refreshSession() gần như đồng thời — supabase-js rotate refresh token sau mỗi lần dùng nên
// lệnh chạy sau có thể nhận phải refresh token đã bị lệnh chạy trước "đốt", ra lỗi
// "Invalid Refresh Token: Already Used" dù phiên đăng nhập thực ra vẫn còn hợp lệ. Dùng 1 promise
// dùng chung để mọi lệnh gọi đồng thời "ăn theo" đúng 1 lượt refresh thật duy nhất.
let refreshInFlight: Promise<Session | null> | null = null

async function refreshSessionOnce(): Promise<Session | null> {
  const { data, error } = await withTimeout(
    supabase.auth.refreshSession(),
    AUTH_OP_TIMEOUT_MS,
    "refreshSession()",
  )
  if (error) {
    console.error(
      `getFreshAuthSession: refreshSession() thất bại — ${error.name}: ${error.message}` +
        ("status" in error && error.status ? ` (status=${error.status})` : ""),
    )
    throw error
  }
  return data.session
}

export async function getFreshAuthSession() {
  const session = await getAuthSession()
  if (session && !isSessionExpiringSoon(session)) return session
  return forceRefreshAuthSession()
}

// Dùng khi ĐÃ BIẾT access token hiện tại bị server từ chối (vd verify-otp trả về "Phiên đăng
// nhập đã hết hạn") dù phía client vẫn tưởng token còn hạn — nghĩa là `session.expires_at` đang
// giữ chưa rơi vào khoảng SESSION_REFRESH_LEEWAY_SECONDS. getFreshAuthSession() bình thường sẽ
// KHÔNG refresh trong trường hợp này (vì isSessionExpiringSoon() vẫn false) nên trả về nguyên
// token cũ đã bị từ chối — bug thật đã xác nhận qua console log (retry gọi lại getAccessToken()
// mà không hề có log lỗi refresh nào, tức getFreshAuthSession() coi token vẫn hợp lệ và trả về y
// nguyên). Gọi thẳng hàm này ở các nhánh "server vừa báo hết hạn" để ép refresh thật, bỏ qua bước
// kiểm tra "còn hạn hay chưa".
export async function forceRefreshAuthSession() {
  if (!refreshInFlight) {
    refreshInFlight = refreshSessionOnce().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

// signOut() cũng đi qua cùng client Supabase (và có thể cùng Web Lock) như refreshSession() —
// bọc timeout tương tự để không lặp lại đúng kiểu treo vô thời hạn khi phiên đăng nhập đã hỏng.
// Dọn sạch storage cục bộ (clearLegacySession/clearSupabaseBrowserSession) không phụ thuộc mạng
// nên luôn chạy được trong `finally`, đảm bảo hàm này luôn kết thúc trong khoảng AUTH_OP_TIMEOUT_MS
// dù supabase.auth.signOut() có treo hay không.
export async function signOutEverywhere() {
  clearLegacySession()
  try {
    await withTimeout(supabase.auth.signOut(), AUTH_OP_TIMEOUT_MS, "signOut()")
  } catch (error) {
    console.error(
      `signOutEverywhere: signOut() thất bại hoặc hết thời gian chờ — ${error instanceof Error ? error.message : error}`,
    )
  } finally {
    clearSupabaseBrowserSession()
  }
}

export async function fetchProfileByAuthId(authUserId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, username, auth_email, full_name, factory_id, department, role, status, approved_by, approved_at, disabled_by, disabled_at",
    )
    .eq("id", authUserId)
    .single()

  if (error) throw error
  return data as Profile
}

export async function fetchPermissionCodesForUser(userId: string) {
  const [directResult, profileResult] = await Promise.all([
    supabase
      .from("user_permissions")
      .select("permission_code")
      .eq("user_id", userId)
      .eq("granted", true),
    supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single(),
  ])

  if (directResult.error) throw directResult.error
  if (profileResult.error) throw profileResult.error

  const codes = new Set<string>()

  for (const row of directResult.data || []) {
    if (row.permission_code) codes.add(row.permission_code)
  }

  if (codes.size > 0) {
    return [...codes].sort()
  }

  const role = profileResult.data.role as AppRole
  const rolePermissionResult = await supabase
    .from("role_permissions")
    .select("permission_code")
    .eq("role", role)

  if (rolePermissionResult.error) throw rolePermissionResult.error

  const rolePermissions = Array.isArray(rolePermissionResult.data)
    ? rolePermissionResult.data
    : []

  for (const row of rolePermissions) {
    if (row.permission_code) codes.add(row.permission_code)
  }

  // Fallback: nếu DB chưa có permissions cho role này (chưa seed), dùng ROLE_DEFAULTS
  if (codes.size === 0 && role in ROLE_DEFAULTS) {
    for (const code of ROLE_DEFAULTS[role]) codes.add(code)
  }

  return [...codes].sort()
}

export async function buildSessionUser(authUser: AuthUser) {
  const profile = await fetchProfileByAuthId(authUser.id)
  const permissions = await fetchPermissionCodesForUser(authUser.id)
  return { ...profile, permissions }
}

export async function hydrateActiveSession() {
  const session = await getFreshAuthSession()
  if (!session?.user) {
    clearLegacySession()
    return { session: null, user: null as SessionUser | null }
  }

  const user = await buildSessionUser(session.user)

  if (user.status !== "active") {
    clearLegacySession()
    return { session, user }
  }

  persistLegacySession(user)
  return { session, user }
}

export async function getActiveFactoryId() {
  const session = await getFreshAuthSession()
  if (!session?.user) {
    clearLegacySession()
    return null
  }

  const cachedFactoryId = localStorage.getItem("erp_factory")
  if (cachedFactoryId) return cachedFactoryId

  const user = await buildSessionUser(session.user)
  if (user.status === "active" && user.factory_id) {
    persistLegacySession(user)
    return user.factory_id
  }

  clearLegacySession()
  return null
}

export async function signInWithUsername(username: string, password: string) {
  let lastError: Error | null = null

  for (const authEmail of authEmailsForUsername(username)) {
    const result = await supabase.auth.signInWithPassword({ email: authEmail, password })
    if (!result.error) return result

    lastError = result.error
    const message = result.error.message.toLowerCase()
    const isInvalidCredentialError =
      message.includes("invalid login credentials") ||
      message.includes("email not confirmed") ||
      message.includes("invalid email or password")

    if (!isInvalidCredentialError) {
      return result
    }
  }

  return {
    data: { session: null, user: null },
    error: lastError,
  }
}

export async function signUpWithUsername(input: {
  username: string
  password: string
  fullName: string
  email: string
  department: string
  factoryId: string
}) {
  const response = await fetch("/api/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      username: normalizeUsername(input.username),
      password: input.password,
      fullName: input.fullName.trim(),
      email: input.email.trim(),
      department: input.department.trim(),
      factoryId: input.factoryId,
    }),
  })

  const result = await response.json().catch(() => null)

  if (!response.ok) {
    return {
      data: null,
      error: new Error(result?.error || "Khong the dang ky tai khoan"),
    }
  }

  return { data: result, error: null }
}

export function describeAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "")
  const lower = message.toLowerCase()
  const status = (error as { status?: number } | null)?.status

  if (
    lower.includes("invalid login credentials") ||
    lower.includes("invalid email or password")
  ) {
    return "Sai tên đăng nhập hoặc mật khẩu"
  }
  if (lower.includes("email not confirmed")) {
    return "Tài khoản chưa được xác thực email. Vui lòng liên hệ admin."
  }
  if (status === 402 || lower.includes("restricted") || lower.includes("quota")) {
    return "Hệ thống đang gặp sự cố hạ tầng (vượt hạn mức dịch vụ). Vui lòng thử lại sau hoặc liên hệ quản trị viên."
  }
  if (status === 429 || lower.includes("rate limit") || lower.includes("too many requests")) {
    return "Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút."
  }
  if (lower.includes("fetch") || lower.includes("network")) {
    return "Không kết nối được máy chủ. Vui lòng kiểm tra mạng và thử lại."
  }
  if (!message) return "Sai tên đăng nhập hoặc mật khẩu"
  return `Không thể đăng nhập: ${message}`
}

export function authBlockReason(user: SessionUser | Profile | null) {
  if (!user) return "missing"
  if (user.status === "pending") return "pending"
  if (user.status === "disabled") return "disabled"
  if (!user.factory_id) return "no_factory"
  return null
}

export function hasPermission(
  user: Pick<SessionUser, "role" | "permissions"> | null | undefined,
  code: string,
) {
  if (!user) return false
  if (user.role === "admin") return true
  return user.permissions.includes(code)
}

export const DEFAULT_PERMISSION_CODES = [
  "dashboard.view",
  "dispatch.view",
  "dispatch.create",
  "dispatch.edit",
  "dispatch.delete",
  "dispatch.import",
  "storage.view",
  "storage.create",
  "storage.edit",
  "storage.delete",
  "inventory.view",
  "inventory.create",
  "inventory.edit",
  "inventory.delete",
  "inventory.post",
  "inventory.analytics",
  "inventory.settings",
  "product.view",
  "product.create",
  "product.edit",
  "product.delete",
  "product.mark_completed",
  "product.predict_view",
  "product.predict_manage",
  "product.confirm_scan",
  "quality.view",
  "quality.create",
  "quality.edit",
  "quality.delete",
  "quality.print",
  "quality.import",
  "export.view",
  "export.create",
  "export.edit",
  "export.delete",
  "export.delete_order",
  "export.quick_add_customer",
  "export.view_own",
  "settings.view",
  "settings.manage_config",
  "settings.master_data",
  "settings.maintenance_config",
  "users.view",
  "users.approve",
  "users.edit_permission",
  "suffixes.quick_add",
  "iso.view",
  "iso.create",
  "iso.edit",
  "iso.delete",
  "iso.xem_xet",
  "iso.soat_xet",
  "iso.phe_duyet",
  "iso.print",
  "iso.signature",
  "notes.view",
  "notes.create",
  "notes.edit",
  "notes.delete",
  "kpi.view",
  "kpi.assign",
  "kpi.evaluate",
  "kpi.view_all",
  "kpi.manage_config",
]

export const ROLE_DEFAULTS: Record<AppRole, string[]> = {
  admin: DEFAULT_PERMISSION_CODES,
  manager: [
    "dashboard.view",
    "dispatch.view",
    "dispatch.create",
    "dispatch.edit",
    "storage.view",
    "storage.create",
    "storage.edit",
    "inventory.view",
    "inventory.create",
    "inventory.edit",
    "inventory.post",
    "inventory.analytics",
    "inventory.settings",
    "product.view",
    "product.create",
    "product.edit",
    "product.mark_completed",
    "product.predict_view",
    "product.predict_manage",
    "product.confirm_scan",
    "quality.view",
    "quality.create",
    "quality.edit",
    "quality.print",
    "export.view",
    "export.create",
    "export.edit",
    "settings.view",
    "settings.master_data",
    "settings.maintenance_config",
    "users.view",
    "iso.view",
    "iso.create",
    "iso.edit",
    "iso.soat_xet",
    "iso.signature",
    "notes.view",
    "notes.create",
    "notes.edit",
    "notes.delete",
    "kpi.view",
    "kpi.assign",
    "kpi.evaluate",
    "kpi.view_all",
  ],
  user: [
    "dashboard.view",
    "dispatch.view",
    "storage.view",
    "inventory.view",
    "inventory.analytics",
    "product.view",
    "product.confirm_scan",
    "quality.view",
    "export.view",
    "iso.view",
    "iso.signature",
    "notes.view",
    "notes.create",
    "notes.edit",
    "notes.delete",
    "kpi.view",
  ],
  customer: ["export.view_own"],
}

export type AuthHydration = {
  session: Session | null
  user: SessionUser | Profile | null
}
