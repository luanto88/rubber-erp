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
// GĐ5 (2026-09-29): Mục 2 gom + ghi nhãn theo CHỮ CÁI ca (A→B→C) kèm tên ca trưởng hiệu lực tại
//   ngày báo cáo (production_shift_names) — không còn "Ca 1/Ca 2" theo giờ quét (lệch với lũy kế).
//   - Dầu DO không lưu DB: loader chỉ trả gợi ý hôm nay + lũy kế các NGÀY TRƯỚC; UI cộng số nhập.
// GĐ6 (2026-09-28):
//   - Tồn theo mốc chốt kiểm kê (bảng product_opening_stock, mốc gần nhất ≤ ngày báo cáo).
//   - Bỏ ép tồn âm về 0 (ép 0 từng dòng rồi cộng làm tổng bị thổi phồng, che mất sai lệch).
//   - Đơn xuất trỏ lô không còn tồn tại → báo riêng (unmatchedExport), không bỏ im lặng.
//   - Lô không có giao dịch (lô mồ côi) → nhập = lots.tong_kg tại ngày hoàn thành/ngày SX.
// GĐ6b (2026-09-29): nhập theo BỌC LÚC SẢN XUẤT; ngày thao tác Thay bọc ghi −bọc nguồn / +bọc đích (cùng
//   CSR + nguồn gốc + loại bành, tổng không đổi), cộng cả lũy kế tháng/năm, kèm ghi chú trên dòng. Sổ cái
//   dựng từ sk_history qua src/lib/sk-boc-ledger.ts (RPC ghi đè lot_transactions.boc tại chỗ nên giao
//   dịch chỉ còn bọc hiện tại). Xuất kho vẫn theo bọc hiện tại của kiện. F12 không tách pallet ⇒ Sang
//   kiện không ảnh hưởng.
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { applyTxToKienBoc, KIEN_KEYS, kienBocOf, type KienBoc } from "@/lib/lot-kien-boc";
import { buildBocLedger, buildKienBocSets, shortBocLabel, type SkHistoryEvent } from "@/lib/sk-boc-ledger";
import {
  assertProductAccess,
  assertReportAccess,
  REPORT_DAILY_PERMISSIONS,
} from "@/app/dashboard/product/confirm/report-access";
import { formatCaName, resolveShiftNamesAt } from "@/app/dashboard/product/confirm/shift-names";

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
  ghiChu: string; // ± do Thay bọc trong ngày báo cáo
  // Tồn tới hết ngày báo cáo. CÓ THỂ ÂM (không ép 0 nữa — âm là dấu hiệu lệch dữ liệu, PDF tô đỏ).
  // Có mốc chốt: tồn chốt + nhập − xuất SAU ngày chốt; chưa có: toàn bộ nhập − toàn bộ xuất.
  tonKg: number;
};

// Đơn xuất đã duyệt trỏ tới lô không còn trong bảng lots — trước đây bị bỏ im lặng.
export type UnmatchedExport = { bales: number; orderCount: number; lotCount: number };

export type DailyShiftRow = {
  ca: string;
  caLabel: string; // "Ca A – Sok Khum" (GĐ5: theo chữ cái ca + ca trưởng hiệu lực ngày báo cáo)
  caName: string; // tên ca trưởng, "" nếu chưa cấu hình
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
  ngayChotTon: string | null; // mốc chốt tồn đầu kỳ đã dùng; null = chưa chốt
  unmatchedExport: UnmatchedExport;
};

export type OpeningStockSuggestion = {
  loaiCsr: string;
  nguonGoc: string;
  boc: string;
  loaiBanh: number;
  tonKg: number;
};

const PAGE_SIZE = 1000;
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
  kien_a: number | null;
  kien_b: number | null;
  kien_c: number | null;
  kien_d: number | null;
  boc: string | null;
  created_at: string | null;
  lots: { loai_csr: string | null; boc: string | null; loai_banh: number | null; suffix: string | null } | null;
};

type ExportRow = {
  id: string;
  ngay: string | null;
  assignments: Array<{ lot_id?: string; ma_lo?: string; kien_a?: number; kien_b?: number; kien_c?: number; kien_d?: number }> | null;
};

