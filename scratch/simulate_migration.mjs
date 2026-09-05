import XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

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
const { data: dbOrders } = await sb.from('export_orders').select('id, ma_don, ngay, so_thong_bao, so_hoa_don, tong_banh, customer_id');

// 3. Fetch customers
const { data: customers } = await sb.from('customers').select('*');
const customerByCode = new Map();
for (const c of customers) {
  customerByCode.set(c.ma_kh.toUpperCase(), c);
}

// 4. Read Excel
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

const childByPid = new Map();
for (const c of childRows) {
  if (!childByPid.has(c.ID)) childByPid.set(c.ID, []);
  childByPid.get(c.ID).push(c);
}

// Helper to determine customer code from parent ID or child Ghi_chu
function detectCustomerCode(p, children) {
  const pid = String(p.ID || '').toUpperCase();
  if (pid.includes('KUMHO')) return 'KUMHO';
  if (pid.includes('NEWBUSTAR') || pid.includes('NBS')) return 'NBS';
  if (pid.includes('PHR') || pid.includes('PHUOC HOA')) return 'PHR';
  if (pid.includes('HG')) return 'HG';
  if (pid.includes('HK RUBBER')) return 'HK RUBBER';

  for (const c of children) {
    const gc = String(c.Ghi_chu || '').toUpperCase();
    if (gc.includes('KUMHO')) return 'KUMHO';
    if (gc.includes('NEWBUSTAR') || gc.includes('NBS')) return 'NBS';
    if (gc.includes('PHR') || gc.includes('PHƯỚC HOÀ') || gc.includes('PHUOC HOA')) return 'PHR';
    if (gc.includes('HG')) return 'HG';
    if (gc.includes('HK RUBBER')) return 'HK RUBBER';
  }
  return null;
}

// Image search directories
const imageBaseDirs = [
  'G:/My Drive/appsheet/data/Chấtlượng-895871990/Xuat_hang_chi_tiet_Images',
  'G:/My Drive/appsheet/data/QuảnlýsảnxuấtKPT-895871990/Xuat_hang_chi_tiet_Images',
  'G:/My Drive/appsheet/data/PHKTraceEUDR-895871990/Xuat_hang_chi_tiet_Images',
  'G:/My Drive/appsheet/data/QuảnlýsảnxuấtKPTtest-895871990/Xuat_hang_chi_tiet_Images',
  'G:/My Drive/appsheet/data/TestGeoJson-895871990/Xuat_hang_chi_tiet_Images'
];

function findImageFile(relPath) {
  if (!relPath) return null;
  const fileName = relPath.replace(/^.*[\\\/]/, '');
  for (const dir of imageBaseDirs) {
    const full = dir + '/' + fileName;
    if (fs.existsSync(full)) return full;
  }
  return null;
}

// SIMULATION
const skipped_matchedDb = [];
const skipped_oldYear = [];
const skipped_allOldLots = [];
const skipped_noLots = [];
const toMigrateOrders = [];

// To track maxStt per customer per date
const customerDateSttMap = new Map();
// Seed with existing dbOrders
for (const o of dbOrders) {
  const dStr = o.ngay ? o.ngay.replace(/-/g, '') : '';
  // parse STT
  if (o.ma_don && o.ma_don.includes('/')) {
    const parts = o.ma_don.split('/');
    const stt = parseInt(parts[parts.length - 1], 10);
    const prefix = parts[0]; // e.g. XH-NBS-13-130226
    // find customer and date
    // ...
  }
}

