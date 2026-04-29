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

const AUTH_EMAIL_DOMAIN = "auth.rubber-erp.local"

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase()
}

export function usernameToAuthEmail(username: string) {
  return `${normalizeUsername(username)}@${AUTH_EMAIL_DOMAIN}`
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

  return [...codes].sort()
}

export async function buildSessionUser(authUser: AuthUser) {
  const profile = await fetchProfileByAuthId(authUser.id)
  const permissions = await fetchPermissionCodesForUser(authUser.id)
  return { ...profile, permissions }
}

export async function hydrateActiveSession() {
  const session = await getAuthSession()
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

export async function signInWithUsername(username: string, password: string) {
  const authEmail = usernameToAuthEmail(username)
  return supabase.auth.signInWithPassword({ email: authEmail, password })
}

export async function signUpWithUsername(input: {
  username: string
  password: string
  fullName: string
  department: string
  factoryId: string
}) {
  const authEmail = usernameToAuthEmail(input.username)

  const { data, error } = await supabase.auth.signUp({
    email: authEmail,
    password: input.password,
    options: {
      data: {
        username: normalizeUsername(input.username),
        full_name: input.fullName.trim(),
      },
    },
  })

  if (error) return { data, error }
  if (!data.user) {
    return {
      data,
      error: new Error("Khong tao duoc tai khoan auth"),
    }
  }

  const { error: profileError } = await supabase.from("profiles").insert({
    id: data.user.id,
    username: normalizeUsername(input.username),
    auth_email: authEmail,
    full_name: input.fullName.trim(),
    factory_id: input.factoryId,
    department: input.department.trim() || null,
    role: "user",
    status: "pending",
  })

  if (profileError) {
    await supabase.auth.signOut()
    return { data, error: profileError }
  }

  return { data, error: null }
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
