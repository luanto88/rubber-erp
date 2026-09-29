// Sổ cái Thay bọc theo TỪNG KIỆN — dùng cho báo cáo F12 (GĐ6b, 2026-09-29).
//
// Vấn đề: RPC perform_sang_kien_thay_boc ghi đè `lot_transactions.boc` tại chỗ, nên giao dịch chỉ còn
// bọc HIỆN TẠI. F12 phải tính nhập theo bọc LÚC SẢN XUẤT và ghi −bọc nguồn / +bọc đích vào đúng ngày
// thao tác Thay bọc (đã chốt với người dùng). Module này dựng lại 2 thứ đó từ `sk_history`:
//   - Bản ghi có `kien_changes` (từ migration 20261004): dùng thẳng — bọc trước khi đổi đọc từ giao dịch.
//   - Bản ghi cũ: `from_boc` lấy theo lots.boc (bản chụp) nên KHÔNG tin được theo kiện (đã gặp bản ghi
//     "nhãn→nhãn" thực tế là trơn→nhãn). Dựng tuần tự theo kiện: trạng thái đầu = source_snapshot.boc
//     của lần thao tác SỚM NHẤT của lô (lô đồng nhất bọc khi sản xuất), mỗi lần: from = trạng thái
//     đang có, to = to_boc; bỏ bước from = to.
// Lưới an toàn: kiện dựng ra trạng thái cuối ≠ bọc giao dịch hiện tại (dữ liệu sửa tay) → bỏ dựng lại
// kiện đó, để F12 giữ cách tính theo bọc hiện tại — tồn theo bọc luôn khớp xuất kho.
//
// Module thuần (không import supabase) để script đối soát dùng lại được.

import { KIEN_KEYS, type KienBoc, type KienKey } from "@/lib/lot-kien-boc";

export type SkKienChange = {
  lot_id?: string;
  kien?: string;
  so_banh?: number | string | null;
  from_boc?: string | null;
  to_boc?: string | null;
};

export type SkHistoryEvent = {
  ngay: string | null;
  created_at: string | null;
  to_boc: string | null;
  lots: Array<{
    id?: string;
    source_snapshot?: { boc?: string | null } | null;
    moved_breakdown?: Partial<Record<KienKey, number>> | null;
    converted?: Partial<Record<KienKey, number>> | null;
  }> | null;
  kien_changes?: SkKienChange[] | null;
};

export type BocTransfer = {
  ngay: string;
  lotId: string;
  kien: KienKey;
  bales: number;
  from: string;
  to: string;
};

export type BocLedger = {
  /** Bọc lúc sản xuất của kiện đã từng Thay bọc (dựng lại hợp lệ). Kiện không có ở đây = bọc hiện tại. */
  prodBoc: Map<string, KienBoc>;
  transfers: BocTransfer[];
  /** Số kiện bị lưới an toàn loại (trạng thái dựng lại ≠ bọc giao dịch hiện tại). */
  skippedKien: Array<{ lotId: string; kien: KienKey; rebuilt: string; current: string }>;
};

const clean = (v: unknown) => String(v ?? "").trim();

type Step = { ngay: string; kien: KienKey; bales: number; from: string | null; to: string };

/**
 * `events` = toàn bộ sk_history Thay bọc của nhà máy (KHÔNG lọc theo ngày báo cáo — lưới an toàn so với
 * bọc hiện tại cần đủ mọi lần thao tác). Người gọi tự bỏ transfer có ngày sau ngày báo cáo.
 * `currentBocsOf(lotId, kien)` = tập bọc hiện tại của MỌI giao dịch chứa kiện (1 kiện có thể nằm ở nhiều
 * giao dịch; admin sửa bọc 1 giao dịch → kiện lẫn 2 bọc). Chỉ dựng lại khi cả tập đúng bằng trạng thái cuối.
 */
