import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"
import {
  EudrFileOpError,
  ensureExportViewPermission,
  loadOrderForFileOps,
  normalizeEudrFiles,
} from "@/app/api/eudr/_lib/eudr-file-permissions"

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

// Route này giờ là ĐƯỜNG DUY NHẤT để đính kèm tệp EUDR — làm cả 2 việc: upload lên
// Storage VÀ patch export_orders.files (trước đây 2 việc tách rời, phần patch DB đi qua
// client trực tiếp nên không có chỗ nào để enforce khóa/ghi nhận người tải lên đáng tin
// cậy). factoryId/orderCode không còn nhận từ client — luôn suy ra từ chính bản ghi
// export_orders theo orderId, tránh giả mạo qua form field.
export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const formData = await req.formData()

    const orderId = String(formData.get("orderId") || "").trim()
    const fileEntry = formData.get("file")

    if (!orderId) {
      return NextResponse.json({ error: "Thieu ma don xuat hang." }, { status: 400 })
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

    const role = (profile.role as string) || ""

    try {
      await ensureExportViewPermission(authUser.id, role)
    } catch (permError) {
      const message = permError instanceof Error ? permError.message : "Khong co quyen."
      return NextResponse.json({ error: message }, { status: 403 })
    }

    const { order, locked } = await loadOrderForFileOps(orderId, profile.factory_id)

    if (locked && role !== "admin") {
      return NextResponse.json(
        { error: "Don hang da duoc phe duyet hoac da cap quyen cho khach hang — chi Admin duoc them tep dinh kem." },
        { status: 403 },
      )
    }

    await ensureBucket()

    const storagePath = `${sanitizeSegment(order.factory_id)}/${sanitizeSegment(order.ma_don)}/${Date.now()}_${sanitizeFilename(fileEntry.name)}`
    const fileBuffer = Buffer.from(await fileEntry.arrayBuffer())
    const uploadResult = await supabaseAdmin.storage.from(EUDR_BUCKET).upload(storagePath, fileBuffer, {
      upsert: true,
      contentType: fileEntry.type || "application/octet-stream",
    })

    if (uploadResult.error) {
      throw uploadResult.error
    }

    const { data: publicData } = supabaseAdmin.storage.from(EUDR_BUCKET).getPublicUrl(storagePath)

    // Đọc lại files mới nhất ngay trước khi ghi để giảm khoảng hở race khi có nhiều người
    // cùng thao tác — vẫn có thể mất 1 lượt hiếm khi 2 request chạm nhau chính xác cùng
    // lúc (bảng export_orders chưa có cơ chế optimistic lock), chấp nhận được cho tần suất
    // thao tác thực tế của module này.
    const { data: freshOrder, error: freshOrderError } = await supabaseAdmin
      .from("export_orders")
      .select("files")
      .eq("id", orderId)
      .single()

    if (freshOrderError) throw freshOrderError

    const newFileEntry = {
      name: fileEntry.name,
      url: publicData.publicUrl,
      path: storagePath,
      size: fileEntry.size,
      uploadedBy: authUser.id,
    }

    const nextFiles = [...normalizeEudrFiles(freshOrder?.files), newFileEntry]

    const { error: updateError } = await supabaseAdmin
      .from("export_orders")
      .update({ files: nextFiles })
      .eq("id", orderId)

    if (updateError) throw updateError

    return NextResponse.json({ file: newFileEntry, files: nextFiles })
  } catch (error) {
    if (error instanceof EudrFileOpError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("EUDR server upload failed", error)
    const message = error instanceof Error ? error.message : "Khong tai duoc file EUDR len may chu."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