type LotInfo = {
  id: string;
  ma_lo: string | null;
  loai_csr: string | null;
  boc: string | null;
  loai_banh: number | null;
  suffix: string | null;
  tong_banh: number | null;
  tong_kg: number | null;
  ngay_ht: string | null;
  ngay_sx: string | null;
};

type OpeningRow = {
  loai_csr: string;
  nguon_goc: string;
  boc: string | null;
  loai_banh: number | string;
  ton_kg: number | string;
};

const CA_ORDER = ["A", "B", "C"];
function compareCaCode(a: string, b: string): number {
  const ia = CA_ORDER.indexOf(a);
  const ib = CA_ORDER.indexOf(b);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return a.localeCompare(b);
}

// Khóa nhóm dùng chung giữa dữ liệu hệ thống và bảng tồn đầu kỳ. Loại bành chuẩn hoá 2 chữ số
// thập phân để 33.33 (NUMERIC) và 33.33 (JS) không lệch khóa.
const groupKey = (loaiCsr: string, nguon: string, boc: string, banh: number) =>
  `${loaiCsr}||${nguon}||${boc}||${round2(banh)}`;

type LaterTxRow = {
  lot_id: string;
  boc: string | null;
  kien_a: number | null;
  kien_b: number | null;
  kien_c: number | null;
  kien_d: number | null;
};

// Toàn bộ sk_history Thay bọc của nhà máy (không lọc ngày — lưới an toàn cần đủ mọi lần thao tác).
// Cột kien_changes (migration 20261004) chưa có → đọc lại không có cột, dựng lại theo cách cũ.
async function loadThayBocEvents(factoryId: string): Promise<SkHistoryEvent[]> {
  const supabase = getSupabaseAdmin();
  const load = (cols: string) =>
    fetchAllPages<SkHistoryEvent>((from, to) =>
      supabase
        .from("sk_history")
        .select(cols)
        .eq("factory_id", factoryId)
        .eq("loai", "Thay bọc")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    );
  try {
    return await load("id,ngay,created_at,to_boc,lots,kien_changes");
  } catch (err) {
    if (!/kien_changes/i.test(err instanceof Error ? err.message : String(err))) throw err;
    return load("id,ngay,created_at,to_boc,lots");
  }
}

type StockComputation = {
  stockRows: DailyStockRow[];
  shiftRows: DailyShiftRow[];
  ngayChotTon: string | null;
  unmatchedExport: UnmatchedExport;
};

/**
 * Lõi tính Mục 1 + Mục 2. `useOpening=false` bỏ qua bảng tồn đầu kỳ (dùng cho nút "Gợi ý từ hệ
 * thống" khi chốt tồn — gợi ý phải là số hệ thống TỰ TÍNH, không phải số đã chốt trước đó).
 */
