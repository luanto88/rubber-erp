import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, assertAccountActive, isSessionExpiredError } from "@/app/api/account/_lib/security"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { mintSignedFileUrl } from "@/lib/secure-file-url"

export const dynamic = "force-dynamic"

// Vá bảo mật 2026-09-20 — thay thế đọc thẳng cột file_*_url (URL public thật trên bucket
// `iso-documents`) từ client. Route này xác thực + kiểm tra đúng quyền xem TRƯỚC khi mint 1
// Signed URL sống ngắn hạn (xem src/lib/secure-file-url.ts). Bucket cần chuyển private (migration
// 20260921_iso_documents_bucket_private.sql) để việc này có ý nghĩa thật — trong lúc bucket còn
// public thì route này chỉ là lớp phòng vệ thêm, chưa chặn được ai biết URL cũ.
//
// ⚠️ KHÔNG import canOpenIsoFile()/@lib/auth vào đây — 2 module đó kéo theo Supabase BROWSER
// client (window/localStorage), không nên nạp vào runtime server (đúng cảnh báo đã ghi sẵn ở
// đầu file src/app/dashboard/iso/_components/iso-file-access.ts, lý do finalize/route.ts từng
// phải tách iso-types.ts riêng chính vì việc này). Vì vậy REPLICATE lại chính xác 2 thuật toán
// đó bằng service role ở dưới — sửa `canOpenIsoFile`/`fetchPermissionCodesForUser` thì phải sửa
// đồng bộ ở đây.

const BUCKET = "iso-documents"

const DOC_COLS = [
  "id",
  "factory_id",
  "trang_thai",
  "ma_tai_lieu",
  "ten_tai_lieu",
  "created_by",
  "soan_thao_user_id",
  "xem_xet_user_id",
  "phe_duyet_user_id",
  "file_goc_url",
  "file_signed_pdf_url",
  "file_signed_office_url",
  "file_phieu_yeu_cau_thay_doi_url",
  "file_phieu_yeu_cau_thay_doi_signed_url",
  "file_de_nghi_soat_xet_url",
  "file_de_nghi_soat_xet_signed_url",
].join(", ")

type DocRow = {
  id: string
  factory_id: string
  trang_thai: string
  ma_tai_lieu: string | null
  ten_tai_lieu: string
  created_by: string | null
  soan_thao_user_id: string | null
  xem_xet_user_id: string | null
  phe_duyet_user_id: string | null
  file_goc_url: string | null
  file_signed_pdf_url: string | null
  file_signed_office_url: string | null
  file_phieu_yeu_cau_thay_doi_url: string | null
  file_phieu_yeu_cau_thay_doi_signed_url: string | null
  file_de_nghi_soat_xet_url: string | null
  file_de_nghi_soat_xet_signed_url: string | null
}

type Variant = "main" | "change_request" | "review_request"

function resolveSourceUrl(doc: DocRow, variant: Variant): string | null {
  switch (variant) {
    case "main":
      return doc.file_signed_pdf_url || doc.file_signed_office_url || doc.file_goc_url
    case "change_request":
      return doc.file_phieu_yeu_cau_thay_doi_signed_url || doc.file_phieu_yeu_cau_thay_doi_url
    case "review_request":
      return doc.file_de_nghi_soat_xet_signed_url || doc.file_de_nghi_soat_xet_url
    default:
      return null
  }
}

/** Mirror `fetchPermissionCodesForUser()` (src/lib/auth.ts) bằng service role — xem cảnh báo ở đầu file. */
async function fetchPermissionCodesServerSide(
  admin: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
  role: string,
): Promise<Set<string>> {
  const codes = new Set<string>()

  const { data: directRows, error: directErr } = await admin
    .from("user_permissions")
    .select("permission_code")
    .eq("user_id", userId)
    .eq("granted", true)
  if (directErr) throw directErr
  for (const row of directRows || []) {
    if (row.permission_code) codes.add(row.permission_code as string)
  }
  if (codes.size > 0) return codes

  const { data: roleRows, error: roleErr } = await admin
    .from("role_permissions")
    .select("permission_code")
    .eq("role", role)
  if (roleErr) throw roleErr
  for (const row of roleRows || []) {
    if (row.permission_code) codes.add(row.permission_code as string)
  }
  return codes
}

/** Mirror `canOpenIsoFile()` (iso-file-access.ts) — xem cảnh báo ở đầu file. */
function canOpenFile(doc: DocRow, isAdmin: boolean, hasExpiredPermission: boolean, currentUserId: string): boolean {
  if (doc.trang_thai !== "het_hieu_luc") return true
  if (isAdmin || hasExpiredPermission) return true
  return (
    doc.created_by === currentUserId ||
    doc.soan_thao_user_id === currentUserId ||
    doc.xem_xet_user_id === currentUserId ||
    doc.phe_duyet_user_id === currentUserId
  )
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authUser = await requireAuthUser(req)
    await assertAccountActive(authUser.id)

    const admin = getSupabaseAdmin()

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("factory_id, role")
      .eq("id", authUser.id)
      .maybeSingle()
    if (profileError || !profile?.factory_id) {
      return NextResponse.json({ error: "Tài khoản chưa gắn nhà máy" }, { status: 403 })
    }

    const { id } = await params
    const variantParam = req.nextUrl.searchParams.get("variant") || "main"
    if (variantParam !== "main" && variantParam !== "change_request" && variantParam !== "review_request") {
      return NextResponse.json({ error: "variant không hợp lệ" }, { status: 400 })
    }
    const variant = variantParam as Variant

    const { data, error } = await admin.from("iso_documents").select(DOC_COLS).eq("id", id).maybeSingle()
    if (error) {
      return NextResponse.json({ error: "Không đọc được tài liệu" }, { status: 500 })
    }
    const doc = data as DocRow | null
    if (!doc) {
      return NextResponse.json({ error: "Không tìm thấy tài liệu này" }, { status: 404 })
    }
    if (doc.factory_id !== profile.factory_id) {
      return NextResponse.json({ error: "Không có quyền xem tài liệu này" }, { status: 403 })
    }

    const isAdmin = profile.role === "admin"
    const permCodes = isAdmin ? new Set<string>() : await fetchPermissionCodesServerSide(admin, authUser.id, profile.role)

    if (!isAdmin && !permCodes.has("iso.view")) {
      return NextResponse.json({ error: "Bạn không có quyền xem tài liệu ISO" }, { status: 403 })
    }

    const hasExpiredPermission = isAdmin || permCodes.has("iso.view_het_hieu_luc")
    if (!canOpenFile(doc, isAdmin, hasExpiredPermission, authUser.id)) {
      return NextResponse.json(
        { error: 'Tài liệu đã hết hiệu lực — cần quyền "Xem file bản hết hiệu lực" mới mở/tải được' },
        { status: 403 },
      )
    }

    const sourceUrl = resolveSourceUrl(doc, variant)
    if (!sourceUrl) {
      return NextResponse.json({ error: "Tài liệu chưa có file" }, { status: 404 })
    }

    const downloadName = req.nextUrl.searchParams.get("download") === "1" ? doc.ma_tai_lieu || doc.ten_tai_lieu : undefined

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
