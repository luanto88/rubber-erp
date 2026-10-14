import { NextRequest, NextResponse } from "next/server"
import { resolveIsoActor, isoActorHasPermission, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { mintSignedFileUrl, parseStorageObjectPath } from "@/lib/secure-file-url"
import { mintFileViewUrl } from "@/lib/file-view-token"

export const dynamic = "force-dynamic"

// GET — Signed URL ngắn hạn cho file ĐÃ KÝ hiện tại của 1 biên bản bảo trì (U1b, khung xem PDF
// nhúng ở trang chi tiết). Mirror `api/documents/[id]/file-url`: xác thực người gọi, đúng nhà máy,
// quyền `maintenance.view`, rồi mới mint URL. Nguồn file = `yeu_cau_ky.file_hien_tai` của yêu cầu
// ký còn hiệu lực mới nhất (đang luân chuyển hoặc hoàn tất). Chưa có yêu cầu ký → 404.
// `?download=1` → trình duyệt tải về thay vì mở xem.
// `?view=1` → link xem qua route app (`/api/files/view/...`) để trình xem PDF lưu ra đúng tên
// "Biên bản {ma_bb}.pdf" thay vì tên object "v4.pdf". DocViewer vẫn dùng Signed URL (không `view`).

const BUCKET = "signing-documents"

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await resolveIsoActor(req)
    if (!actor.isAdmin && !(await isoActorHasPermission(actor, ["maintenance.view"]))) {
      return NextResponse.json({ error: "Bạn không có quyền xem biên bản bảo trì" }, { status: 403 })
    }
    const { id } = await params
    // id đi vào chuỗi filter `.or(...)` của PostgREST — chỉ nhận UUID.
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "Mã biên bản không hợp lệ" }, { status: 400 })
    }
    const admin = getSupabaseAdmin()

    const { data: record, error: recErr } = await admin
      .from("maintenance_records")
      .select("id, factory_id, ma_bb")
      .eq("id", id)
      .maybeSingle()
    if (recErr) return NextResponse.json({ error: "Không đọc được biên bản" }, { status: 500 })
    if (!record || record.factory_id !== actor.factoryId) {
      return NextResponse.json({ error: "Không tìm thấy biên bản này" }, { status: 404 })
    }

    const { data: yeuCau, error: ycErr } = await admin
      .from("yeu_cau_ky")
      .select("file_hien_tai")
      .eq("factory_id", actor.factoryId)
      .eq("modun", "maintenance")
      .or(`ban_ghi_id.eq.${id},ma_ho_so.eq.${id}`)
      .in("trang_thai", ["dang_luan_chuyen", "hoan_tat"])
      .order("tao_luc", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (ycErr) return NextResponse.json({ error: "Không đọc được yêu cầu ký" }, { status: 500 })
    if (!yeuCau?.file_hien_tai) {
      return NextResponse.json({ error: "Biên bản chưa có file ký" }, { status: 404 })
    }

    if (req.nextUrl.searchParams.get("view") === "1") {
      const path = parseStorageObjectPath(yeuCau.file_hien_tai as string, BUCKET)
      if (!path) return NextResponse.json({ error: "Đường dẫn file ký không hợp lệ" }, { status: 500 })
      const url = await mintFileViewUrl({ bucket: BUCKET, path, fileName: `Biên bản ${record.ma_bb || id}` })
      return NextResponse.json({ url })
    }

    const downloadName = req.nextUrl.searchParams.get("download") === "1"
      ? `Biên bản ${record.ma_bb || id}`
      : undefined
    const url = await mintSignedFileUrl(yeuCau.file_hien_tai as string, { bucket: BUCKET, downloadName })
    if (!url) {
      return NextResponse.json({ error: "Không tạo được đường dẫn file — file có thể đã bị xoá khỏi kho lưu trữ" }, { status: 500 })
    }
    return NextResponse.json({ url })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) })
  }
}
