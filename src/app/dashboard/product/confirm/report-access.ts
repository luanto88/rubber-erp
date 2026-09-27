// Guard quyền cho 2 server action dựng dữ liệu báo cáo cuối ngày (KHÔNG phải server action — chỉ
// được import từ actions.ts / daily-report-actions.ts).
//
// Không tin userId do client khai: client gửi access token Supabase, server tự xác thực bằng
// service role rồi tra profile (đúng nhà máy, còn active) + quyền hiệu lực.
//
// Quyền hiệu lực mirror đúng fetchPermissionCodesForUser (src/lib/auth.ts): có bất kỳ dòng
// user_permissions granted=true thì CHỈ dùng tập đó, không cộng role_permissions; admin luôn qua.
import { getSupabaseAdmin } from "@/lib/supabase-admin";

/** Phiếu báo thành phẩm (F09): ai TẠO được thành phẩm (nhập tay hoặc quét QR) thì in được. */
export const REPORT_SHIFT_PERMISSIONS = ["product.create", "product.confirm_scan"];
/** Báo cáo lô (F11) + Báo cáo sản xuất hằng ngày (F12) — nhân viên văn phòng. */
export const REPORT_DAILY_PERMISSIONS = ["product.report_daily"];

export async function assertReportAccess(
  accessToken: string | null | undefined,
  factoryId: string,
  anyOf: string[],
  label: string,
): Promise<void> {
  if (!accessToken) throw new Error("Phiên đăng nhập không hợp lệ, vui lòng tải lại trang.");
  const supabase = getSupabaseAdmin();

  const { data: authData, error: authErr } = await supabase.auth.getUser(accessToken);
  if (authErr || !authData.user) {
    throw new Error("Phiên đăng nhập đã hết hạn, vui lòng tải lại trang.");
  }
  const userId = authData.user.id;

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("role, status, factory_id")
    .eq("id", userId)
    .maybeSingle();
  if (profileErr) throw new Error(profileErr.message);
  if (!profile || profile.status !== "active") throw new Error("Tài khoản không còn hoạt động.");
  if (profile.factory_id !== factoryId) throw new Error("Bạn không thuộc nhà máy này.");
  if (profile.role === "admin") return;

  const { data: direct, error: directErr } = await supabase
    .from("user_permissions")
    .select("permission_code")
    .eq("user_id", userId)
    .eq("granted", true);
  if (directErr) throw new Error(directErr.message);

  let codes = (direct || []).map((r) => r.permission_code as string);
  if (codes.length === 0) {
    const { data: roleRows, error: roleErr } = await supabase
      .from("role_permissions")
      .select("permission_code")
      .eq("role", profile.role);
    if (roleErr) throw new Error(roleErr.message);
    codes = (roleRows || []).map((r) => r.permission_code as string);
  }

  if (!anyOf.some((code) => codes.includes(code))) {
    throw new Error(`Bạn không có quyền xem ${label}.`);
  }
}
