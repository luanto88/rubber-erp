// Đối soát nguồn số liệu tồn thành phẩm cho Báo cáo sản xuất hằng ngày (F12) — CHỈ ĐỌC, không ghi.
//
// In ra, theo từng nhà máy:
//   1. Lô không có lot_transactions (lô mồ côi) — gồm lô tồn dư hậu tố "r" của Sang kiện/Thay bọc.
//   2. Lô có SUM(lot_transactions.so_kg) ≠ tong_banh × loai_banh, hoặc kien_* lệch tổng giao dịch.
//   3. Lô có lots.boc khác bọc trong giao dịch.
//   4. Đơn xuất (đã duyệt hoặc chưa) trỏ tới lô không còn tồn tại.
//   5. Lô bị gán đơn xuất NHIỀU HƠN số bành đã sản xuất (theo từng kiện) + danh sách đơn góp phần,
//      đánh dấu đơn nghi trùng (cùng mã đơn, hoặc cùng ngày + cùng khách + cùng danh sách gán).
//   6. Tồn thô theo nhóm (CSR + nguồn + bọc + bành) tới hết ngày --ngay (mặc định hôm nay), và nếu
//      có mốc chốt trong product_opening_stock thì in thêm tồn chốt + chênh lệch với số tự tính.
//
// Chạy:
//   node --env-file=.env.local scripts/reconcile-f12-stock.mjs
//   node --env-file=.env.local scripts/reconcile-f12-stock.mjs --ngay=2026-07-26 --factory=phuochoa_kt
//   node --env-file=.env.local scripts/reconcile-f12-stock.mjs --json=out.json   (xuất thêm file JSON)
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Thiếu NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY trong .env.local");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

const todayVN = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
const NGAY = arg("ngay") || todayVN;
const FACTORY_CODE = arg("factory");
const JSON_OUT = arg("json");

async function fetchAll(table, cols, filter) {
  let out = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(cols).order("id").range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) {
      if (/does not exist|schema cache/i.test(error.message)) return null; // bảng chưa có
      throw new Error(`${table}: ${error.message}`);
    }
    out = out.concat(data || []);
    if (!data || data.length < 1000) break;
  }
  return out;
}

const KIEN = ["a", "b", "c", "d"];
const num = (v) => Number(v) || 0;
const r2 = (v) => Math.round(v * 100) / 100;
const fmt = (v) => r2(v).toLocaleString("vi-VN");

function nguonResolver(suffixes) {
  const byCode = new Map();
  for (const s of suffixes) if (s.code) byCode.set(s.code.trim().toLowerCase(), s);
  const fromNguon = (n) => {
    n = (n || "").trim().toUpperCase();
    if (!n) return null;
    if (n === "NT" || n === "CS") return "Công ty";
    if (n === "M" || n === "TM") return "Thu mua";
    if (n.startsWith("GC")) return "Gia công";
    if (n === "TL") return "Thanh lý";
    return null;
  };
  return (suffix) => {
    const code = (suffix || "").trim().toLowerCase();
    if (!code) return "Công ty";
    const s = byCode.get(code);
    return fromNguon(s?.nguon) || fromNguon(code) || s?.name?.trim() || code;
  };
}

const factories = await fetchAll("factories", "id,code,name");
const targets = FACTORY_CODE ? factories.filter((f) => f.code === FACTORY_CODE) : factories;
if (targets.length === 0) {
  console.error(`Không tìm thấy nhà máy ${FACTORY_CODE}`);
  process.exit(1);
}

const report = {};
console.log(`Đối soát tồn thành phẩm tới hết ngày ${NGAY}\n`);

