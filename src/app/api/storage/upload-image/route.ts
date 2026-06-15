import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"

const IMAGE_BUCKET_CONFIG = {
  "inventory-files": {
    public: true,
    fileSizeLimit: 10 * 1024 * 1024,
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"] as string[],
  },
  "order-files": {
    public: true,
    fileSizeLimit: 10 * 1024 * 1024,
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"] as string[],
  },
  "product-files": {
    public: true,
    fileSizeLimit: 10 * 1024 * 1024,
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"] as string[],
  },
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

async function ensureBucket(bucket: keyof typeof IMAGE_BUCKET_CONFIG) {
  const config = IMAGE_BUCKET_CONFIG[bucket]
  const existingBucket = await supabaseAdmin.storage.getBucket(bucket)

  if (existingBucket.error) {
    if (!isBucketNotFound(existingBucket.error)) {
      throw existingBucket.error
    }

    const createdBucket = await supabaseAdmin.storage.createBucket(bucket, config)
    if (createdBucket.error) {
      throw createdBucket.error
    }
    return
  }

  const bucketData = existingBucket.data
  const shouldUpdate =
    bucketData.public !== config.public ||
    bucketData.file_size_limit !== config.fileSizeLimit ||
    JSON.stringify(bucketData.allowed_mime_types || []) !== JSON.stringify(config.allowedMimeTypes)

  if (!shouldUpdate) return

  const updatedBucket = await supabaseAdmin.storage.updateBucket(bucket, config)
  if (updatedBucket.error) {
    throw updatedBucket.error
  }
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const formData = await req.formData()

    const bucketValue = String(formData.get("bucket") || "").trim()
    const factoryId = sanitizeSegment(String(formData.get("factoryId") || ""))
    const documentType = sanitizeSegment(String(formData.get("documentType") || ""))
    const fileEntry = formData.get("file")

    if (!bucketValue || !(bucketValue in IMAGE_BUCKET_CONFIG)) {
      return NextResponse.json({ error: "Bucket upload khong hop le." }, { status: 400 })
    }

    if (!factoryId || !documentType) {
      return NextResponse.json({ error: "Thieu thong tin upload anh." }, { status: 400 })
    }

    if (!(fileEntry instanceof File)) {
      return NextResponse.json({ error: "Khong tim thay file anh." }, { status: 400 })
    }

    const bucket = bucketValue as keyof typeof IMAGE_BUCKET_CONFIG
    const config = IMAGE_BUCKET_CONFIG[bucket]

    if (!config.allowedMimeTypes.includes(fileEntry.type)) {
      return NextResponse.json({ error: "Dinh dang anh khong duoc ho tro." }, { status: 400 })
    }

    if (fileEntry.size > config.fileSizeLimit) {
      return NextResponse.json({ error: "Anh vuot qua gioi han 10MB." }, { status: 400 })
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("factory_id, status")
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

    await ensureBucket(bucket)

    const storagePath = `${factoryId}/${documentType}/${Date.now()}_${sanitizeFilename(fileEntry.name)}`
    const fileBuffer = Buffer.from(await fileEntry.arrayBuffer())
    const uploadResult = await supabaseAdmin.storage.from(bucket).upload(storagePath, fileBuffer, {
      upsert: true,
      contentType: fileEntry.type,
    })

    if (uploadResult.error) {
      throw uploadResult.error
    }

    const { data: publicData } = supabaseAdmin.storage.from(bucket).getPublicUrl(storagePath)

    return NextResponse.json({
      path: storagePath,
      publicUrl: publicData.publicUrl,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Khong tai duoc anh len storage."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
