import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"

const EUDR_BUCKET = "eudr-files"
const EUDR_BUCKET_CONFIG = {
  public: true,
  fileSizeLimit: 50 * 1024 * 1024,
} as const

function sanitizeSegment(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, "_")
}

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_")
}

function isBucketNotFound(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "")
  return /bucket.*not found|404/i.test(message)
}

// Route trước đây chỉ kiểm tra "cùng nhà máy" — bất kỳ nhân viên active nào trong nhà
// máy (kể cả không có quyền vào module Xuất hàng/EUDR) đều gọi được. Mirror đúng ngữ
// nghĩa fetchPermissionCodesForUser() (src/lib/auth.ts): có quyền explicit trong
// user_permissions thì CHỈ dùng đúng tập đó, không cộng thêm role_permissions.
async function ensureExportViewPermission(userId: string, role: string) {
  if (role === "admin") return

  const { data: explicitRows } = await supabaseAdmin
    .from("user_permissions")
    .select("permission_code")
    .eq("user_id", userId)
    .eq("granted", true)

  let allowed: boolean
  if (explicitRows && explicitRows.length > 0) {
    allowed = explicitRows.some((r) => r.permission_code === "export.view")
  } else {
    const { data: roleRows } = await supabaseAdmin
      .from("role_permissions")
      .select("permission_code")
      .eq("role", role)
      .eq("permission_code", "export.view")
    allowed = (roleRows?.length || 0) > 0
  }

  if (!allowed) {
    throw new Error("Ban khong co quyen tai file EUDR len.")
  }
}

async function ensureBucket() {
  const existingBucket = await supabaseAdmin.storage.getBucket(EUDR_BUCKET)

  if (existingBucket.error) {
    if (!isBucketNotFound(existingBucket.error)) {
      throw existingBucket.error
    }

    const createdBucket = await supabaseAdmin.storage.createBucket(EUDR_BUCKET, EUDR_BUCKET_CONFIG)
    if (createdBucket.error) {
      throw createdBucket.error
    }
    return
  }

  const bucketData = existingBucket.data
  const shouldUpdate =
    bucketData.public !== EUDR_BUCKET_CONFIG.public ||
    bucketData.file_size_limit !== EUDR_BUCKET_CONFIG.fileSizeLimit

  if (!shouldUpdate) return

  const updatedBucket = await supabaseAdmin.storage.updateBucket(EUDR_BUCKET, EUDR_BUCKET_CONFIG)
  if (updatedBucket.error) {
    throw updatedBucket.error
  }
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const formData = await req.formData()

    const factoryId = sanitizeSegment(String(formData.get("factoryId") || ""))
    const orderCode = sanitizeSegment(String(formData.get("orderCode") || ""))
    const fileEntry = formData.get("file")

    if (!factoryId || !orderCode) {
      return NextResponse.json({ error: "Thieu thong tin upload EUDR." }, { status: 400 })
    }

    if (!(fileEntry instanceof File)) {
      return NextResponse.json({ error: "Khong tim thay file dinh kem." }, { status: 400 })
    }

    if (fileEntry.size > EUDR_BUCKET_CONFIG.fileSizeLimit) {
      return NextResponse.json({ error: "File vuot qua gioi han 50MB." }, { status: 400 })
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("factory_id, status, role")
      .eq("id", authUser.id)
      .single()

    if (profileError || !profile) {
      throw new Error(profileError?.message || "Khong tai duoc ho so nguoi dung.")
    }

    if (profile.status !== "active") {
      return NextResponse.json({ error: "Tai khoan khong con hoat dong." }, { status: 403 })
    }

    if (profile.factory_id !== factoryId) {
      return NextResponse.json({ error: "Khong dung nha may upload du lieu." }, { status: 403 })
    }

    try {
      await ensureExportViewPermission(authUser.id, (profile.role as string) || "")
    } catch (permError) {
      const message = permError instanceof Error ? permError.message : "Khong co quyen."
      return NextResponse.json({ error: message }, { status: 403 })
    }

    await ensureBucket()

    const storagePath = `${factoryId}/${orderCode}/${Date.now()}_${sanitizeFilename(fileEntry.name)}`
    const fileBuffer = Buffer.from(await fileEntry.arrayBuffer())
    const uploadResult = await supabaseAdmin.storage.from(EUDR_BUCKET).upload(storagePath, fileBuffer, {
      upsert: true,
      contentType: fileEntry.type || "application/octet-stream",
    })

    if (uploadResult.error) {
      throw uploadResult.error
    }

    const { data: publicData } = supabaseAdmin.storage.from(EUDR_BUCKET).getPublicUrl(storagePath)

    return NextResponse.json({
      name: fileEntry.name,
      size: fileEntry.size,
      path: storagePath,
      publicUrl: publicData.publicUrl,
    })
  } catch (error) {
    console.error("EUDR server upload failed", error)
    const message = error instanceof Error ? error.message : "Khong tai duoc file EUDR len may chu."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
