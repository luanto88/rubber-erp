-- Chữ viết tắt ký thay (KT./TM./TL./TUQ.) cho bước Phê duyệt cuối của module ISO —
-- cả "Soạn thảo ISO" (iso_documents) lẫn "Thực hiện hồ sơ ISO" (iso_form_instances).
-- Chọn ngay lúc ký qua SignPlacementModal (mirror đúng cơ chế phe_duyet_sign_as đã
-- có ở văn bản nội bộ — xem 20260706_van_ban_sign_as.sql). Chỉ áp dụng cho bước
-- Phê duyệt; Soạn thảo/Xem xét không có khái niệm ký thay (đã xác nhận với người dùng).
--
-- Tọa độ hộp tiền tố (prefixX/Y/W/H, showPrefix) không cần migration riêng — chỉ
-- thêm field vào JSON placement (phe_duyet_placement / phe_duyet_placement trong
-- placement_ky tương ứng) khi ký mới, không đổi schema cột JSONB.

ALTER TABLE iso_documents
  ADD COLUMN IF NOT EXISTS phe_duyet_sign_as TEXT;

ALTER TABLE iso_form_instances
  ADD COLUMN IF NOT EXISTS phe_duyet_sign_as TEXT;