async function computeStock(factoryId: string, ngay: string, useOpening: boolean): Promise<StockComputation> {
  const supabase = getSupabaseAdmin();
  const yearStart = `${ngay.slice(0, 4)}-01-01`;
  const monthStart = `${ngay.slice(0, 7)}-01`;

  const [txRows, laterTxRows, exportRows, allLots, suffixRes, shiftNames] = await Promise.all([
    fetchAllPages<TxRow>((from, to) =>
      supabase
        .from("lot_transactions")
        .select("id,lot_id,ca,ngay_nhap,so_banh,so_kg,kien_a,kien_b,kien_c,kien_d,boc,created_at,lots!inner(loai_csr,boc,loai_banh,suffix,factory_id)")
        .eq("lots.factory_id", factoryId)
        .lte("ngay_nhap", ngay)
        .order("ngay_nhap", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    // Lô có giao dịch SAU ngày báo cáo (hoặc giao dịch thiếu ngày) — chỉ để biết lô đó KHÔNG phải lô mồ
    // côi. Thiếu bước này, lô có ngay_sx ≤ ngày nhưng giao dịch ghi ngày sau bị cộng thừa lots.tong_kg.
    fetchAllPages<LaterTxRow>((from, to) =>
      supabase
        .from("lot_transactions")
        .select("id,lot_id,boc,kien_a,kien_b,kien_c,kien_d,lots!inner(factory_id)")
        .eq("lots.factory_id", factoryId)
        .or(`ngay_nhap.gt.${ngay},ngay_nhap.is.null`)
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
    // Toàn bộ lô của nhà máy: vừa để tra lô của đơn xuất, vừa để phát hiện lô không có giao dịch.
    fetchAllPages<LotInfo>((from, to) =>
      supabase
        .from("lots")
        .select("id,ma_lo,loai_csr,boc,loai_banh,suffix,tong_banh,tong_kg,ngay_ht,ngay_sx")
        .eq("factory_id", factoryId)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    supabase.from("suffixes").select("code,nguon,name").eq("factory_id", factoryId),
    resolveShiftNamesAt(factoryId, ngay),
  ]);
  if (suffixRes.error) throw new Error(suffixRes.error.message);
  const resolveNguon = makeNguonResolver((suffixRes.data || []) as SuffixRow[]);
  const skEvents = await loadThayBocEvents(factoryId);

  // Mốc chốt tồn gần nhất ≤ ngày báo cáo.
  let ngayChotTon: string | null = null;
  const opening = new Map<string, number>();
  if (useOpening) {
    const { data: chot, error: chotErr } = await supabase
      .from("product_opening_stock")
      .select("ngay_chot")
      .eq("factory_id", factoryId)
      .lte("ngay_chot", ngay)
      .order("ngay_chot", { ascending: false })
      .limit(1);
    // Bảng chưa tồn tại (migration chưa chạy) → coi như chưa chốt, không làm hỏng báo cáo.
    if (chotErr && !/product_opening_stock|does not exist|schema cache/i.test(chotErr.message)) {
      throw new Error(chotErr.message);
    }
    ngayChotTon = (chot?.[0]?.ngay_chot as string | undefined) ?? null;
    if (ngayChotTon) {
      const openRows = await fetchAllPages<OpeningRow>((from, to) =>
        supabase
          .from("product_opening_stock")
          .select("loai_csr,nguon_goc,boc,loai_banh,ton_kg,id")
          .eq("factory_id", factoryId)
          .eq("ngay_chot", ngayChotTon)
          .order("id", { ascending: true })
          .range(from, to),
      );
      for (const o of openRows) {
        const k = groupKey(o.loai_csr.trim(), o.nguon_goc.trim(), (o.boc || "").trim(), Number(o.loai_banh) || 0);
        opening.set(k, (opening.get(k) || 0) + (Number(o.ton_kg) || 0));
      }
    }
  }
  // Có mốc chốt: chỉ phát sinh SAU ngày chốt mới cộng/trừ vào tồn.
  const countsForTon = (d: string) => !ngayChotTon || d > ngayChotTon;

  // ── Mục 1 ──
  const stock = new Map<string, DailyStockRow>();
  const getRow = (loaiCsr: string, nguon: string, boc: string, banh: number) => {
    const k = groupKey(loaiCsr, nguon, boc, banh);
    let row = stock.get(k);
    if (!row) {
      row = {
        loaiCsr, nguonGoc: nguon, boc, loaiBanh: banh, ghiChu: "",
        nhapBanh: 0, nhapKg: 0, nhapThangKg: 0, nhapNamKg: 0,
        xuatKg: 0, xuatThangKg: 0, xuatNamKg: 0, tonKg: 0,
      };
      stock.set(k, row);
    }
    return row;
  };
  const addNhap = (row: DailyStockRow, d: string, kg: number, bales: number) => {
    if (countsForTon(d)) row.tonKg += kg;
    if (d >= yearStart) row.nhapNamKg += kg;
    if (d >= monthStart) row.nhapThangKg += kg;
    if (d === ngay) {
      row.nhapKg += kg;
      row.nhapBanh += bales;
    }
  };

  // ── Mục 2 ──
  const shiftToday = new Map<string, { ca: string; loaiCsr: string; loaiBanh: number; soBanh: number; soKg: number }>();
  const shiftMonth = new Map<string, number>();
  const shiftYear = new Map<string, number>();
  const lotsWithTx = new Set<string>(laterTxRows.map((t) => t.lot_id));
  // Bọc theo từng kiện (sau Thay bọc tròn kiện, 1 lô có thể có kiện khác bọc) — dùng cho xuất kho.
  const kienBoc = new Map<string, KienBoc>();
  // Sổ cái Thay bọc: bọc lúc SX theo kiện + các lần chuyển. So với bọc HIỆN TẠI của mọi giao dịch
  // (kể cả giao dịch sau ngày báo cáo) để lưới an toàn hoạt động đúng.
  const lotBocById = new Map<string, string | null>(allLots.map((l) => [l.id, l.boc]));
  // Sản lượng thật theo (lô|kiện) tới ngày báo cáo — lượng thay bọc lấy theo đây, KHÔNG theo số bành ghi
  // trong sk_history (bản ghi cũ có thể ghi số "đã chuyển" khác số bành thật của kiện).
  const kienProd = new Map<string, { bales: number; kg: number }>();
  const ledger = buildBocLedger(skEvents, buildKienBocSets([...txRows, ...laterTxRows], lotBocById));

  for (const tx of txRows) {
    lotsWithTx.add(tx.lot_id);
    const lot = tx.lots;
    const loaiCsr = (lot?.loai_csr || "").trim() || "—";
    // Giao dịch là nguồn chính cho bọc (Thay bọc sửa đúng giao dịch của kiện); lô chỉ là dự phòng.
    const boc = (tx.boc || lot?.boc || "").trim();
    const banh = Number(lot?.loai_banh) || 0;
    applyTxToKienBoc(kienBoc, tx, boc);
    const kg = Number(tx.so_kg) || 0;
    const bales = Number(tx.so_banh) || 0;
    const d = tx.ngay_nhap;
    const nguon = resolveNguon(lot?.suffix);
    const prod = ledger.prodBoc.get(tx.lot_id);
    const kienBales = KIEN_KEYS.map((k) => [k, Number(tx[`kien_${k}`]) || 0] as const).filter(([, b]) => b > 0);
    const totalKienBales = kienBales.reduce((sum, [, b]) => sum + b, 0);
    for (const [k, b] of kienBales) {
      // Sản lượng thật của từng kiện (kg chia theo tỷ lệ bành) — dùng cho cả nhập lẫn lượng thay bọc.
      const kgK = totalKienBales > 0 ? (kg * b) / totalKienBales : b * banh;
      const pk = `${tx.lot_id}|${k}`;
      const cur = kienProd.get(pk) || { bales: 0, kg: 0 };
      kienProd.set(pk, { bales: cur.bales + b, kg: cur.kg + kgK });
    }
    if (prod && kienBales.length > 0) {
      // Lô từng Thay bọc: mỗi kiện vào bọc LÚC SẢN XUẤT.
      for (const [k, b] of kienBales) {
        const kgK = totalKienBales > 0 ? (kg * b) / totalKienBales : b * banh;
        addNhap(getRow(loaiCsr, nguon, (prod[k] || boc).trim(), banh), d, kgK, b);
      }
    } else {
      addNhap(getRow(loaiCsr, nguon, boc, banh), d, kg, bales);
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
    }
  }

  // Lô không có giao dịch nào (lô mồ côi — nhập CSV/sửa tay DB): nhập = lots.tong_kg tại ngày hoàn
  // thành (fallback ngày SX), mirror loadStorageLots. Không đưa vào Mục 2 (không biết ca).
  const lotInfo = new Map<string, LotInfo>();
  // Dự phòng theo mã lô: dữ liệu lịch sử có lô bị tạo lại (id mới, cùng ma_lo) nên lot_id trong đơn
  // xuất cũ không còn khớp. Chỉ dùng khi mã lô là DUY NHẤT trong nhà máy (tránh gán nhầm lô trùng mã).
  const lotsByMa = new Map<string, LotInfo[]>();
  for (const l of allLots) {
    lotInfo.set(l.id, l);
    const ma = (l.ma_lo || "").trim().toLowerCase();
    if (ma) lotsByMa.set(ma, [...(lotsByMa.get(ma) || []), l]);
    if (lotsWithTx.has(l.id)) continue;
    const kg = Number(l.tong_kg) || 0;
    const d = (l.ngay_ht || l.ngay_sx || "").slice(0, 10);
    if (kg <= 0 || !d || d > ngay) continue;
    const row = getRow((l.loai_csr || "").trim() || "—", resolveNguon(l.suffix), (l.boc || "").trim(), Number(l.loai_banh) || 0);
    addNhap(row, d, kg, Number(l.tong_banh) || 0);
  }

  // Thay bọc: −bọc nguồn / +bọc đích vào đúng ngày thao tác (≤ ngày báo cáo).
  type NoteAgg = { loaiCsr: string; nguon: string; banh: number; a: string; b: string; bales: number };
  const noteNet = new Map<string, NoteAgg>();
  for (const t of ledger.transfers) {
    if (t.ngay > ngay) continue;
    const lot = lotInfo.get(t.lotId);
    if (!lot) continue;
    const loaiCsr = (lot.loai_csr || "").trim() || "—";
    const nguon = resolveNguon(lot.suffix);
    const banh = Number(lot.loai_banh) || 0;
    const real = kienProd.get(`${t.lotId}|${t.kien}`);
    const bales = real ? real.bales : t.bales;
    const kg = real ? real.kg : t.bales * banh;
    if (!bales && !kg) continue;
    addNhap(getRow(loaiCsr, nguon, t.from, banh), t.ngay, -kg, -bales);
    addNhap(getRow(loaiCsr, nguon, t.to, banh), t.ngay, kg, bales);
    if (t.ngay !== ngay) continue;
    // Gộp theo cặp bọc (không phân chiều) để bù trừ đi–về trong cùng ngày.
    const [a, b] = [t.from, t.to].sort();
    const nk = `${loaiCsr}||${nguon}||${round2(banh)}||${a}||${b}`;
    const cur = noteNet.get(nk) || { loaiCsr, nguon, banh, a, b, bales: 0 };
    cur.bales += t.from === a ? bales : -bales; // dương = a→b
    noteNet.set(nk, cur);
  }
  const rowNotes = new Map<string, string[]>();
  const addNote = (k: string, text: string) => rowNotes.set(k, [...(rowNotes.get(k) || []), text]);
  for (const v of noteNet.values()) {
    if (v.bales === 0) continue;
    const [from, to] = v.bales > 0 ? [v.a, v.b] : [v.b, v.a];
    const n = Math.abs(v.bales);
    const label = `Thay bọc ${shortBocLabel(from)}→${shortBocLabel(to)}`;
    addNote(groupKey(v.loaiCsr, v.nguon, to, v.banh), `+${n} bành từ ${label}`);
    addNote(groupKey(v.loaiCsr, v.nguon, from, v.banh), `−${n} bành do ${label}`);
  }
  for (const [k, texts] of rowNotes) {
    const row = stock.get(k);
    if (row) row.ghiChu = texts.join("; ");
  }

  // Xuất kho: kg = số bành gán × loại bành của lô.
  const unmatchedOrders = new Set<string>();
  const unmatchedLots = new Set<string>();
  let unmatchedBales = 0;
  for (const order of exportRows) {
    const d = (order.ngay || "").slice(0, 10);
    if (!d) continue;
    for (const a of order.assignments || []) {
      const bales = (Number(a?.kien_a) || 0) + (Number(a?.kien_b) || 0) + (Number(a?.kien_c) || 0) + (Number(a?.kien_d) || 0);
      if (!bales || !a) continue;
      let lot = a?.lot_id ? lotInfo.get(a.lot_id) : undefined;
      if (!lot && a?.ma_lo) {
        const same = lotsByMa.get(a.ma_lo.trim().toLowerCase());
        if (same && same.length === 1) lot = same[0];
      }
      if (!lot) {
        unmatchedBales += bales;
        unmatchedOrders.add(order.id);
        unmatchedLots.add(a?.lot_id || "(trống)");
        continue;
      }
      const banh = Number(lot.loai_banh) || 0;
      for (const k of KIEN_KEYS) {
        const kienBales = Number(a[`kien_${k}`]) || 0;
        if (!kienBales) continue;
        const kg = kienBales * banh;
        const boc = kienBocOf(kienBoc, lot.id, k, lot.boc);
        const row = getRow((lot.loai_csr || "").trim() || "—", resolveNguon(lot.suffix), boc, banh);
        if (countsForTon(d)) row.tonKg -= kg;
        if (d >= yearStart) row.xuatNamKg += kg;
        if (d >= monthStart) row.xuatThangKg += kg;
        if (d === ngay) row.xuatKg += kg;
      }
    }
  }

  // Tồn chốt: cộng vào đúng nhóm (tạo nhóm nếu nhóm chỉ còn trong số chốt).
  for (const [k, ton] of opening) {
    const [loaiCsr, nguon, boc, banhStr] = k.split("||");
    getRow(loaiCsr, nguon, boc, Number(banhStr) || 0).tonKg += ton;
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
      tonKg: round2(r.tonKg),
    }))
    .filter((r) => r.nhapNamKg !== 0 || r.xuatNamKg !== 0 || r.tonKg !== 0 || r.ghiChu !== "")
    .sort(
      (a, b) =>
        a.loaiCsr.localeCompare(b.loaiCsr) ||
        a.nguonGoc.localeCompare(b.nguonGoc) ||
        a.boc.localeCompare(b.boc) ||
        a.loaiBanh - b.loaiBanh,
    );

  const shiftRows: DailyShiftRow[] = [...shiftToday.entries()]
    .map(([sk, v]) => ({
      ca: v.ca,
      caLabel: formatCaName(v.ca, shiftNames),
      caName: (shiftNames as Record<string, string>)[v.ca] || "",
      loaiCsr: v.loaiCsr,
      loaiBanh: v.loaiBanh,
      soBanh: v.soBanh,
      soKg: round2(v.soKg),
      luyKeThangKg: round2(shiftMonth.get(sk) || 0),
      luyKeNamKg: round2(shiftYear.get(sk) || 0),
    }))
    .sort(
      (a, b) =>
        compareCaCode(a.ca, b.ca) ||
        a.loaiCsr.localeCompare(b.loaiCsr) ||
        a.loaiBanh - b.loaiBanh,
    );

  return {
    stockRows,
    shiftRows,
    ngayChotTon,
    unmatchedExport: { bales: unmatchedBales, orderCount: unmatchedOrders.size, lotCount: unmatchedLots.size },
  };
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

  const [computed, doItemsRes] = await Promise.all([
    computeStock(factoryId, ngay, true),
    supabase.from("inventory_items").select("id").eq("factory_id", factoryId).eq("code", DO_ITEM_CODE),
  ]);
  if (doItemsRes.error) throw new Error(doItemsRes.error.message);

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
    stockRows: computed.stockRows,
    shiftRows: computed.shiftRows,
    doSuggestToday: round2(doSuggestToday),
    doPriorMonth: round2(doPriorMonth),
    doPriorYear: round2(doPriorYear),
    ngayChotTon: computed.ngayChotTon,
    unmatchedExport: computed.unmatchedExport,
  };
}

/**
 * Gợi ý số tồn từ hệ thống tại hết ngày `ngayChot` (KHÔNG dùng số chốt cũ) — cho nút "Gợi ý từ hệ
 * thống" ở Cài đặt → Tồn đầu kỳ thành phẩm. Người dùng sửa lại theo số kiểm kê thực tế rồi mới lưu.
 */
export async function loadOpeningStockSuggestion(
  factoryId: string,
  ngayChot: string,
  accessToken: string | null,
): Promise<OpeningStockSuggestion[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ngayChot)) throw new Error("Ngày chốt không hợp lệ.");
  await assertProductAccess(accessToken, factoryId, ["settings.manage_config"], "chốt tồn đầu kỳ thành phẩm");
  const { stockRows } = await computeStock(factoryId, ngayChot, false);
  return stockRows
    .filter((r) => r.tonKg !== 0)
    .map((r) => ({ loaiCsr: r.loaiCsr, nguonGoc: r.nguonGoc, boc: r.boc, loaiBanh: r.loaiBanh, tonKg: r.tonKg }));
}

