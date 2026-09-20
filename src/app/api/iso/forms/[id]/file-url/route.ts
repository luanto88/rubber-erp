import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, assertAccountActive, isSessionExpiredError } from "@/app/api/account/_lib/security"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { mintSignedFileUrl } from "@/lib/secure-file-url"

export const dynamic = "force-dynamic"

// Vá bảo mật 2026-09-20 — mirror `api/iso/documents/[id]/file-url/route.ts` cho module "Thực
// hiện hồ sơ ISO" (`iso_form_instances`). Bucket `iso-documents` dùng chung, sẽ chuyển private.
//
// Khác `iso_documents`: module này KHÔNG có khái niệm `het_hieu_luc`/quyền xem riêng — RLS
// SELECT (`20260908_iso_form_instances_rls_hardening.sql`) và toàn bộ UI hiện hành
// (`iso/forms/page.tsx`, `iso/forms/[id]/page.tsx`) đều KHÔNG có bất kỳ `hasPermission()` nào
// gate việc xem — chỉ cần cùng `factory_id`. Route này giữ đúng phạm vi đó, không tự thêm
// permission mới (sẽ là thay đổi hành vi ngoài phạm vi vá lỗ hổng URL).
//
// `draft_file_url` luôn được ghi đồng bộ vào DB ngay trong `handleUpload()` (không có bước
// "Lưu" tách rời như `iso_documents`) — nên KHÔNG có race condition "vừa upload nhưng DB chưa
// kịp cập nhật" như ở route kia, route này không cần bước "persist trước khi mint".

const BUCKET = "iso-documents"

type InstanceRow = {
  id: string
  factory_id: string
  trang_thai: string
  tieu_de: string
  draft_file_url: string | null
  draft_file_type: string | null
  final_pdf_url: string | null
  final_office_url: string | null
  soan_thao_signed_url: string | null
}

/** Mirror đúng biến `fileUrl` tính trong `iso/forms/[id]/page.tsx`. */
function resolveSourceUrl(inst: InstanceRow): string | null {
  const isEditable = inst.trang_thai === "draft" || inst.trang_thai === "tra_ve"
  if (isEditable) return inst.draft_file_url
  return inst.final_pdf_url || inst.final_office_url || inst.soan_thao_signed_url || inst.draft_file_url
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await requireAuthUser(req)
    await assertAccountActive(authUser.id)

    const admin = getSupabaseAdmin()

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("factory_id")
      .eq("id", authUser.id)
      .maybeSingle()
    if (profileError || !profile?.factory_id) {
      return NextResponse.json({ error: "Tài khoản chưa gắn nhà máy" }, { status: 403 })
    }

    const { id } = await params

    const { data, error } = await admin
      .from("iso_form_instances")
      .select("id, factory_id, trang_thai, tieu_de, draft_file_url, draft_file_type, final_pdf_url, final_office_url, soan_thao_signed_url")
      .eq("id", id)
      .maybeSingle()
    if (error) {
      return NextResponse.json({ error: "Không đọc được hồ sơ" }, { status: 500 })
    }
    const inst = data as InstanceRow | null
    if (!inst) {
      return NextResponse.json({ error: "Không tìm thấy hồ sơ này" }, { status: 404 })
    }
    if (inst.factory_id !== profile.factory_id) {
      return NextResponse.json({ error: "Không có quyền xem hồ sơ này" }, { status: 403 })
    }

    const sourceUrl = resolveSourceUrl(inst)
    if (!sourceUrl) {
      return NextResponse.json({ error: "Hồ sơ chưa có file" }, { status: 404 })
    }

    const downloadName = req.nextUrl.searchParams.get("download") === "1" ? inst.tieu_de || "ho_so" : undefined

    const url = await mintSignedFileUrl(sourceUrl, { bucket: BUCKET, downloadName })
    if (!url) {
      return NextResponse.json({ error: "Không tạo được đường dẫn file — file có thể đã bị xoá khỏi kho lưu trữ" }, { status: 500 })
    }

    return NextResponse.json({ url })
  } catch (err) {
    const status = isSessionExpiredError(err) ? 401 : 500
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status })
  }
}
