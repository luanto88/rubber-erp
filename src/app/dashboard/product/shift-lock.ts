"use server";

// Guard + query dùng chung cho tính năng "Khóa ca sản xuất Thành phẩm" (product_shift_locks).
// Xem .claude/rules/06-module-production.md mục "Khóa ca sản xuất".
//
// File "use server" — mọi export đều là Server Action, dùng getSupabaseAdmin() (service role,
// bypass RLS). Được gọi theo 2 cách:
//   1. Server-to-server: các file "use server" khác (product/actions.ts, confirm/actions.ts)
//      import và gọi trực tiếp như hàm TS thường (assertShiftNotLocked).
//   2. Client-to-server: page.tsx ("use client") gọi trực tiếp như 1 server action bình thường
//      (loadActiveShiftLocks) — bắt buộc đi qua service role vì cần join profiles để lấy tên
//      người khóa, mà RLS của bảng profiles chặn user thường đọc hồ sơ người khác.
//
// Vì các server action gọi assertShiftNotLocked chạy bằng service role (không có session JWT),
// auth.uid() không có sẵn — bắt buộc thread actorUserId như tham số, tra profiles.role để xác
// định admin thay vì tin thẳng 1 boolean từ client (an toàn hơn 1 bậc, không đổi kiến trúc tổng
// thể). Ngược lại, 2 RPC product_lock_shift/product_unlock_shift được GỌI TRỰC TIẾP TỪ CLIENT
// (không qua file này) vì cần auth.uid() thật để không thể giả mạo actor — xem product/page.tsx.

import { getSupabaseAdmin } from "@/lib/supabase-admin";

export async function assertShiftNotLocked(params: {
  factoryId: string;
  ngaySx: string;
  ca: string;
  actorUserId: string | null | undefined;
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data: lockRow } = await supabase
    .from("product_shift_locks")
    .select("id")
    .eq("factory_id", params.factoryId)
    .eq("ngay_sx", params.ngaySx)
    .eq("ca", params.ca)
    .eq("is_active", true)
    .maybeSingle();
  if (!lockRow) return;

  let isAdmin = false;
  if (params.actorUserId) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", params.actorUserId)
      .maybeSingle();
    isAdmin = profile?.role === "admin";
  }
  if (isAdmin) return;

  throw new Error(
    `Ca sản xuất ${params.ngaySx} - Ca ${params.ca} đã được duyệt & khóa. Liên hệ quản trị viên (module Thành phẩm) để mở khóa trước khi thao tác.`,
  );
}

export type ActiveShiftLock = {
  ngaySx: string;
  ca: string;
  lockedByName: string;
  lockedAt: string;
};

// Toàn bộ khóa đang active của 1 nhà máy — dùng để build lockedShiftKeys ở product/page.tsx
// (icon header Ngày + disable Sửa/Xóa theo ca). Bảng nhỏ, không cần lọc theo khoảng ngày filter.
export async function loadActiveShiftLocks(factoryId: string): Promise<ActiveShiftLock[]> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("product_shift_locks")
    .select("ngay_sx, ca, locked_by, locked_at")
    .eq("factory_id", factoryId)
    .eq("is_active", true);
  if (!data || data.length === 0) return [];

  const userIds = [...new Set(data.map((r) => r.locked_by).filter(Boolean))];
  const { data: profiles } = await supabase.from("profiles").select("id, full_name, username").in("id", userIds);
  const nameMap = new Map((profiles || []).map((p) => [p.id, p.full_name || p.username || "—"]));

  return data.map((r) => ({
    ngaySx: r.ngay_sx,
    ca: r.ca,
    lockedByName: nameMap.get(r.locked_by) || "—",
    lockedAt: r.locked_at,
  }));
}
