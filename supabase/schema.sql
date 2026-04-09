-- ============================================
-- RUBBER FACTORY ERP - DATABASE SCHEMA
-- Phước Hòa Kampong Thom & Cuaparis
-- ============================================

-- 1. Factory / Nhà máy
CREATE TABLE factories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT UNIQUE NOT NULL, -- 'phuochoa_kt', 'cuaparis'
  name TEXT NOT NULL,
  prefix TEXT NOT NULL, -- 'CSR', 'SVR'
  location TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO factories (code, name, prefix, location) VALUES
  ('phuochoa_kt', 'Phước Hòa Kampong Thom', 'CSR', 'Kampong Thom'),
  ('cuaparis', 'Cuaparis', 'SVR', 'Phước Hòa');

-- 2. Users / Người dùng
CREATE TABLE users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT DEFAULT 'user', -- 'admin', 'manager', 'user'
  factory_id UUID REFERENCES factories(id),
  department TEXT,
  status TEXT DEFAULT 'pending', -- 'pending', 'active', 'disabled'
  permissions JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Suffixes / Hậu tố
CREATE TABLE suffixes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID REFERENCES factories(id),
  code TEXT NOT NULL, -- 'cs', 'm', 'gctpk'
  name TEXT NOT NULL,
  nguon TEXT, -- 'NT', 'TM', 'GC'
  chung_nhan TEXT,
  congty TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Dispatch / Điều xe
CREATE TABLE dispatch_entries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID REFERENCES factories(id),
  ngay TEXT NOT NULL, -- dd/mm/yyyy
  chung_nhan TEXT,
  rows JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Storage Tanks / Ngăn lưu
CREATE TABLE ngans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID REFERENCES factories(id),
  ma_ngan TEXT NOT NULL,
  ten_ngan TEXT NOT NULL,
  loai_nl TEXT, -- 'Mủ đông chén', 'Mủ đông khối', 'Mủ dây'
  nguon_goc TEXT, -- 'NT', 'TM', 'GC'
  xu_ly TEXT, -- 'Xé', 'Không xé'
  chung_nhan TEXT,
  ngay_bd DATE,
  ngay_kt DATE,
  trang_thai TEXT DEFAULT 'Đang nhận',
  tong_tuoi NUMERIC DEFAULT 0,
  tong_kho NUMERIC DEFAULT 0,
  trips JSONB DEFAULT '[]',
  lo_nguon_goc TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Lots / Lô thành phẩm
CREATE TABLE lots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID REFERENCES factories(id),
  ma_lo TEXT NOT NULL,
  num INTEGER NOT NULL,
  suffix TEXT NOT NULL,
  year TEXT NOT NULL,
  ngay_sx DATE NOT NULL,
  ngay_ht DATE, -- ngày hoàn thành (nếu dở dang hoàn thành ngày khác)
  ca TEXT NOT NULL, -- 'A', 'B', 'C'
  ngan_id UUID REFERENCES ngans(id),
  loai_csr TEXT NOT NULL,
  loai_banh NUMERIC DEFAULT 35,
  boc TEXT,
  tham TEXT,
  pallet TEXT[] DEFAULT '{}',
  chi_thi TEXT,
  kien_a INTEGER DEFAULT 0,
  kien_b INTEGER DEFAULT 0,
  kien_c INTEGER DEFAULT 0,
  kien_d INTEGER DEFAULT 0,
  tong_banh INTEGER DEFAULT 0,
  tong_kg NUMERIC DEFAULT 0,
  trang_thai TEXT DEFAULT 'Dở dang', -- 'Dở dang', 'Hoàn thành'
  dd_snapshot JSONB, -- snapshot khi hoàn thành dở dang
  ghi_chu TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 7. QC Results / Kết quả kiểm nghiệm
CREATE TABLE qc_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID REFERENCES factories(id),
  lot_id UUID REFERENCES lots(id),
  ma_lo TEXT,
  pkn INTEGER,
  ma_kl TEXT, -- mã kiểm lại
  ngay_kn DATE NOT NULL,
  ngay_sx DATE,
  chung_loai TEXT,
  loai_csr TEXT,
  loai_kn TEXT, -- 'thuong', 'ngat', 'tuy_chon', 'lai_rot', 'lai_6thang'
  tieu_chuan TEXT,
  so_mau INTEGER DEFAULT 6,
  samples JSONB DEFAULT '{}',
  grade JSONB DEFAULT '{}',
  dat_hang TEXT,
  trang_thai TEXT, -- 'dat', 'rot'
  parent_id UUID REFERENCES qc_results(id),
  lan INTEGER DEFAULT 1,
  ly_do TEXT,
  nguoi_kn TEXT,
  ghi_chu TEXT,
  audit_log JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 8. Customers / Khách hàng
CREATE TABLE customers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID REFERENCES factories(id),
  ma_kh TEXT NOT NULL,
  ten_kh_en TEXT,
  email TEXT,
  dia_chi TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 9. Export Orders / Đơn xuất hàng
CREATE TABLE export_orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID REFERENCES factories(id),
  ma_don TEXT NOT NULL,
  ngay DATE NOT NULL,
  so_thong_bao TEXT,
  so_hoa_don TEXT,
  so_hop_dong TEXT,
  customer_id UUID REFERENCES customers(id),
  chung_loai TEXT,
  loai_pallet TEXT,
  vehicles JSONB DEFAULT '[]',
  assignments JSONB DEFAULT '[]',
  tong_banh INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 10. Sang kiện history
CREATE TABLE sk_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID REFERENCES factories(id),
  ngay DATE NOT NULL,
  loai TEXT, -- 'Sang kiện', 'Thay bọc', 'Sang kiện + Thay bọc'
  chung_loai TEXT,
  from_boc TEXT,
  to_boc TEXT,
  from_pallet TEXT,
  to_pallet TEXT,
  lots JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_lots_factory ON lots(factory_id);
CREATE INDEX idx_lots_ngay ON lots(ngay_sx);
CREATE INDEX idx_lots_ngan ON lots(ngan_id);
CREATE INDEX idx_lots_status ON lots(trang_thai);
CREATE INDEX idx_qc_lot ON qc_results(lot_id);
CREATE INDEX idx_qc_ngay ON qc_results(ngay_kn);
CREATE INDEX idx_ngans_factory ON ngans(factory_id);
CREATE INDEX idx_dispatch_factory ON dispatch_entries(factory_id);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================
ALTER TABLE factories ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE ngans ENABLE ROW LEVEL SECURITY;
ALTER TABLE qc_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE suffixes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sk_history ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read/write (simple policy for now)
CREATE POLICY "Allow all" ON factories FOR ALL USING (true);
CREATE POLICY "Allow all" ON users FOR ALL USING (true);
CREATE POLICY "Allow all" ON lots FOR ALL USING (true);
CREATE POLICY "Allow all" ON ngans FOR ALL USING (true);
CREATE POLICY "Allow all" ON qc_results FOR ALL USING (true);
CREATE POLICY "Allow all" ON dispatch_entries FOR ALL USING (true);
CREATE POLICY "Allow all" ON customers FOR ALL USING (true);
CREATE POLICY "Allow all" ON export_orders FOR ALL USING (true);
CREATE POLICY "Allow all" ON suffixes FOR ALL USING (true);
CREATE POLICY "Allow all" ON sk_history FOR ALL USING (true);
