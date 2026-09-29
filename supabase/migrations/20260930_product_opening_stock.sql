-- GĐ6 (2026-09-28): Tồn đầu kỳ thành phẩm theo số chốt kiểm kê — nguồn mốc tồn cho Báo cáo sản
-- xuất hằng ngày (F12).
--
-- Vì sao cần: F12 trước đây tự suy tồn = toàn bộ nhập − toàn bộ xuất từ khi có dữ liệu. Phần tồn
-- trước khi dùng hệ thống (nhập CSV đầu kỳ, đơn xuất cũ thiếu...) không kiểm chứng được. Kế toán
-- kho chuẩn: chốt số kiểm kê thực tế tại 1 ngày, sau đó tồn = tồn chốt + nhập − xuất SAU ngày chốt.
--
-- Quy ước:
--   - ton_kg là tồn tại THỜI ĐIỂM KẾT THÚC ngày ngay_chot (nhập/xuất trong chính ngày chốt đã nằm
--     trong số kiểm kê, không cộng/trừ lại).
--   - F12 dùng mốc chốt GẦN NHẤT ≤ ngày báo cáo. Nhóm không có dòng trong mốc chốt = tồn chốt 0.
--   - nguon_goc lưu đúng nhãn F12 đang hiển thị: 'Công ty' | 'Thu mua' | 'Gia công' | 'Thanh lý' |
--     nhãn hậu tố khác (xem makeNguonResolver trong confirm/daily-report-actions.ts).
--   - boc lưu '' (không NULL) khi lô không có bọc, để UNIQUE hoạt động.
--
-- Chạy tay trên Supabase SQL Editor. Idempotent.

CREATE TABLE IF NOT EXISTS public.product_opening_stock (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id  UUID NOT NULL REFERENCES public.factories(id),
  ngay_chot   DATE NOT NULL,
  loai_csr    TEXT NOT NULL,
  nguon_goc   TEXT NOT NULL,
  boc         TEXT NOT NULL DEFAULT '',
  loai_banh   NUMERIC NOT NULL,
  ton_kg      NUMERIC NOT NULL DEFAULT 0,
  ghi_chu     TEXT,
  created_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT product_opening_stock_key
    UNIQUE (factory_id, ngay_chot, loai_csr, nguon_goc, boc, loai_banh)
);

CREATE INDEX IF NOT EXISTS idx_product_opening_stock_factory_ngay
  ON public.product_opening_stock (factory_id, ngay_chot);

DROP TRIGGER IF EXISTS trg_product_opening_stock_updated_at ON public.product_opening_stock;
CREATE TRIGGER trg_product_opening_stock_updated_at
BEFORE UPDATE ON public.product_opening_stock
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.product_opening_stock ENABLE ROW LEVEL SECURITY;

-- Đọc: mọi người trong nhà máy (F12 đọc qua service role, nhưng tab Cài đặt đọc bằng client).
DROP POLICY IF EXISTS product_opening_stock_select ON public.product_opening_stock;
CREATE POLICY product_opening_stock_select ON public.product_opening_stock
  FOR SELECT USING (factory_id = public.current_profile_factory_id());

-- Ghi: admin hoặc có quyền quản trị cấu hình nhà máy (cùng quyền với các tab Cấu hình nhà máy).
DROP POLICY IF EXISTS product_opening_stock_insert ON public.product_opening_stock;
CREATE POLICY product_opening_stock_insert ON public.product_opening_stock
  FOR INSERT WITH CHECK (
    factory_id = public.current_profile_factory_id()
    AND (public.current_profile_role() = 'admin'
         OR public.current_profile_has_permission('settings.manage_config'))
  );

DROP POLICY IF EXISTS product_opening_stock_update ON public.product_opening_stock;
CREATE POLICY product_opening_stock_update ON public.product_opening_stock
  FOR UPDATE
  USING (
    factory_id = public.current_profile_factory_id()
    AND (public.current_profile_role() = 'admin'
         OR public.current_profile_has_permission('settings.manage_config'))
  )
  WITH CHECK (factory_id = public.current_profile_factory_id());

DROP POLICY IF EXISTS product_opening_stock_delete ON public.product_opening_stock;
CREATE POLICY product_opening_stock_delete ON public.product_opening_stock
  FOR DELETE USING (
    factory_id = public.current_profile_factory_id()
    AND (public.current_profile_role() = 'admin'
         OR public.current_profile_has_permission('settings.manage_config'))
  );

-- Kiểm chứng sau khi chạy:
--   SELECT policyname, cmd FROM pg_policies WHERE tablename = 'product_opening_stock';  -- 4 dòng
