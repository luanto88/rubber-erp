import XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

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
console.log(`[DB] Loaded ${allDbLots.length} lots from Supabase.`);

const dbLotMap = new Map();
for (const l of allDbLots) {
  // e.g. "1593cs/25" -> l
  dbLotMap.set(l.ma_lo.toLowerCase(), l);
  // Also key without year: "1593cs" -> l if unique, but year could be 25 or 26.
  // Store array for "1593cs"
  const baseKey = `${l.num}${l.suffix || ''}`.toLowerCase();
  if (!dbLotMap.has(baseKey)) dbLotMap.set(baseKey, []);
  if (Array.isArray(dbLotMap.get(baseKey))) {
    dbLotMap.get(baseKey).push(l);
  }
}

// 2. Fetch existing DB export_orders
const { data: dbOrders, error: orderErr } = await sb.from('export_orders').select('*');
if (orderErr) throw orderErr;
console.log(`[DB] Loaded ${dbOrders.length} existing export orders.`);

// 3. Fetch DB customers
const { data: dbCustomers } = await sb.from('customers').select('*');
console.log(`[DB] Loaded ${dbCustomers.length} customers.`);
const custMap = new Map();
for (const c of dbCustomers) {
  custMap.set(c.ma_kh.toUpperCase(), c);
}

// 4. Read Excel files
const wbP = XLSX.readFile('cung_cap_dl/xuat_hang.xlsx');
const parentRows = XLSX.utils.sheet_to_json(wbP.Sheets[wbP.SheetNames[0]], { defval: null });

const wbC = XLSX.readFile('cung_cap_dl/xuat_hang_chi_tiet.xlsx');
const childRows = XLSX.utils.sheet_to_json(wbC.Sheets[wbC.SheetNames[0]], { defval: null });

console.log(`[Excel] Parent rows: ${parentRows.length}, Child rows: ${childRows.length}`);

// Map children to parent
const childByPid = new Map();
for (const c of childRows) {
  if (!childByPid.has(c.ID)) childByPid.set(c.ID, []);
  childByPid.get(c.ID).push(c);
}

// Check how many parent rows have children
let parentsWithChildren = 0;
let parentsWithoutChildren = 0;
for (const p of parentRows) {
  const c = childByPid.get(p.ID);
  if (c && c.length > 0) parentsWithChildren++;
  else parentsWithoutChildren++;
}
console.log(`Parents with children: ${parentsWithChildren}, without: ${parentsWithoutChildren}`);

// Detailed analysis per parent row
const analysis = [];

for (const p of parentRows) {
  const pid = String(p.ID || '');
  const pDate = excelDateToISO(p.Ngay_xuat);
  const soTb = String(p.Thong_bao_GH || '').trim();
  const children = childByPid.get(p.ID) || [];
  
  // Extract customer code from ID or Ghi_chu
  let custCode = null;
  const mPrefix = pid.match(/^XH-([A-Z\s\.]+)\./i);
  if (mPrefix) {
    custCode = mPrefix[1].trim().toUpperCase();
  } else if (p.Ghi_chu) {
    const gc = String(p.Ghi_chu).toUpperCase();
    if (gc.includes('PHR')) custCode = 'PHR';
    else if (gc.includes('KUMHO')) custCode = 'KUMHO';
    else if (gc.includes('NBS') || gc.includes('NEWBUSTAR')) custCode = 'NBS';
    else if (gc.includes('HG')) custCode = 'HG';
  }

  // Check matching with DB existing orders
  let matchedDbOrder = null;
  for (const dbo of dbOrders) {
    // Compare date & so_thong_bao
    const dboDate = dbo.ngay;
    const dboTb = String(dbo.so_thong_bao || '');
    if (dboDate === pDate) {
      if (soTb && (dboTb === soTb || dboTb.startsWith(soTb + '/') || dboTb.includes(soTb))) {
        matchedDbOrder = dbo;
        break;
      }
    }
  }

  // Analyze lots in children
  let totalBanhCalc = 0;
  let totalKgCalc = 0;
  let totalKgExcel = 0;
  const lotsList = [];
  const validLotsInDb = [];
  const invalidLotsMissing = [];
  const doDangLots = [];
  let hasImage = false;
  const images = [];

  for (const c of children) {
    // Parse Loai_banh
    let lb = 35;
    if (c.Loai_banh) {
      const lbStr = String(c.Loai_banh).replace(',', '.');
      const parsed = parseFloat(lbStr);
      if (!isNaN(parsed)) lb = parsed;
    }

    if (c.Khoi_luong) {
      const klNum = parseFloat(String(c.Khoi_luong).replace(',', '.'));
      if (!isNaN(klNum)) totalKgExcel += klNum;
    }

    // Check images
    for (let i = 1; i <= 6; i++) {
      const img = c[`Hinh_anh ${i}`];
      if (img) {
        hasImage = true;
        images.push(img);
      }
    }

    // Parse So_lo_xuat
    const rawLots = String(c.So_lo_xuat || '').split(',').map(s => s.trim()).filter(Boolean);
    const yr = c.nam_tp ? String(c.nam_tp).slice(-2) : (pDate ? pDate.slice(2, 4) : '26');
    
    // Check Lo_do_dang
    if (c.Lo_do_dang) {
      doDangLots.push({
        raw: c.Lo_do_dang,
        childKey: c.Key
      });
    }

    for (const rawL of rawLots) {
      lotsList.push(rawL);
      // Determine if it matches DB lot
      // rawL could be "1593cs", "1084", "420cs"
      const match = rawL.match(/^(\d+)([a-zA-Z]*)/);
      if (match) {
        const num = parseInt(match[1], 10);
        const sfx = match[2] || (c.Hau_to_lo || 'cs');
        
        // Try exact match with year
        const fullMaLo25 = `${num}${sfx}/25`.toLowerCase();
        const fullMaLo26 = `${num}${sfx}/26`.toLowerCase();
        
        let foundDbLot = null;
        if (c.nam_tp === 2025 || (num >= 1593 && num <= 1613 && pDate <= '2026-05-01')) {
          foundDbLot = dbLotMap.get(fullMaLo25);
        }
        if (!foundDbLot) {
          foundDbLot = dbLotMap.get(fullMaLo26);
        }
        if (!foundDbLot && dbLotMap.has(fullMaLo25)) {
          foundDbLot = dbLotMap.get(fullMaLo25);
        }

        if (foundDbLot) {
          validLotsInDb.push({ raw: rawL, dbLot: foundDbLot });
        } else {
          invalidLotsMissing.push({ raw: rawL, num, sfx, yr });
        }
      }
    }
  }

  analysis.push({
    id: pid,
    date: pDate,
    soTb,
    custCode,
    matchedDbOrder: matchedDbOrder ? matchedDbOrder.ma_don : null,
    childCount: children.length,
    lotsCount: lotsList.length,
    validLotsCount: validLotsInDb.length,
    missingLotsCount: invalidLotsMissing.length,
    totalKgExcel,
    doDangLots,
    imagesCount: images.length,
    sampleMissingLots: invalidLotsMissing.slice(0, 3).map(l => l.raw),
    sampleValidLots: validLotsInDb.slice(0, 3).map(l => l.dbLot.ma_lo)
  });
}

