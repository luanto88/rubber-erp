import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, assertAccountActive, isSessionExpiredError } from "@/app/api/account/_lib/security"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { mintSignedFileUrl } from "@/lib/secure-file-url"

export const dynamic = "force-dynamic"

// Vá bảo mật 2026-09-20 — mirror `api/iso/documents/[id]/file-url/route.ts` cho module Văn bản
// nội bộ (`van_ban_documents`). Bảng này dùng CHUNG bucket `iso-documents` (không phải bucket
// riêng) nên tự động bị ảnh hưởng khi bucket chuyển private — route này thay thế mọi nơi client
// từng đọc thẳng `file_*_url` (URL public) rồi render `<a href>`/`window.open`.
//
// Quyền xem PHẢI mirror đúng 2 lớp đang thực thi thật (không suy đoán, đã đọc trực tiếp
// `supabase/migrations/20260914_van_ban_che_do_xem.sql` + `api/documents/search/route.ts`):
//   1. RLS SELECT của `van_ban_documents` (nguồn sự thật): factory khớp, và
//      `che_do_xem <> 'gioi_han'` HOẶC là người soạn thảo/phê duyệt/tạo/admin HOẶC
//      `van_ban_is_participant()` (SECURITY DEFINER — gọi qua RPC, KHÔNG tự viết lại logic
//      quét `thu_tu_ky_json` bằng tay, tránh trôi lệch với hàm SQL).
//   2. Quyền app-level `documents.view` — không nằm trong RLS, chỉ có ở tầng ứng dụng (mirror
//      `search/route.ts` dòng ~42-64).
//
// ⚠️ CỐ Ý KHÔNG áp thêm điều kiện "cùng phòng ban" mà `search/route.ts` dùng cho văn bản
// `cong_khai` — điều kiện đó chỉ là narrowing UX riêng cho kết quả tìm kiếm AI (giữ kết quả liên
// quan phòng ban), KHÔNG phải ranh giới bảo mật: RLS SELECT thật cho `cong_khai` chỉ đòi factory
// khớp. Thêm điều kiện phòng ban vào đây sẽ chặn nhầm người xem văn bản công khai hợp lệ.

const BUCKET = "iso-documents"

type DocRow = {
  id: string
  factory_id: string
  che_do_xem: string
  ten_van_ban: string
  ma_van_ban: string | null
  created_by: string | null
  soan_thao_user_id: string | null
  phe_duyet_user_id: string | null
  file_goc_url: string | null
  file_signed_pdf_url: string | null
  file_signed_office_url: string | null
}

/** Mirror `fetchPermissionCodesForUser()` (src/lib/auth.ts) bằng service role — không import
 * trực tiếp vì module đó kéo theo Supabase browser client. */
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

    const { data, error } = await admin
      .from("van_ban_documents")
      .select("id, factory_id, che_do_xem, ten_van_ban, ma_van_ban, created_by, soan_thao_user_id, phe_duyet_user_id, file_goc_url, file_signed_pdf_url, file_signed_office_url")
      .eq("id", id)
      .maybeSingle()
    if (error) {
      return NextResponse.json({ error: "Không đọc được văn bản" }, { status: 500 })
    }
    const doc = data as DocRow | null
    if (!doc) {
      return NextResponse.json({ error: "Không tìm thấy văn bản này" }, { status: 404 })
    }
    if (doc.factory_id !== profile.factory_id) {
      return NextResponse.json({ error: "Không có quyền xem văn bản này" }, { status: 403 })
    }

    const isAdmin = profile.role === "admin"
    const permCodes = isAdmin ? new Set<string>() : await fetchPermissionCodesServerSide(admin, authUser.id, profile.role)
    if (!isAdmin && !permCodes.has("documents.view")) {
      return NextResponse.json({ error: "Bạn không có quyền xem văn bản nội bộ" }, { status: 403 })
    }

    if (doc.che_do_xem === "gioi_han" && !isAdmin) {
      const isDirectOwner =
        doc.created_by === authUser.id ||
        doc.soan_thao_user_id === authUser.id ||
        doc.phe_duyet_user_id === authUser.id
      let allowed = isDirectOwner
      if (!allowed) {
        const { data: ok } = await admin.rpc("van_ban_is_participant", { p_doc_id: id, p_user_id: authUser.id })
        allowed = ok === true
      }
      if (!allowed) {
        return NextResponse.json(
          { error: "Văn bản này ở chế độ giới hạn — bạn không thuộc danh sách được xem" },
          { status: 403 },
        )
      }
    }

    const sourceUrl = doc.file_signed_pdf_url || doc.file_signed_office_url || doc.file_goc_url
    if (!sourceUrl) {
      return NextResponse.json({ error: "Văn bản chưa có file" }, { status: 404 })
    }

    const downloadName = req.nextUrl.searchParams.get("download") === "1"
      ? (doc.ma_van_ban ? `${doc.ma_van_ban} ${doc.ten_van_ban}` : doc.ten_van_ban)
      : undefined

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
