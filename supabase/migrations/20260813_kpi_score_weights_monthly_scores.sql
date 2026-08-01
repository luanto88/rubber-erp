-- Module KPI & 5S — Phase 4: Trọng số công thức + Hệ số chuyên cần + Engine tính điểm tháng.
-- Xem đầy đủ .claude/rules/27-kpi-module.md, mục "Công thức tính điểm" (đầu file) và
-- "Database Schema" → "Trọng số & bảng điểm tháng". KHÔNG đổi công thức đã chốt, chỉ implement.
--
-- Công thức:
--   KPI tháng = (A%×Hoàn thành + B%×Đúng hạn + C%×5S + D%×Chuyên môn) × Hệ số chuyên cần
--   Hệ số chuyên cần = CLAMP(Số ngày có chấm D trong tháng ÷ Ngày chuẩn, 0.75, 1.10)
--
-- Nguồn dữ liệu từng thành phần:
--   A (Hoàn thành) — kpi_task_members.tien_do_nghiem_thu (ưu tiên) hoặc tien_do, theo
--     kpi_tasks.ngay_giao rơi trong tháng, is_active=true. Không có task nào trong tháng → mặc
--     định 100 (bản nháp — chưa renormalize trọng số, xem ghi chú "Quyết định thiết kế" dưới).
--   B (Đúng hạn) — trong số task ĐÃ ĐẾN HẠN trong tháng (han_hoan_thanh <= cutoff), tỷ lệ
--     da_nop_luc <= han_hoan_thanh. Không có task nào đã đến hạn → mặc định 100.
--   C (5S) — kpi_5s_evaluations.ket_qua (dat=100/tuong_doi=50/khong_dat=0) theo nguoi_don_id
--     (SNAPSHOT người chịu trách nhiệm đúng tuần đó), tuan_bat_dau rơi trong tháng, chia cho SỐ
--     LẦN người đó thực sự có snapshot (không chia cho tổng số tuần). Không có lần chấm nào →
--     mặc định 100.
--   D (Chuyên môn) — kpi_daily_evaluations + kpi_daily_evaluation_items. Chỉ tính các NGÀY có ít
--     nhất 1 lượt chấm loai='chinh' (đúng "ngày có mặt/có chấm" theo rules file). Điểm mỗi ngày =
--     (%chính×10 + Σ%choàng_i×5) ÷ (10 + 5×số nhóm choàng có chấm ngày đó) × 100, trung bình theo
--     ngày trong tháng. Không có ngày nào → mặc định 100, so_ngay_co_cham = 0.
--
-- Quyết định thiết kế (bản nháp Phase 4, chưa khóa sổ — điểm luôn 'nhap'):
-- 1. Thiếu dữ liệu 1 thành phần (A/B/C/D) → mặc định 100 cho riêng thành phần đó, KHÔNG
--    renormalize lại trọng số 3 thành phần còn lại. Đơn giản hóa có chủ đích cho giai đoạn nháp
--    (roadmap: "chạy nháp 1-2 tháng quan sát thực tế" trước khi tinh chỉnh ở Phase 5).
-- 2. `kpi_score_weights` cho phép cấu hình riêng theo `group_id` (nhóm chuyên môn CHÍNH của user)
--    hoặc dòng mặc định `group_id IS NULL` (toàn nhà máy) — ưu tiên dòng theo nhóm nếu có.
-- 3. Validate tổng 4 trọng số = 100 là ràng buộc TẦNG APP (Settings form), KHÔNG phải CHECK
--    constraint DB — admin có thể tạm thời lưu dở khi đang chỉnh sửa nhiều dòng.
-- 4. Engine là 1 RPC/transaction dùng GROUP BY cho toàn bộ user của nhà máy trong 1 lượt gọi,
--    KHÔNG loop-per-user (đúng ràng buộc bắt buộc đã ghi ở "Rủi ro/quy tắc bắt buộc" đầu rules
--    file). UPSERT có điều kiện `WHERE trang_thai <> 'da_khoa'` — không ghi đè điểm đã khóa, dù
--    Phase 4 chưa có UI khóa (chuẩn bị sẵn cho Phase 5).

-- ══════════════════ 1. kpi_score_weights ══════════════════
CREATE TABLE IF NOT EXISTS public.kpi_score_weights (
  id                     UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id             UUID NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  group_id               UUID REFERENCES public.personnel_groups(id) ON DELETE CASCADE,
  trong_so_hoan_thanh    NUMERIC NOT NULL DEFAULT 30,
  trong_so_dung_han      NUMERIC NOT NULL DEFAULT 25,
  trong_so_5s            NUMERIC NOT NULL DEFAULT 20,
  trong_so_chuyen_mon    NUMERIC NOT NULL DEFAULT 25,
  ngay_chuan_chuyen_can  NUMERIC NOT NULL DEFAULT 24,
  he_so_chuyen_can_min   NUMERIC NOT NULL DEFAULT 0.75,
  he_so_chuyen_can_max   NUMERIC NOT NULL DEFAULT 1.10,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(factory_id, group_id)
);