for (const f of targets) {
  const byFactory = (q) => q.eq("factory_id", f.id);
  const [lots, orders, suffixes, opening] = await Promise.all([
    fetchAll("lots", "id,ma_lo,suffix,trang_thai,boc,loai_csr,loai_banh,kien_a,kien_b,kien_c,kien_d,tong_banh,tong_kg,ngay_sx,ngay_ht", byFactory),
    fetchAll("export_orders", "id,ma_don,ngay,trang_thai,customer_id,assignments", byFactory),
    fetchAll("suffixes", "id,code,nguon,name", byFactory),
    fetchAll("product_opening_stock", "id,ngay_chot,loai_csr,nguon_goc,boc,loai_banh,ton_kg", byFactory),
  ]);
  if (lots.length === 0 && orders.length === 0) continue;
  const lotIds = new Set(lots.map((l) => l.id));
  const txs = [];
  const idList = [...lotIds];
  for (let i = 0; i < idList.length; i += 200) {
    const chunk = idList.slice(i, i + 200);
    const part = await fetchAll("lot_transactions", "id,lot_id,kien_a,kien_b,kien_c,kien_d,so_banh,so_kg,boc,ngay_nhap", (q) => q.in("lot_id", chunk));
    txs.push(...part);
  }
  const resolveNguon = nguonResolver(suffixes || []);
  const txByLot = new Map();
  for (const t of txs) {
    if (!txByLot.has(t.lot_id)) txByLot.set(t.lot_id, []);
    txByLot.get(t.lot_id).push(t);
  }
  const lotById = new Map(lots.map((l) => [l.id, l]));
  // Dự phòng theo mã lô (lô bị tạo lại id mới, cùng ma_lo) — chỉ khi mã lô duy nhất, giống F12.
  const lotsByMa = new Map();
  for (const l of lots) {
    const ma = (l.ma_lo || "").trim().toLowerCase();
    if (ma) lotsByMa.set(ma, [...(lotsByMa.get(ma) || []), l]);
  }
  const resolveLot = (a) => {
    if (a?.lot_id && lotById.has(a.lot_id)) return { lot: lotById.get(a.lot_id), byMa: false };
    const same = a?.ma_lo ? lotsByMa.get(a.ma_lo.trim().toLowerCase()) : null;
    if (same && same.length === 1) return { lot: same[0], byMa: true };
    return { lot: null, byMa: false };
  };

  console.log(`══════ ${f.name || f.code} (${f.code}) — ${lots.length} lô, ${txs.length} giao dịch, ${orders.length} đơn xuất ══════`);

  // 1. Lô mồ côi
  const orphans = lots.filter((l) => num(l.tong_banh) > 0 && !txByLot.has(l.id));
  console.log(`\n[1] Lô có số bành nhưng KHÔNG có giao dịch: ${orphans.length}`);
  for (const l of orphans) console.log(`    - ${l.ma_lo} (${l.trang_thai}) ${l.tong_banh} bành${/r$/i.test(l.suffix || "") ? " ← lô tồn dư Sang kiện/Thay bọc" : ""}`);

  // 2. Lệch tổng
  const mismatch = [];
  for (const l of lots) {
    const list = txByLot.get(l.id);
    if (!list) continue;
    const sum = { a: 0, b: 0, c: 0, d: 0 };
    let kg = 0;
    for (const t of list) {
      for (const k of KIEN) sum[k] += num(t[`kien_${k}`]);
      kg += num(t.so_kg);
    }
    const kienLech = KIEN.filter((k) => sum[k] !== num(l[`kien_${k}`]));
    const expectKg = num(l.tong_banh) * num(l.loai_banh);
    if (kienLech.length > 0 || Math.abs(kg - expectKg) > 0.5) {
      mismatch.push({ ma_lo: l.ma_lo, kienLech, lots: KIEN.map((k) => num(l[`kien_${k}`])), tx: KIEN.map((k) => sum[k]), kgTx: r2(kg), kgExpect: r2(expectKg) });
    }
  }
  console.log(`\n[2] Lô lệch giữa lots và lot_transactions: ${mismatch.length}`);
  for (const m of mismatch) console.log(`    - ${m.ma_lo}: lots A-D=${m.lots.join("/")} · giao dịch A-D=${m.tx.join("/")} · kg giao dịch ${fmt(m.kgTx)} vs tong_banh×loai_banh ${fmt(m.kgExpect)}`);

  // 3. Lệch bọc
  const bocLech = [];
  for (const l of lots) {
    const bocs = [...new Set((txByLot.get(l.id) || []).map((t) => (t.boc || "").trim()).filter(Boolean))];
    if (bocs.length > 0 && (bocs.length > 1 || bocs[0] !== (l.boc || "").trim())) bocLech.push({ ma_lo: l.ma_lo, lotBoc: l.boc, txBoc: bocs });
  }
  console.log(`\n[3] Lô có bọc lệch giữa lots và giao dịch: ${bocLech.length}`);
  for (const b of bocLech) console.log(`    - ${b.ma_lo}: lots="${b.lotBoc || ""}" · giao dịch=${b.txBoc.map((x) => `"${x}"`).join(", ")}`);

  // 4 + 5. Đơn xuất
  const missing = [];
  const assigned = new Map(); // lot_id -> {a,b,c,d, orders:[]}
  for (const o of orders) {
    for (const a of o.assignments || []) {
      const bales = KIEN.reduce((s, k) => s + num(a?.[`kien_${k}`]), 0);
      if (!bales) continue;
      const { lot: hit, byMa } = resolveLot(a);
      if (!hit || byMa) {
        missing.push({ ma_don: o.ma_don, ngay: o.ngay, trang_thai: o.trang_thai, lot_id: a?.lot_id, ma_lo: a?.ma_lo, bales, khopTheoMa: byMa ? hit.id : null });
        if (!hit) continue;
      }
      const cur = assigned.get(hit.id) || { a: 0, b: 0, c: 0, d: 0, orders: [] };
      for (const k of KIEN) cur[k] += num(a[`kien_${k}`]);
      cur.orders.push({ id: o.id, ma_don: o.ma_don, ngay: o.ngay, trang_thai: o.trang_thai, customer_id: o.customer_id, kien: KIEN.map((k) => num(a[`kien_${k}`])) });
      assigned.set(hit.id, cur);
    }
  }
  const khopMa = missing.filter((m) => m.khopTheoMa);
  const matLo = missing.filter((m) => !m.khopTheoMa);
  console.log(`\n[4] Dòng gán đơn xuất có lot_id không còn tồn tại: ${missing.length} (khớp lại được theo mã lô: ${khopMa.length}, mất hẳn: ${matLo.length})`);
  for (const m of matLo) console.log(`    - MẤT HẲN: Đơn ${m.ma_don} (${m.ngay}, ${m.trang_thai ?? "đã duyệt"}): lô ${m.ma_lo || m.lot_id} — ${m.bales} bành`);
  for (const m of khopMa) console.log(`    - khớp theo mã: Đơn ${m.ma_don} (${m.ngay}): lô ${m.ma_lo} — ${m.bales} bành (lot_id cũ ${m.lot_id} → ${m.khopTheoMa})`);

  // Đơn nghi trùng: cùng mã đơn, hoặc cùng ngày + khách + danh sách gán giống hệt.
  const sig = (o) => JSON.stringify((o.assignments || []).map((a) => [a.lot_id, ...KIEN.map((k) => num(a[`kien_${k}`]))]).sort());
  const dupGroups = new Map();
  for (const o of orders) {
    const k1 = `ma:${(o.ma_don || "").trim()}`;
    const k2 = `sig:${o.ngay}|${o.customer_id}|${sig(o)}`;
    for (const k of [k1, k2]) {
      if (k === "ma:") continue;
      if (!dupGroups.has(k)) dupGroups.set(k, []);
      dupGroups.get(k).push(o);
    }
  }
  const dupOrderIds = new Set();
  for (const list of dupGroups.values()) if (list.length > 1) for (const o of list) dupOrderIds.add(o.id);

  const over = [];
  for (const [lotId, a] of assigned) {
    const l = lotById.get(lotId);
    const prod = { a: 0, b: 0, c: 0, d: 0 };
    const list = txByLot.get(lotId);
    if (list) for (const t of list) for (const k of KIEN) prod[k] += num(t[`kien_${k}`]);
    else for (const k of KIEN) prod[k] = num(l[`kien_${k}`]);
    const kienVuot = KIEN.filter((k) => a[k] > prod[k]);
    if (kienVuot.length > 0) over.push({ ma_lo: l.ma_lo, trang_thai: l.trang_thai, prod, assigned: a, kienVuot });
  }
  over.sort((x, y) => x.ma_lo.localeCompare(y.ma_lo));
  console.log(`\n[5] Lô bị gán đơn xuất NHIỀU HƠN số đã sản xuất: ${over.length}`);
  for (const o of over) {
    const tongSx = KIEN.reduce((s, k) => s + o.prod[k], 0);
    const tongGan = KIEN.reduce((s, k) => s + o.assigned[k], 0);
    console.log(`    - ${o.ma_lo} (${o.trang_thai}): sản xuất ${tongSx} (A-D ${KIEN.map((k) => o.prod[k]).join("/")}) · đã gán ${tongGan} (A-D ${KIEN.map((k) => o.assigned[k]).join("/")}) · vượt ở kiện ${o.kienVuot.map((k) => k.toUpperCase()).join(",")}`);
    for (const od of o.assigned.orders) {
      console.log(`        · Đơn ${od.ma_don || od.id} ngày ${od.ngay} [${od.trang_thai ?? "đã duyệt"}] gán A-D ${od.kien.join("/")}${dupOrderIds.has(od.id) ? "  ⚠ NGHI TRÙNG" : ""}`);
    }
  }

  // 6. Tồn thô theo nhóm tới hết NGAY
  const groups = new Map();
  const g = (l) => {
    const k = `${(l.loai_csr || "").trim() || "—"}||${resolveNguon(l.suffix)}||${(l.boc || "").trim()}||${r2(num(l.loai_banh))}`;
    if (!groups.has(k)) groups.set(k, { tonTho: 0 });
    return groups.get(k);
  };
  for (const l of lots) {
    const list = txByLot.get(l.id);
    if (list) {
      for (const t of list) if ((t.ngay_nhap || "") <= NGAY) g(l).tonTho += num(t.so_kg);
    } else {
      const d = (l.ngay_ht || l.ngay_sx || "").slice(0, 10);
      if (d && d <= NGAY) g(l).tonTho += num(l.tong_kg);
    }
  }
  for (const o of orders) {
    const d = (o.ngay || "").slice(0, 10);
    const approved = o.trang_thai == null || o.trang_thai === "da_phe_duyet";
    if (!d || d > NGAY || !approved) continue;
    for (const a of o.assignments || []) {
      const l = resolveLot(a).lot;
      if (!l) continue;
      g(l).tonTho -= KIEN.reduce((s, k) => s + num(a[`kien_${k}`]), 0) * num(l.loai_banh);
    }
  }
  const chotDates = [...new Set((opening || []).map((o) => o.ngay_chot))].filter((d) => d <= NGAY).sort();
  const chot = chotDates.at(-1);
  console.log(`\n[6] Tồn thô tự tính theo nhóm (đơn xuất đã duyệt) tới hết ${NGAY}${chot ? ` — mốc chốt gần nhất ${chot}` : " — chưa có mốc chốt"}`);
  let tong = 0;
  for (const [k, v] of [...groups.entries()].sort()) {
    if (Math.abs(v.tonTho) < 0.01) continue;
    tong += v.tonTho;
    console.log(`    ${k.replaceAll("||", " | ")}: ${fmt(v.tonTho)} kg${v.tonTho < 0 ? "  ← ÂM" : ""}`);
  }
  console.log(`    Tổng: ${fmt(tong)} kg`);
  if (chot) {
    const tongChot = (opening || []).filter((o) => o.ngay_chot === chot).reduce((s, o) => s + num(o.ton_kg), 0);
    console.log(`    Tổng tồn chốt ngày ${chot}: ${fmt(tongChot)} kg`);
  }

  report[f.code] = { orphans: orphans.map((l) => l.ma_lo), mismatch, bocLech, missing, over, chot: chot || null };
  console.log("");
}

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  console.log(`Đã ghi ${JSON_OUT}`);
}
