import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const AUTH_EMAIL_DOMAIN = "auth.rubber-erp.local"

function normalizeUsername(value) {
  return value.trim().toLowerCase()
}

function usernameToAuthEmail(username) {
  return `${normalizeUsername(username)}@${AUTH_EMAIL_DOMAIN}`
}

const roleDefaults = {
  admin: [
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
  ],
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
  user: ["dispatch.view", "storage.view", "product.view", "quality.view", "export.view"],
  customer: [],
}

async function listAllAuthUsers() {
  let page = 1
  const users = []

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    users.push(...data.users)
    if (data.users.length < 1000) break
    page += 1
  }

  return users
}

async function main() {
  const { data: legacyUsers, error: legacyError } = await supabase
    .from("users")
    .select("id, username, password_hash, full_name, role, factory_id, department, status, permissions, created_at, updated_at")
    .order("created_at")

  if (legacyError) throw legacyError

  const authUsers = await listAllAuthUsers()
  const authByEmail = new Map(authUsers.map((item) => [item.email, item]))

  for (const legacy of legacyUsers || []) {
    const username = normalizeUsername(legacy.username)
    const authEmail = usernameToAuthEmail(username)
    let authUser = authByEmail.get(authEmail)

    if (!authUser) {
      const { data, error } = await supabase.auth.admin.createUser({
        email: authEmail,
        password: legacy.password_hash,
        email_confirm: true,
        user_metadata: {
          username,
          full_name: legacy.full_name,
          migrated_from_legacy_users: true,
        },
      })

      if (error) throw error
      authUser = data.user
      authByEmail.set(authEmail, authUser)
      console.log(`Created auth user for ${username}`)
    } else {
      console.log(`Auth user already exists for ${username}`)
    }

    const { error: profileError } = await supabase.from("profiles").upsert({
      id: authUser.id,
      username,
      auth_email: authEmail,
      full_name: legacy.full_name,
      factory_id: legacy.factory_id,
      department: legacy.department || null,
      role: legacy.role || "user",
      status: legacy.status || "pending",
      created_at: legacy.created_at,
      updated_at: legacy.updated_at,
    })

    if (profileError) throw profileError

    const legacyPermissions = Object.entries(legacy.permissions || {})
      .filter(([, granted]) => granted)
      .map(([code]) => code)

    const finalPermissions =
      legacyPermissions.length > 0 ? legacyPermissions : roleDefaults[legacy.role || "user"] || []

    const { error: deletePermissionError } = await supabase
      .from("user_permissions")
      .delete()
      .eq("user_id", authUser.id)

    if (deletePermissionError) throw deletePermissionError

    if (finalPermissions.length > 0) {
      const { error: insertPermissionError } = await supabase.from("user_permissions").insert(
        finalPermissions.map((code) => ({
          user_id: authUser.id,
          permission_code: code,
          granted: true,
        })),
      )

      if (insertPermissionError) throw insertPermissionError
    }

    console.log(`Migrated profile for ${username}`)
  }

  console.log("Legacy user migration completed.")
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
