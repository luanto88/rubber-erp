import fs from 'fs';
import XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';

const envText = fs.readFileSync('.env.local', 'utf8');
const envConfig = {};
envText.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let val = match[2] ? match[2].trim() : '';
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    envConfig[match[1]] = val;
  }
});

const supabase = createClient(envConfig.NEXT_PUBLIC_SUPABASE_URL, envConfig.SUPABASE_SERVICE_ROLE_KEY);

async function fetchAll(table, select, filterFn) {
  const PAGE = 1000;
  let from = 0;
  let all = [];
  while (true) {
    let q = supabase.from(table).select(select).range(from, from + PAGE - 1);
    if (filterFn) q = filterFn(q);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

function foldText(value) {
  return (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}
function normalizeLotStatus(status) {
  const folded = foldText(status).replace(/\s+/g, '');
  if (folded === 'xuathang') return 'Xuất hàng';
  if (folded === 'hoanthanh') return 'Hoàn thành';
  return 'Dở dang';
}

async function main() {
  console.log('=== BẮT ĐẦU ĐIỀU CHỈNH DỮ LIỆU TỒN KHO THEO MỤC IV ===\n');

  // --- BƯỚC 1: Khôi phục trạng thái cho 23 lô 1428cs/26 -> 1450cs/26 ---
  console.log('--- BƯỚC 1: Khôi phục 23 lô từ 1428cs/26 đến 1450cs/26 sang "Hoàn thành" ---');
  const nums23 = Array.from({ length: 23 }, (_, i) => 1428 + i);
  const { data: updated23, error: err23 } = await supabase
    .from('lots')
    .update({ trang_thai: 'Hoàn thành', updated_at: new Date().toISOString() })
    .in('num', nums23)
    .eq('year', '26')
    .select('id, num, ma_lo, trang_thai');

  if (err23) throw err23;
  console.log(`-> Đã cập nhật ${updated23.length} lô sang "Hoàn thành": ${updated23.map(l => l.num).join(', ')}`);

  // Điều chỉnh đơn hàng XH-PHR-1-080126/1: tách liên kết khỏi các lô năm 26
  const { data: order1, error: errOrder1 } = await supabase
    .from('export_orders')
    .select('*')
    .eq('ma_don', 'XH-PHR-1-080126/1')
    .single();

  if (order1 && order1.assignments) {
    const updatedAssignments = order1.assignments.map(a => {
      const m = (a.ma_lo || '').match(/^(\d+)/);
      const num = Number(m ? m[1] : 0);
      if (num >= 1428 && num <= 1450) {
        return {
          ...a,
          ma_lo: `${num}cs/25`,
          lot_id: null
        };
      }
      return a;
    });

    const { error: errUpOrder } = await supabase
      .from('export_orders')
      .update({ assignments: updatedAssignments, updated_at: new Date().toISOString() })
      .eq('id', order1.id);

    if (errUpOrder) throw errUpOrder;
    console.log('-> Đã điều chỉnh assignments trong đơn XH-PHR-1-080126/1 về mã lô năm 25 (lot_id: null)');
  }

  // --- BƯỚC 2: Điều chỉnh 2 lô xuất dở dang 371 và 1159 ---
  console.log('\n--- BƯỚC 2: Điều chỉnh số lượng và kiện cho 2 lô dở dang 371 và 1159 ---');
  // Lô 371: còn 24 bành (kiện D: 24) = 840 kg
  const { data: up371, error: err371 } = await supabase
    .from('lots')
    .update({
      kien_a: 0,
      kien_b: 0,
      kien_c: 0,
      kien_d: 24,
      tong_banh: 24,
      tong_kg: 840,
      trang_thai: 'Hoàn thành',
      updated_at: new Date().toISOString()
    })
    .eq('num', 371)
    .eq('year', '26')
    .select();

  if (err371) throw err371;
  console.log('-> Lô 371cs/26: Cập nhật còn 24 bành (840 kg, kiện D: 24), trạng thái: Hoàn thành');

  // Lô 1159: còn 96 bành (kiện B: 24, C: 36, D: 36) = 3.360 kg
  const { data: up1159, error: err1159 } = await supabase
    .from('lots')
    .update({
      kien_a: 0,
      kien_b: 24,
      kien_c: 36,
      kien_d: 36,
      tong_banh: 96,
      tong_kg: 3360,
      trang_thai: 'Hoàn thành',
      updated_at: new Date().toISOString()
    })
    .eq('num', 1159)
    .eq('year', '26')
    .select();

  if (err1159) throw err1159;
  console.log('-> Lô 1159cs/26: Cập nhật còn 96 bành (3.360 kg, kiện B: 24, C: 36, D: 36), trạng thái: Hoàn thành');

  // --- BƯỚC 3: Cập nhật trạng thái "Xuất hàng" cho 197 lô thừa ---
  console.log('\n--- BƯỚC 3: Cập nhật trạng thái "Xuất hàng" cho các lô đã xuất thực tế ---');
  const recon = JSON.parse(fs.readFileSync('cung_cap_dl/reconciliation_result.json', 'utf8'));
  const excessNums = recon.excessInDbLots.map(l => l.num);

  console.log(`Danh sách cần cập nhật gồm ${excessNums.length} lô.`);
  // Batch update in chunks of 50
  let totalUpdated = 0;
  for (let i = 0; i < excessNums.length; i += 50) {
    const chunk = excessNums.slice(i, i + 50);
    const { data: upChunk, error: errChunk } = await supabase
      .from('lots')
      .update({ trang_thai: 'Xuất hàng', updated_at: new Date().toISOString() })
      .in('num', chunk)
      .eq('year', '26')
      .neq('trang_thai', 'Xuất hàng')
      .select('num');

    if (errChunk) throw errChunk;
    totalUpdated += (upChunk ? upChunk.length : 0);
  }
  console.log(`-> Đã chuyển ${totalUpdated} lô còn lại từ "Hoàn thành" sang "Xuất hàng"!`);

  // --- BƯỚC 4: Kiểm tra đối soát sau điều chỉnh ---
  console.log('\n--- BƯỚC 4: Kiểm tra đối soát sau điều chỉnh ---');
  const allLotsAfter = await fetchAll('lots', 'num, ma_lo, tong_banh, tong_kg, trang_thai, ngay_sx, year');
  
  const inStockLe16 = allLotsAfter.filter(l => (!l.ngay_sx || l.ngay_sx <= '2026-09-16') && normalizeLotStatus(l.trang_thai) === 'Hoàn thành');
  const inStockKg = inStockLe16.reduce((s, l) => s + (l.tong_kg || 0), 0);
  const inStockBanh = inStockLe16.reduce((s, l) => s + (l.tong_banh || 0), 0);

  console.log(`Số lô tồn kho (<= 16/09/2026, Hoàn thành): ${inStockLe16.length}`);
  console.log(`Tổng bành tồn kho: ${inStockBanh}`);
  console.log(`Tổng khối lượng tồn kho: ${(inStockKg / 1000).toFixed(3)} tấn`);

  // Đọc TON_TT để so sánh
  const wb = XLSX.readFile('cung_cap_dl/TON_TT.xlsx');
  const ws = wb.Sheets[wb.SheetNames[0]];
  const ttData = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const ttLots = new Map();
  for (let i = 2; i < ttData.length; i++) {
    const r = ttData[i];
    if (!r || r[0] == null || r[0] === '') continue;
    const num = Number(r[0]);
    const sum = (Number(r[1]) || 0) + (Number(r[2]) || 0) + (Number(r[3]) || 0) + (Number(r[4]) || 0);
    ttLots.set(num, sum);
  }

  // Check diff
  const inStockMap = new Map(inStockLe16.map(l => [l.num, l]));
  
  // Lots in inStockLe16 not in TON_TT
  const notInTT = inStockLe16.filter(l => !ttLots.has(l.num));
  console.log(`Lô có trong tồn kho DB nhưng không có trong TON_TT: ${notInTT.length}`);
  if (notInTT.length > 0) {
    notInTT.forEach(l => console.log(`  + Lô ${l.num} (${l.ma_lo})`));
  }

  // Lots in TON_TT not in inStockLe16
  const missingFromDB = [];
  for (const [num, sum] of ttLots.entries()) {
    if (!inStockMap.has(num)) {
      missingFromDB.push({ num, sum });
    }
  }
  console.log(`Lô có trong TON_TT nhưng không có trong tồn kho DB: ${missingFromDB.length}`);
  missingFromDB.forEach(m => console.log(`  - Lô ${m.num}: ${m.sum} bành (Ghi chú: Lô 189 bỏ qua theo yêu cầu, lô 1552 ghi ngày 17/9)`));

  console.log('\n=== HOÀN TẤT ĐIỀU CHỈNH THÀNH CÔNG ===');
}

main();
