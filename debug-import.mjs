/**
 * DEBUG — Kiểm tra lỗi import từng bảng
 * Chạy: node debug-import.mjs
 */
import { readFileSync, existsSync } from "fs";

function loadEnv() {
  if (!existsSync(".env.local")) return;
  readFileSync(".env.local","utf8").split("\n").forEach(line => {
    const [k,...v] = line.split("=");
    if (k && v.length) process.env[k.trim()] = v.join("=").trim();
  });
}
loadEnv();

const URL  = process.env.SUPABASE_URL || "https://kaoeenrewvltnrbxmjfe.supabase.co";
const KEY  = process.env.SUPABASE_SERVICE_KEY || "";
const backup = JSON.parse(readFileSync("backup.json","utf8"));

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
  Prefer: "resolution=merge-duplicates,return=minimal",
};

async function testOne(table, row) {
  const res = await fetch(`${URL}/rest/v1/${table}`, {
    method: "POST",
    headers,
    body: JSON.stringify([row]),
  });
  const text = await res.text();
  return { status: res.status, ok: res.ok, body: text };
}

// Test 1 record từ mỗi bảng
const tests = [
  { table: "dx_history", row: { id: backup.dxHistory[0].id, ngay: backup.dxHistory[0].ngay, total_xe: backup.dxHistory[0].totalXe, total_diem: backup.dxHistory[0].totalDiem, status: backup.dxHistory[0].status, rows: backup.dxHistory[0].rows }},
  { table: "ngans",      row: (() => { const r=backup.ngans[0]; return { key:r.key,ma_ngan:r.ma_ngan,ten_ngan:r.ten_ngan,loai_nl:r.loai_nl,nguon_goc:r.nguon_goc,xu_ly:r.xu_ly,chung_nhan:r.chung_nhan,ngay_bd:r.ngay_bd||null,ngay_kt:r.ngay_kt||null,trang_thai:r.trang_thai,tong_tuoi:r.tong_tuoi||0,tong_kho:r.tong_kho||0,trips:r.trips||[],lo_nguon_goc:r.lo_nguon_goc||"" }})() },
  { table: "lots",       row: (() => { const r=backup.lots[0]; return { key:r.key,ma_lo:r.ma_lo,num:r.num,suffix:r.suffix,year:r.year,ngay_sx:r.ngay_sx||null,ca:r.ca,ngan_ref:r.ngan_ref||null,loai_csr:r.loai_csr,loai_banh:r.loai_banh||35,boc:r.boc||"",tham:r.tham||"",pallet:r.pallet||[],chi_thi:r.chi_thi||"",kien_a:r.kien_a||0,kien_b:r.kien_b||0,kien_c:r.kien_c||0,kien_d:r.kien_d||0,tong_banh:r.tong_banh||0,tong_kg:r.tong_kg||0,trang_thai:r.trang_thai||"",ghi_chu:r.ghi_chu||"" }})() },
  { table: "qc_results", row: (() => { const r=backup.qcResults[0]; return { key:r.key,lot_ref:r.lot_ref||null,ma_lo:r.ma_lo||"",pkn:r.pkn||0,ngay_kn:r.ngay_kn||null,ngay_sx:r.ngay_sx||null,chung_loai:r.chung_loai||"",loai_csr:r.loai_csr||"",loai_kn:r.loai_kn||"",tieu_chuan:r.tieu_chuan||"",so_mau:r.so_mau||6,samples:r.samples||{},grade:r.grade||{},dat_hang:r.dat_hang||"",trang_thai:r.trang_thai||"",ghi_chu:r.ghi_chu||"",audit_log:r.audit_log||[] }})() },
  { table: "customers",  row: (() => { const r=backup.customers[0]; return { id:r.id,ma_kh:r.ma_kh||"",ten_kh_en:r.ten_kh_en||"",email:r.email||"",dia_chi:r.dia_chi||"" }})() },
  { table: "xh_orders",  row: (() => { const r=backup.xhOrders[0]; return { key:r.key,ma_don:r.ma_don||"",ngay:r.ngay||null,so_thong_bao:r.so_thong_bao||"",so_hoa_don:r.so_hoa_don||"",so_hop_dong:r.so_hop_dong||"",ma_kh:r.ma_kh||"",ten_kh:r.ten_kh||"",chung_loai:r.chung_loai||"",loai_pallet:r.loai_pallet||"",vehicles:r.vehicles||[],assignments:r.assignments||[],tong_banh:r.tong_banh||0 }})() },
];

console.log("\n🔍 DEBUG — Test 1 record mỗi bảng:\n");
for (const t of tests) {
  const r = await testOne(t.table, t.row);
  const icon = r.ok ? "✅" : "❌";
  console.log(`${icon} ${t.table.padEnd(15)} [${r.status}] ${r.ok ? "OK" : r.body}`);
}
console.log("");
