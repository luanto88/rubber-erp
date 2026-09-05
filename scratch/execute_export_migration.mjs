import XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const FACTORY_ID = '0268ab41-a564-4538-acf1-6297ac372f57';
const ADMIN_ID = '21d59cc2-787b-4a8c-b3e8-f1a144dc86de';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

console.log('=== BẮT ĐẦU DI TRÚ XUẤT HÀNG LÊN RUBBER-ERP ===\n');

// 1. Fetch DB lots
console.log('1. Đang tải danh sách lô trong database...');
let allDbLots = [];
let from = 0;
while (true) {
  const { data, error } = await sb.from('lots').select('id, ma_lo, num, suffix, year, loai_banh, tong_banh, trang_thai').range(from, from + 999);
  if (error) throw error;
  allDbLots.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}
console.log(`   -> Đã tải ${allDbLots.length} lô từ DB.`);
const dbLotByMaLo = new Map(allDbLots.map(l => [l.ma_lo.toLowerCase(), l]));

// 2. Fetch existing DB export_orders
console.log('2. Đang kiểm tra các đơn xuất hàng hiện có trong DB...');
const { data: dbOrders, error: orderErr } = await sb.from('export_orders').select('id, ma_don, ngay, so_thong_bao, so_hoa_don, tong_banh, customer_id, assignments, trang_thai');
if (orderErr) throw orderErr;
console.log(`   -> Đã có ${dbOrders.length} đơn hàng trên hệ thống.`);

// 3. Ensure customers
console.log('3. Đang kiểm tra danh mục khách hàng...');
let { data: customers, error: custErr } = await sb.from('customers').select('*');
if (custErr) throw custErr;

let customerByCode = new Map(customers.map(c => [c.ma_kh.toUpperCase(), c]));

if (!customerByCode.has('HG')) {
  console.log('   -> Thêm khách hàng mới: HG (CÔNG TY TNHH CAO SU HOÀNG GIA)...');
  const { data: newHg, error: insHgErr } = await sb.from('customers').insert({
    factory_id: FACTORY_ID,
    ma_kh: 'HG',
    ten_kh_en: 'CÔNG TY TNHH CAO SU HOÀNG GIA',
    quoc_gia: 'Việt Nam',
    dia_chi: '',
    email: '',
    nguoi_lien_he: ''
  }).select().single();
  if (insHgErr) throw insHgErr;
  customerByCode.set('HG', newHg);
}

if (!customerByCode.has('HK RUBBER')) {
  console.log('   -> Thêm khách hàng mới: HK RUBBER (HƯNG KHANG RUBBER)...');
  const { data: newHk, error: insHkErr } = await sb.from('customers').insert({
    factory_id: FACTORY_ID,
    ma_kh: 'HK RUBBER',
    ten_kh_en: 'HƯNG KHANG RUBBER',
    quoc_gia: 'Việt Nam',
    dia_chi: '',
    email: '',
    nguoi_lien_he: ''
  }).select().single();
  if (insHkErr) throw insHkErr;
  customerByCode.set('HK RUBBER', newHk);
}

// 4. Read Excel
console.log('4. Đang đọc dữ liệu Excel...');
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

// Upload image cache to avoid duplicate upload
const uploadedUrlCache = new Map();

async function uploadImageToStorage(diskPath, originalName) {
  if (uploadedUrlCache.has(diskPath)) {
    return uploadedUrlCache.get(diskPath);
  }

  const ext = path.extname(diskPath).toLowerCase() || '.jpg';
  const cleanExt = ext.replace('.', '');
  const mime = cleanExt === 'png' ? 'image/png' : 'image/jpeg';
  const cleanBase = path.basename(diskPath, ext).replace(/[^a-zA-Z0-9_\-]/g, '_');
  const storagePath = `${FACTORY_ID}/vehicles/${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${cleanBase}.${cleanExt}`;

  const buffer = fs.readFileSync(diskPath);
  const { data, error } = await sb.storage.from('order-files').upload(storagePath, buffer, {
    contentType: mime,
    upsert: true
  });

  if (error) {
    console.error(`   ! Lỗi upload ảnh ${diskPath}:`, error.message);
    return null;
  }

  const { data: urlData } = sb.storage.from('order-files').getPublicUrl(storagePath);
  uploadedUrlCache.set(diskPath, urlData.publicUrl);
  return urlData.publicUrl;
}

