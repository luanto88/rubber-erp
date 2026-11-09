-- 2026-11-09 — Cờ "Người ký mặc định khi trùng chức vụ" trên hồ sơ Nhân sự.
-- Lý do: 2 người cùng chức vụ chính quyền "Giám đốc" (Chau Chók, Tô Thành Luân) ⇒ Đề nghị mua gợi ý người
-- đứng trước theo tên. Người được tick được chọn sẵn khi nhiều người cùng chức vụ (Giám đốc / Kế toán …).
-- Chỉ thêm cột, không sửa dữ liệu. Admin tick ở Cài đặt → Nhân sự → Sửa nhân sự.
-- Chạy tay trên Supabase SQL Editor. An toàn chạy lại.

ALTER TABLE maintenance_staff
  ADD COLUMN IF NOT EXISTS mac_dinh_ky BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN maintenance_staff.mac_dinh_ky IS
  'Ưu tiên chọn sẵn làm người ký khi nhiều người cùng chức vụ (vd 2 Giám đốc). Dùng ở /api/purchase/approvers.';
