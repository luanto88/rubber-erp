"use client"

import { supabase } from "@/lib/supabase"
import type { SessionUser } from "@/lib/auth"

// Nhận diện "Ban giám đốc" theo chức danh trong maintenance_staff.chuc_vu_chinh_quyen — không
// tạo permission code riêng. Dùng so khớp CHỨA chuỗi con "giam doc" (đã chuẩn hóa bỏ dấu), không
// đòi hỏi hậu tố "nhà máy" — dữ liệu thật của nhà máy lưu "Giám đốc"/"Phó giám đốc" không có hậu
// tố đó, exact-match Set cũ luôn fail cho user thường (đã xác nhận qua dữ liệu thật 2 tài khoản
// cchok94/luanto, chỉ role=admin mới qua được nhánh khác).
const APPROVER_TITLE_KEYWORD = "giam doc"

function normalizeText(value?: string | null) {
  return (value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    // "đ" không phải ký tự có dấu kèm base letter trong Unicode (khác "ố"/"ế"...) nên NFD +
    // strip-diacritic ở trên không xử lý được nó — phải thay thủ công, mirror đúng cách
    // sanitizeStorageFileName() (src/app/dashboard/documents/_components/documents-types.ts) đã
    // làm cho đúng vấn đề này. Thiếu bước này khiến "Giám đốc" chuẩn hóa thành "giam đoc" (còn đ),
    // không khớp được với keyword "giam doc" (d thường) — đây là nguyên nhân thật khiến nút Phê
    // duyệt không hiện cho tài khoản Phó giám đốc dù dữ liệu chức vụ đã đúng.
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .trim()
    .toLowerCase()
}

type MaintenanceStaffApproverRow = { ten: string | null; chuc_vu_chinh_quyen: string | null }

export async function resolveCanApproveInventory(
  factoryId: string,
  user: Pick<SessionUser, "id" | "role" | "full_name"> | null,
): Promise<boolean> {
  if (!user) return false
  if (user.role === "admin") return true
  if (!user.id) return false

  const fullName = user.full_name?.trim() || ""
  const [staffByProfileRes, staffByNameRes] = await Promise.all([
    supabase
      .from("maintenance_staff")
      .select("ten,chuc_vu_chinh_quyen")
      .eq("factory_id", factoryId)
      .eq("active", true)
      .eq("profile_id", user.id)
      .maybeSingle(),
    fullName
      ? supabase
          .from("maintenance_staff")
          .select("ten,chuc_vu_chinh_quyen")
          .eq("factory_id", factoryId)
          .eq("active", true)
          .eq("ten", fullName)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  const staffRow =
    (staffByProfileRes.data as MaintenanceStaffApproverRow | null) ||
    (staffByNameRes.data as MaintenanceStaffApproverRow | null)

  return normalizeText(staffRow?.chuc_vu_chinh_quyen).includes(APPROVER_TITLE_KEYWORD)
}
