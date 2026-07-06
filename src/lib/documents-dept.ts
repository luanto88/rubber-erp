import type { SupabaseClient } from "@supabase/supabase-js"

// Xác định department code (VD: "NMCB") của 1 profile cho module Văn bản nội bộ.
// 3-way match — cùng nguyên tắc với dept-users/route.ts:
//   1. profile.department_id -> departments.id
//   2. profile.department (tên đầy đủ) -> departments.name
//   3. profile.department (chính là code, không phân biệt hoa/thường) -> departments.code
// Trước đây chỉ có 2 nhánh đầu (dept-code/route.ts và sign/route.ts getUserDeptCode),
// khiến các profile lưu thẳng code (không qua department_id, không khớp tên) không resolve được
// -> canKyBuoc sai, user đúng bước ký nhưng không thấy nút Ký (chỉ thấy Trả về vì có quyền phe_duyet).
export async function resolveUserDeptCode(
  supabaseAdmin: SupabaseClient,
  profile: { department: string | null; department_id: string | null },
): Promise<string | null> {
  if (profile.department_id) {
    const { data } = await supabaseAdmin
      .from("departments")
      .select("code")
      .eq("id", profile.department_id)
      .maybeSingle()
    if (data?.code) return data.code as string
  }

  if (profile.department) {
    const { data: byName } = await supabaseAdmin
      .from("departments")
      .select("code")
      .eq("name", profile.department)
      .maybeSingle()
    if (byName?.code) return byName.code as string

    const deptUpper = profile.department.toUpperCase()
    const { data: byCode } = await supabaseAdmin
      .from("departments")
      .select("code")
      .eq("code", deptUpper)
      .maybeSingle()
    if (byCode?.code) return byCode.code as string
  }

  return null
}
