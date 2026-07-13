-- Lý do từ chối phê duyệt biên bản bảo trì (trang_thai mới 'tu_choi', không cần
-- CHECK constraint vì cột trang_thai vốn là TEXT tự do).
ALTER TABLE public.maintenance_records
  ADD COLUMN IF NOT EXISTS ly_do_tu_choi TEXT;