// Summarize
console.log('\n--- TỔNG KẾT PHÂN LOẠI 181 ĐƠN HÀNG APPSHEET ---');
const matchedDb = analysis.filter(a => a.matchedDbOrder);
const noMatch = analysis.filter(a => !a.matchedDbOrder);

console.log(`1. Đã khớp với DB hiện tại (sẽ bỏ qua theo yêu cầu user): ${matchedDb.length} đơn`);
console.table(matchedDb.map(m => ({ id: m.id, date: m.date, soTb: m.soTb, cust: m.custCode, matchedDbMaDon: m.matchedDbOrder })));

console.log(`\n2. Chưa có trong DB: ${noMatch.length} đơn`);

// In noMatch, categorize by lot availability in DB
const noMatchWithAllValidLots = noMatch.filter(a => a.lotsCount > 0 && a.missingLotsCount === 0);
const noMatchWithSomeValidLots = noMatch.filter(a => a.validLotsCount > 0 && a.missingLotsCount > 0);
const noMatchWithZeroValidLots = noMatch.filter(a => a.lotsCount > 0 && a.validLotsCount === 0);
const noMatchWithZeroLots = noMatch.filter(a => a.lotsCount === 0);

console.log(`  - Có 100% lô tồn tại trong DB (lô >= 1593cs): ${noMatchWithAllValidLots.length} đơn`);
console.log(`  - Hỗn hợp: vừa có lô trong DB, vừa có lô < 1593cs: ${noMatchWithSomeValidLots.length} đơn`);
console.log(`  - Toàn bộ lô đều là lô cũ (< 1593cs, năm 2024 hoặc 2025): ${noMatchWithZeroValidLots.length} đơn`);
console.log(`  - Không khai báo lô trong So_lo_xuat: ${noMatchWithZeroLots.length} đơn`);

console.log('\n--- CHI TIẾT CÁC ĐƠN HỖN HỢP (CÓ CẢ LÔ TRONG VÀ NGOÀI DB) ---');
console.table(noMatchWithSomeValidLots.map(m => ({
  id: m.id,
  date: m.date,
  soTb: m.soTb,
  cust: m.custCode,
  validCount: m.validLotsCount,
  missingCount: m.missingLotsCount,
  sampleValid: m.sampleValidLots.join(', '),
  sampleMissing: m.sampleMissingLots.join(', ')
})));

console.log('\n--- CHI TIẾT CÁC ĐƠN CÓ 100% LÔ HỢP LỆ TRONG DB (ỨNG VIÊN CHÍNH ĐỂ MIGRATION) ---');
console.table(noMatchWithAllValidLots.map(m => ({
  id: m.id,
  date: m.date,
  soTb: m.soTb,
  cust: m.custCode,
  lotsCount: m.lotsCount,
  kgExcel: m.totalKgExcel,
  doDang: m.doDangLots.length > 0 ? JSON.stringify(m.doDangLots) : '',
  images: m.imagesCount
})));
