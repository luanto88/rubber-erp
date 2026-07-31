-- Module Nhập Xuất Tồn: thêm "Vị trí kho" (VD: "Khu A - Kệ A2 - Lô 04") cho từng cặp
-- (vật tư, kho) — 1 vật tư có thể ở vị trí khác nhau tùy kho. Dùng cho tab "Thẻ kho" (in nhãn
-- QR dán hiện trường) và trang "Thẻ kho điện tử" (/dashboard/inventory/item).
-- Chạy thủ công trong Supabase SQL Editor — theo đúng quy ước dự án (không có Supabase CLI).

ALTER TABLE inventory_item_warehouse_rules
  ADD COLUMN IF NOT EXISTS location_code TEXT;
