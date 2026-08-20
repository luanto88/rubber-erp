-- Tỷ giá quy đổi USD dùng cho Báo cáo công tác bảo trì theo kỳ (F07) và ngưỡng phân loại
-- Sửa chữa Lớn/Nhỏ (>200 USD) trong module Bảo trì — thay thế tỷ giá hard-code trong
-- src/lib/currency.ts (1USD=25.000VND, 1USD=4.100KHR). NULL = chưa cấu hình, giữ nguyên mặc định.
ALTER TABLE factories
  ADD COLUMN IF NOT EXISTS ty_gia_usd_vnd NUMERIC,
  ADD COLUMN IF NOT EXISTS ty_gia_usd_khr NUMERIC;
