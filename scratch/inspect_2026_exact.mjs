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
  const { data, error } = await sb.from('lots').select('id, ma_lo, num, suffix, year, loai_banh, tong_banh, trang_thai').range(from, from + 999);
  if (error) throw error;
  allDbLots.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}

const dbLotByMaLo = new Map(allDbLots.map(l => [l.ma_lo.toLowerCase(), l]));

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

// Check only 2026 orders
const orders2026 = parentRows.filter(p => {
  const d = excelDateToISO(p.Ngay_xuat);
  return d && d >= '2026-01-01';
});

console.log('--- PHÂN TÍCH TỪNG ĐƠN HÀNG 2026 THEO NAM_TP VÀ LÔ DB ---');

const summaryList = [];

for (const p of orders2026) {
  const pDate = excelDateToISO(p.Ngay_xuat);
  const soTb = String(p.Thong_bao_GH || '').trim();
  const children = childByPid.get(p.ID) || [];

  // Check matched DB order
  const matched = dbOrders.find(o => o.ngay === pDate && (soTb && (o.so_thong_bao === soTb || String(o.so_thong_bao).includes(soTb))));

  let totalLotsInOrder = 0;
  let lotsMatchedDb = 0;
  let lotsUnmatched = 0;
  const matchedLotNames = [];
  const unmatchedLotNames = [];
  const namTpSet = new Set();

  for (const c of children) {
    const yr = c.nam_tp ? String(c.nam_tp).slice(-2) : '26';
    namTpSet.add(c.nam_tp);
    const rawLots = String(c.So_lo_xuat || '').split(',').map(s => s.trim()).filter(Boolean);
    totalLotsInOrder += rawLots.length;

    for (const r of rawLots) {
      const m = r.match(/^(\d+)([a-zA-Z]*)/);
      if (m) {
        const num = parseInt(m[1], 10);
        const sfx = m[2] || (c.Hau_to_lo || 'cs');
        const expectedMaLo = (num + sfx + '/' + yr).toLowerCase();
        const found = dbLotByMaLo.get(expectedMaLo);
        if (found) {
          lotsMatchedDb++;
          matchedLotNames.push(found.ma_lo);
        } else {
          lotsUnmatched++;
          unmatchedLotNames.push(expectedMaLo);
        }
      }
    }
  }

  summaryList.push({
    pid: p.ID,
    date: pDate,
    soTb,
    matchedDb: matched ? matched.ma_don : null,
    namTp: Array.from(namTpSet).join(', '),
    totalLots: totalLotsInOrder,
    matchedLots: lotsMatchedDb,
    unmatchedLots: lotsUnmatched,
    sampleUnmatched: unmatchedLotNames.slice(0, 2).join(', '),
    sampleMatched: matchedLotNames.slice(0, 2).join(', ')
  });
}

console.log('\n--- 2026 ORDERS ROWS 0..15 ---');
console.table(summaryList.slice(0, 16));

