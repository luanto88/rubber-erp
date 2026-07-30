-- Module Nhập Xuất Tồn: thêm phê duyệt BGĐ (Người phê duyệt, ký sau khi Ghi sổ, không chặn
-- Ghi sổ — áp dụng cho Nhập kho + Xuất kho, KHÔNG áp dụng Chuyển kho) và batch_id để nhóm nhiều
-- phiếu Xuất kho tạo trong cùng 1 phiên "xuất nhiều kho cùng lúc" lại với nhau để in theo từng kho.
-- Chạy thủ công trong Supabase SQL Editor — theo đúng quy ước dự án (không có Supabase CLI).

ALTER TABLE inventory_documents
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS approved_by_name TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS batch_id UUID;

CREATE INDEX IF NOT EXISTS idx_inventory_documents_batch_id
  ON inventory_documents(batch_id)
  WHERE batch_id IS NOT NULL;
