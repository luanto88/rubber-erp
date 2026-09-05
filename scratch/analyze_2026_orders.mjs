import XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

// 1. Fetch DB lots
let allDbLots = [];
let from = 0;
while (true) {
  const { data, error } = await sb.from('lots').select('id, ma_lo, num, suffix, year, tong_banh, ngay_sx').range(from, from + 999);
  if (error) throw error;
  allDbLots.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}
const dbLotMap25 = new Map(allDbLots.filter(l => l.year === '25').map(l => [l.num, l]));
const dbLotMap26 = new Map(allDbLots.filter(l => l.year === '26').map(l => [l.num, l]));

console.log('Lots 25 in DB:', dbLotMap25.size, 'range: [1593..1613]');
console.log('Lots 26 in DB:', dbLotMap26.size, 'range: [1..1460]');

// 2. Fetch existing DB export_orders
const { data: dbOrders } = await sb.from('export_orders').select('id, ma_don, ngay, so_thong_bao, so_hoa_don, tong_banh');

// 3. Read Excel
const wbP = XLSX.readFile('cung_cap_dl/xuat_hang.xlsx');
const parentRows = XLSX.utils.sheet_to_json(wbP.Sheets[wbP.SheetNames[0]], { defval: null });
const wbC = XLSX.readFile('cung_cap_dl/xuat_hang_chi_tiet.xlsx');
const childRows = XLSX.utils.sheet_to_json(wbC.Sheets[wbC.SheetNames[0]], { defval: null });

function excelDateToISO(v) {
  if (!v) return null;
  if (typeof v === 'number') {
    const d = new Date((v - 25569) * 86400 * 1000);
    return d.toISOString().slice(0, 10);
  }
  const str = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  const m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  return str;
}

const childByPid = new Map();
for (const c of childRows) {
  if (!childByPid.has(c.ID)) childByPid.set(c.ID, []);
  childByPid.get(c.ID).push(c);
}

// Filter only 2026 orders in Excel
const orders2026 = parentRows.filter(p => {
  const d = excelDateToISO(p.Ngay_xuat);
  return d && d >= '2026-01-01';
});

console.log('Total orders in 2026 in Excel:', orders2026.length);

const results2026 = [];

for (const p of orders2026) {
  const pDate = excelDateToISO(p.Ngay_xuat);
  const soTb = String(p.Thong_bao_GH || '').trim();
  const children = childByPid.get(p.ID) || [];

  // Check matching with DB export_orders
  const matched = dbOrders.find(o => o.ngay === pDate && (soTb && (o.so_thong_bao === soTb || String(o.so_thong_bao).includes(soTb))));

  let totalLots = 0;
  let lotsInDb = [];
  let lotsNotInDb = [];
  let doDangInfo = [];
  let totalKg = 0;
  let loaiBanh = null;
  let chungLoai = null;
  let loaiBoc = null;

  for (const c of children) {
    if (c.Khoi_luong) totalKg += parseFloat(String(c.Khoi_luong).replace(',', '.')) || 0;
    if (c.Loai_banh) loaiBanh = c.Loai_banh;
    if (c.Chung_loai_xuat) chungLoai = c.Chung_loai_xuat;
    if (c.Loai_vat_tu_xuat) loaiBoc = c.Loai_vat_tu_xuat;
    if (c.Lo_do_dang) doDangInfo.push(c.Lo_do_dang);

    const yr = c.nam_tp || 2026;
    const rawLots = String(c.So_lo_xuat || '').split(',').map(s => s.trim()).filter(Boolean);
    totalLots += rawLots.length;

    for (const r of rawLots) {
      const m = r.match(/^(\d+)/);
      if (m) {
        const num = parseInt(m[1], 10);
        let found = null;
        if (yr === 2025 || num >= 1500) {
          if (dbLotMap25.has(num)) found = dbLotMap25.get(num);
        }
        if (!found && dbLotMap26.has(num)) {
          found = dbLotMap26.get(num);
        }
        if (found) {
          lotsInDb.push(found.ma_lo);
        } else {
          lotsNotInDb.push(r + '(nam:' + yr + ')');
        }
      }
    }
  }

  results2026.push({
    pid: p.ID,
    date: pDate,
    soTb,
    matchedDb: matched ? matched.ma_don : null,
    totalKg: totalKg.toFixed(2),
    totalLots,
    inDbCount: lotsInDb.length,
    notInDbCount: lotsNotInDb.length,
    sampleNotInDb: lotsNotInDb.slice(0, 3).join(', '),
    doDang: doDangInfo.join('; ')
  });
}

console.log('\n--- BẢNG THỐNG KÊ 45 ĐƠN HÀNG NĂM 2026 (PHẦN 1: 0..20) ---');
console.table(results2026.slice(0, 20));

