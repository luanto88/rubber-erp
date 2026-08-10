import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"
import {
  EudrFileOpError,
  appendEudrFileEntry,
  ensureExportViewPermission,
  loadOrderForFileOps,
} from "@/app/api/eudr/_lib/eudr-file-permissions"
import { EUDR_BUCKET, sanitizeSegment } from "@/lib/eudr-attachments"

export const dynamic = "force-dynamic"

// POST /api/eudr/register-file  { orderId, path, name, size }
//
// Ghi nhận 1 file đã được client upload THẲNG lên Supabase Storage (bucket `eudr-files`, RLS đã
// cho phép authenticated user ghi trực tiếp đúng path nhà máy mình — xem
// 20260819_eudr_storage_bucket_lockdown.sql). Route này KHÔNG nhận file (chỉ JSON nhỏ gọn), nên
// không dính giới hạn body ~4.5MB của Vercel Serverless Function — đây là lý do route này tồn
// tại: `/api/eudr/upload` (multipart, nhận file) bị giới hạn đó chặn với file lớn (vd .rar 8MB),
// còn route này thì không.
//
// Vì route JSON dễ bị gọi trực tiếp (Postman/devtools) hơn multipart (không cần build file
// thật), bắt buộc validate thêm: `path` phải đúng thuộc order này, và file phải THẬT SỰ tồn tại
// trên Storage — không tin tưởng path/size do client tự khai báo.
export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const body = (await req.json().catch(() => null)) as {
      orderId?: string
      path?: string
      name?: string
      size?: number
    } | null

    const orderId = String(body?.orderId || "").trim()
    const path = String(body?.path || "").trim()
    const name = String(body?.name || "").trim()
    const size = typeof body?.size === "number" && Number.isFinite(body.size) ? body.size : undefined

    if (!orderId || !path || !name) {
      return NextResponse.json({ error: "Thieu thong tin dang ky tep dinh kem." }, { status: 400 })
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

    const expectedPrefix = `${sanitizeSegment(order.factory_id)}/${sanitizeSegment(order.ma_don)}/`
    if (!path.startsWith(expectedPrefix)) {
      return NextResponse.json({ error: "Duong dan tep khong hop le cho don hang nay." }, { status: 400 })
    }

    const lastSlash = path.lastIndexOf("/")
    const folder = lastSlash >= 0 ? path.slice(0, lastSlash) : ""
    const fileNameInStorage = lastSlash >= 0 ? path.slice(lastSlash + 1) : path
    const { data: listedFiles, error: listError } = await supabaseAdmin.storage
      .from(EUDR_BUCKET)
      .list(folder, { search: fileNameInStorage })

    if (listError || !listedFiles?.some((f) => f.name === fileNameInStorage)) {
      return NextResponse.json({ error: "Khong tim thay tep da tai len tren Storage." }, { status: 400 })
    }

    const { data: publicData } = supabaseAdmin.storage.from(EUDR_BUCKET).getPublicUrl(path)

    const { file, files } = await appendEudrFileEntry(orderId, {
      name,
      url: publicData.publicUrl,
      path,
      size,
      uploadedBy: authUser.id,
    })

    return NextResponse.json({ file, files })
  } catch (error) {
    if (error instanceof EudrFileOpError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("EUDR register-file failed", error)
    const message = error instanceof Error ? error.message : "Khong ghi nhan duoc tep dinh kem."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