/**
 * Tổ hợp (Loại CSR, Nguồn gốc, Bọc, Loại bành) có thật trong dữ liệu — nguồn cho các dropdown lọc xếp
 * tầng ở Cài đặt → Tồn đầu kỳ thành phẩm. Gom từ lots (bọc theo giao dịch vì sau Thay bọc tròn kiện 1 lô
 * có thể có kiện khác bọc) + các dòng đã chốt trước đó.
 */
export async function loadOpeningStockOptions(
  factoryId: string,
  accessToken: string | null,
): Promise<OpeningStockSuggestion[]> {
  await assertProductAccess(accessToken, factoryId, ["settings.manage_config"], "chốt tồn đầu kỳ thành phẩm");
  const supabase = getSupabaseAdmin();
  const [lots, txs, suffixRes, opening] = await Promise.all([
    fetchAllPages<{ id: string; loai_csr: string | null; boc: string | null; loai_banh: number | null; suffix: string | null }>(
      (from, to) =>
        supabase
          .from("lots")
          .select("id,loai_csr,boc,loai_banh,suffix")
          .eq("factory_id", factoryId)
          .order("id", { ascending: true })
          .range(from, to),
    ),
    fetchAllPages<{ lot_id: string; boc: string | null }>((from, to) =>
      supabase
        .from("lot_transactions")
        .select("id,lot_id,boc,lots!inner(factory_id)")
        .eq("lots.factory_id", factoryId)
        .not("boc", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    supabase.from("suffixes").select("code,nguon,name").eq("factory_id", factoryId),
    fetchAllPages<{ loai_csr: string | null; nguon_goc: string | null; boc: string | null; loai_banh: number | null }>((from, to) =>
      supabase
        .from("product_opening_stock")
        .select("id,loai_csr,nguon_goc,boc,loai_banh")
        .eq("factory_id", factoryId)
        .order("id", { ascending: true })
        .range(from, to),
    ).then(
      (data) => ({ data, error: null as { message: string } | null }),
      // Bảng chưa tồn tại (migration chưa chạy) → bỏ qua tồn đã chốt, vẫn gợi ý từ lô.
      (err: unknown) => ({ data: [] as never[], error: { message: err instanceof Error ? err.message : String(err) } }),
    ),
  ]);
  if (suffixRes.error) throw new Error(suffixRes.error.message);
  const resolveNguon = makeNguonResolver((suffixRes.data || []) as SuffixRow[]);
  const bocsByLot = new Map<string, Set<string>>();
  for (const t of txs) {
    const b = (t.boc || "").trim();
    if (!b) continue;
    const set = bocsByLot.get(t.lot_id) || new Set<string>();
    set.add(b);
    bocsByLot.set(t.lot_id, set);
  }
  const out = new Map<string, OpeningStockSuggestion>();
  const add = (loaiCsr: string, nguonGoc: string, boc: string, loaiBanh: number) => {
    if (!loaiCsr || !nguonGoc || !(loaiBanh > 0)) return;
    const k = groupKey(loaiCsr, nguonGoc, boc, loaiBanh);
    if (!out.has(k)) out.set(k, { loaiCsr, nguonGoc, boc, loaiBanh: round2(loaiBanh), tonKg: 0 });
  };
  for (const l of lots) {
    const csr = (l.loai_csr || "").trim();
    const nguon = resolveNguon(l.suffix);
    const banh = Number(l.loai_banh) || 0;
    const bocs = bocsByLot.get(l.id) || new Set([(l.boc || "").trim()]);
    for (const b of bocs) add(csr, nguon, b, banh);
  }
  if (!opening.error) {
    for (const o of opening.data || []) {
      add((o.loai_csr || "").trim(), (o.nguon_goc || "").trim(), (o.boc || "").trim(), Number(o.loai_banh) || 0);
    }
  }
  return [...out.values()].sort(
    (a, b) =>
      a.loaiCsr.localeCompare(b.loaiCsr) ||
      a.nguonGoc.localeCompare(b.nguonGoc) ||
      a.boc.localeCompare(b.boc) ||
      a.loaiBanh - b.loaiBanh,
  );
}