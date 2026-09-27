"use server";

// Dữ liệu cho "Báo cáo sản xuất hằng ngày" (NMCB-QT01-F12) — đi kèm Báo cáo lô sản xuất (F11).
// Bám `cung_cap_dl/NMCB-QT01-F12 Báo cáo sản xuất hàng ngày.pdf`:
//   Mục 1 — thành phẩm theo (Loại CSR + Nguồn gốc + Bọc + Loại bành): nhập/xuất/tồn + lũy kế.
//   Mục 2 — khối lượng sản xuất từng ca (tách CSR + loại bành, KHÔNG tách bọc vì đơn giá công nhân
//           chỉ phụ thuộc CSR + bành) + dòng dầu Diesel (gợi ý từ xuất kho DO750K).
// Quyết định đã chốt với người dùng (2026-09-27):
//   - Mục 1 liệt kê mọi tổ hợp có nhập/xuất trong năm hoặc còn tồn; đã xuất hết vẫn hiện, tồn = 0.
//   - Xuất kho = đơn xuất ĐÃ PHÊ DUYỆT (NULL coi như đã duyệt, khớp getExportOrderStatus), theo
//     export_orders.ngay.
//   - Lũy kế dòng ca theo mã ca (A/B/C) + CSR + loại bành.
//   - Dầu DO không lưu DB: loader chỉ trả gợi ý hôm nay + lũy kế các NGÀY TRƯỚC; UI cộng số nhập.
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  assertReportAccess,
  REPORT_DAILY_PERMISSIONS,
} from "@/app/dashboard/product/confirm/report-access";

export type DailyStockRow = {
  loaiCsr: string;
  nguonGoc: string;
  boc: string;
  loaiBanh: number;
  nhapBanh: number; // trong ngày
  nhapKg: number; // trong ngày
  nhapThangKg: number;
  nhapNamKg: number;
  xuatKg: number; // trong ngày
  xuatThangKg: number;
  xuatNamKg: number;
  tonKg: number; // mọi thời điểm tới hết ngày báo cáo, không âm
};

export type DailyShiftRow = {
  ca: string;
  caLabel: string; // "Ca 1", "Ca 2"... theo thứ tự thực tế trong ngày
  loaiCsr: string;
  loaiBanh: number;
  soBanh: number;
  soKg: number;
  luyKeThangKg: number;
  luyKeNamKg: number;
};

export type DailyReportData = {
  ngay: string;
  stockRows: DailyStockRow[];
  shiftRows: DailyShiftRow[];
  doSuggestToday: number; // xuất kho DO750K trong ngày (lít)
  doPriorMonth: number; // đầu tháng → ngày trước
  doPriorYear: number; // 01/01 → ngày trước
};

const PAGE_SIZE = 1000;
const ID_CHUNK = 200;
const DO_ITEM_CODE = "DO750K";

const round2 = (v: number) => Math.round(v * 100) / 100;

// PostgREST cắt âm thầm ở 1000 dòng — bắt buộc phân trang (.claude/rules/04-code-patterns.md).
async function fetchAllPages<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = (data || []) as T[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}

type SuffixRow = { code: string | null; nguon: string | null; name: string | null };

function makeNguonResolver(suffixes: SuffixRow[]) {
  const byCode = new Map<string, SuffixRow>();
  for (const s of suffixes) if (s.code) byCode.set(s.code.trim().toLowerCase(), s);
  const fromNguon = (nguon: string): string | null => {
    const n = nguon.trim().toUpperCase();
    if (!n) return null;
    if (n === "NT" || n === "CS") return "Công ty";
    if (n === "M" || n === "TM") return "Thu mua";
    if (n.startsWith("GC")) return "Gia công";
    if (n === "TL") return "Thanh lý";
    return null;
  };
  return (suffix: string | null | undefined): string => {
    const code = (suffix || "").trim().toLowerCase();
    if (!code) return "Công ty";
    const s = byCode.get(code);
    return fromNguon(s?.nguon || "") || fromNguon(code) || s?.name?.trim() || code;
  };
}

// Giống loadShiftReportData: lô là nguồn chính cho bọc, giao dịch là dự phòng.
type TxRow = {
  id: string;
  lot_id: string;
  ca: string | null;
  ngay_nhap: string;
  so_banh: number | null;
  so_kg: number | null;
  boc: string | null;
  created_at: string | null;
  lots: { loai_csr: string | null; boc: string | null; loai_banh: number | null; suffix: string | null } | null;
};

type ExportRow = {
  ngay: string | null;
  assignments: Array<{ lot_id?: string; kien_a?: number; kien_b?: number; kien_c?: number; kien_d?: number }> | null;
};

type LotInfo = { id: string; loai_csr: string | null; boc: string | null; loai_banh: number | null; suffix: string | null };

