import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

// 1. Check total export orders now
const { data: orders } = await sb.from('export_orders').select('id, ma_don, ngay, so_thong_bao, tong_banh, vehicles, files, trang_thai');
console.log('Tổng số đơn hàng xuất hiện tại trong DB:', orders.length);

// 2. Sample 3 newly migrated orders
const sampleMigrated = orders.filter(o => o.ma_don.startsWith('XH-HG') || o.ma_don.startsWith('XH-HK RUBBER') || o.ma_don === 'XH-PHR-1-080126/1');
console.log('\n--- MẪU 3 ĐƠN HÀNG DI TRÚ ---');
for (const o of sampleMigrated.slice(0, 3)) {
  console.log({
    ma_don: o.ma_don,
    ngay: o.ngay,
    so_thong_bao: o.so_thong_bao,
    tong_banh: o.tong_banh,
    so_xe: o.vehicles?.length,
    so_anh_xe: o.vehicles?.[0]?.image_urls?.length,
    so_file_dinh_kem: o.files?.length,
    trang_thai: o.trang_thai,
    sample_img: o.vehicles?.[0]?.image_urls?.[0]
  });
}

// 3. Check lots with status 'Xuất hàng'
const { count: xhLotsCount } = await sb.from('lots').select('*', { count: 'exact', head: true }).eq('trang_thai', 'Xuất hàng');
console.log('\nTổng số lô có trạng thái "Xuất hàng":', xhLotsCount);

// 4. Check customers
const { data: customers } = await sb.from('customers').select('ma_kh, ten_kh_en, quoc_gia');
console.log('\nDanh mục khách hàng hiện tại:');
console.table(customers);
