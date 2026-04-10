/**
 * RUBBER ERP — Import backup.json → Supabase (v2)
 * Đúng với schema thực tế: UUID keys, factory_id, tên bảng thật
 * 
 * Chạy: node import-supabase-v2.mjs
 */
import { readFileSync, existsSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";

// ─── Load .env.local ──────────────────────────────────────────────────────────
function loadEnv() {
  if (!existsSync(".env.local")) return;
  readFileSync(".env.local","utf8").split("\n").forEach(line => {
    const [k,...v] = line.split("=");
    if (k && v.length) process.env[k.trim()] = v.join("=").trim();
  });
}
loadEnv();

const BASE = process.env.SUPABASE_URL || "https://kaoeenrewvltnrbxmjfe.supabase.co";
const KEY  = process.env.SUPABASE_SERVICE_KEY || "";
const BATCH = 50;

if (!KEY) {
  console.error("❌ Thiếu SUPABASE_SERVICE_KEY trong .env.local");
  process.exit(1);
}

const H = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
  Prefer: "resolution=merge-duplicates,return=minimal",
};

// ─── REST helpers ─────────────────────────────────────────────────────────────
async function GET(table, params = "") {
  const res = await fetch(`${BASE}/rest/v1/${table}?${params}`, { headers: H });
  if (!res.ok) throw new Error(`GET ${table}: ${await res.text()}`);
  return res.json();
}

