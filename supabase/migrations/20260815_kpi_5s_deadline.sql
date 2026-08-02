-- Module KPI — Hạn chấm điểm hàng tuần cho Vị trí 5S (Thứ + Giờ), tuỳ chọn (opt-in) per vị trí.
-- Xem plan tại thời điểm tạo: kpi_5s_locations chưa có bất kỳ khái niệm cadence/deadline nào —
-- người được phân công chấm (nguoi_cham_id) có thể chấm bất kỳ ngày nào trong tuần.
--
-- Dùng kiểu MẢNG (deadline_weekdays INTEGER[]) dù UI chỉ cho chọn ĐÚNG 1 phần tử (radio-behavior,
-- không phải multi-select) — để tái dùng đúng khái niệm apply_weekdays đã có ở kpi_task_templates
-- (1=Thứ 2..7=CN, khớp EXTRACT(ISODOW ...) của Postgres), và tương thích ngược nếu sau này cần mở
-- rộng cadence khác mà không phải đổi kiểu cột / rollback dữ liệu.
--
-- NULLABLE, không default ép buộc — khác kpi_task_templates.apply_weekdays (NOT NULL, có default)
-- vì đây là tính năng TUỲ CHỌN theo từng vị trí, không bắt buộc như nhịp lặp của task định kỳ.
-- Không backfill dữ liệu cũ — mọi vị trí hiện có sẽ có deadline_weekdays = NULL, tự động KHÔNG
-- hiện badge quá hạn, giữ nguyên hành vi cũ (chấm bất kỳ ngày nào trong tuần).

ALTER TABLE public.kpi_5s_locations
  ADD COLUMN IF NOT EXISTS deadline_weekdays INTEGER[],
  ADD COLUMN IF NOT EXISTS deadline_time TIME;

ALTER TABLE public.kpi_5s_locations
  DROP CONSTRAINT IF EXISTS kpi_5s_locations_deadline_weekdays_check;

ALTER TABLE public.kpi_5s_locations
  ADD CONSTRAINT kpi_5s_locations_deadline_weekdays_check
  CHECK (
    deadline_weekdays IS NULL
    OR (
      array_length(deadline_weekdays, 1) BETWEEN 1 AND 7
      AND deadline_weekdays <@ ARRAY[1,2,3,4,5,6,7]
    )
  );

-- Không cần đổi RLS — kpi_5s_locations_update/_insert (20260807_kpi_department_scoping.sql) là
-- row-level, thêm cột mới không ảnh hưởng. Ràng buộc "chọn thứ thì bắt buộc chọn giờ" xử lý ở
-- tầng app (kpi-5s-locations-tab.tsx), không cần CHECK cứng ở DB.
