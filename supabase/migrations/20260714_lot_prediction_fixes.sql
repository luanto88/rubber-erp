-- Fix 4 lỗi module "Dự đoán số lô thành phẩm" — xem .claude/rules/06-module-production.md
-- mục "Cập nhật 2026-07-14" để biết bối cảnh đầy đủ.
--
-- 1) Gắn "batch nào thực sự gán ngăn cho từng kiện" (kien_X_batch_id) — độc lập với
--    origin_batch_id/last_batch_id vốn chỉ theo dõi ở cấp CẢ DÒNG. Đây là root cause của bug
--    "N4 continue lô dở dang của N5 nhưng in thiếu kiện, còn N5 in lại thì lòi thêm nhãn phantom
--    của kiện đã bị N4 nhận".
-- 2) Backfill 2-hop cho dữ liệu hiện có.
-- 3) RPC create_lot_prediction_batch: ghi kèm kien_X_batch_id ở mọi nơi ghi kien_X_ngan_id, và
--    thêm tham số p_override_start_num cho tính năng "sửa số lô bắt đầu khi bắt đầu lô mới".
-- 4) Thêm cột lưu URL PDF đã render (nhãn nhỏ/lớn) trên lot_prediction_batches — mở lại bằng
--    icon, không phải render lại.

-- ── 1) Cột mới kien_X_batch_id ──────────────────────────────────────────────────────────────
ALTER TABLE lot_prediction_lots
  ADD COLUMN IF NOT EXISTS kien_a_batch_id UUID REFERENCES lot_prediction_batches(id);
ALTER TABLE lot_prediction_lots
  ADD COLUMN IF NOT EXISTS kien_b_batch_id UUID REFERENCES lot_prediction_batches(id);
ALTER TABLE lot_prediction_lots
  ADD COLUMN IF NOT EXISTS kien_c_batch_id UUID REFERENCES lot_prediction_batches(id);
ALTER TABLE lot_prediction_lots
  ADD COLUMN IF NOT EXISTS kien_d_batch_id UUID REFERENCES lot_prediction_batches(id);

CREATE INDEX IF NOT EXISTS idx_lot_prediction_lots_kien_a_batch ON lot_prediction_lots (kien_a_batch_id);
CREATE INDEX IF NOT EXISTS idx_lot_prediction_lots_kien_b_batch ON lot_prediction_lots (kien_b_batch_id);
CREATE INDEX IF NOT EXISTS idx_lot_prediction_lots_kien_c_batch ON lot_prediction_lots (kien_c_batch_id);
CREATE INDEX IF NOT EXISTS idx_lot_prediction_lots_kien_d_batch ON lot_prediction_lots (kien_d_batch_id);

-- ── 2) Backfill 2-hop: khớp ngan_id hiện tại của kien_X với ngan_id của origin_batch_id trước,
--    fallback last_batch_id, fallback cuối origin_batch_id. Chạy lại an toàn nhiều lần (chỉ ghi
--    khi kien_X_ngan_id IS NOT NULL và kien_X_batch_id đang NULL).
UPDATE lot_prediction_lots l
SET kien_a_batch_id = CASE
  WHEN l.kien_a_ngan_id IS NULL THEN NULL
  WHEN l.kien_a_ngan_id = (SELECT ngan_id FROM lot_prediction_batches WHERE id = l.origin_batch_id) THEN l.origin_batch_id
  WHEN l.kien_a_ngan_id = (SELECT ngan_id FROM lot_prediction_batches WHERE id = l.last_batch_id) THEN l.last_batch_id
  ELSE l.origin_batch_id
END
WHERE l.kien_a_batch_id IS NULL AND l.kien_a_ngan_id IS NOT NULL;

UPDATE lot_prediction_lots l
SET kien_b_batch_id = CASE
  WHEN l.kien_b_ngan_id IS NULL THEN NULL
  WHEN l.kien_b_ngan_id = (SELECT ngan_id FROM lot_prediction_batches WHERE id = l.origin_batch_id) THEN l.origin_batch_id
  WHEN l.kien_b_ngan_id = (SELECT ngan_id FROM lot_prediction_batches WHERE id = l.last_batch_id) THEN l.last_batch_id
  ELSE l.origin_batch_id
END
WHERE l.kien_b_batch_id IS NULL AND l.kien_b_ngan_id IS NOT NULL;

