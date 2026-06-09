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
  const email = String(body?.email || "").trim().toLowerCase()
  const department = String(body?.department || "").trim()
  const factoryId = String(body?.factoryId || "").trim()

  if (!username || !password || !fullName || !email || !factoryId) {
    return badRequest("Vui long nhap day du thong tin bat buoc")
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return badRequest("Email khong hop le")
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

  const { data: existingStaffByProfile, error: existingStaffByProfileError } = await adminSupabase
    .from("maintenance_staff")
    .select("id")
    .eq("factory_id", factoryId)
    .eq("profile_id", createdUser.id)
    .maybeSingle()

  if (existingStaffByProfileError) {
    await adminSupabase.from("profiles").delete().eq("id", createdUser.id)
    await adminSupabase.auth.admin.deleteUser(createdUser.id)
    return badRequest(existingStaffByProfileError.message, 500)
  }

  let existingStaffId = existingStaffByProfile?.id ?? null

  if (!existingStaffId) {
    const { data: unlinkedStaffByName, error: unlinkedStaffByNameError } = await adminSupabase
      .from("maintenance_staff")
      .select("id")
      .eq("factory_id", factoryId)
      .is("profile_id", null)
      .eq("ten", fullName)
      .limit(2)

    if (unlinkedStaffByNameError) {
      await adminSupabase.from("profiles").delete().eq("id", createdUser.id)
      await adminSupabase.auth.admin.deleteUser(createdUser.id)
      return badRequest(unlinkedStaffByNameError.message, 500)
    }

    if ((unlinkedStaffByName?.length || 0) > 1) {
      await adminSupabase.from("profiles").delete().eq("id", createdUser.id)
      await adminSupabase.auth.admin.deleteUser(createdUser.id)
      return badRequest(
        "Có nhiều hồ sơ nhân sự trùng họ tên chưa liên kết. Vui lòng liên hệ admin để gán đúng email.",
        409,
      )
    }

    existingStaffId = unlinkedStaffByName?.[0]?.id ?? null
  }

  const staffPayload = {
    factory_id: factoryId,
    profile_id: createdUser.id,
    ten: fullName,
    email,
    active: true,
  }

  const staffResult = existingStaffId
    ? await adminSupabase.from("maintenance_staff").update(staffPayload).eq("id", existingStaffId)
    : await adminSupabase.from("maintenance_staff").insert(staffPayload)

  if (staffResult.error) {
    await adminSupabase.from("profiles").delete().eq("id", createdUser.id)
    await adminSupabase.auth.admin.deleteUser(createdUser.id)
    return badRequest(staffResult.error.message, 500)
  }

  return NextResponse.json({
    success: true,
    userId: createdUser.id,
  })
}
