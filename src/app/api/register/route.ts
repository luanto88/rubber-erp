import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { normalizeUsername, usernameToAuthEmail } from "@/lib/auth"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

function badRequest(error: string, status = 400) {
  return NextResponse.json({ error }, { status })
}

export async function POST(request: Request) {
  if (!supabaseUrl || !serviceRoleKey) {
    return badRequest("Server chua cau hinh SUPABASE_SERVICE_ROLE_KEY", 500)
  }

  const body = await request.json().catch(() => null)
  const username = normalizeUsername(body?.username || "")
  const password = String(body?.password || "")
  const fullName = String(body?.fullName || "").trim()
  const department = String(body?.department || "").trim()
  const factoryId = String(body?.factoryId || "").trim()

  if (!username || !password || !fullName || !factoryId) {
    return badRequest("Vui long nhap day du thong tin bat buoc")
  }

  if (password.length < 6) {
    return badRequest("Mat khau phai co it nhat 6 ky tu")
  }

  const adminSupabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: existingProfile, error: existingProfileError } = await adminSupabase
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle()

  if (existingProfileError) {
    return badRequest(existingProfileError.message, 500)
  }

  if (existingProfile) {
    return badRequest("Ten dang nhap da ton tai", 409)
  }

  const authEmail = usernameToAuthEmail(username)

  const { data: createdUserData, error: createUserError } =
    await adminSupabase.auth.admin.createUser({
      email: authEmail,
      password,
      email_confirm: true,
      user_metadata: {
        username,
        full_name: fullName,
      },
    })

  if (createUserError || !createdUserData.user) {
    return badRequest(
      createUserError?.message || "Khong tao duoc tai khoan auth",
      createUserError?.status || 500,
    )
  }

  const createdUser = createdUserData.user

  const { error: profileError } = await adminSupabase.from("profiles").insert({
    id: createdUser.id,
    username,
    auth_email: authEmail,
    full_name: fullName,
    factory_id: factoryId,
    department: department || null,
    role: "user",
    status: "pending",
  })

  if (profileError) {
    await adminSupabase.auth.admin.deleteUser(createdUser.id)
    return badRequest(profileError.message, 500)
  }

  return NextResponse.json({
    success: true,
    userId: createdUser.id,
  })
}
