// Tên ca A/B/C theo ca trưởng, có ngày hiệu lực (GĐ5, 2026-09-29).
//
// Server-only (dùng supabase-admin) — KHÔNG import từ client component. Không đặt "use server" để
// các file server khác gọi thẳng như hàm thường; trang quét QR gọi qua server action
// loadFactoryShiftNames() trong actions.ts.
//
// Nguồn: bảng production_shift_names (mỗi lần đổi ca trưởng = 1 dòng mới với hieu_luc_tu). Tên của
// ngày X = dòng có hieu_luc_tu <= X mới nhất. Ca nào không có dòng — hoặc bảng chưa tồn tại vì
// migration 20261002 chưa chạy — rơi về 3 cột LEGACY factories.ca_*_ten để không gãy khi deploy.

import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const SHIFT_CODES = ["A", "B", "C"] as const;
export type ShiftCode = (typeof SHIFT_CODES)[number];
export type ShiftNames = Record<ShiftCode, string>;

const LEGACY_COLUMNS: Record<ShiftCode, "ca_a_ten" | "ca_b_ten" | "ca_c_ten"> = {
  A: "ca_a_ten",
  B: "ca_b_ten",
  C: "ca_c_ten",
};

type ShiftNameRow = { ca: string; ca_truong: string | null; hieu_luc_tu: string };

// Hàm thuần — chọn tên hiệu lực tại `ngay` từ các dòng lịch sử (không phụ thuộc thứ tự đầu vào).
export function pickShiftNamesAt(rows: ShiftNameRow[], ngay: string): Partial<ShiftNames> {
  const best: Partial<Record<ShiftCode, ShiftNameRow>> = {};
  for (const row of rows) {
    const ca = row.ca as ShiftCode;
    if (!SHIFT_CODES.includes(ca)) continue;
    if (!row.hieu_luc_tu || row.hieu_luc_tu > ngay) continue;
    const name = (row.ca_truong || "").trim();
    if (!name) continue;
    const cur = best[ca];
    if (!cur || row.hieu_luc_tu > cur.hieu_luc_tu) best[ca] = row;
  }
  const out: Partial<ShiftNames> = {};
  for (const ca of SHIFT_CODES) {
    const row = best[ca];
    if (row) out[ca] = (row.ca_truong || "").trim();
  }
  return out;
}

export async function resolveShiftNamesAt(factoryId: string, ngay: string): Promise<ShiftNames> {
  const supabase = getSupabaseAdmin();
  const [historyRes, legacyRes] = await Promise.all([
    supabase
      .from("production_shift_names")
      .select("ca, ca_truong, hieu_luc_tu")
      .eq("factory_id", factoryId)
      .lte("hieu_luc_tu", ngay),
    supabase.from("factories").select("ca_a_ten, ca_b_ten, ca_c_ten").eq("id", factoryId).maybeSingle(),
  ]);
  // Lỗi bảng lịch sử (vd chưa chạy migration) → coi như rỗng, dùng cột cũ.
  const picked = historyRes.error ? {} : pickShiftNamesAt((historyRes.data ?? []) as ShiftNameRow[], ngay);
  const legacy = (legacyRes.data ?? {}) as Partial<Record<(typeof LEGACY_COLUMNS)[ShiftCode], string | null>>;
  const out = {} as ShiftNames;
  for (const ca of SHIFT_CODES) {
    out[ca] = picked[ca] || (legacy[LEGACY_COLUMNS[ca]] || "").trim();
  }
  return out;
}

// "Ca A – Sok Khum" / "Ca A" (không có tên) / "Ca X" (mã lạ, giữ nguyên).
export function formatCaName(ca: string, names: Partial<Record<string, string>>): string {
  const name = (names[ca] || "").trim();
  return name ? `Ca ${ca} – ${name}` : `Ca ${ca}`;
}
