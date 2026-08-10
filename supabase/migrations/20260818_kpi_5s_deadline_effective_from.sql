-- Fix bug: hạn chấm điểm 5S báo "Quá hạn" ngay khi vừa cấu hình lịch mới, nếu occurrence của
-- TUẦN HIỆN TẠI đã trôi qua (vd hôm nay Chủ nhật, chọn hạn Thứ 7 — Thứ 7 tuần này đã ở quá khứ).
-- computeKpi5sDeadline() trước đây luôn tính theo tuần ISO hiện tại, không biết lịch này vừa mới
-- được cấu hình — nên báo trễ hạn ngay cả khi chưa từng có cơ hội chấm đúng hạn.
--
-- Thêm cột "hiệu lực từ ngày" — tự động set = ngày cấu hình (qua trigger, không phụ thuộc client
-- nào ghi đúng) mỗi khi deadline_weekdays/deadline_time THAY ĐỔI GIÁ TRỊ (không set lại khi sửa
-- các field khác như tên/mô tả/người dọn). Tầng ứng dụng (computeKpi5sNextDeadline trong
-- src/lib/kpi-5s.ts) dùng cột này để tự lùi occurrence bị "sinh non" sang tuần kế tiếp.

ALTER TABLE kpi_5s_locations
  ADD COLUMN IF NOT EXISTS deadline_effective_from DATE;

CREATE OR REPLACE FUNCTION kpi_5s_locations_set_deadline_effective_from()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.deadline_weekdays IS NOT NULL AND NEW.deadline_time IS NOT NULL THEN
      NEW.deadline_effective_from := CURRENT_DATE;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF (NEW.deadline_weekdays IS DISTINCT FROM OLD.deadline_weekdays)
       OR (NEW.deadline_time IS DISTINCT FROM OLD.deadline_time) THEN
      IF NEW.deadline_weekdays IS NOT NULL AND NEW.deadline_time IS NOT NULL THEN
        NEW.deadline_effective_from := CURRENT_DATE;
      ELSE
        NEW.deadline_effective_from := NULL;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kpi_5s_locations_deadline_effective_from ON kpi_5s_locations;
CREATE TRIGGER trg_kpi_5s_locations_deadline_effective_from
  BEFORE INSERT OR UPDATE ON kpi_5s_locations
  FOR EACH ROW EXECUTE FUNCTION kpi_5s_locations_set_deadline_effective_from();

-- Backfill 1 lần cho dữ liệu cũ đã có sẵn deadline_weekdays/deadline_time (cấu hình trước
-- migration này) — coi như đã hiệu lực từ lâu, không cần lùi sang tuần sau.
UPDATE kpi_5s_locations
SET deadline_effective_from = COALESCE(deadline_effective_from, created_at::date)
WHERE deadline_weekdays IS NOT NULL AND deadline_time IS NOT NULL;
