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
  const { data, error } = await sb.from('lots').select('id, ma_lo, num, suffix, year, tong_banh').range(from, from + 999);
  if (error) throw error;
  allDbLots.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}
const dbLotMap = new Set(allDbLots.map(l => l.ma_lo.toLowerCase()));

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

let matchedDbCount = 0;
let noMatchCount = 0;
let allLotsValidInDb = 0;
let partialLotsInDb = 0;
let zeroLotsInDb = 0;
let noLotsField = 0;

const matchedList = [];
const allValidList = [];
const partialList = [];

for (const p of parentRows) {
  const pDate = excelDateToISO(p.Ngay_xuat);
  const soTb = String(p.Thong_bao_GH || '').trim();
  const children = childByPid.get(p.ID) || [];
  
  // Check if matches DB export_orders
  const matched = dbOrders.find(o => o.ngay === pDate && (soTb && (o.so_thong_bao === soTb || String(o.so_thong_bao).includes(soTb))));
  if (matched) {
    matchedDbCount++;
    matchedList.push({ pid: p.ID, date: pDate, soTb, dbMaDon: matched.ma_don });
    continue;
  }
  noMatchCount++;

  let totalLots = 0;
  let validLots = 0;
  let invalidLots = 0;

  for (const c of children) {
    const rawLots = String(c.So_lo_xuat || '').split(',').map(s => s.trim()).filter(Boolean);
    totalLots += rawLots.length;
    for (const r of rawLots) {
      const m = r.match(/^(\d+)([a-zA-Z]*)/);
      if (m) {
        const num = parseInt(m[1], 10);
        const sfx = m[2] || (c.Hau_to_lo || 'cs');
        const key25 = (num + sfx + '/25').toLowerCase();
        const key26 = (num + sfx + '/26').toLowerCase();
        if (dbLotMap.has(key25) || dbLotMap.has(key26)) {
          validLots++;
        } else {
          invalidLots++;
        }
      }
    }
  }

  if (totalLots === 0) noLotsField++;
  else if (invalidLots === 0) {
    allLotsValidInDb++;
    allValidList.push({ pid: p.ID, date: pDate, soTb, totalLots });
  } else if (validLots > 0) {
    partialLotsInDb++;
    partialList.push({ pid: p.ID, date: pDate, soTb, totalLots, validLots, invalidLots });
  } else {
    zeroLotsInDb++;
  }
}

console.log('TỔNG ĐƠN EXCEL:', parentRows.length);
console.log('1. Đơn trùng với DB (bỏ qua):', matchedDbCount);
console.log('2. Đơn không trùng với DB:', noMatchCount);
console.log('   - 100% lô có trong DB (lô >= 1593cs):', allLotsValidInDb);
console.log('   - Hỗn hợp (có lô trong DB & có lô < 1593cs):', partialLotsInDb);
console.log('   - 100% lô cũ trước 1593cs (năm 2024 hoặc trước 29/12/2025):', zeroLotsInDb);
console.log('   - Không có danh sách lô:', noLotsField);

console.log('\n--- CÁC ĐƠN TRÙNG VỚI DB ---');
console.table(matchedList);

console.log('\n--- CÁC ĐƠN HỖN HỢP (PARTIAL) ---');
console.table(partialList);