async function POST(table, rows) {
  let ok = 0, fail = 0;
  const batches = [];
  for (let i = 0; i < rows.length; i += BATCH) batches.push(rows.slice(i, i+BATCH));

  for (const batch of batches) {
    const res = await fetch(`${BASE}/rest/v1/${table}`, {
      method: "POST", headers: H, body: JSON.stringify(batch),
    });
    if (res.ok) { ok += batch.length; }
    else {
      fail += batch.length;
      const err = await res.text();
      console.log(`\n  ⚠️  [${table}] ${err.slice(0,200)}`);
    }
    process.stdout.write(`\r  ↳ ${ok+fail}/${rows.length} (✓${ok} ✗${fail})`);
  }
  process.stdout.write("\n");
  return { ok, fail };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const backup = JSON.parse(readFileSync("backup.json","utf8"));
console.log(`\n📦 Backup: ${backup._backup_date}`);

// 1. Lấy factory_id
console.log("\n🔍 Lấy danh sách factories...");
const factories = await GET("factories", "select=id,code,name");
console.log("  Factories tìm thấy:");
factories.forEach(f => console.log(`  - [${f.id}] ${f.code} — ${f.name}`));

// Chọn factory (CSR = Phước Hòa KT)
let FACTORY_ID = factories[0]?.id;
const csrFactory = factories.find(f =>
  f.code?.toLowerCase().includes("phuochoa") ||
  f.code?.toLowerCase().includes("kt") ||
  f.name?.toLowerCase().includes("kampong") ||
  f.name?.toLowerCase().includes("phước hòa")
);
if (csrFactory) FACTORY_ID = csrFactory.id;

console.log(`\n✅ Dùng factory_id: ${FACTORY_ID}`);
console.log(`   (${factories.find(f=>f.id===FACTORY_ID)?.name || "unknown"})\n`);

// 2. Tạo mapping: old key → new UUID
// Lưu vào file để debug nếu cần
const keyMap = { ngans: {}, lots: {}, customers: {}, qcResults: {} };

backup.ngans.forEach(r      => { keyMap.ngans[r.key]      = randomUUID(); });
backup.lots.forEach(r       => { keyMap.lots[r.key]       = randomUUID(); });
backup.customers.forEach(r  => { keyMap.customers[r.id]   = randomUUID(); });
backup.qcResults.forEach(r  => { keyMap.qcResults[r.key]  = randomUUID(); });

console.log("🗺  Key mapping tạo xong:");
console.log(`   ngans: ${Object.keys(keyMap.ngans).length}`);
console.log(`   lots:  ${Object.keys(keyMap.lots).length}`);
console.log(`   qc:    ${Object.keys(keyMap.qcResults).length}\n`);

// 3. Import ngans
console.log("📥 ngans...");
const nganRows = backup.ngans.map(r => ({
  id:           keyMap.ngans[r.key],
  factory_id:   FACTORY_ID,
  ma_ngan:      r.ma_ngan      ?? "",
  ten_ngan:     r.ten_ngan     ?? "",
  loai_nl:      r.loai_nl      ?? "",
  nguon_goc:    r.nguon_goc    ?? "",
  xu_ly:        r.xu_ly        ?? "",
  chung_nhan:   r.chung_nhan   ?? "",
  ngay_bd:      r.ngay_bd      || null,
  ngay_kt:      r.ngay_kt      || null,
  trang_thai:   r.trang_thai   ?? "",
  tong_tuoi:    r.tong_tuoi    ?? 0,
  tong_kho:     r.tong_kho     ?? 0,
  trips:        r.trips        ?? [],
  lo_nguon_goc: r.lo_nguon_goc ?? "",
}));
const r1 = await POST("ngans", nganRows);

// 4. Import customers
console.log("📥 customers...");
const custRows = backup.customers.map(r => ({
  id:        keyMap.customers[r.id],
  factory_id: FACTORY_ID,
  ma_kh:     r.ma_kh     ?? "",
  ten_kh_en: r.ten_kh_en ?? "",
  email:     r.email     ?? "",
  dia_chi:   r.dia_chi   ?? "",
}));
const r2 = await POST("customers", custRows);

// 5. Import lots (cần ngan_id từ mapping)
console.log("📥 lots...");
const lotRows = backup.lots.map(r => ({
  id:            keyMap.lots[r.key],
  factory_id:    FACTORY_ID,
  ma_lo:         r.ma_lo      ?? "",
  num:           r.num        ?? 0,
  suffix:        r.suffix     ?? "",
  year:          r.year       ?? "",
  ngay_sx:       r.ngay_sx    || null,
  ca:            r.ca         ?? "",
  ngan_id:       r.ngan_ref ? (keyMap.ngans[r.ngan_ref] ?? null) : null,
  loai_csr:      r.loai_csr   ?? "",
  loai_banh:     r.loai_banh  ?? 35,
  boc:           r.boc        ?? "",
  tham:          r.tham       ?? "",
  pallet:        r.pallet     ?? [],
  chi_thi:       r.chi_thi    ?? "",
  kien_a:        r.kien_a     ?? 0,
  kien_b:        r.kien_b     ?? 0,
  kien_c:        r.kien_c     ?? 0,
  kien_d:        r.kien_d     ?? 0,
  tong_banh:     r.tong_banh  ?? 0,
  tong_kg:       r.tong_kg    ?? 0,
  trang_thai:    r.trang_thai ?? "",
  ghi_chu:       r.ghi_chu    ?? "",
  dd_snapshot:   r.dd_snapshot ?? null,
  is_manual_edit: r.isManualEdit ?? false,
  edit_key:      r.editKey    ?? null,
}));
const r3 = await POST("lots", lotRows);

// 6. Import qc_results (cần lot_id từ mapping)
console.log("📥 qc_results...");
// Build lot key→uuid map by ma_lo for fallback
const lotKeyByMaLo = {};
backup.lots.forEach(r => { lotKeyByMaLo[r.ma_lo] = keyMap.lots[r.key]; });

const qcRows = backup.qcResults.map(r => ({
  id:         keyMap.qcResults[r.key],
  factory_id: FACTORY_ID,
  lot_id:     r.lot_ref ? (keyMap.lots[r.lot_ref] ?? lotKeyByMaLo[r.ma_lo] ?? null) : (lotKeyByMaLo[r.ma_lo] ?? null),
  ma_lo:      r.ma_lo      ?? "",
  pkn:        r.pkn        ?? 0,
  ngay_kn:    r.ngay_kn    || null,
  ngay_sx:    r.ngay_sx    || null,
  chung_loai: r.chung_loai ?? "",
  loai_csr:   r.loai_csr   ?? "",
  loai_kn:    r.loai_kn    ?? "",
  tieu_chuan: r.tieu_chuan ?? "",
  so_mau:     r.so_mau     ?? 6,
  samples:    r.samples    ?? {},
  grade:      r.grade      ?? {},
  dat_hang:   r.dat_hang   ?? "",
  trang_thai: r.trang_thai ?? "",
}));
const r4 = await POST("qc_results", qcRows);

// 7. Import dispatch_entries (dx_history)
console.log("📥 dispatch_entries...");
// Schema: id, factory_id, ngay, chung_nhan, rows
// Lưu toàn bộ dxHistory rows vào JSONB rows column
const dxRows = backup.dxHistory.map(r => ({
  id:          randomUUID(),
  factory_id:  FACTORY_ID,
  ngay:        r.ngay ?? "",
  chung_nhan:  r.rows?.[0]?.chung_nhan ?? "",
  rows:        r.rows ?? [],
}));
const r5 = await POST("dispatch_entries", dxRows);

// 8. Import export_orders
console.log("📥 export_orders...");
// customer_id: cần UUID từ mapping, match bằng ma_kh
const custIdByMaKh = {};
backup.customers.forEach(r => { custIdByMaKh[r.ma_kh] = keyMap.customers[r.id]; });

const xhRows = backup.xhOrders.map(r => ({
  id:           randomUUID(),
  factory_id:   FACTORY_ID,
  ma_don:       r.ma_don        ?? "",
  ngay:         r.ngay          || null,
  so_thong_bao: r.so_thong_bao  ?? "",
  so_hoa_don:   r.so_hoa_don    ?? "",
  so_hop_dong:  r.so_hop_dong   ?? "",
  customer_id:  custIdByMaKh[r.ma_kh] ?? null,
  chung_loai:   r.chung_loai    ?? "",
  loai_pallet:  r.loai_pallet   ?? "",
  vehicles:     r.vehicles      ?? [],
  assignments:  r.assignments   ?? [],
  tong_banh:    r.tong_banh     ?? 0,
}));
const r6 = await POST("export_orders", xhRows);

// ─── Summary ──────────────────────────────────────────────────────────────────
const all = [
  ["ngans",            r1],
  ["customers",        r2],
  ["lots",             r3],
  ["qc_results",       r4],
  ["dispatch_entries", r5],
  ["export_orders",    r6],
];

console.log("\n══════════════════════════════════════");
let totalOk = 0, totalFail = 0;
for (const [name, r] of all) {
  const icon = r.fail === 0 ? "✅" : r.ok === 0 ? "❌" : "⚠️ ";
  console.log(`${icon} ${name.padEnd(20)} ✓${r.ok}  ✗${r.fail}`);
  totalOk += r.ok; totalFail += r.fail;
}
console.log("──────────────────────────────────────");
console.log(`   TỔNG: ✓${totalOk}  ✗${totalFail}`);
console.log("══════════════════════════════════════\n");

// Lưu key mapping để dùng sau
writeFileSync("key-mapping.json", JSON.stringify(keyMap, null, 2));
console.log("💾 key-mapping.json đã lưu (dùng để debug hoặc migrate thêm)\n");
