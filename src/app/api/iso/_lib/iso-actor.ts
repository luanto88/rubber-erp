import type { NextRequest } from "next/server"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"

export type IsoActor = {
  userId: string
  factoryId: string
  role: string
  isAdmin: boolean
}

/**
 * Xác thực người gọi route ISO từ Bearer token, và lấy `factory_id` từ hồ sơ của CHÍNH họ —
 * không bao giờ tin `factoryId`/`userId` do client gửi lên. Tài khoản không `active` bị từ chối.
 */
export async function resolveIsoActor(req: NextRequest): Promise<IsoActor> {
  const user = await requireAuthUser(req)
  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .select("factory_id, role, status")
    .eq("id", user.id)
    .single()
  if (error || !profile) throw new IsoAuthError("Không tìm thấy hồ sơ người dùng", 403)
  if (profile.status !== "active") throw new IsoAuthError("Tài khoản không hoạt động", 403)
  if (!profile.factory_id) throw new IsoAuthError("Tài khoản chưa được gán nhà máy", 403)
  const role = (profile.role as string) || ""
  return { userId: user.id, factoryId: profile.factory_id as string, role, isAdmin: role === "admin" }
}

/**
 * Quyền hiệu lực của người dùng — mirror ĐÚNG `fetchPermissionCodesForUser()` (src/lib/auth.ts):
 * có bất kỳ quyền cấp tường minh (`granted = true`) thì CHỈ dùng tập đó, ngược lại dùng
 * `role_permissions` theo vai trò. Admin luôn qua.
 */
export async function isoActorHasPermission(actor: IsoActor, codes: string[]): Promise<boolean> {
  if (actor.isAdmin) return true
  const { data: direct } = await supabaseAdmin
    .from("user_permissions")
    .select("permission_code")
    .eq("user_id", actor.userId)
    .eq("granted", true)
  const directCodes = (direct || []).map((r) => r.permission_code as string)
  if (directCodes.length > 0) return directCodes.some((c) => codes.includes(c))
  if (!actor.role) return false
  const { data: roleRows } = await supabaseAdmin
    .from("role_permissions")
    .select("permission_code")
    .eq("role", actor.role)
    .in("permission_code", codes)
  return (roleRows?.length || 0) > 0
}

export class IsoAuthError extends Error {
  constructor(message: string, public status: number) {
    super(message)
    this.name = "IsoAuthError"
  }
}

/** Mã HTTP cho lỗi xác thực: 401 khi phiên hỏng, mã riêng cho IsoAuthError, còn lại 500. */
export function isoAuthErrorStatus(err: unknown): number {
  if (err instanceof IsoAuthError) return err.status
  if (err instanceof Error && (err.name === "SessionExpiredError" || err.message === "Phiên đăng nhập không hợp lệ")) {
    return 401
  }
  return 500
}
