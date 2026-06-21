-- Thêm trường phạm vi văn bản (Nội bộ công ty / Nội bộ đơn vị)
-- và cờ ký thừa/thay cho người phê duyệt (Phó GĐ ký thay → "KT.")
ALTER TABLE van_ban_documents
  ADD COLUMN IF NOT EXISTS pham_vi TEXT DEFAULT 'Cong_ty',
  ADD COLUMN IF NOT EXISTS phe_duyet_is_kt BOOLEAN DEFAULT false;
