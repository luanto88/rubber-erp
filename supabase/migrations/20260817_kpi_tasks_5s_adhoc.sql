-- Việc đột xuất 5S — cho phép BGĐ giao 1 Công việc (kpi_tasks) đột xuất liên kết tới 1 Vị trí 5S
-- cụ thể, kèm ảnh hiện trạng ("before") ngay lúc giao việc. HOÀN TOÀN TÁCH BIỆT với hệ thống
-- chấm điểm 5S định kỳ hàng tuần (kpi_5s_evaluations) — không đụng công thức tính điểm C (5S)
-- hàng tháng, chỉ là 1 Công việc chuyên môn bình thường có thêm 2 field tham chiếu tuỳ chọn.
--
-- kpi_5s_location_id: vị trí 5S liên quan (tuỳ chọn) — hiện link/badge ở trang chi tiết việc.
-- before_image_urls: ảnh hiện trạng do người GIAO việc đính kèm lúc tạo (khác kpi_task_logs.
--   image_urls — đó là ảnh bằng chứng "after" do người THỰC HIỆN nộp sau khi xử lý xong).
--
-- kpi_tasks hiện không có màn "Sửa" sau khi tạo — nếu insert task trước rồi mới upload ảnh, một
-- lần upload/update lỗi sẽ để lại task vĩnh viễn không có ảnh before và không có cách bổ sung.
-- Vì vậy client PHẢI tự sinh id (crypto.randomUUID()) trước khi insert, upload ảnh lên đúng path
-- Storage {factory_id}/kpi/tasks/{id}/... rồi mới insert kpi_tasks với id tường minh này (đã xác
-- nhận an toàn: kpi_tasks.id chỉ là UUID DEFAULT gen_random_uuid() — không phải GENERATED ALWAYS,
-- không có BEFORE INSERT trigger nào can thiệp id, và RLS kpi_tasks_insert không tham chiếu id).

ALTER TABLE public.kpi_tasks
  ADD COLUMN IF NOT EXISTS kpi_5s_location_id UUID REFERENCES public.kpi_5s_locations(id) ON DELETE SET NULL;
ALTER TABLE public.kpi_tasks
  ADD COLUMN IF NOT EXISTS before_image_urls TEXT[] NULL DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_kpi_tasks_5s_location
  ON public.kpi_tasks(kpi_5s_location_id) WHERE kpi_5s_location_id IS NOT NULL;