export function buildBocLedger(
  events: SkHistoryEvent[],
  currentBocsOf: (lotId: string, kien: KienKey) => string[],
): BocLedger {
  const sorted = [...events].sort(
    (a, b) => clean(a.created_at).localeCompare(clean(b.created_at)) || clean(a.ngay).localeCompare(clean(b.ngay)),
  );
  const stepsByLot = new Map<string, Step[]>();
  const origByLot = new Map<string, string>();
  const push = (lotId: string, s: Step) => stepsByLot.set(lotId, [...(stepsByLot.get(lotId) || []), s]);

  for (const ev of sorted) {
    const ngay = clean(ev.ngay).slice(0, 10);
    if (!ngay) continue;
    if (Array.isArray(ev.kien_changes) && ev.kien_changes.length > 0) {
      for (const c of ev.kien_changes) {
        const lotId = clean(c.lot_id);
        const kien = clean(c.kien).toLowerCase() as KienKey;
        const to = clean(c.to_boc);
        if (!lotId || !KIEN_KEYS.includes(kien) || !to) continue;
        const from = clean(c.from_boc) || null;
        if (from && !origByLot.has(lotId)) origByLot.set(lotId, from);
        push(lotId, { ngay, kien, bales: Number(c.so_banh) || 0, from, to });
      }
      continue;
    }
    const to = clean(ev.to_boc);
    if (!to) continue;
    for (const entry of ev.lots || []) {
      const lotId = clean(entry?.id);
      if (!lotId) continue;
      const src = clean(entry.source_snapshot?.boc);
      if (src && !origByLot.has(lotId)) origByLot.set(lotId, src);
      const moved = entry.moved_breakdown || entry.converted || {};
      for (const kien of KIEN_KEYS) {
        const bales = Number(moved[kien]) || 0;
        if (bales > 0) push(lotId, { ngay, kien, bales, from: null, to });
      }
    }
  }

  const prodBoc = new Map<string, KienBoc>();
  const transfers: BocTransfer[] = [];
  const skippedKien: BocLedger["skippedKien"] = [];

  for (const [lotId, steps] of stepsByLot) {
    const orig = origByLot.get(lotId) || "";
    for (const kien of KIEN_KEYS) {
      const ks = steps.filter((s) => s.kien === kien);
      if (ks.length === 0) continue;
      let state = ks[0].from || orig;
      if (!state) continue;
      const init = state;
      const kienTransfers: BocTransfer[] = [];
      for (const s of ks) {
        // Bản ghi mới có from thật; bản ghi cũ lấy trạng thái đang có.
        const from = s.from || state;
        if (from !== s.to) kienTransfers.push({ ngay: s.ngay, lotId, kien, bales: s.bales, from, to: s.to });
        state = s.to;
      }
      const current = [...new Set(currentBocsOf(lotId, kien).map(clean).filter(Boolean))];
      if (current.length > 0 && (current.length > 1 || current[0] !== state)) {
        skippedKien.push({ lotId, kien, rebuilt: state, current: current.join(" + ") });
        continue;
      }
      const pb = prodBoc.get(lotId) || {};
      pb[kien] = init;
      prodBoc.set(lotId, pb);
      transfers.push(...kienTransfers);
    }
  }

  return { prodBoc, transfers, skippedKien };
}

/** Rút gọn tên bọc cho ghi chú F12: "Bọc nhãn 0,04 VRG CSR10" → "nhãn 0,04". */
export function shortBocLabel(boc: string): string {
  const m = /^Bọc\s+(\S+)\s+([\d,.]+)/i.exec(boc.trim());
  return m ? `${m[1]} ${m[2]}` : boc.trim();
}

/** Tập bọc hiện tại của từng kiện theo mọi giao dịch (rỗng boc → bọc lô). */
export function buildKienBocSets(
  rows: Array<{ lot_id: string; boc?: string | null } & Partial<Record<`kien_${KienKey}`, number | string | null>>>,
  lotBocById?: Map<string, string | null | undefined>,
) {
  const map = new Map<string, Partial<Record<KienKey, Set<string>>>>();
  for (const tx of rows) {
    const boc = clean(tx.boc || lotBocById?.get(tx.lot_id));
    if (!boc) continue;
    const m = map.get(tx.lot_id) || {};
    for (const k of KIEN_KEYS) {
      if ((Number(tx[`kien_${k}`]) || 0) <= 0) continue;
      (m[k] ||= new Set()).add(boc);
    }
    map.set(tx.lot_id, m);
  }
  return (lotId: string, kien: KienKey): string[] => [...(map.get(lotId)?.[kien] || [])];
}
