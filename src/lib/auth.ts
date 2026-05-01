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
const SESSION_REFRESH_LEEWAY_SECONDS = 120

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

export async function getFreshAuthSession() {
  const session = await getAuthSession()
  if (session && !isSessionExpiringSoon(session)) return session

  const { data, error } = await supabase.auth.refreshSession()
  if (error) throw error
  return data.session
}

export async function signOutEverywhere() {
  clearLegacySession()
  try {
    await supabase.auth.signOut()
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
  "settings.view",
  "settings.manage_config",
  "users.view",
  "users.approve",
  "users.edit_permission",
  "suffixes.quick_add",
]

export const ROLE_DEFAULTS: Record<AppRole, string[]> = {
  admin: DEFAULT_PERMISSION_CODES,
  manager: [
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
    "quality.view",
    "quality.create",
    "quality.edit",
    "quality.print",
    "export.view",
    "export.create",
    "export.edit",
    "settings.view",
    "users.view",
  ],
  user: [
    "dispatch.view",
    "storage.view",
    "inventory.view",
    "inventory.analytics",
    "product.view",
    "quality.view",
    "export.view",
  ],
  customer: [],
}

export type AuthHydration = {
  session: Session | null
  user: SessionUser | Profile | null
}
