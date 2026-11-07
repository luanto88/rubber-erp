-- GĐ3b — Thống kê chu kỳ sửa chữa + sản lượng giữa 2 lần sửa (docs/qr-equipment-plan.md).
-- CHẠY TAY trong Supabase SQL Editor TRƯỚC khi deploy code.
-- 2 hàm chỉ ĐỌC, gom theo NGÀY ở SQL để không kéo hàng nghìn dòng về điện thoại (giới hạn 1000 dòng PostgREST).
-- Chỉ service_role gọi (API /api/equipment/* tự kiểm quyền + nhà máy).

-- 1) Thành phẩm theo ngày + dây chuyền.
--    Giao dịch: lot_transactions.so_kg theo ngay_nhap.
--    Lô "mồ côi" (không có giao dịch): lots.tong_kg tại COALESCE(ngay_ht, ngay_sx) — cùng quy ước F12.
CREATE OR REPLACE FUNCTION public.equipment_daily_product_output(
  p_factory uuid,
  p_from date,
  p_to date
)
RETURNS TABLE (ngay date, day_chuyen text, so_kg numeric)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH tx AS (
    SELECT t.ngay_nhap AS ngay, l.day_chuyen, SUM(COALESCE(t.so_kg, 0)) AS so_kg
    FROM lot_transactions t
    JOIN lots l ON l.id = t.lot_id
    WHERE l.factory_id = p_factory
      AND t.ngay_nhap BETWEEN p_from AND p_to
    GROUP BY t.ngay_nhap, l.day_chuyen
  ),
  orphan AS (
    SELECT COALESCE(l.ngay_ht, l.ngay_sx) AS ngay, l.day_chuyen, SUM(COALESCE(l.tong_kg, 0)) AS so_kg
    FROM lots l
    WHERE l.factory_id = p_factory
      AND COALESCE(l.tong_kg, 0) > 0
      AND COALESCE(l.ngay_ht, l.ngay_sx) BETWEEN p_from AND p_to
      AND NOT EXISTS (SELECT 1 FROM lot_transactions t WHERE t.lot_id = l.id)
    GROUP BY 1, 2
  )
  SELECT u.ngay, u.day_chuyen, SUM(u.so_kg) AS so_kg
  FROM (SELECT * FROM tx UNION ALL SELECT * FROM orphan) u
  GROUP BY u.ngay, u.day_chuyen
  ORDER BY u.ngay;
$$;

-- 2) Điều xe theo ngày: KL TƯƠI tổng (5 loại) và KL tươi mủ tạp (chén + đông chén + đông khối + dây).
--    Nguồn thật = dispatch_entries.rows (JSONB, rule 19). Ngày dòng = rows[]._date nếu có, ngược lại entry.ngay;
--    nhận cả "YYYY-MM-DD" lẫn "dd/mm/yyyy". p_so_xe NULL ⇒ toàn nhà máy; có ⇒ chỉ chuyến của xe đó
--    (so khớp không phân biệt hoa/thường, bỏ số 0 đầu như parseVehicleCode).
CREATE OR REPLACE FUNCTION public.equipment_parse_any_date(p text)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p IS NULL THEN NULL
    WHEN btrim(p) ~ '^\d{4}-\d{2}-\d{2}' THEN substr(btrim(p), 1, 10)::date
    WHEN btrim(p) ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date(btrim(p), 'DD/MM/YYYY')
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.equipment_num(p text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN btrim(COALESCE(p, '')) ~ '^-?\d+(\.\d+)?$' THEN btrim(p)::numeric ELSE 0 END;
$$;

CREATE OR REPLACE FUNCTION public.equipment_daily_dispatch_output(
  p_factory uuid,
  p_from date,
  p_to date,
  p_so_xe text DEFAULT NULL
)
RETURNS TABLE (ngay date, kl_tuoi numeric, kl_tuoi_mu_tap numeric)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH r AS (
    SELECT
      COALESCE(equipment_parse_any_date(x->>'_date'), equipment_parse_any_date(e.ngay)) AS ngay,
      regexp_replace(upper(btrim(COALESCE(x->>'so_xe', ''))), '^0+(\d)', '\1') AS so_xe,
      equipment_num(x->>'kl_ct') + equipment_num(x->>'kl_dct') + equipment_num(x->>'kl_dkt')
        + equipment_num(x->>'kl_dt') AS mu_tap,
      equipment_num(x->>'kl_mn') AS mu_nuoc
    FROM dispatch_entries e
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(e.rows) = 'array' THEN e.rows ELSE '[]'::jsonb END
    ) x
    WHERE e.factory_id = p_factory
  )
  SELECT r.ngay, SUM(r.mu_tap + r.mu_nuoc) AS kl_tuoi, SUM(r.mu_tap) AS kl_tuoi_mu_tap
  FROM r
  WHERE r.ngay BETWEEN p_from AND p_to
    AND (
      p_so_xe IS NULL
      OR r.so_xe = regexp_replace(upper(btrim(p_so_xe)), '^0+(\d)', '\1')
    )
  GROUP BY r.ngay
  ORDER BY r.ngay;
$$;

REVOKE ALL ON FUNCTION public.equipment_daily_product_output(uuid, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.equipment_daily_dispatch_output(uuid, date, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.equipment_daily_product_output(uuid, date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.equipment_daily_dispatch_output(uuid, date, date, text) TO service_role;

-- Kiểm tra sau khi chạy (MCC-2 thay dao 06/10 → 19/10/2026, kỳ vọng Mủ tạp = 566895):
-- SELECT day_chuyen, SUM(so_kg) FROM equipment_daily_product_output(
--   (SELECT id FROM factories WHERE code = 'phuochoa_kt'), '2026-10-06', '2026-10-19') GROUP BY 1;