UPDATE lot_prediction_lots l
SET kien_c_batch_id = CASE
  WHEN l.kien_c_ngan_id IS NULL THEN NULL
  WHEN l.kien_c_ngan_id = (SELECT ngan_id FROM lot_prediction_batches WHERE id = l.origin_batch_id) THEN l.origin_batch_id
  WHEN l.kien_c_ngan_id = (SELECT ngan_id FROM lot_prediction_batches WHERE id = l.last_batch_id) THEN l.last_batch_id
  ELSE l.origin_batch_id
END
WHERE l.kien_c_batch_id IS NULL AND l.kien_c_ngan_id IS NOT NULL;

UPDATE lot_prediction_lots l
SET kien_d_batch_id = CASE
  WHEN l.kien_d_ngan_id IS NULL THEN NULL
  WHEN l.kien_d_ngan_id = (SELECT ngan_id FROM lot_prediction_batches WHERE id = l.origin_batch_id) THEN l.origin_batch_id
  WHEN l.kien_d_ngan_id = (SELECT ngan_id FROM lot_prediction_batches WHERE id = l.last_batch_id) THEN l.last_batch_id
  ELSE l.origin_batch_id
END
WHERE l.kien_d_batch_id IS NULL AND l.kien_d_ngan_id IS NOT NULL;

-- ── 3) Cột lưu PDF đã render (nhãn nhỏ / nhãn lớn) — mở lại qua icon, không render lại ───────
ALTER TABLE lot_prediction_batches ADD COLUMN IF NOT EXISTS pdf_small_url TEXT;
ALTER TABLE lot_prediction_batches ADD COLUMN IF NOT EXISTS pdf_small_generated_at TIMESTAMPTZ;
ALTER TABLE lot_prediction_batches ADD COLUMN IF NOT EXISTS pdf_large_url TEXT;
ALTER TABLE lot_prediction_batches ADD COLUMN IF NOT EXISTS pdf_large_generated_at TIMESTAMPTZ;

-- ── 4) RPC create_lot_prediction_batch — thêm p_override_start_num, ghi kien_X_batch_id ──────
-- QUAN TRỌNG: Postgres coi "chữ ký hàm" (danh sách KIỂU tham số theo thứ tự) là định danh khi
-- overload — CREATE OR REPLACE với thêm 1 tham số cuối (dù có DEFAULT) sẽ KHÔNG thay thế hàm
-- cũ, mà tạo ra một overload thứ 2 song song, gây "function is not unique" khi PostgREST gọi
-- bằng named params chỉ khớp phần đầu chung của cả 2 chữ ký. Phải DROP đúng chữ ký cũ (20 tham
-- số, kết thúc bằng BOOLEAN của p_closes_ngan) trước khi tạo lại với 21 tham số.
DROP FUNCTION IF EXISTS create_lot_prediction_batch(
  UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, TEXT, UUID,
  NUMERIC, TEXT, INTEGER, TEXT[], INTEGER, BOOLEAN
);