for (const p of parentRows) {
  const pDate = excelDateToISO(p.Ngay_xuat);
  const soTb = String(p.Thong_bao_GH || '').trim();
  const children = childByPid.get(p.ID) || [];

  // 1. Check if matches DB export_orders
  const matched = dbOrders.find(o => o.ngay === pDate && (soTb && (o.so_thong_bao === soTb || String(o.so_thong_bao).includes(soTb))));
  if (matched) {
    skipped_matchedDb.push({ pid: p.ID, date: pDate, soTb, matchedMaDon: matched.ma_don });
    continue;
  }

  // 2. Filter out pre-2026 orders (or orders where date < 2025-12-29)
  if (!pDate || pDate < '2025-12-29') {
    skipped_oldYear.push({ pid: p.ID, date: pDate, soTb });
    continue;
  }

  // 3. Process lots & do_dang in children
  const custCode = detectCustomerCode(p, children) || 'UNKNOWN';
  
  let orderTotalBanh = 0;
  let orderTotalKg = 0;
  let loaiBanh = 35;
  let chungLoai = 'CSR 10';
  let loaiBoc = 'Bọc 0,04 không nhãn';
  let loaiPallet = 'Rời';

  const orderVehicles = [];
  const orderAssignments = [];
  const orderImages = [];

  let validLotsCount = 0;
  let ignoredOldLotsCount = 0;

  children.forEach((c, cIdx) => {
    if (c.Loai_banh) {
      const n = parseFloat(String(c.Loai_banh).replace(',', '.'));
      if (!isNaN(n)) loaiBanh = n;
    }
    if (c.Chung_loai_xuat) chungLoai = c.Chung_loai_xuat;
    if (c.Loai_vat_tu_xuat) loaiBoc = c.Loai_vat_tu_xuat;
    if (c.Loai_pallet_xuat) loaiPallet = c.Loai_pallet_xuat;

    const yr = c.nam_tp ? String(c.nam_tp).slice(-2) : '26';
    const sfx = c.Hau_to_lo || 'cs';

    // Parse full lots
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
      const rawLots = String(c.So_lo_xuat || '').split(',').map(s => s.trim()).filter(Boolean);
      for (const r of rawLots) {
        const m = r.match(/^(\d+)/);
        if (m) fullLotNums.add(parseInt(m[1], 10));
      }
    }

    // Parse partial lots
    const doDangMap = new Map();
    if (c.Lo_do_dang) {
      const tokens = String(c.Lo_do_dang).split(/[,;]/).map(s => s.trim()).filter(Boolean);
      for (const t of tokens) {
        const m = t.match(/(\d+)\s*=\s*(\d+)/);
        if (m) {
          const num = parseInt(m[1], 10);
          const banh = parseInt(m[2], 10);
          doDangMap.set(num, banh);
          fullLotNums.delete(num);
        }
      }
    }

    // Collect images for this vehicle
    const vehicleImageUrls = [];
    for (let i = 1; i <= 6; i++) {
      const imgPath = c[`Hinh_anh ${i}`];
      if (imgPath) {
        const diskFile = findImageFile(imgPath);
        if (diskFile) {
          vehicleImageUrls.push({ excelPath: imgPath, diskFile });
          orderImages.push({ excelPath: imgPath, diskFile });
        }
      }
    }

    // Create Vehicle object
    const vehicleObj = {
      id: `v_appsheet_${c.Key || cIdx}`,
      loai_xe: 'Container 40ft',
      bien_truoc: '',
      bien_sau: '',
      ghi_chu: c.Ghi_chu || (c.Tu_gio && c.Den_gio ? `Thời gian xuất: ${c.Tu_gio} - ${c.Den_gio}` : ''),
      image_urls: vehicleImageUrls.map(img => img.diskFile) // placeholder for now
    };
    orderVehicles.push(vehicleObj);

    // Map full lots to assignments
    for (const num of fullLotNums) {
      // In DB, lots are num + suffix + '/' + year
      // But notice: for 1593..1613, year in DB is '25'
      let lotInDb = null;
      const keyYr = `${num}${sfx}/${yr}`.toLowerCase();
      if (dbLotByMaLo.has(keyYr)) {
        lotInDb = dbLotByMaLo.get(keyYr);
      } else if (num >= 1593 && dbLotByMaLo.has(`${num}${sfx}/25`.toLowerCase())) {
        lotInDb = dbLotByMaLo.get(`${num}${sfx}/25`.toLowerCase());
      }

      if (lotInDb) {
        validLotsCount++;
        orderTotalBanh += 144;
        orderAssignments.push({
          lot_id: lotInDb.id,
          ma_lo: lotInDb.ma_lo,
          vehicleIdx: cIdx,
          kien_a: 36,
          kien_b: 36,
          kien_c: 36,
          kien_d: 36
        });
      } else {
        ignoredOldLotsCount++;
      }
    }

    // Map partial lots to assignments
    for (const [num, banh] of doDangMap.entries()) {
      let lotInDb = null;
      const keyYr = `${num}${sfx}/${yr}`.toLowerCase();
      if (dbLotByMaLo.has(keyYr)) {
        lotInDb = dbLotByMaLo.get(keyYr);
      } else if (num >= 1593 && dbLotByMaLo.has(`${num}${sfx}/25`.toLowerCase())) {
        lotInDb = dbLotByMaLo.get(`${num}${sfx}/25`.toLowerCase());
      }

      if (lotInDb) {
        validLotsCount++;
        orderTotalBanh += banh;
        // Distribute banh across kien_a, b, c, d
        let rem = banh;
        const kA = Math.min(36, rem); rem -= kA;
        const kB = Math.min(36, rem); rem -= kB;
        const kC = Math.min(36, rem); rem -= kC;
        const kD = Math.min(36, rem); rem -= kD;

        orderAssignments.push({
          lot_id: lotInDb.id,
          ma_lo: lotInDb.ma_lo,
          vehicleIdx: cIdx,
          kien_a: kA,
          kien_b: kB,
          kien_c: kC,
          kien_d: kD
        });
      } else {
        ignoredOldLotsCount++;
      }
    }
  });

  if (validLotsCount === 0) {
    if (ignoredOldLotsCount > 0) {
      skipped_allOldLots.push({ pid: p.ID, date: pDate, soTb, ignoredOldLotsCount });
    } else {
      skipped_noLots.push({ pid: p.ID, date: pDate, soTb });
    }
    continue;
  }

  // Generate ma_don
  const dateFormatted = pDate.split('-').reverse().map((part, idx) => idx === 2 ? part.slice(-2) : part).join('');
  const keyStt = `${custCode}_${pDate}`;
  const currentStt = (customerDateSttMap.get(keyStt) || 0) + 1;
  customerDateSttMap.set(keyStt, currentStt);

  const maDon = `XH-${custCode}-${soTb}-${dateFormatted}/${currentStt}`;

  toMigrateOrders.push({
    pid: p.ID,
    ma_don: maDon,
    ngay: pDate,
    so_thong_bao: soTb,
    customer_code: custCode,
    chung_loai: chungLoai,
    loai_banh: loaiBanh,
    loai_boc: loaiBoc,
    loai_pallet: loaiPallet,
    tong_banh: orderTotalBanh,
    tong_tan: ((orderTotalBanh * loaiBanh) / 1000).toFixed(2),
    validLotsCount,
    ignoredOldLotsCount,
    vehiclesCount: orderVehicles.length,
    assignmentsCount: orderAssignments.length,
    imagesCount: orderImages.length,
    vehicles: orderVehicles,
    assignments: orderAssignments
  });
}

