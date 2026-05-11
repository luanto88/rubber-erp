-- ============================================
-- MAINTENANCE MODULE
-- ============================================

-- Danh mục thiết bị / xe
CREATE TABLE maintenance_assets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID REFERENCES factories(id),
  ma_tb TEXT NOT NULL,
  ten_tb TEXT NOT NULL,
  bo_phan TEXT NOT NULL, -- Mủ tạp|Mủ nước|Nước thải|Biomass|Đội xe|Văn phòng|Khác
  loai TEXT NOT NULL DEFAULT 'may_moc', -- may_moc | xe
  nam_sd TEXT,
  bien_so TEXT,
  mo_ta TEXT,
  trang_thai TEXT NOT NULL DEFAULT 'active', -- active | inactive
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(factory_id, ma_tb)
);

-- Nhân sự bảo trì
CREATE TABLE maintenance_staff (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID REFERENCES factories(id),
  ten TEXT NOT NULL,
  chuc_vu TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Vật tư ngoài (master list để tái sử dụng tên)
CREATE TABLE maintenance_external_materials (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID REFERENCES factories(id),
  ten_vat_tu TEXT NOT NULL,
  dvt TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(factory_id, ten_vat_tu)
);

-- Biên bản bảo trì (document header)
CREATE TABLE maintenance_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID REFERENCES factories(id),
  ma_bb TEXT, -- MT-DDMMYY/XXX, auto-generated
  hang_muc TEXT NOT NULL, -- Sửa chữa | Bảo dưỡng
  ngay DATE NOT NULL,
  tu_gio TIME,
  den_gio TIME,
  bo_phan TEXT NOT NULL,

  -- Nhân sự chung (snapshot)
  nguoi_tao TEXT,
  nguoi_thuc_hien TEXT[] DEFAULT '{}',
  nv_phu_trach TEXT,
  phu_trach_bao_tri TEXT,
  bgd_phu_trach TEXT,
  giam_doc TEXT,

  -- Workflow
  trang_thai TEXT NOT NULL DEFAULT 'cho_duyet', -- cho_duyet | da_duyet | huy
  nguoi_duyet TEXT,
  ngay_duyet TIMESTAMPTZ,
  inventory_issue_doc_id UUID, -- link phiếu xuất kho auto-tạo

  ghi_chu TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(factory_id, ma_bb)
);

-- Dòng thiết bị trong biên bản (1 biên bản có N dòng)
CREATE TABLE maintenance_record_lines (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  record_id UUID REFERENCES maintenance_records(id) ON DELETE CASCADE,
  factory_id UUID REFERENCES factories(id),
  sort_order INTEGER DEFAULT 0,

  -- Thiết bị (snapshot tại thời điểm tạo)
  asset_id UUID REFERENCES maintenance_assets(id),
  ten_tb TEXT NOT NULL,
  ma_tb TEXT NOT NULL,
  ten_tai_xe TEXT, -- Đội xe only

  -- Nội dung
  noi_dung TEXT,
  nguyen_nhan TEXT, -- chỉ Sửa chữa
  cac_khac_phuc TEXT,

  -- Chi phí per dòng
  loai_sua_chua TEXT, -- lon | nho (chỉ Sửa chữa)
  chi_phi_dk NUMERIC DEFAULT 0,
  loai_tien TEXT DEFAULT 'USD', -- USD | KHR | VND
  cong_tho NUMERIC DEFAULT 0,

  -- Nhiên liệu (Đội xe only)
  nhien_lieu_su_dung TEXT,
  dvt_do TEXT,
  so_luong_do NUMERIC,

  -- Ảnh per thiết bị (tối đa 6)
  image_urls TEXT[] DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT now()
);

-- Vật tư per dòng thiết bị
CREATE TABLE maintenance_materials (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  line_id UUID REFERENCES maintenance_record_lines(id) ON DELETE CASCADE,
  record_id UUID REFERENCES maintenance_records(id) ON DELETE CASCADE, -- dễ query tổng
  factory_id UUID REFERENCES factories(id),
  sort_order INTEGER DEFAULT 0,

  nguon TEXT NOT NULL, -- trong_kho | ben_ngoai
  inventory_item_id UUID, -- → inventory_items (nullable, chỉ trong_kho)
  ten_vat_tu TEXT NOT NULL,
  dvt TEXT,
  so_luong NUMERIC DEFAULT 0,
  don_gia NUMERIC, -- chỉ ben_ngoai
  loai_tien TEXT, -- chỉ ben_ngoai: USD | KHR | VND
  thanh_tien NUMERIC GENERATED ALWAYS AS (
    CASE WHEN so_luong IS NOT NULL AND don_gia IS NOT NULL
    THEN so_luong * don_gia ELSE 0 END
  ) STORED,

  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_maintenance_records_factory ON maintenance_records(factory_id);
CREATE INDEX idx_maintenance_records_ngay ON maintenance_records(factory_id, ngay);
CREATE INDEX idx_maintenance_records_trang_thai ON maintenance_records(factory_id, trang_thai);
CREATE INDEX idx_maintenance_record_lines_record ON maintenance_record_lines(record_id);
CREATE INDEX idx_maintenance_record_lines_asset ON maintenance_record_lines(asset_id);
CREATE INDEX idx_maintenance_materials_record ON maintenance_materials(record_id);
CREATE INDEX idx_maintenance_materials_line ON maintenance_materials(line_id);
CREATE INDEX idx_maintenance_assets_factory ON maintenance_assets(factory_id);
CREATE INDEX idx_maintenance_assets_bo_phan ON maintenance_assets(factory_id, bo_phan);