CREATE OR REPLACE FUNCTION create_lot_prediction_batch(
  p_factory_id              UUID,
  p_ngan_id                 UUID,
  p_day_chuyen              TEXT,
  p_loai_csr                TEXT,
  p_loai_banh               NUMERIC,
  p_boc                     TEXT,
  p_tham                    TEXT,
  p_suffix                  TEXT,
  p_year                    TEXT,
  p_kien_weight_kg          NUMERIC,
  p_existing_real_kg        NUMERIC,
  p_requested_lot_count     INTEGER,
  p_carry_resolution        TEXT,
  p_created_by              UUID,
  p_reserved_kg             NUMERIC DEFAULT 0,
  p_real_lot_ma_lo          TEXT DEFAULT NULL,
  p_real_lot_num            INTEGER DEFAULT NULL,
  p_real_unassignable_kien  TEXT[] DEFAULT NULL,
  p_requested_trailing_kien INTEGER DEFAULT NULL,
  p_closes_ngan             BOOLEAN DEFAULT false,
  p_override_start_num      INTEGER DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ngan RECORD;
  v_pending RECORD;
  v_pending_found BOOLEAN := false;
  v_bridge_needed BOOLEAN := false;
  v_batch_id UUID;
  v_cap_kg NUMERIC;
  v_used_kg_predicted NUMERIC;
  v_used_kg NUMERIC;
  v_available_kg NUMERIC;
  v_continue BOOLEAN := false;
  v_next_num INTEGER;
  v_fresh_start_num INTEGER;
  v_remaining INTEGER;
  v_lot_weight_kg NUMERIC;
  v_n_max INTEGER;
  v_n INTEGER;
  v_leftover_kg NUMERIC;
  v_leftover_kien_count INTEGER;
  v_created_ids UUID[] := '{}';
  v_new_id UUID;
  v_ma_lo TEXT;
  v_i INTEGER;
  v_all_assigned BOOLEAN;
  v_unassignable TEXT[];
BEGIN
  SELECT * INTO v_ngan FROM ngans WHERE id = p_ngan_id AND factory_id = p_factory_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ngăn không tìm thấy hoặc không thuộc nhà máy này';
  END IF;

  v_cap_kg := COALESCE(v_ngan.tong_kho, 0) * 1.10;

  SELECT COALESCE(SUM(
    (CASE WHEN kien_a_ngan_id = p_ngan_id THEN kien_weight_kg ELSE 0 END) +
    (CASE WHEN kien_b_ngan_id = p_ngan_id THEN kien_weight_kg ELSE 0 END) +
    (CASE WHEN kien_c_ngan_id = p_ngan_id THEN kien_weight_kg ELSE 0 END) +
    (CASE WHEN kien_d_ngan_id = p_ngan_id THEN kien_weight_kg ELSE 0 END)
  ), 0) INTO v_used_kg_predicted
  FROM lot_prediction_lots
  WHERE factory_id = p_factory_id AND trang_thai = 'Dự kiến' AND real_lot_id IS NULL;

  v_used_kg := COALESCE(p_existing_real_kg, 0) + v_used_kg_predicted + COALESCE(p_reserved_kg, 0);
  v_available_kg := GREATEST(0, v_cap_kg - v_used_kg);

  -- Tìm lô carry-over đang chờ nối cùng series (từ dự đoán trước HOẶC đã bridge từ lô thật
  -- trước đó nhưng chưa xử lý xong), lock để tránh race
  SELECT * INTO v_pending
  FROM lot_prediction_lots
  WHERE factory_id = p_factory_id
    AND loai_csr = p_loai_csr
    AND loai_banh = p_loai_banh
    AND year = p_year
    AND carry_over_status = 'pending'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;
  v_pending_found := FOUND;

  IF v_pending_found AND p_carry_resolution IS NULL THEN
    RAISE EXCEPTION 'CARRY_PENDING:%:%', v_pending.id, v_pending.ma_lo;
  END IF;

  -- Nếu không có carry-over dự đoán nào đang chờ, kiểm tra xem lô thật Dở dang (JS truyền
  -- vào) đã từng được bridge chưa — nếu chưa có row nào khớp ma_lo thì cần tạo mới sau khi
  -- có batch_id.
  IF NOT v_pending_found AND p_real_lot_ma_lo IS NOT NULL THEN
    PERFORM 1 FROM lot_prediction_lots
    WHERE factory_id = p_factory_id AND ma_lo = p_real_lot_ma_lo;
    IF NOT FOUND THEN
      v_bridge_needed := true;
    END IF;
  END IF;

  -- Tạo batch trước để có id tham chiếu cho các UPDATE/INSERT tiếp theo
  INSERT INTO lot_prediction_batches (
    factory_id, ngan_id, day_chuyen, loai_csr, loai_banh, boc, tham, suffix, year,
    requested_lot_count, suggested_lot_count, ngan_tong_kho_snapshot, ngan_used_kg_snapshot,
    carry_from_prediction_lot_id, closes_ngan, created_by
  ) VALUES (
    p_factory_id, p_ngan_id, p_day_chuyen, p_loai_csr, p_loai_banh, p_boc, p_tham, p_suffix, p_year,
    p_requested_lot_count, 0, COALESCE(v_ngan.tong_kho, 0), v_used_kg,
    CASE WHEN v_pending_found THEN v_pending.id ELSE NULL END, COALESCE(p_closes_ngan, false), p_created_by
  ) RETURNING id INTO v_batch_id;

  IF v_pending_found AND p_carry_resolution = 'skip' THEN
    UPDATE lot_prediction_lots
      SET carry_over_status = 'abandoned', last_batch_id = v_batch_id
      WHERE id = v_pending.id;
  END IF;

  IF v_bridge_needed THEN
    v_unassignable := COALESCE(p_real_unassignable_kien, '{}');
    INSERT INTO lot_prediction_lots (
      factory_id, ma_lo, num, suffix, year, loai_csr, loai_banh, boc, tham,
      kien_weight_kg, origin_batch_id, last_batch_id, unassignable_kien,
      carry_over_status, trang_thai, created_by
    ) VALUES (
      p_factory_id, p_real_lot_ma_lo, p_real_lot_num, p_suffix, p_year, p_loai_csr, p_loai_banh, p_boc, p_tham,
      p_kien_weight_kg, v_batch_id, v_batch_id, v_unassignable,
      'pending', 'Dự kiến', p_created_by
    ) RETURNING id INTO v_new_id;
    SELECT * INTO v_pending FROM lot_prediction_lots WHERE id = v_new_id;
    v_pending_found := true;
  END IF;

  v_continue := v_pending_found AND (p_carry_resolution = 'continue' OR v_bridge_needed);

  IF v_continue THEN
    v_remaining := LEAST(
      (CASE WHEN v_pending.kien_a_ngan_id IS NULL AND NOT ('a' = ANY(v_pending.unassignable_kien)) THEN 1 ELSE 0 END) +
      (CASE WHEN v_pending.kien_b_ngan_id IS NULL AND NOT ('b' = ANY(v_pending.unassignable_kien)) THEN 1 ELSE 0 END) +
      (CASE WHEN v_pending.kien_c_ngan_id IS NULL AND NOT ('c' = ANY(v_pending.unassignable_kien)) THEN 1 ELSE 0 END) +
      (CASE WHEN v_pending.kien_d_ngan_id IS NULL AND NOT ('d' = ANY(v_pending.unassignable_kien)) THEN 1 ELSE 0 END),
      FLOOR(v_available_kg / v_pending.kien_weight_kg)::INTEGER
    );

    -- Mỗi UPDATE dưới đây ghi CẢ kien_X_ngan_id LẪN kien_X_batch_id trong cùng câu lệnh —
    -- kien_X_batch_id là root-cause fix cho bug "N4 continue kiện của N5 nhưng in thiếu/lòi
    -- nhãn phantom" (xem .claude/rules/06-module-production.md mục "Cập nhật 2026-07-14").
    IF v_pending.kien_a_ngan_id IS NULL AND NOT ('a' = ANY(v_pending.unassignable_kien)) AND v_remaining > 0 THEN
      UPDATE lot_prediction_lots SET kien_a_ngan_id = p_ngan_id, kien_a_batch_id = v_batch_id WHERE id = v_pending.id;
      v_remaining := v_remaining - 1;
      v_available_kg := v_available_kg - v_pending.kien_weight_kg;
    END IF;
    IF v_pending.kien_b_ngan_id IS NULL AND NOT ('b' = ANY(v_pending.unassignable_kien)) AND v_remaining > 0 THEN
      UPDATE lot_prediction_lots SET kien_b_ngan_id = p_ngan_id, kien_b_batch_id = v_batch_id WHERE id = v_pending.id;
      v_remaining := v_remaining - 1;
      v_available_kg := v_available_kg - v_pending.kien_weight_kg;
    END IF;
    IF v_pending.kien_c_ngan_id IS NULL AND NOT ('c' = ANY(v_pending.unassignable_kien)) AND v_remaining > 0 THEN
      UPDATE lot_prediction_lots SET kien_c_ngan_id = p_ngan_id, kien_c_batch_id = v_batch_id WHERE id = v_pending.id;
      v_remaining := v_remaining - 1;
      v_available_kg := v_available_kg - v_pending.kien_weight_kg;
    END IF;
    IF v_pending.kien_d_ngan_id IS NULL AND NOT ('d' = ANY(v_pending.unassignable_kien)) AND v_remaining > 0 THEN
      UPDATE lot_prediction_lots SET kien_d_ngan_id = p_ngan_id, kien_d_batch_id = v_batch_id WHERE id = v_pending.id;
      v_remaining := v_remaining - 1;
      v_available_kg := v_available_kg - v_pending.kien_weight_kg;
    END IF;

    SELECT
      ((kien_a_ngan_id IS NOT NULL OR 'a' = ANY(unassignable_kien)) AND
       (kien_b_ngan_id IS NOT NULL OR 'b' = ANY(unassignable_kien)) AND
       (kien_c_ngan_id IS NOT NULL OR 'c' = ANY(unassignable_kien)) AND
       (kien_d_ngan_id IS NOT NULL OR 'd' = ANY(unassignable_kien)))
      INTO v_all_assigned
    FROM lot_prediction_lots WHERE id = v_pending.id;

    UPDATE lot_prediction_lots
      SET carry_over_status = CASE WHEN v_all_assigned THEN 'continued' ELSE 'pending' END,
          last_batch_id = v_batch_id
      WHERE id = v_pending.id;

    v_next_num := v_pending.num;
  ELSE
    -- Fallback: chưa có gì để nối tiếp — lấy số kế tiếp sau max hiện có, TRỪ KHI người dùng
    -- override tường minh (p_override_start_num, tính năng "bắt đầu lô mới" — xem rule 2026-07-14).
    IF p_override_start_num IS NOT NULL THEN
      v_ma_lo := CASE WHEN p_suffix = '' THEN p_override_start_num || '/' || p_year
                       ELSE p_override_start_num || p_suffix || '/' || p_year END;
      IF EXISTS (SELECT 1 FROM lots WHERE factory_id = p_factory_id AND ma_lo = v_ma_lo)
         OR EXISTS (
           SELECT 1 FROM lot_prediction_lots
           WHERE factory_id = p_factory_id AND ma_lo = v_ma_lo AND carry_over_status != 'abandoned'
         ) THEN
        RAISE EXCEPTION 'Số lô % đã tồn tại (trùng mã lô %), vui lòng chọn số khác.', p_override_start_num, v_ma_lo;
      END IF;
      v_next_num := p_override_start_num;
    ELSE
      SELECT GREATEST(
        COALESCE((SELECT MAX(num) FROM lots
          WHERE factory_id = p_factory_id AND loai_csr = p_loai_csr AND loai_banh = p_loai_banh AND year = p_year), 0),
        COALESCE((SELECT MAX(num) FROM lot_prediction_lots
          WHERE factory_id = p_factory_id AND loai_csr = p_loai_csr AND loai_banh = p_loai_banh
            AND year = p_year AND carry_over_status != 'abandoned'), 0)
      ) + 1 INTO v_next_num;
    END IF;
  END IF;

  -- v_next_num = số của dòng ĐANG được tiếp tục (đã tồn tại trong bảng) khi v_continue=true,
  -- nên lô MỚI hoàn toàn (Bước 2/3) phải bắt đầu từ v_next_num + 1 trong trường hợp đó —
  -- nếu không sẽ INSERT trùng đúng ma_lo của dòng vừa continue (vi phạm UNIQUE factory_id+ma_lo).
  -- Khi KHÔNG continue, v_next_num đã là số kế tiếp đúng (MAX+1 hoặc override), dùng thẳng.
  v_fresh_start_num := CASE WHEN v_continue THEN v_next_num + 1 ELSE v_next_num END;

  v_lot_weight_kg := 4 * p_kien_weight_kg;
  v_n_max := FLOOR(v_available_kg / v_lot_weight_kg)::INTEGER;
  v_n := LEAST(COALESCE(p_requested_lot_count, v_n_max), v_n_max);
  IF v_n < 0 THEN v_n := 0; END IF;

  v_i := 0;
  WHILE v_i < v_n LOOP
    v_ma_lo := CASE WHEN p_suffix = '' THEN (v_fresh_start_num + v_i) || '/' || p_year
                     ELSE (v_fresh_start_num + v_i) || p_suffix || '/' || p_year END;
    INSERT INTO lot_prediction_lots (
      factory_id, ma_lo, num, suffix, year, loai_csr, loai_banh, boc, tham,
      kien_weight_kg, origin_batch_id, last_batch_id,
      kien_a_ngan_id, kien_b_ngan_id, kien_c_ngan_id, kien_d_ngan_id,
      kien_a_batch_id, kien_b_batch_id, kien_c_batch_id, kien_d_batch_id,
      carry_over_status, trang_thai, created_by
    ) VALUES (
      p_factory_id, v_ma_lo, v_fresh_start_num + v_i, p_suffix, p_year, p_loai_csr, p_loai_banh, p_boc, p_tham,
      p_kien_weight_kg, v_batch_id, v_batch_id,
      p_ngan_id, p_ngan_id, p_ngan_id, p_ngan_id,
      v_batch_id, v_batch_id, v_batch_id, v_batch_id,
      'none', 'Dự kiến', p_created_by
    ) RETURNING id INTO v_new_id;
    v_created_ids := array_append(v_created_ids, v_new_id);
    v_i := v_i + 1;
  END LOOP;

  -- Khối "đuôi lẻ": trước đây chỉ chạy khi v_n = v_n_max (tức đã dùng hết mức tối đa 110%).
  -- Từ khi mặc định client nhắm mục tiêu 100-105% (v_n thường NHỎ HƠN v_n_max), khối này phải
  -- chạy cả khi có yêu cầu tường minh p_requested_trailing_kien, nếu không sẽ bị bỏ qua hoàn
  -- toàn và mất khả năng tạo lô lẻ theo lựa chọn thủ công của người dùng.
  IF v_n = v_n_max OR p_requested_trailing_kien IS NOT NULL THEN
    v_leftover_kg := v_available_kg - v_n * v_lot_weight_kg;
    -- LEAST(...,3): khi v_n < v_n_max (mục tiêu 100-105%), v_leftover_kg không còn chắc chắn
    -- nhỏ hơn 1 lô như trước (invariant cũ chỉ đúng khi v_n = v_n_max = FLOOR(...)).
    v_leftover_kien_count := LEAST(FLOOR(v_leftover_kg / p_kien_weight_kg)::INTEGER, 3);
    IF p_requested_trailing_kien IS NOT NULL THEN
      -- Override thủ công chỉ được GIẢM xuống dưới mức an toàn vừa tính, không bao giờ được
      -- tăng vượt qua nó (mức đó đã tôn trọng trần 110% qua v_available_kg/v_cap_kg).
      v_leftover_kien_count := LEAST(GREATEST(p_requested_trailing_kien, 0), v_leftover_kien_count);
    END IF;
    IF v_leftover_kien_count >= 1 THEN
      v_ma_lo := CASE WHEN p_suffix = '' THEN (v_fresh_start_num + v_n) || '/' || p_year
                       ELSE (v_fresh_start_num + v_n) || p_suffix || '/' || p_year END;
      INSERT INTO lot_prediction_lots (
        factory_id, ma_lo, num, suffix, year, loai_csr, loai_banh, boc, tham,
        kien_weight_kg, origin_batch_id, last_batch_id,
        kien_a_ngan_id, kien_b_ngan_id, kien_c_ngan_id, kien_d_ngan_id,
        kien_a_batch_id, kien_b_batch_id, kien_c_batch_id, kien_d_batch_id,
        carry_over_status, trang_thai, created_by
      ) VALUES (
        p_factory_id, v_ma_lo, v_fresh_start_num + v_n, p_suffix, p_year, p_loai_csr, p_loai_banh, p_boc, p_tham,
        p_kien_weight_kg, v_batch_id, v_batch_id,
        CASE WHEN v_leftover_kien_count >= 1 THEN p_ngan_id ELSE NULL END,
        CASE WHEN v_leftover_kien_count >= 2 THEN p_ngan_id ELSE NULL END,
        CASE WHEN v_leftover_kien_count >= 3 THEN p_ngan_id ELSE NULL END,
        NULL,
        CASE WHEN v_leftover_kien_count >= 1 THEN v_batch_id ELSE NULL END,
        CASE WHEN v_leftover_kien_count >= 2 THEN v_batch_id ELSE NULL END,
        CASE WHEN v_leftover_kien_count >= 3 THEN v_batch_id ELSE NULL END,
        NULL,
        'pending', 'Dự kiến', p_created_by
      ) RETURNING id INTO v_new_id;
      v_created_ids := array_append(v_created_ids, v_new_id);
    END IF;
  END IF;

  UPDATE lot_prediction_batches SET suggested_lot_count = v_n_max WHERE id = v_batch_id;

  RETURN jsonb_build_object(
    'batch_id', v_batch_id,
    'suggested_lot_count', v_n_max,
    'created_count', v_n,
    'next_num', v_fresh_start_num,
    'carry_continued', v_continue,
    'created_ids', to_jsonb(v_created_ids)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION create_lot_prediction_batch(
  UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, TEXT, UUID,
  NUMERIC, TEXT, INTEGER, TEXT[], INTEGER, BOOLEAN, INTEGER
) TO authenticated;
