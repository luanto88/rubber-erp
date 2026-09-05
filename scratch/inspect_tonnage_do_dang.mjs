import XLSX from 'xlsx';

const wbC = XLSX.readFile('cung_cap_dl/xuat_hang_chi_tiet.xlsx');
const childRows = XLSX.utils.sheet_to_json(wbC.Sheets[wbC.SheetNames[0]], { defval: null });

function parseLoaiBanh(v) {
  if (!v) return 35;
  const s = String(v).replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 35 : n;
}

console.log('--- KIỂM TRA LOGIC KHỐI LƯỢNG, SỐ LÔ TRÒN, SỐ LÔ DỞ DANG ---');

const discrepancies = [];
const matches = [];

for (const c of childRows) {
  const lb = parseLoaiBanh(c.Loai_banh);
  const klExcel = parseFloat(String(c.Khoi_luong || '0').replace(',', '.')) || 0;
  
  // Parse full lots from So_lo_xuat
  const rawLots = String(c.So_lo_xuat || '').split(',').map(s => s.trim()).filter(Boolean);
  
  // Parse partial lots from Lo_do_dang
  // Format example: "961=48,1338=72" or "1360=59,1374=96,1371=90" or "143=65; 1376=55"
  let doDangBanh = 0;
  const doDangParsed = [];
  if (c.Lo_do_dang) {
    const tokens = String(c.Lo_do_dang).split(/[,;]/).map(s => s.trim()).filter(Boolean);
    for (const t of tokens) {
      const m = t.match(/(\d+)\s*=\s*(\d+)/);
      if (m) {
        const lotNum = m[1];
        const banh = parseInt(m[2], 10);
        doDangBanh += banh;
        doDangParsed.push({ lotNum, banh });
      } else {
        doDangParsed.push({ unparsed: t });
      }
    }
  }

  // Count how many full lots:
  // Are the lots in Lo_do_dang ALSO in So_lo_xuat, or separate?
  // Let's check:
  const doDangLotNums = new Set(doDangParsed.map(d => d.lotNum));
  let fullLotsCount = 0;
  let partialLotsInSoLoCount = 0;

  for (const r of rawLots) {
    const m = r.match(/^(\d+)/);
    if (m && doDangLotNums.has(m[1])) {
      partialLotsInSoLoCount++;
    } else {
      fullLotsCount++;
    }
  }

  // Calculate tonnage:
  // Method 1: If rawLots contains full lots, and Lo_do_dang are separate
  // Method 2: If rawLots contains BOTH full lots AND the dở dang lots (where each dở dang lot only has doDangBanh, not 144 banh)
  const totalBanh_Method1 = (rawLots.length * 144) + doDangBanh;
  const totalKg_Method1 = (totalBanh_Method1 * lb) / 1000;

  const totalBanh_Method2 = (fullLotsCount * 144) + doDangBanh;
  const totalKg_Method2 = (totalBanh_Method2 * lb) / 1000;

  // Let's see which method matches klExcel:
  const diff1 = Math.abs(totalKg_Method1 - klExcel);
  const diff2 = Math.abs(totalKg_Method2 - klExcel);

  let bestMethod = null;
  let bestKg = 0;
  let bestBanh = 0;
  if (diff2 < 0.05) {
    bestMethod = 'Method2 (So_lo_xuat includes do_dang)';
    bestKg = totalKg_Method2;
    bestBanh = totalBanh_Method2;
    matches.push({ key: c.Key, id: c.ID, klExcel, bestKg, method: 2, doDang: c.Lo_do_dang });
  } else if (diff1 < 0.05) {
    bestMethod = 'Method1 (Lo_do_dang extra)';
    bestKg = totalKg_Method1;
    bestBanh = totalBanh_Method1;
    matches.push({ key: c.Key, id: c.ID, klExcel, bestKg, method: 1, doDang: c.Lo_do_dang });
  } else {
    discrepancies.push({
      key: c.Key,
      id: c.ID,
      nam_tp: c.nam_tp,
      loai_banh: lb,
      rawLotsCount: rawLots.length,
      fullLotsCount,
      doDang: c.Lo_do_dang,
      doDangBanh,
      klExcel,
      kgMethod1: totalKg_Method1.toFixed(3),
      kgMethod2: totalKg_Method2.toFixed(3),
      diff2: (totalKg_Method2 - klExcel).toFixed(3)
    });
  }
}

console.log(`Matches: ${matches.length} / ${childRows.length}`);
console.log(`Discrepancies: ${discrepancies.length} / ${childRows.length}`);

console.log('\n--- CÁC DÒNG CÓ LỆCH KHỐI LƯỢNG (DISCREPANCIES) ---');
console.table(discrepancies);
