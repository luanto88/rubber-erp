-- Migration: Mục tiêu chất lượng theo năm (quality_targets)
-- Dùng để cấu hình mục tiêu chất lượng hàng năm theo (nhà máy, năm, chỉ tiêu, sản phẩm)
-- phục vụ Báo cáo thống kê chất lượng tháng (module Kiểm nghiệm).

CREATE TABLE IF NOT EXISTS quality_targets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID NOT NULL REFERENCES factories(id),
  nam INTEGER NOT NULL,
  chi_tieu TEXT NOT NULL,        -- 'tap_chat'|'tro'|'bay_hoi'|'nito'|'po'|'pri'|'mooney'|'mau_sac'|'tccs_tong'
  san_pham TEXT NOT NULL,        -- '10'|'20'|'L'|'3L'|'5'|'CV50'|'CV60' (= chung_loai)
  nguong_min NUMERIC,            -- ngưỡng dưới (dùng cho chi_tieu bound=min hoặc range)
  nguong_max NUMERIC,            -- ngưỡng trên (dùng cho chi_tieu bound=max hoặc range)
  tieu_chuan TEXT,               -- chỉ dùng khi chi_tieu='tccs_tong': "TCCS 112:2022" | "TCVN 3769:2016"
  ty_le_muc_tieu NUMERIC NOT NULL,   -- % mục tiêu (vd 96, 98.75, 100)
  noi_dung_muc_tieu TEXT,        -- câu mô tả (tự sinh, cho sửa tay)
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(factory_id, nam, chi_tieu, san_pham)
);

CREATE INDEX IF NOT EXISTS idx_quality_targets_factory_nam ON quality_targets(factory_id, nam);

DROP TRIGGER IF EXISTS trg_quality_targets_updated_at ON public.quality_targets;
CREATE TRIGGER trg_quality_targets_updated_at
BEFORE UPDATE ON public.quality_targets
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE quality_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quality_targets_select" ON quality_targets
  FOR SELECT USING (
    factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "quality_targets_insert" ON quality_targets
  FOR INSERT WITH CHECK (
    factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "quality_targets_update" ON quality_targets
  FOR UPDATE USING (
    factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "quality_targets_delete" ON quality_targets
  FOR DELETE USING (
    factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid())
  );
