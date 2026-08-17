-- Module KPI & 5S — Renormalize công thức tính điểm KPI tháng khi thiếu dữ liệu.
-- Xem đầy đủ .claude/rules/27-kpi-module.md, mục "Kế hoạch phiên sau (2026-08-XX) — 3 cải tiến
-- sau khi dùng thử thực tế: renormalize điểm KPI, bắt buộc bằng chứng, fix bug mất ảnh" → mục A.
--
-- Bug đã sửa: trước đây mỗi thành phần A/B/C/D thiếu dữ liệu được COALESCE mặc định = 100, khiến
-- 1 người hoàn toàn không có dữ liệu ở CẢ 4 thành phần trong tháng vẫn ra điểm KPI = 75 (100 × hệ
-- số chuyên cần sàn 0.75) thay vì không được chấm điểm.
--
-- Quyết định đã chốt:
-- 1. Cả 4 thành phần đều KHÔNG có dữ liệu → KHÔNG tạo dòng kpi_monthly_scores nào cho user đó
--    tháng đó (không xuất hiện ở bảng "Toàn nhà máy"/bảng xếp hạng ẩn danh tháng đó).
-- 2. Chỉ MỘT SỐ thành phần có dữ liệu → renormalize trọng số CHỈ trên các thành phần CÓ dữ liệu
--    (vd chỉ A,B có: diem_tong = (wA×A + wB×B)/(wA+wB) × hệ_số_chuyên_cần), KHÔNG mặc định các
--    thành phần thiếu = 100 rồi cộng vào như trước.
--
-- Khi ĐỦ cả 4 thành phần, công thức tương đương y hệt bản cũ (w_sum_eff = tổng trọng số cấu hình,
-- thường = 100) — không có regression cho trường hợp dữ liệu đầy đủ.
--
-- Giữ nguyên chữ ký hàm (3 tham số) — không cần DROP FUNCTION.

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
    SELECT tm.user_id, AVG(COALESCE(tm.tien_do_nghiem_thu, tm.tien_do)) AS diem_hoan_thanh,
      COUNT(*) AS so_task
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
      AVG(CASE e.ket_qua WHEN 'dat' THEN 100 WHEN 'tuong_doi' THEN 50 ELSE 0 END) AS diem_5s,
      COUNT(*) AS so_lan_cham
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
      a.diem_hoan_thanh AS diem_hoan_thanh,
      COALESCE(a.so_task, 0) > 0 AS has_a,
      CASE WHEN b.tong_da_den_han > 0 THEN (b.dung_han::numeric / b.tong_da_den_han) * 100 ELSE NULL END AS diem_dung_han,
      COALESCE(b.tong_da_den_han, 0) > 0 AS has_b,
      c.diem_5s AS diem_5s,
      COALESCE(c.so_lan_cham, 0) > 0 AS has_c,
      d.diem_chuyen_mon AS diem_chuyen_mon,
      COALESCE(d.so_ngay_co_cham, 0) > 0 AS has_d,
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
      LEAST(fc.he_so_max, GREATEST(fc.he_so_min, fc.so_ngay_co_cham::numeric / NULLIF(fc.ngay_chuan, 0))) AS he_so_chuyen_can,
      CASE WHEN fc.has_a THEN fc.w_a ELSE 0 END AS w_a_eff,
      CASE WHEN fc.has_b THEN fc.w_b ELSE 0 END AS w_b_eff,
      CASE WHEN fc.has_c THEN fc.w_c ELSE 0 END AS w_c_eff,
      CASE WHEN fc.has_d THEN fc.w_d ELSE 0 END AS w_d_eff
    FROM final_calc fc
  ),
  scored2 AS (
    SELECT s.*, (s.w_a_eff + s.w_b_eff + s.w_c_eff + s.w_d_eff) AS w_sum_eff FROM scored s
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
        ( COALESCE(s.diem_hoan_thanh, 0) * s.w_a_eff
        + COALESCE(s.diem_dung_han, 0)   * s.w_b_eff
        + COALESCE(s.diem_5s, 0)         * s.w_c_eff
        + COALESCE(s.diem_chuyen_mon, 0) * s.w_d_eff )
        / s.w_sum_eff * s.he_so_chuyen_can,
        1
      ),
      jsonb_build_object(
        'a', round(s.diem_hoan_thanh, 1), 'b', round(s.diem_dung_han, 1),
        'c', round(s.diem_5s, 1), 'd', round(s.diem_chuyen_mon, 1),
        'trong_so', jsonb_build_object('a', s.w_a, 'b', s.w_b, 'c', s.w_c, 'd', s.w_d),
        'trong_so_hieu_luc', jsonb_build_object('a', s.w_a_eff, 'b', s.w_b_eff, 'c', s.w_c_eff, 'd', s.w_d_eff),
        'co_du_lieu', jsonb_build_object('a', s.has_a, 'b', s.has_b, 'c', s.has_c, 'd', s.has_d),
        'he_so_chuyen_can', round(s.he_so_chuyen_can, 3),
        'so_ngay_co_cham', s.so_ngay_co_cham, 'ngay_chuan', s.ngay_chuan
      ),
      'nhap'
    FROM scored2 s
    WHERE s.w_sum_eff > 0
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
