import { NextRequest, NextResponse } from "next/server"
import { resolveIsoActor, isoActorHasPermission, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { mintSignedFileUrl, parseStorageObjectPath } from "@/lib/secure-file-url"
import { mintFileViewUrl } from "@/lib/file-view-token"
import { loaiTaiLieuLabel } from "@/lib/signing/labels"

export const dynamic = "force-dynamic"

// GET — link mở file ĐÃ KÝ hiện tại (`yeu_cau_ky.file_hien_tai`) của 1 yêu cầu ký, dùng cho các
// cột "Xem file đã ký" ở danh sách nghiệp vụ (Bảo trì, Điều xe...).
// - `?view=1` → link qua `/api/files/view/...` (giữ đúng tên khi lưu từ trình xem PDF).
// - `?download=1` → Signed URL tải về.
// - Không tham số → Signed URL xem inline.
// Tên file: `?name=` (chỉ ảnh hưởng tên hiển thị), mặc định "<loại tài liệu> <mã hồ sơ>".
// Quyền: admin, người ký của yêu cầu, hoặc quyền xem của module.

const BUCKET = "signing-documents"

const MODULE_VIEW_PERMISSION: Record<string, string> = {
  maintenance: "maintenance.view",
  dispatch: "dispatch.view",
  quality: "quality.view",
  purchase: "purchase.view_all",
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveIsoActor(req)
    const { id } = await params
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "Mã yêu cầu ký không hợp lệ" }, { status: 400 })
    }
    const admin = getSupabaseAdmin()
    const { data: yc, error } = await admin
      .from("yeu_cau_ky")
      .select("id, factory_id, modun, loai_tai_lieu, ma_ho_so, file_hien_tai")
      .eq("id", id)
      .maybeSingle()
    if (error) return NextResponse.json({ error: "Không đọc được yêu cầu ký" }, { status: 500 })
    if (!yc || yc.factory_id !== actor.factoryId) {
      return NextResponse.json({ error: "Không tìm thấy yêu cầu ký này" }, { status: 404 })
    }

    let allowed = actor.isAdmin
    if (!allowed) {
      const { data: me } = await admin
        .from("nguoi_ky")
        .select("id")
        .eq("yeu_cau_id", id)
        .eq("user_id", actor.userId)
        .limit(1)
        .maybeSingle()
      allowed = !!me
    }
    if (!allowed) {
      const perm = MODULE_VIEW_PERMISSION[yc.modun as string]
      allowed = !!perm && (await isoActorHasPermission(actor, [perm]))
    }
    if (!allowed) return NextResponse.json({ error: "Bạn không có quyền xem file này" }, { status: 403 })

    if (!yc.file_hien_tai) return NextResponse.json({ error: "Chưa có file ký" }, { status: 404 })

    const rawName = (req.nextUrl.searchParams.get("name") || "").trim().slice(0, 150)
    const fileName = rawName || `${loaiTaiLieuLabel(yc.loai_tai_lieu as string)} ${yc.ma_ho_so || ""}`.trim()
    const sp = req.nextUrl.searchParams

    if (sp.get("view") === "1") {
      const path = parseStorageObjectPath(yc.file_hien_tai as string, BUCKET)
      if (!path) return NextResponse.json({ error: "Đường dẫn file ký không hợp lệ" }, { status: 500 })
      return NextResponse.json({ url: await mintFileViewUrl({ bucket: BUCKET, path, fileName }) })
    }

    const url = await mintSignedFileUrl(yc.file_hien_tai as string, {
      bucket: BUCKET,
      downloadName: sp.get("download") === "1" ? fileName : undefined,
    })
    if (!url) return NextResponse.json({ error: "Không tạo được đường dẫn file" }, { status: 500 })
    return NextResponse.json({ url })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) })
  }
}
