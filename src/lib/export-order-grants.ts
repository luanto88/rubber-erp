"use client"

import { supabase } from "@/lib/supabase"
import { forceRefreshAuthSession, getFreshAuthSession } from "@/lib/auth"

// Cấp quyền xem 1 đơn xuất hàng cụ thể (không phải toàn bộ theo customer_id) cho 1 tài
// khoản role="customer". Mirror đúng pattern của operation_note_shares (xem
// src/lib/operation-notes.ts) — RLS của export_order_customer_grants tự xác thực actor
// là admin cùng factory qua auth.uid(), không tin dữ liệu client gửi lên.
// Xem migration: supabase/migrations/20260708_customer_portal_export_grants.sql

// Supabase JS (PostgREST) ném lỗi dạng plain object { message, code, details, hint... },
// KHÔNG phải instance của `Error` — dùng hàm này ở catch block để luôn thấy đúng lỗi thật
// (vd vi phạm RLS, chưa chạy migration) thay vì rơi vào fallback chung chung.
export function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message?: unknown }).message
    if (typeof msg === "string" && msg) return msg
  }
  return fallback
}

export type GrantCandidate = { id: string; name: string }

export type ExportOrderGrant = {
  id: string
  export_order_id: string
  granted_to_user_id: string
  granted_by: string | null
  created_at: string
}

// Danh sách tài khoản role=customer trong nhà máy — phải qua API route server-side vì
// RLS của bảng `profiles` không cho user thường đọc toàn bộ profiles trong factory.
// Route đích bắt buộc requireAuthUser() (xem api/export/customer-grant-candidates/route.ts)
// nên PHẢI đính kèm Authorization Bearer token, nếu không sẽ luôn nhận lỗi
// "Phiên đăng nhập không hợp lệ" dù admin đang đăng nhập hợp lệ.
//
// Dùng getFreshAuthSession() (biên độ refresh 300s, xem src/lib/auth.ts) thay vì
// supabase.auth.getSession() thô (biên độ refresh mặc định của SDK chỉ 90s) — nếu vẫn bị server
// từ chối với code "session_expired" (token hết hạn thật giữa lúc gửi request), retry đúng 1 lần
// bằng forceRefreshAuthSession() (ép refresh, bỏ qua check "còn hạn hay chưa"), mirror đúng
// pattern retry-once đã dùng ổn định ở settings/page.tsx.
async function requestGrantCandidates(factoryId: string, token: string) {
  const res = await fetch(`/api/export/customer-grant-candidates?factoryId=${encodeURIComponent(factoryId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const json = (await res.json().catch(() => null)) as { users?: GrantCandidate[]; error?: string; code?: string } | null
  return { res, json }
}

export async function fetchGrantCandidates(factoryId: string): Promise<GrantCandidate[]> {
  const session = await getFreshAuthSession()
  let token = session?.access_token || ""
  let { res, json } = await requestGrantCandidates(factoryId, token)

  if (!res.ok && json?.code === "session_expired") {
    const freshSession = await forceRefreshAuthSession()
    token = freshSession?.access_token || ""
    ;({ res, json } = await requestGrantCandidates(factoryId, token))
  }

  if (!res.ok) throw new Error(json?.error || "Không tải được danh sách khách hàng.")
  return json?.users || []
}

export async function fetchExportOrderGrants(orderId: string): Promise<ExportOrderGrant[]> {
  const { data, error } = await supabase
    .from("export_order_customer_grants")
    .select("id, export_order_id, granted_to_user_id, granted_by, created_at")
    .eq("export_order_id", orderId)
  if (error) throw error
  return (data || []) as ExportOrderGrant[]
}

// Đặt lại đúng danh sách khách hàng được cấp quyền cho 1 đơn xuất hàng (thêm người mới,
// gỡ người bị bỏ chọn). Đi qua client Supabase bình thường — RLS tự xác thực actor thật
// sự là admin cùng factory, không dùng service role ở đây.
export async function setExportOrderGrants(input: {
  orderId: string
  factoryId: string
  actorId: string
  recipientUserIds: string[]
}) {
  const current = await fetchExportOrderGrants(input.orderId)
  const currentIds = new Set(current.map((g) => g.granted_to_user_id))
  const nextIds = new Set(input.recipientUserIds)

  const toAdd = input.recipientUserIds.filter((id) => !currentIds.has(id))
  const toRemove = current.filter((g) => !nextIds.has(g.granted_to_user_id))

  if (toAdd.length) {
    const { error } = await supabase.from("export_order_customer_grants").insert(
      toAdd.map((uid) => ({
        export_order_id: input.orderId,
        factory_id: input.factoryId,
        granted_to_user_id: uid,
        granted_by: input.actorId,
      })),
    )
    if (error) throw error
  }

  if (toRemove.length) {
    const { error } = await supabase
      .from("export_order_customer_grants")
      .delete()
      .in("id", toRemove.map((g) => g.id))
    if (error) throw error
  }
}
