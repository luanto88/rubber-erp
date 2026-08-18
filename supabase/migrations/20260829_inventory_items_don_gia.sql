-- Thêm Đơn giá + Loại tiền cho danh mục Vật tư (inventory_items).
-- Mục đích: vật tư nguồn "Trong kho" trong biên bản Bảo trì hiện không có giá (chỉ "Mua ngoài"
-- mới có), khiến bảng "Vật tư sử dụng" trên các mẫu in (F13/F10/F15) luôn rỗng cột Đơn giá/Thành
-- tiền cho vật tư trong kho. Thêm 2 cột này vào inventory_items để module Bảo trì tự điền giá
-- khi chọn vật tư từ danh mục. Xem .claude/rules/13-inventory-module.md, 14-maintenance-module.md.
--
-- NOT NULL DEFAULT để không phá dữ liệu/script cũ (scripts/import-inventory-items.mjs,
-- scripts/fix-null-categories.mjs không cần sửa). "Bắt buộc" thực thi ở tầng validate UI của các
-- form tạo/sửa vật tư (Cài đặt → Cấu hình nhà máy → Vật tư/Hóa chất; Nhập kho → thêm nhanh vật
-- tư), không ép cứng ở DB constraint.

ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS don_gia NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS loai_tien TEXT NOT NULL DEFAULT 'USD';
