import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, assertAccountActive, isSessionExpiredError } from "@/app/api/account/_lib/security"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { parseStorageObjectPath } from "@/lib/secure-file-url"
import { computeIntegrityHash } from "@/lib/signing/hash"

export const dynamic = "force-dynamic"

// Vá bảo mật 2026-09-20 — thay cho việc `IsoFormVerifyModal` tự `fetch(pdfUrl)` file (vài MB)
// về trình duyệt chỉ để tính SHA-256 rồi vứt đi. Route này tải object TRỰC TIẾP bằng service
// role (không qua Signed URL, không qua mạng công cộng) và trả thẳng mã băm — vừa vá được lỗ
// hổng URL public, vừa đỡ tốn băng thông hơn phương án mint-signed-url-rồi-fetch-lại.
//
// Ưu tiên nguồn PDF GIỐNG HỆT `IsoFormVerifyModal`'s `pdfUrl` (KHÔNG dùng chung
// `resolveSourceUrl` của route `file-url` — mục đích khác nhau: modal xác thực luôn muốn nghệ
// thuật phẩm đã ký MỚI NHẤT, không quan tâm hồ sơ có đang "editable" hay không).

const BUCKET = "iso-documents"

type InstanceRow = {
  id: string
  factory_id: string
  final_pdf_url: string | null
  soan_thao_signed_url: string | null
  draft_file_url: string | null
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
      .select("id, factory_id, final_pdf_url, soan_thao_signed_url, draft_file_url")
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

    const sourceUrl = inst.final_pdf_url || inst.soan_thao_signed_url || inst.draft_file_url
    if (!sourceUrl) {
      return NextResponse.json({ error: "Hồ sơ chưa có tệp PDF để tính mã băm" }, { status: 404 })
    }

    const path = parseStorageObjectPath(sourceUrl, BUCKET)
    if (!path) {
      return NextResponse.json({ error: "Không xác định được vị trí tệp trong kho lưu trữ" }, { status: 500 })
    }

    const { data: fileBlob, error: downloadError } = await admin.storage.from(BUCKET).download(path)
    if (downloadError || !fileBlob) {
      return NextResponse.json({ error: "Không tải được tệp để tính mã băm" }, { status: 500 })
    }

    const bytes = Buffer.from(await fileBlob.arrayBuffer())
    const hash = computeIntegrityHash(bytes)

    return NextResponse.json({ hash })
  } catch (err) {
    const status = isSessionExpiredError(err) ? 401 : 500
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status })
  }
}