-- UNIQUE(factory_id, group_id) không tự chặn nhiều dòng group_id=NULL (Postgres coi NULL <> NULL
-- trong unique constraint) — thêm partial unique index riêng để chỉ có đúng 1 dòng mặc định.
CREATE UNIQUE INDEX IF NOT EXISTS idx_kpi_score_weights_default
  ON public.kpi_score_weights(factory_id) WHERE group_id IS NULL;

ALTER TABLE public.kpi_score_weights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kpi_score_weights_select" ON public.kpi_score_weights;
CREATE POLICY "kpi_score_weights_select" ON public.kpi_score_weights
  FOR SELECT USING (factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "kpi_score_weights_insert" ON public.kpi_score_weights;
CREATE POLICY "kpi_score_weights_insert" ON public.kpi_score_weights
  FOR INSERT WITH CHECK (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND public.current_profile_has_permission('kpi.manage_config')
  );

DROP POLICY IF EXISTS "kpi_score_weights_update" ON public.kpi_score_weights;
CREATE POLICY "kpi_score_weights_update" ON public.kpi_score_weights
  FOR UPDATE USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND public.current_profile_has_permission('kpi.manage_config')
  );

DROP POLICY IF EXISTS "kpi_score_weights_delete" ON public.kpi_score_weights;
CREATE POLICY "kpi_score_weights_delete" ON public.kpi_score_weights
  FOR DELETE USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND public.current_profile_has_permission('kpi.manage_config')
  );

CREATE OR REPLACE FUNCTION public.kpi_score_weights_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_kpi_score_weights_updated_at ON public.kpi_score_weights;
CREATE TRIGGER trg_kpi_score_weights_updated_at
  BEFORE UPDATE ON public.kpi_score_weights
  FOR EACH ROW EXECUTE FUNCTION public.kpi_score_weights_set_updated_at();

-- ══════════════════ 2. kpi_monthly_scores ══════════════════
CREATE TABLE IF NOT EXISTS public.kpi_monthly_scores (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id        UUID NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES auth.users(id),
  nam               INTEGER NOT NULL,
  thang             INTEGER NOT NULL CHECK (thang BETWEEN 1 AND 12),
  diem_hoan_thanh   NUMERIC,
  diem_dung_han     NUMERIC,
  diem_5s           NUMERIC,
  diem_chuyen_mon   NUMERIC,
  he_so_chuyen_can  NUMERIC,
  so_ngay_co_cham   INTEGER,
  diem_tong         NUMERIC,
  chi_tiet          JSONB,
  trang_thai        TEXT NOT NULL DEFAULT 'nhap' CHECK (trang_thai IN ('nhap', 'da_khoa')),
  khoa_boi          UUID REFERENCES auth.users(id),
  khoa_luc          TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(factory_id, user_id, nam, thang)
);

CREATE INDEX IF NOT EXISTS idx_kpi_monthly_scores_user ON public.kpi_monthly_scores(user_id, nam, thang);
CREATE INDEX IF NOT EXISTS idx_kpi_monthly_scores_factory_period ON public.kpi_monthly_scores(factory_id, nam, thang);

ALTER TABLE public.kpi_monthly_scores ENABLE ROW LEVEL SECURITY;

-- Xem điểm cá nhân (mọi user), hoặc toàn nhà máy (admin/kpi.view_all). Không có INSERT/UPDATE/
-- DELETE cho client — chỉ engine RPC (SECURITY DEFINER) mới ghi được.
DROP POLICY IF EXISTS "kpi_monthly_scores_select" ON public.kpi_monthly_scores;
CREATE POLICY "kpi_monthly_scores_select" ON public.kpi_monthly_scores
  FOR SELECT USING (
    factory_id IN (SELECT factory_id FROM public.profiles WHERE id = auth.uid())
    AND (
      user_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR public.current_profile_has_permission('kpi.view_all')
    )
  );

