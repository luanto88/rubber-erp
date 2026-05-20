-- Noi dung chung cho bien ban bao duong nhieu thiet bi
-- Mirror du cac truong nhu tung dong thiet bi (maintenance_record_lines)
ALTER TABLE public.maintenance_records
  ADD COLUMN IF NOT EXISTS noi_dung_chung     TEXT,     -- F03: 1/ Noi dung bao duong
  ADD COLUMN IF NOT EXISTS nguyen_nhan_chung  TEXT,     -- F03: 2/ Ly do bao duong
  ADD COLUMN IF NOT EXISTS cac_khac_phuc_chung TEXT,   -- F15: Khoi luong da bao duong
  ADD COLUMN IF NOT EXISTS image_urls_chung   TEXT[];   -- 6 slot anh chung

-- dispatch_vehicle_id cho dong thiet bi Doi xe
ALTER TABLE public.maintenance_record_lines
  ADD COLUMN IF NOT EXISTS dispatch_vehicle_id UUID
    REFERENCES public.dispatch_vehicles(id) ON DELETE SET NULL;