console.log('=== KẾT QUẢ MÔ PHỎNG DI TRÚ XUẤT HÀNG ===');
console.log('1. Đơn trùng DB (bỏ qua):', skipped_matchedDb.length);
console.log('2. Đơn năm 2024 hoặc trước 29/12/2025 (bỏ qua):', skipped_oldYear.length);
console.log('3. Đơn năm 2026 nhưng 100% lô cũ trước 1593cs (bỏ qua):', skipped_allOldLots.length);
console.log('4. Đơn không có lô nào (bỏ qua):', skipped_noLots.length);
console.log('5. ĐƠN HỢP LỆ ĐỦ ĐIỀU KIỆN DI TRÚ:', toMigrateOrders.length);

console.log('\n--- DANH SÁCH CÁC ĐƠN ĐƯỢC DI TRÚ ---');
console.table(toMigrateOrders.map(o => ({
  ma_don: o.ma_don,
  ngay: o.ngay,
  so_tb: o.so_thong_bao,
  kh: o.customer_code,
  chung_loai: o.chung_loai,
  loai_banh: o.loai_banh,
  tong_banh: o.tong_banh,
  tong_tan: o.tong_tan,
  so_lo: o.validLotsCount,
  lo_cu_bo_qua: o.ignoredOldLotsCount,
  so_xe: o.vehiclesCount,
  so_anh: o.imagesCount
})));
