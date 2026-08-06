-- Mở rộng KpiLinkPrompt ("Gắn bản ghi tại chỗ") sang 3 module ERP mới: Bảo trì (maintenance),
-- Xuất hàng (export), Kho vật tư (inventory — dùng chung 1 module_code cho cả 3 luồng
-- Nhập/Xuất/Chuyển kho, mirror cách "process:measurement" đang gộp về family "process").
--
-- 9 giá trị hợp lệ sau migration này (xem KPI_MODULE_OPTIONS, src/lib/kpi-tasks.ts):
-- dispatch, output, quality, storage, product, process (6 giá trị cũ từ 20260816) +
-- maintenance, export, inventory (3 giá trị mới).
--
-- Không backfill — mọi việc/việc định kỳ tạo trước migration này giữ nguyên module_code hiện có.

ALTER TABLE public.kpi_tasks DROP CONSTRAINT IF EXISTS kpi_tasks_module_code_check;
ALTER TABLE public.kpi_tasks ADD CONSTRAINT kpi_tasks_module_code_check
  CHECK (module_code IS NULL OR module_code IN
    ('dispatch','output','quality','storage','product','process','maintenance','export','inventory'));

ALTER TABLE public.kpi_task_templates DROP CONSTRAINT IF EXISTS kpi_task_templates_module_code_check;
ALTER TABLE public.kpi_task_templates ADD CONSTRAINT kpi_task_templates_module_code_check
  CHECK (module_code IS NULL OR module_code IN
    ('dispatch','output','quality','storage','product','process','maintenance','export','inventory'));
