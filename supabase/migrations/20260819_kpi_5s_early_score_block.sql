-- Chặn cứng chấm điểm 5S quá sớm (2026-08-19) — trả lời câu hỏi "có kẽ hở chấm 'Đạt' trước khi
-- dọn thật không?" (đã xác nhận CÓ, chưa từng bị chặn). Chốt với người dùng: chặn cứng theo
-- khung giờ trước hạn (KPI_5S_EARLY_BLOCK_HOURS = 48 giờ, xem src/lib/kpi-5s.ts).
--
-- Chỉ chặn INSERT (lần chấm gốc) — không đụng UPDATE, vì 2 RPC sửa kết quả sau này
-- (kpi_5s_evaluation_correct, kpi_appeal_decide_correction) đều UPDATE trực tiếp
-- kpi_5s_evaluations, không INSERT dòng mới; việc sửa lại 1 lần chấm đã có không nên bị chặn bởi
-- rule "quá sớm" (khi đó việc dọn dẹp thật đã xảy ra rồi, chỉ là sửa kết quả ghi nhận).
-- Admin/kpi.manage_config được bypass (dùng để chấm bù/xử lý ngoại lệ hiện trường thật).

CREATE OR REPLACE FUNCTION public.kpi_5s_prevent_early_score()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_location RECORD;
  v_deadline_dow INTEGER;
  v_deadline_time TIME;
  v_week_start DATE;
  v_deadline_ts TIMESTAMPTZ;
  v_is_privileged BOOLEAN;
BEGIN
  SELECT * INTO v_location FROM public.kpi_5s_locations WHERE id = NEW.location_id;
  IF NOT FOUND OR v_location.deadline_weekdays IS NULL OR array_length(v_location.deadline_weekdays, 1) IS NULL
     OR v_location.deadline_time IS NULL THEN
    RETURN NEW; -- vị trí chưa cấu hình hạn chấm — không có mốc nào để so, không chặn
  END IF;

  v_is_privileged := EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    OR public.current_profile_has_permission('kpi.manage_config');
  IF v_is_privileged THEN
    RETURN NEW;
  END IF;

  v_deadline_dow := v_location.deadline_weekdays[1];
  v_deadline_time := v_location.deadline_time;
  -- Thứ Hai (ISODOW=1) của tuần đang chấm, tính bằng NEW.tuan_bat_dau (đã là Thứ Hai theo quy ước
  -- getIsoWeekStart() ở phía client) rồi cộng offset đúng thứ cấu hình.
  v_week_start := NEW.tuan_bat_dau;
  v_deadline_ts := (v_week_start + ((v_deadline_dow - 1) || ' days')::INTERVAL)::DATE + v_deadline_time;

  IF v_deadline_ts - now() > (INTERVAL '1 hour' * 48) THEN
    RAISE EXCEPTION 'Chưa tới thời điểm được chấm điểm — hạn chấm là % (còn hơn 48 giờ nữa).',
      to_char(v_deadline_ts, 'DD/MM/YYYY HH24:MI');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_kpi_5s_prevent_early_score ON public.kpi_5s_evaluations;
CREATE TRIGGER trg_kpi_5s_prevent_early_score
  BEFORE INSERT ON public.kpi_5s_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.kpi_5s_prevent_early_score();
