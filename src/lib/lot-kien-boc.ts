// Bọc theo TỪNG KIỆN của lô thành phẩm.
//
// Sau "Thay bọc tròn kiện" (2026-09-28) một lô có thể có kiện khác bọc — `lots.boc` chỉ là bản chụp của
// giao dịch cuối, KHÔNG dùng để biết bọc của từng kiện. Nguồn đúng là `lot_transactions.boc` của giao
// dịch chứa kiện đó. Module thuần (không import supabase) để dùng chung cho màn Xuất hàng (client) và
// báo cáo F12 (server). Script .mjs trong scripts/ chép lại đúng logic này.

export const KIEN_KEYS = ["a", "b", "c", "d"] as const;
export type KienKey = (typeof KIEN_KEYS)[number];
export type KienBoc = Partial<Record<KienKey, string>>;

export type KienTxRow = {
  lot_id: string;
  boc?: string | null;
  kien_a?: number | string | null;
  kien_b?: number | string | null;
  kien_c?: number | string | null;
  kien_d?: number | string | null;
};

/**
 * Ghi bọc của 1 giao dịch vào map: mọi kiện có bành trong giao dịch nhận bọc giao dịch (rỗng thì dùng
 * `fallbackBoc`). Gọi theo thứ tự thời gian tăng dần — giao dịch sau ghi đè giao dịch trước.
 */
export function applyTxToKienBoc(map: Map<string, KienBoc>, tx: KienTxRow, fallbackBoc?: string | null) {
  const boc = String(tx.boc || fallbackBoc || "").trim();
  if (!boc) return;
  const kb = map.get(tx.lot_id) || {};
  for (const k of KIEN_KEYS) if ((Number(tx[`kien_${k}`]) || 0) > 0) kb[k] = boc;
  map.set(tx.lot_id, kb);
}

/** `rows` phải xếp tăng dần theo thời gian. `lotBocById` là bọc dự phòng khi giao dịch không ghi bọc. */
export function buildLotKienBocMap(rows: KienTxRow[], lotBocById?: Map<string, string | null | undefined>) {
  const map = new Map<string, KienBoc>();
  for (const tx of rows) applyTxToKienBoc(map, tx, lotBocById?.get(tx.lot_id));
  return map;
}

/** Bọc của 1 kiện: theo giao dịch, không có thì theo bản chụp của lô. */
export function kienBocOf(map: Map<string, KienBoc>, lotId: string, kien: KienKey, lotBoc?: string | null) {
  return (map.get(lotId)?.[kien] ?? lotBoc ?? "").trim();
}
