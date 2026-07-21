-- Cho phép nhiều người cùng trực 1 ca (mục 2, .claude/rules/06-module-production.md mục
-- "Kế hoạch phiên sau (2026-07-21)") — trước đây UNIQUE (factory_id, ca) chỉ cho đúng 1 dòng/ca,
-- ShiftAssignmentsTab chỉ có 1 form/ca. Bỏ hẳn ràng buộc unique cứng — mỗi dòng độc lập theo
-- người (đã đúng cấu trúc từ đầu), không cần đổi sang bảng con riêng.
ALTER TABLE production_shift_assignments DROP CONSTRAINT IF EXISTS production_shift_assignments_factory_id_ca_key;
