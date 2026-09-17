import fs from 'fs';
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

function foldText(value) {
  return (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}
function normalizeLotStatus(status) {
  const folded = foldText(status).replace(/\s+/g, '');
  if (folded === 'xuathang') return 'Xuất hàng';
  if (folded === 'hoanthanh') return 'Hoàn thành';
  return 'Dở dang';
}

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

async function main() {
  const factoryId = '0268ab41-a564-4538-acf1-6297ac372f57';
  const lots = await fetchAll('lots', 'ma_lo,loai_csr,loai_banh,boc,tong_kg,tong_banh,trang_thai,ngay_sx', q => q.eq('factory_id', factoryId));

  // 1. Dashboard Overview KPI (All lots with Hoàn thành)
  const inStockAll = lots.filter(r => normalizeLotStatus(r.trang_thai) === 'Hoàn thành');
  const tonTpTotal = inStockAll.reduce((s, r) => s + (r.tong_kg || 0), 0);
  console.log(`=== DASHBOARD TỒN KHO THÀNH PHẨM (TÍNH ĐẾN HÔM NAY 17/09) ===`);
  console.log(`Số lô: ${inStockAll.length}`);
  console.log(`Tổng khối lượng: ${(tonTpTotal / 1000).toFixed(3)} tấn`);

  // 2. Dashboard Overview KPI (<= 16/09)
  const inStockLe16 = lots.filter(r => (!r.ngay_sx || r.ngay_sx <= '2026-09-16') && normalizeLotStatus(r.trang_thai) === 'Hoàn thành');
  const tonTpLe16 = inStockLe16.reduce((s, r) => s + (r.tong_kg || 0), 0);
  console.log(`\n=== TỒN KHO THÀNH PHẨM (ĐẾN HẾT NGÀY 16/09) ===`);
  console.log(`Số lô: ${inStockLe16.length}`);
  console.log(`Tổng khối lượng: ${(tonTpLe16 / 1000).toFixed(3)} tấn`);
}
main();