-- ══════════════ 3. RPC atomic kpi_compute_monthly_scores ══════════════
-- 1 lệnh gọi tính lại điểm A/B/C/D + hệ số chuyên cần + diem_tong cho TOÀN BỘ user active của 1
-- nhà máy trong 1 (nam, thang) — dùng CTE/GROUP BY, không loop-per-user.
CREATE OR REPLACE FUNCTION public.kpi_compute_monthly_scores(
  p_factory_id UUID,
  p_nam INTEGER,
  p_thang INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_month_start DATE;
  v_month_end DATE;
  v_cutoff TIMESTAMPTZ;
  v_affected INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Chưa đăng nhập.';
  END IF;
  IF NOT public.current_profile_has_permission('kpi.manage_config') THEN
    RAISE EXCEPTION 'Bạn không có quyền tính điểm KPI tháng.';
  END IF;
  IF p_thang < 1 OR p_thang > 12 THEN
    RAISE EXCEPTION 'Tháng không hợp lệ: %', p_thang;
  END IF;

  v_month_start := make_date(p_nam, p_thang, 1);
  v_month_end := (v_month_start + INTERVAL '1 month' - INTERVAL '1 day')::date;
  v_cutoff := LEAST(now(), (v_month_end + 1)::timestamptz);

  WITH a_data AS (
    SELECT tm.user_id, AVG(COALESCE(tm.tien_do_nghiem_thu, tm.tien_do)) AS diem_hoan_thanh
    FROM public.kpi_task_members tm
    JOIN public.kpi_tasks t ON t.id = tm.task_id
    WHERE t.factory_id = p_factory_id
      AND tm.is_active = true
      AND t.ngay_giao BETWEEN v_month_start AND v_month_end
    GROUP BY tm.user_id
  ),
  b_data AS (
    SELECT tm.user_id,
      COUNT(*) FILTER (WHERE tm.da_nop_luc IS NOT NULL AND tm.da_nop_luc <= t.han_hoan_thanh) AS dung_han,
      COUNT(*) AS tong_da_den_han
    FROM public.kpi_task_members tm
    JOIN public.kpi_tasks t ON t.id = tm.task_id
    WHERE t.factory_id = p_factory_id
      AND tm.is_active = true
      AND t.ngay_giao BETWEEN v_month_start AND v_month_end
      AND t.han_hoan_thanh <= v_cutoff
    GROUP BY tm.user_id
  ),
  c_data AS (
    SELECT e.nguoi_don_id AS user_id,
      AVG(CASE e.ket_qua WHEN 'dat' THEN 100 WHEN 'tuong_doi' THEN 50 ELSE 0 END) AS diem_5s
    FROM public.kpi_5s_evaluations e
    WHERE e.factory_id = p_factory_id
      AND e.tuan_bat_dau BETWEEN v_month_start AND v_month_end
    GROUP BY e.nguoi_don_id
  ),
  eval_pct AS (
    SELECT de.id AS evaluation_id, de.user_id, de.ngay, de.loai,
      COALESCE(
        (SELECT AVG(CASE it.ket_qua WHEN 'dat' THEN 1.0 WHEN 'tuong_doi' THEN 0.5 ELSE 0 END)
         FROM public.kpi_daily_evaluation_items it WHERE it.evaluation_id = de.id),
        0
      ) AS pct
    FROM public.kpi_daily_evaluations de
    WHERE de.factory_id = p_factory_id AND de.ngay BETWEEN v_month_start AND v_month_end
  ),
  chinh_days AS (
    SELECT user_id, ngay, pct AS chinh_pct FROM eval_pct WHERE loai = 'chinh'
  ),
  choang_days AS (
    SELECT user_id, ngay, SUM(pct * 5) AS choang_sum, COUNT(*) AS choang_count
    FROM eval_pct WHERE loai = 'choang'
    GROUP BY user_id, ngay
  ),
  day_scores AS (
    SELECT
      c.user_id,
      c.ngay,
      (c.chinh_pct * 10) + COALESCE(ch.choang_sum, 0) AS diem_ngay,
      10 + COALESCE(ch.choang_count, 0) * 5 AS max_ngay
    FROM chinh_days c
    LEFT JOIN choang_days ch ON ch.user_id = c.user_id AND ch.ngay = c.ngay
  ),
  d_data AS (
    SELECT user_id,
      AVG((diem_ngay / NULLIF(max_ngay, 0)) * 100) AS diem_chuyen_mon,
      COUNT(*) AS so_ngay_co_cham
    FROM day_scores
    GROUP BY user_id
  ),
  weight_row AS (
    SELECT p.id AS user_id,
      COALESCE(w_group.trong_so_hoan_thanh, w_default.trong_so_hoan_thanh, 30) AS w_a,
      COALESCE(w_group.trong_so_dung_han, w_default.trong_so_dung_han, 25) AS w_b,
      COALESCE(w_group.trong_so_5s, w_default.trong_so_5s, 20) AS w_c,
      COALESCE(w_group.trong_so_chuyen_mon, w_default.trong_so_chuyen_mon, 25) AS w_d,
      COALESCE(w_group.ngay_chuan_chuyen_can, w_default.ngay_chuan_chuyen_can, 24) AS ngay_chuan,
      COALESCE(w_group.he_so_chuyen_can_min, w_default.he_so_chuyen_can_min, 0.75) AS he_so_min,
      COALESCE(w_group.he_so_chuyen_can_max, w_default.he_so_chuyen_can_max, 1.10) AS he_so_max
    FROM public.profiles p
    LEFT JOIN public.maintenance_staff ms ON ms.profile_id = p.id AND ms.factory_id = p_factory_id
    LEFT JOIN public.personnel_group_members pgm ON pgm.staff_id = ms.id AND pgm.is_primary = true
    LEFT JOIN public.kpi_score_weights w_group ON w_group.factory_id = p_factory_id AND w_group.group_id = pgm.group_id
    LEFT JOIN public.kpi_score_weights w_default ON w_default.factory_id = p_factory_id AND w_default.group_id IS NULL
    WHERE p.factory_id = p_factory_id AND p.status = 'active'
  ),
  final_calc AS (
    SELECT
      wr.user_id,
      COALESCE(a.diem_hoan_thanh, 100) AS diem_hoan_thanh,
      COALESCE(
        CASE WHEN b.tong_da_den_han > 0 THEN (b.dung_han::numeric / b.tong_da_den_han) * 100 ELSE NULL END,
        100
      ) AS diem_dung_han,
      COALESCE(c.diem_5s, 100) AS diem_5s,
      COALESCE(d.diem_chuyen_mon, 100) AS diem_chuyen_mon,
      COALESCE(d.so_ngay_co_cham, 0) AS so_ngay_co_cham,
      wr.w_a, wr.w_b, wr.w_c, wr.w_d, wr.ngay_chuan, wr.he_so_min, wr.he_so_max
    FROM weight_row wr
    LEFT JOIN a_data a ON a.user_id = wr.user_id
    LEFT JOIN b_data b ON b.user_id = wr.user_id
    LEFT JOIN c_data c ON c.user_id = wr.user_id
    LEFT JOIN d_data d ON d.user_id = wr.user_id
  ),
  scored AS (
    SELECT
      fc.*,
      LEAST(fc.he_so_max, GREATEST(fc.he_so_min, fc.so_ngay_co_cham::numeric / NULLIF(fc.ngay_chuan, 0))) AS he_so_chuyen_can
    FROM final_calc fc
  ),
  upserted AS (
    INSERT INTO public.kpi_monthly_scores (
      factory_id, user_id, nam, thang,
      diem_hoan_thanh, diem_dung_han, diem_5s, diem_chuyen_mon,
      he_so_chuyen_can, so_ngay_co_cham, diem_tong, chi_tiet, trang_thai
    )
    SELECT
      p_factory_id, s.user_id, p_nam, p_thang,
      round(s.diem_hoan_thanh, 1),
      round(s.diem_dung_han, 1),
      round(s.diem_5s, 1),
      round(s.diem_chuyen_mon, 1),
      round(s.he_so_chuyen_can, 3),
      s.so_ngay_co_cham,
      round(
        ((s.w_a * s.diem_hoan_thanh + s.w_b * s.diem_dung_han + s.w_c * s.diem_5s + s.w_d * s.diem_chuyen_mon) / 100.0)
        * s.he_so_chuyen_can,
        1
      ),
      jsonb_build_object(
        'a', round(s.diem_hoan_thanh, 1), 'b', round(s.diem_dung_han, 1),
        'c', round(s.diem_5s, 1), 'd', round(s.diem_chuyen_mon, 1),
        'trong_so', jsonb_build_object('a', s.w_a, 'b', s.w_b, 'c', s.w_c, 'd', s.w_d),
        'he_so_chuyen_can', round(s.he_so_chuyen_can, 3),
        'so_ngay_co_cham', s.so_ngay_co_cham, 'ngay_chuan', s.ngay_chuan
      ),
      'nhap'
    FROM scored s
    ON CONFLICT (factory_id, user_id, nam, thang)
    DO UPDATE SET
      diem_hoan_thanh = EXCLUDED.diem_hoan_thanh,
      diem_dung_han = EXCLUDED.diem_dung_han,
      diem_5s = EXCLUDED.diem_5s,
      diem_chuyen_mon = EXCLUDED.diem_chuyen_mon,
      he_so_chuyen_can = EXCLUDED.he_so_chuyen_can,
      so_ngay_co_cham = EXCLUDED.so_ngay_co_cham,
      diem_tong = EXCLUDED.diem_tong,
      chi_tiet = EXCLUDED.chi_tiet,
      updated_at = now()
    WHERE public.kpi_monthly_scores.trang_thai <> 'da_khoa'
    RETURNING 1
  )
  SELECT count(*) INTO v_affected FROM upserted;

  RETURN v_affected;
END;
$$;

REVOKE ALL ON FUNCTION public.kpi_compute_monthly_scores(UUID, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kpi_compute_monthly_scores(UUID, INTEGER, INTEGER) TO authenticated;
