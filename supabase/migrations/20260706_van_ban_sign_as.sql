-- Chữ viết tắt ký thay (KT./TM./TL./TUQ.) cho bước Phê duyệt cuối của văn bản nội bộ,
-- chọn ngay lúc ký qua SignPlacementModal — thay thế cơ chế cũ phe_duyet_is_kt
-- (chọn lúc soạn thảo, chỉ có KT.). Cột phe_duyet_is_kt được GIỮ NGUYÊN để văn bản
-- cũ đã phê duyệt trước ngày này vẫn hiển thị đúng "KT. " trên timeline.
--
-- Bước ký phòng ban (nguoi_ky JSONB) không cần migration — chỉ thêm field "sign_as"
-- vào JSON khi ký mới, không đổi schema cột.

ALTER TABLE van_ban_documents
  ADD COLUMN IF NOT EXISTS phe_duyet_sign_as TEXT;