// 5. Sequence tracking for ma_don
const customerDateSttMap = new Map();
// Seed with existing db orders
for (const o of dbOrders) {
  if (o.ma_don && o.ma_don.includes('/')) {
    const parts = o.ma_don.split('/');
    const stt = parseInt(parts[parts.length - 1], 10);
    // Find customer ma_kh and ngay
    const cust = customers.find(c => c.id === o.customer_id);
    const code = cust ? cust.ma_kh.toUpperCase() : 'UNKNOWN';
    const key = `${code}_${o.ngay}`;
    const cur = customerDateSttMap.get(key) || 0;
    if (!isNaN(stt) && stt > cur) customerDateSttMap.set(key, stt);
  }
}

// 6. Build the list of 27 orders to migrate
console.log('5. Đang chuẩn bị dữ liệu 27 đơn hàng...');
const ordersToInsert = [];
const affectedLotIds = new Set();

for (const p of parentRows) {
  const pDate = excelDateToISO(p.Ngay_xuat);
  const soTb = String(p.Thong_bao_GH || '').trim();
  const children = childByPid.get(p.ID) || [];

  // Check matching DB
  const matched = dbOrders.find(o => o.ngay === pDate && (soTb && (o.so_thong_bao === soTb || String(o.so_thong_bao).includes(soTb))));
  if (matched) continue;

  // Filter out pre-29/12/2025
  if (!pDate || pDate < '2025-12-29') continue;

  const custCode = detectCustomerCode(p, children) || 'UNKNOWN';
  const customerObj = customerByCode.get(custCode);
  const customerId = customerObj ? customerObj.id : null;

  let orderTotalBanh = 0;
  let loaiBanh = 35;
  let chungLoai = 'CSR 10';
  let loaiBoc = 'Bọc 0,04 không nhãn';
  let loaiPallet = 'Rời';

  const orderVehicles = [];
  const orderAssignments = [];
  const orderFiles = [];

  let validLotsCount = 0;

  for (let cIdx = 0; cIdx < children.length; cIdx++) {
    const c = children[cIdx];
    if (c.Loai_banh) {
      const n = parseFloat(String(c.Loai_banh).replace(',', '.'));
      if (!isNaN(n)) loaiBanh = n;
    }
    if (c.Chung_loai_xuat) chungLoai = c.Chung_loai_xuat;
    if (c.Loai_vat_tu_xuat) loaiBoc = c.Loai_vat_tu_xuat;
    if (c.Loai_pallet_xuat) loaiPallet = c.Loai_pallet_xuat;

    const yr = c.nam_tp ? String(c.nam_tp).slice(-2) : '26';
    const sfx = c.Hau_to_lo || 'cs';

    // Full lots
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

    // Partial lots
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

    // Upload vehicle images
    const vehicleImageUrls = [];
    for (let i = 1; i <= 6; i++) {
      const imgPath = c[`Hinh_anh ${i}`];
      if (imgPath) {
        const diskFile = findImageFile(imgPath);
        if (diskFile) {
          const publicUrl = await uploadImageToStorage(diskFile, path.basename(diskFile));
          if (publicUrl) {
            vehicleImageUrls.push(publicUrl);
            orderFiles.push({
              name: `Ảnh xuất hàng Xe ${cIdx + 1} (${i})`,
              url: publicUrl
            });
          }
        }
      }
    }

    const vehicleObj = {
      id: `v_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      loai_xe: 'Container 40ft',
      bien_truoc: '',
      bien_sau: '',
      ghi_chu: c.Ghi_chu ? `AppSheet: ${c.Ghi_chu}` : 'Di trú từ AppSheet',
      image_urls: vehicleImageUrls
    };
    orderVehicles.push(vehicleObj);

    // Map full lots
    for (const num of fullLotNums) {
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
        affectedLotIds.add(lotInDb.id);
        orderAssignments.push({
          lot_id: lotInDb.id,
          ma_lo: lotInDb.ma_lo,
          vehicleIdx: cIdx,
          kien_a: 36,
          kien_b: 36,
          kien_c: 36,
          kien_d: 36
        });
      }
    }

    // Map partial lots
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
        affectedLotIds.add(lotInDb.id);

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
      }
    }
  }

  if (validLotsCount === 0) continue;

  // Generate ma_don
  const dateFormatted = pDate.split('-').reverse().map((part, idx) => idx === 2 ? part.slice(-2) : part).join('');
  const keyStt = `${custCode}_${pDate}`;
  const currentStt = (customerDateSttMap.get(keyStt) || 0) + 1;
  customerDateSttMap.set(keyStt, currentStt);

  const maDon = `XH-${custCode}-${soTb}-${dateFormatted}/${currentStt}`;

  ordersToInsert.push({
    id: crypto.randomUUID(),
    factory_id: FACTORY_ID,
    ma_don: maDon,
    ngay: pDate,
    so_thong_bao: soTb,
    so_hoa_don: p.so_hd ? String(p.so_hd).trim() : '',
    so_hop_dong: '',
    customer_id: customerId,
    chung_loai: chungLoai,
    loai_pallet: loaiPallet,
    loai_banh: loaiBanh,
    loai_boc: loaiBoc,
    vehicles: orderVehicles,
    assignments: orderAssignments,
    tong_banh: orderTotalBanh,
    yeu_cau_chi_tieu: [],
    files: orderFiles,
    trang_thai: 'da_phe_duyet',
    created_by: ADMIN_ID,
    approved_by: ADMIN_ID,
    approved_at: `${pDate}T12:00:00.000Z`,
    public_token: crypto.randomUUID()
  });
}

console.log(`\n6. Chuẩn bị insert ${ordersToInsert.length} đơn hàng vào bảng 'export_orders'...`);

for (const order of ordersToInsert) {
  const { error } = await sb.from('export_orders').insert(order);
  if (error) {
    console.error(`   ! Lỗi insert đơn ${order.ma_don}:`, error.message);
    throw error;
  }
  console.log(`   ✓ Đã insert đơn: ${order.ma_don} (${order.tong_banh} bành, ${(order.tong_banh * order.loai_banh / 1000).toFixed(2)} tấn, ${order.vehicles.length} xe, ${order.files.length} ảnh)`);
}

// 7. Synchronize lot statuses
console.log(`\n7. Đang đồng bộ trạng thái ${affectedLotIds.size} lô trong bảng 'lots'...`);
const { data: latestOrders } = await sb.from('export_orders').select('assignments, trang_thai');

let updatedLotsCount = 0;
for (const lotId of affectedLotIds) {
  const lot = dbLotByMaLo.get(allDbLots.find(l => l.id === lotId)?.ma_lo.toLowerCase());
  if (!lot) continue;

  const totalAssignedBanh = latestOrders.reduce((sum, ord) => {
    if (ord.trang_thai === 'da_phe_duyet' && Array.isArray(ord.assignments)) {
      const match = ord.assignments.filter(a => a.lot_id === lotId);
      for (const m of match) {
        sum += (m.kien_a || 0) + (m.kien_b || 0) + (m.kien_c || 0) + (m.kien_d || 0);
      }
    }
    return sum;
  }, 0);

  const nextStatus = totalAssignedBanh >= (lot.tong_banh || 144) ? 'Xuất hàng' : 'Hoàn thành';
  if (lot.trang_thai !== nextStatus) {
    const { error: updErr } = await sb.from('lots').update({ trang_thai: nextStatus }).eq('id', lotId);
    if (!updErr) updatedLotsCount++;
  }
}
console.log(`   ✓ Đã cập nhật trạng thái cho ${updatedLotsCount} lô thành 'Xuất hàng'.`);

console.log('\n=== HOÀN THÀNH DI TRÚ TOÀN BỘ DỮ LIỆU XUẤT HÀNG THÀNH CÔNG! ===');
