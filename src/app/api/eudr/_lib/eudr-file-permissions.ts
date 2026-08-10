import { supabaseAdmin } from "@/app/api/account/_lib/security"

// "Đơn hàng đã khóa quản lý tệp đính kèm" khi:
//   - đã phê duyệt (trang_thai !== "cho_phe_duyet" — mirror đúng getExportOrderStatus()
//     ở export/page.tsx, trang_thai rỗng/null mặc định coi là đã phê duyệt), HOẶC
//   - đã được cấp quyền cho ít nhất 1 tài khoản khách hàng (export_order_customer_grants).
// Khi đã khóa, chỉ admin được thêm/xóa/thay tệp đính kèm — người upload gốc (nếu không
// phải admin) cũng không còn quyền đó nữa. Dùng service role để không phụ thuộc RLS của
// export_order_customer_grants (staff không phải người cấp quyền sẽ bị RLS ẩn dòng đó,
// nên client không thể tự tính chính xác trạng thái khóa cho MỌI role — phải qua route này).
export async function isExportOrderLocked(orderId: string, trangThai: string | null | undefined): Promise<boolean> {
  const isApproved = (trangThai || "da_phe_duyet") !== "cho_phe_duyet"
  if (isApproved) return true

  const { count } = await supabaseAdmin
    .from("export_order_customer_grants")
    .select("id", { count: "exact", head: true })
    .eq("export_order_id", orderId)

  return (count || 0) > 0
}

export type EudrOrderFileEntry = {
  name: string
  url: string
  path?: string
  size?: number
  uploadedBy?: string | null
}

export function normalizeEudrFiles(files: unknown): EudrOrderFileEntry[] {
  if (!Array.isArray(files)) return []
  return files.filter((f): f is EudrOrderFileEntry => (
    !!f && typeof f === "object" && typeof (f as EudrOrderFileEntry).name === "string" && typeof (f as EudrOrderFileEntry).url === "string"
  ))
}

// Mirror đúng ngữ nghĩa fetchPermissionCodesForUser() (src/lib/auth.ts): có quyền explicit
// trong user_permissions thì CHỈ dùng đúng tập đó, không cộng thêm role_permissions.
export async function ensureExportViewPermission(userId: string, role: string): Promise<void> {
  if (role === "admin") return

  const { data: explicitRows } = await supabaseAdmin
    .from("user_permissions")
    .select("permission_code")
    .eq("user_id", userId)
    .eq("granted", true)

  let allowed: boolean
  if (explicitRows && explicitRows.length > 0) {
    allowed = explicitRows.some((r) => r.permission_code === "export.view")
  } else {
    const { data: roleRows } = await supabaseAdmin
      .from("role_permissions")
      .select("permission_code")
      .eq("role", role)
      .eq("permission_code", "export.view")
    allowed = (roleRows?.length || 0) > 0
  }

  if (!allowed) {
    throw new Error("Ban khong co quyen thao tac EUDR cua don hang nay.")
  }
}

export type EudrOrderForFileOps = {
  id: string
  factory_id: string
  ma_don: string
  trang_thai: string | null
  files: unknown
}

// Dùng chung cho cả 2 route (attach/remove) — tải đơn qua service role, xác thực đúng
// nhà máy của người gọi, rồi trả kèm trạng thái khóa. Ném lỗi có `status` gắn sẵn để route
// chỉ cần bắt và trả NextResponse tương ứng.
export class EudrFileOpError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function loadOrderForFileOps(orderId: string, profileFactoryId: string | null): Promise<{
  order: EudrOrderForFileOps
  locked: boolean
}> {
  const { data: order, error } = await supabaseAdmin
    .from("export_orders")
    .select("id, factory_id, ma_don, trang_thai, files")
    .eq("id", orderId)
    .single()

  if (error || !order) {
    throw new EudrFileOpError("Khong tim thay don xuat hang.", 404)
  }

  if (!profileFactoryId || order.factory_id !== profileFactoryId) {
    throw new EudrFileOpError("Khong dung nha may thao tac don hang nay.", 403)
  }

  const locked = await isExportOrderLocked(order.id, order.trang_thai)

  return { order: order as EudrOrderForFileOps, locked }
}

export type NewEudrFileInput = {
  name: string
  url: string
  path: string
  size?: number
  uploadedBy: string
}

// Re-read `export_orders.files` mới nhất ngay trước khi ghi (giảm khoảng hở race khi nhiều
// người cùng thao tác) rồi append 1 entry mới. Dùng chung bởi CẢ `/api/eudr/upload` (fallback
// multipart khi client không upload thẳng được) LẪN `/api/eudr/register-file` (đường chính, sau
// khi client đã upload thẳng lên Storage) — không được viết lại logic này ở 2 nơi.
export async function appendEudrFileEntry(
  orderId: string,
  newFileEntry: NewEudrFileInput,
): Promise<{ file: EudrOrderFileEntry; files: EudrOrderFileEntry[] }> {
  const { data: freshOrder, error: freshOrderError } = await supabaseAdmin
    .from("export_orders")
    .select("files")
    .eq("id", orderId)
    .single()

  if (freshOrderError) throw freshOrderError

  const nextFiles = [...normalizeEudrFiles(freshOrder?.files), newFileEntry]

  const { error: updateError } = await supabaseAdmin
    .from("export_orders")
    .update({ files: nextFiles })
    .eq("id", orderId)

  if (updateError) throw updateError

  return { file: newFileEntry, files: nextFiles }
}
