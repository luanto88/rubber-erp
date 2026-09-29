// Guard quyền cho 2 server action dựng dữ liệu báo cáo cuối ngày (KHÔNG phải server action — chỉ
// được import từ actions.ts / daily-report-actions.ts).
//
// Không tin userId do client khai: client gửi access token Supabase, server tự xác thực bằng
// service role rồi tra profile (đúng nhà máy, còn active) + quyền hiệu lực.
//
// Quyền hiệu lực mirror đúng fetchPermissionCodesForUser (src/lib/auth.ts): có bất kỳ dòng
// user_permissions granted=true thì CHỈ dùng tập đó, không cộng role_permissions; admin luôn qua.
import { getSupabaseAdmin } from "@/lib/supabase-admin";

/**
 * Phiếu báo thành phẩm (F09): ai TẠO được thành phẩm (nhập tay hoặc quét QR) thì in được; thêm
 * người duyệt & khóa ca (GĐ7b — người khóa ca có thể là người đầu tiên mở F09 để sinh bản cứng).
 */
export const REPORT_SHIFT_PERMISSIONS = ["product.create", "product.confirm_scan", "product.approve_shift"];
/** Báo cáo lô (F11) + Báo cáo sản xuất hằng ngày (F12) — nhân viên văn phòng. */
export const REPORT_DAILY_PERMISSIONS = ["product.report_daily"];

/** Đổi ngăn nguồn của kiện (trang tra cứu nhãn) — người trực ca quét QR. */
export const PRODUCT_SWAP_NGAN_PERMISSIONS = ["product.confirm_scan"];

/** Tạo giao dịch thành phẩm mới (nhập tay hoặc quét QR). */
export const PRODUCT_CREATE_PERMISSIONS = ["product.create", "product.confirm_scan"];

/**
 * Xác thực token và bắt buộc người gọi là admin đang hoạt động, cùng nhà máy. Dùng cho mọi thao tác
 * sửa/xóa giao dịch thành phẩm ĐÃ GỬI (GĐ4: chỉ admin). Trả về userId đã xác thực.
 */
export async function assertProductAdmin(
  accessToken: string | null | undefined,
  factoryId: string,
  action: string,
): Promise<string> {
  const identity = await resolveProductActor(accessToken, factoryId);
  if (!identity.isAdmin) throw new Error(`Chỉ admin được ${action}.`);
  return identity.userId;
}

/** Xác thực token, trả userId + cờ admin (không kiểm quyền cụ thể). */
export async function resolveProductActor(
  accessToken: string | null | undefined,
  factoryId: string,
): Promise<{ userId: string; isAdmin: boolean }> {
  if (!accessToken) throw new Error("Phiên đăng nhập không hợp lệ, vui lòng tải lại trang.");
  const supabase = getSupabaseAdmin();
  const { data: authData, error: authErr } = await supabase.auth.getUser(accessToken);
  if (authErr || !authData.user) throw new Error("Phiên đăng nhập đã hết hạn, vui lòng tải lại trang.");
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("role, status, factory_id")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileErr) throw new Error(profileErr.message);
  if (!profile || profile.status !== "active") throw new Error("Tài khoản không còn hoạt động.");
  if (profile.factory_id !== factoryId) throw new Error("Bạn không thuộc nhà máy này.");
  return { userId: authData.user.id, isAdmin: profile.role === "admin" };
}

export async function assertReportAccess(
  accessToken: string | null | undefined,
  factoryId: string,
  anyOf: string[],
  label: string,
): Promise<void> {
  await assertProductAccess(accessToken, factoryId, anyOf, `xem ${label}`);
}

/**
 * Như assertReportAccess nhưng trả về userId đã xác thực (không tin userId client khai) — dùng
 * cho thao tác GHI cần ghi nhận người thực hiện. `action` là cụm động từ cho câu báo lỗi.
 */
export async function assertProductAccess(
  accessToken: string | null | undefined,
  factoryId: string,
  anyOf: string[],
  action: string,
): Promise<string> {
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
  if (profile.role === "admin") return userId;

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
    throw new Error(`Bạn không có quyền ${action}.`);
  }
  return userId;
}