const CA_ORDER = ["A", "B", "C"];
function compareCaCode(a: string, b: string): number {
  const ia = CA_ORDER.indexOf(a);
  const ib = CA_ORDER.indexOf(b);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return a.localeCompare(b);
}

export async function loadDailyProductionReportData(
  factoryId: string,
  ngay: string,
  accessToken: string | null,
): Promise<DailyReportData> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ngay)) throw new Error("Ngày báo cáo không hợp lệ.");
  await assertReportAccess(accessToken, factoryId, REPORT_DAILY_PERMISSIONS, "báo cáo sản xuất hằng ngày");
  const supabase = getSupabaseAdmin();
  const yearStart = `${ngay.slice(0, 4)}-01-01`;
  const monthStart = `${ngay.slice(0, 7)}-01`;

  const [txRows, exportRows, suffixRes, doItemsRes] = await Promise.all([
    fetchAllPages<TxRow>((from, to) =>
      supabase
        .from("lot_transactions")
        .select("id,lot_id,ca,ngay_nhap,so_banh,so_kg,boc,created_at,lots!inner(loai_csr,boc,loai_banh,suffix,factory_id)")
        .eq("lots.factory_id", factoryId)
        .lte("ngay_nhap", ngay)
        .order("ngay_nhap", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchAllPages<ExportRow>((from, to) =>
      supabase
        .from("export_orders")
        .select("id,ngay,assignments")
        .eq("factory_id", factoryId)
        .lte("ngay", ngay)
        .or("trang_thai.is.null,trang_thai.eq.da_phe_duyet")
        .order("id", { ascending: true })
        .range(from, to),
    ),
    supabase.from("suffixes").select("code,nguon,name").eq("factory_id", factoryId),
    supabase.from("inventory_items").select("id").eq("factory_id", factoryId).eq("code", DO_ITEM_CODE),
  ]);
  if (suffixRes.error) throw new Error(suffixRes.error.message);
  if (doItemsRes.error) throw new Error(doItemsRes.error.message);
  const resolveNguon = makeNguonResolver((suffixRes.data || []) as SuffixRow[]);

  // ── Mục 1 ──
  const stock = new Map<string, DailyStockRow>();
  const keyOf = (loaiCsr: string, nguon: string, boc: string, banh: number) => `${loaiCsr}||${nguon}||${boc}||${banh}`;
  const getRow = (loaiCsr: string, nguon: string, boc: string, banh: number) => {
    const k = keyOf(loaiCsr, nguon, boc, banh);
    let row = stock.get(k);
    if (!row) {
      row = {
        loaiCsr, nguonGoc: nguon, boc, loaiBanh: banh,
        nhapBanh: 0, nhapKg: 0, nhapThangKg: 0, nhapNamKg: 0,
        xuatKg: 0, xuatThangKg: 0, xuatNamKg: 0, tonKg: 0,
      };
      stock.set(k, row);
    }
    return row;
  };

  // ── Mục 2 ──
  const shiftToday = new Map<string, { ca: string; loaiCsr: string; loaiBanh: number; soBanh: number; soKg: number }>();
  const shiftMonth = new Map<string, number>();
  const shiftYear = new Map<string, number>();
  const earliestByCa = new Map<string, string>();

  for (const tx of txRows) {
    const lot = tx.lots;
    const loaiCsr = (lot?.loai_csr || "").trim() || "—";
    const boc = (lot?.boc || tx.boc || "").trim();
    const banh = Number(lot?.loai_banh) || 0;
    const kg = Number(tx.so_kg) || 0;
    const bales = Number(tx.so_banh) || 0;
    const row = getRow(loaiCsr, resolveNguon(lot?.suffix), boc, banh);
    row.tonKg += kg;
    const d = tx.ngay_nhap;
    if (d >= yearStart) row.nhapNamKg += kg;
    if (d >= monthStart) row.nhapThangKg += kg;
    if (d === ngay) {
      row.nhapKg += kg;
      row.nhapBanh += bales;
    }

    const ca = (tx.ca || "").trim();
    if (!ca || d < yearStart) continue;
    const sk = `${ca}||${loaiCsr}||${banh}`;
    shiftYear.set(sk, (shiftYear.get(sk) || 0) + kg);
    if (d >= monthStart) shiftMonth.set(sk, (shiftMonth.get(sk) || 0) + kg);
    if (d === ngay) {
      const cur = shiftToday.get(sk) || { ca, loaiCsr, loaiBanh: banh, soBanh: 0, soKg: 0 };
      cur.soBanh += bales;
      cur.soKg += kg;
      shiftToday.set(sk, cur);
      const created = tx.created_at || "";
      const prev = earliestByCa.get(ca);
      if (prev === undefined || (created && created < prev)) earliestByCa.set(ca, created);
    }
  }

  // Xuất kho: kg = số bành gán × loại bành của lô.
  const exportLotIds = new Set<string>();
  for (const order of exportRows) {
    for (const a of order.assignments || []) if (a?.lot_id) exportLotIds.add(a.lot_id);
  }
  const lotInfo = new Map<string, LotInfo>();
  const idList = [...exportLotIds];
  for (let i = 0; i < idList.length; i += ID_CHUNK) {
    const { data, error } = await supabase
      .from("lots")
      .select("id,loai_csr,boc,loai_banh,suffix")
      .eq("factory_id", factoryId)
      .in("id", idList.slice(i, i + ID_CHUNK));
    if (error) throw new Error(error.message);
    for (const l of (data || []) as LotInfo[]) lotInfo.set(l.id, l);
  }
  for (const order of exportRows) {
    const d = (order.ngay || "").slice(0, 10);
    if (!d) continue;
    for (const a of order.assignments || []) {
      const lot = a?.lot_id ? lotInfo.get(a.lot_id) : undefined;
      if (!lot) continue;
      const bales = (Number(a.kien_a) || 0) + (Number(a.kien_b) || 0) + (Number(a.kien_c) || 0) + (Number(a.kien_d) || 0);
      if (!bales) continue;
      const banh = Number(lot.loai_banh) || 0;
      const kg = bales * banh;
      const row = getRow((lot.loai_csr || "").trim() || "—", resolveNguon(lot.suffix), (lot.boc || "").trim(), banh);
      row.tonKg -= kg;
      if (d >= yearStart) row.xuatNamKg += kg;
      if (d >= monthStart) row.xuatThangKg += kg;
      if (d === ngay) row.xuatKg += kg;
    }
  }

  const stockRows = [...stock.values()]
    .map((r) => ({
      ...r,
      nhapKg: round2(r.nhapKg),
      nhapThangKg: round2(r.nhapThangKg),
      nhapNamKg: round2(r.nhapNamKg),
      xuatKg: round2(r.xuatKg),
      xuatThangKg: round2(r.xuatThangKg),
      xuatNamKg: round2(r.xuatNamKg),
      tonKg: Math.max(0, round2(r.tonKg)),
    }))
    .filter((r) => r.nhapNamKg > 0 || r.xuatNamKg > 0 || r.tonKg > 0)
    .sort(
      (a, b) =>
        a.loaiCsr.localeCompare(b.loaiCsr) ||
        a.nguonGoc.localeCompare(b.nguonGoc) ||
        a.boc.localeCompare(b.boc) ||
        a.loaiBanh - b.loaiBanh,
    );

  const caOrder = [...earliestByCa.keys()].sort(
    (a, b) => (earliestByCa.get(a) || "").localeCompare(earliestByCa.get(b) || "") || compareCaCode(a, b),
  );
  const caLabel = new Map(caOrder.map((ca, i) => [ca, `Ca ${i + 1}`]));
  const shiftRows: DailyShiftRow[] = [...shiftToday.entries()]
    .map(([sk, v]) => ({
      ca: v.ca,
      caLabel: caLabel.get(v.ca) || `Ca ${v.ca}`,
      loaiCsr: v.loaiCsr,
      loaiBanh: v.loaiBanh,
      soBanh: v.soBanh,
      soKg: round2(v.soKg),
      luyKeThangKg: round2(shiftMonth.get(sk) || 0),
      luyKeNamKg: round2(shiftYear.get(sk) || 0),
    }))
    .sort(
      (a, b) =>
        caOrder.indexOf(a.ca) - caOrder.indexOf(b.ca) ||
        a.loaiCsr.localeCompare(b.loaiCsr) ||
        a.loaiBanh - b.loaiBanh,
    );

  // ── Dầu DO750K ── (phiếu hủy đã tự xóa movement — không cần lọc trạng thái phiếu)
  let doSuggestToday = 0;
  let doPriorMonth = 0;
  let doPriorYear = 0;
  const doItemIds = ((doItemsRes.data || []) as Array<{ id: string }>).map((r) => r.id);
  if (doItemIds.length > 0) {
    const moves = await fetchAllPages<{ quantity_out: number | null; movement_date: string }>((from, to) =>
      supabase
        .from("inventory_stock_movements")
        .select("id,quantity_out,movement_date")
        .eq("factory_id", factoryId)
        .in("item_id", doItemIds)
        .eq("movement_type", "export")
        .gte("movement_date", yearStart)
        .lte("movement_date", ngay)
        .order("id", { ascending: true })
        .range(from, to),
    );
    for (const m of moves) {
      const q = Number(m.quantity_out) || 0;
      if (m.movement_date === ngay) doSuggestToday += q;
      else {
        doPriorYear += q;
        if (m.movement_date >= monthStart) doPriorMonth += q;
      }
    }
  }

  return {
    ngay,
    stockRows,
    shiftRows,
    doSuggestToday: round2(doSuggestToday),
    doPriorMonth: round2(doPriorMonth),
    doPriorYear: round2(doPriorYear),
  };
}
