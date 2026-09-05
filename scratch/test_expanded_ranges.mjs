import XLSX from 'xlsx';

const wbC = XLSX.readFile('cung_cap_dl/xuat_hang_chi_tiet.xlsx');
const childRows = XLSX.utils.sheet_to_json(wbC.Sheets[wbC.SheetNames[0]], { defval: null });

function parseLoaiBanh(v) {
  if (!v) return 35;
  const s = String(v).replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 35 : n;
}

function parseRange(str) {
  if (!str) return [];
  const res = [];
  const parts = String(str).split(/[,;]/).map(s => s.trim()).filter(Boolean);
  for (const p of parts) {
    const m = p.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const start = parseInt(m[1], 10);
      const end = parseInt(m[2], 10);
      for (let i = start; i <= end; i++) res.push(i);
    } else {
      const mSingle = p.match(/^(\d+)/);
      if (mSingle) res.push(parseInt(mSingle[1], 10));
    }
  }
  return res;
}

console.log('--- TEST EXPANDED FORMULA ON CHILD ROWS ---');

let perfectMatch = 0;
let remainingDiscrepancies = [];

for (const c of childRows) {
  const lb = parseLoaiBanh(c.Loai_banh);
  const klExcel = parseFloat(String(c.Khoi_luong || '0').replace(',', '.')) || 0;
  
  // 1. Gather all full lots from:
  // a) Khoang_lo_1, 2, 3, 4
  // b) Lo_con_lai
  // c) So_lo_xuat (fallback if Khoang_lo is empty)
  let fullLotNums = new Set();
  
  const hasKhoang = c.Khoang_lo_1 || c.Khoang_lo_2 || c.Khoang_lo_3 || c.Khoang_lo_4;
  if (hasKhoang) {
    for (const r of [c.Khoang_lo_1, c.Khoang_lo_2, c.Khoang_lo_3, c.Khoang_lo_4]) {
      if (r) parseRange(r).forEach(n => fullLotNums.add(n));
    }
    if (c.Lo_con_lai) {
      parseRange(c.Lo_con_lai).forEach(n => fullLotNums.add(n));
    }
  } else {
    // If no Khoang_lo, parse from So_lo_xuat
    const rawLots = String(c.So_lo_xuat || '').split(',').map(s => s.trim()).filter(Boolean);
    for (const r of rawLots) {
      const m = r.match(/^(\d+)/);
      if (m) fullLotNums.add(parseInt(m[1], 10));
    }
  }

  // 2. Parse Lo_do_dang
  let doDangBanh = 0;
  const doDangLots = new Map();
  if (c.Lo_do_dang) {
    const tokens = String(c.Lo_do_dang).split(/[,;]/).map(s => s.trim()).filter(Boolean);
    for (const t of tokens) {
      const m = t.match(/(\d+)\s*=\s*(\d+)/);
      if (m) {
        const lotNum = parseInt(m[1], 10);
        const banh = parseInt(m[2], 10);
        doDangBanh += banh;
        doDangLots.set(lotNum, banh);
        // If this lot was in fullLotNums, remove it from full lots!
        fullLotNums.delete(lotNum);
      }
    }
  }

  const calculatedBanh = (fullLotNums.size * 144) + doDangBanh;
  const calculatedKg = (calculatedBanh * lb) / 1000;
  const diff = Math.abs(calculatedKg - klExcel);

  if (diff < 0.05) {
    perfectMatch++;
  } else {
    remainingDiscrepancies.push({
      key: c.Key,
      id: c.ID,
      nam_tp: c.nam_tp,
      klExcel,
      calculatedKg: calculatedKg.toFixed(3),
      diff: (calculatedKg - klExcel).toFixed(3),
      fullLotsCount: fullLotNums.size,
      doDangBanh,
      khoang1: c.Khoang_lo_1,
      khoang2: c.Khoang_lo_2,
      conLai: c.Lo_con_lai,
      doDang: c.Lo_do_dang,
      soLo: String(c.So_lo_xuat || '').slice(0, 30)
    });
  }
}

console.log(`Perfect Match: ${perfectMatch} / ${childRows.length}`);
console.log(`Remaining Discrepancies: ${remainingDiscrepancies.length} / ${childRows.length}`);
console.table(remainingDiscrepancies);
