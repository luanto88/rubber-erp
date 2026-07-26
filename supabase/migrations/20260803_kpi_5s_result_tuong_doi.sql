-- Module KPI — thêm mức trung gian "Tương đối" cho chấm điểm 5S (Đạt/Tương đối/Không đạt).
-- Trước đó chỉ có 2 mức Đạt/Không đạt (xem kpi_5s_evaluations.ket_qua trong
-- 20260729_kpi_5s_zones.sql). Xem đầy đủ .claude/rules/27-kpi-module.md mục "C — Điểm 5S".
--
-- Dùng DO block dò và drop TOÀN BỘ check constraint có tham chiếu tới cột "ket_qua" thay vì
-- đoán tên constraint mặc định do Postgres tự sinh — an toàn hơn hard-code tên (2 constraint
-- gốc được khai báo inline không đặt tên tường minh trong 20260729_kpi_5s_zones.sql).

DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.kpi_5s_evaluations'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%ket_qua%'
  LOOP
    EXECUTE format('ALTER TABLE public.kpi_5s_evaluations DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

-- 3 mức hợp lệ
ALTER TABLE public.kpi_5s_evaluations
  ADD CONSTRAINT kpi_5s_evaluations_ket_qua_check
  CHECK (ket_qua IN ('dat', 'tuong_doi', 'khong_dat'));

-- Bắt buộc lý do cho cả "tuong_doi" lẫn "khong_dat" (đã chốt với người dùng — giữ lịch sử
-- minh bạch, dễ tra cứu vì sao không đạt tuyệt đối).
ALTER TABLE public.kpi_5s_evaluations
  ADD CONSTRAINT kpi_5s_evaluations_ly_do_check
  CHECK (ket_qua = 'dat' OR (ly_do IS NOT NULL AND length(trim(ly_do)) > 0));
