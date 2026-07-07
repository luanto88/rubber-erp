-- Module Thành phẩm — Dự đoán số lô trước sản xuất + in nhãn QR theo kiện
-- Xem .claude/rules/06-module-production.md mục "4.6. Dự đoán số lô trước sản xuất"

-- 1. lot_prediction_batches: 1 dòng / lần "chọn ngăn → tạo dự đoán"
CREATE TABLE IF NOT EXISTS lot_prediction_batches (
  id                            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id                    UUID NOT NULL,
  ngan_id                       UUID NOT NULL REFERENCES ngans(id),
  day_chuyen                    TEXT,
  loai_csr                      TEXT NOT NULL,
  loai_banh                     NUMERIC NOT NULL,
  boc                           TEXT,
  tham                          TEXT,
  suffix                        TEXT NOT NULL DEFAULT '',
  year                          TEXT NOT NULL,
  requested_lot_count           INTEGER,
  suggested_lot_count           INTEGER NOT NULL DEFAULT 0,
  ngan_tong_kho_snapshot        NUMERIC NOT NULL DEFAULT 0,
  ngan_used_kg_snapshot         NUMERIC NOT NULL DEFAULT 0,
  carry_from_prediction_lot_id  UUID,
  status                        TEXT NOT NULL DEFAULT 'active', -- active | cancelled
  -- true = batch này đánh dấu `ngan_id` của chính nó là "đã dự kiến xong" — bất kỳ batch nào
  -- của 1 ngăn có cờ này thì ngăn đó bị loại khỏi loadPredictAvailableNgans, bất kể còn dư
  -- dung lượng danh nghĩa bao nhiêu (mục tiêu chỉ 100-105%, không phải 110%, nên luôn còn dư
  -- 5-10% nếu chỉ dựa vào capacity thô). Xem .claude/rules/06-module-production.md mục "4.6".
  closes_ngan                   BOOLEAN NOT NULL DEFAULT false,
  created_by                    UUID REFERENCES auth.users(id),
  created_at                    TIMESTAMPTZ DEFAULT now()
);

-- An toàn nếu bảng đã được tạo từ lần chạy trước (tương tự cột unassignable_kien bên dưới).
ALTER TABLE lot_prediction_batches
  ADD COLUMN IF NOT EXISTS closes_ngan BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_lot_prediction_batches_factory
  ON lot_prediction_batches (factory_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lot_prediction_batches_ngan
  ON lot_prediction_batches (ngan_id);
CREATE INDEX IF NOT EXISTS idx_lot_prediction_batches_closes_ngan
  ON lot_prediction_batches (factory_id, ngan_id) WHERE closes_ngan = true;

-- 2. lot_prediction_lots: 1 dòng / lô dự kiến (tương đương `lots`), 4 cột ngăn theo từng kiện
CREATE TABLE IF NOT EXISTS lot_prediction_lots (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id            UUID NOT NULL,
  ma_lo                 TEXT NOT NULL,
  num                   INTEGER NOT NULL,
  suffix                TEXT NOT NULL DEFAULT '',
  year                  TEXT NOT NULL,
  loai_csr              TEXT NOT NULL,
  loai_banh             NUMERIC NOT NULL,
  boc                   TEXT,
  tham                  TEXT,
  kien_weight_kg        NUMERIC NOT NULL, -- KL (kg) của 1 kiện tròn theo config loai_csr/loai_banh tại thời điểm tạo
  origin_batch_id       UUID NOT NULL REFERENCES lot_prediction_batches(id),
  last_batch_id         UUID NOT NULL REFERENCES lot_prediction_batches(id),
  kien_a_ngan_id        UUID REFERENCES ngans(id), -- null = chưa gán, chờ carry-over
  kien_b_ngan_id        UUID REFERENCES ngans(id),
  kien_c_ngan_id        UUID REFERENCES ngans(id),
  kien_d_ngan_id        UUID REFERENCES ngans(id),
  unassignable_kien     TEXT[] NOT NULL DEFAULT '{}', -- kien letter ('a'|'b'|'c'|'d') đã có thật (đủ hoặc dở dang 1 phần)
                                                        -- ở lô thật, KHÔNG được gán ngăn mới qua dự đoán — cột kien_X_ngan_id
                                                        -- tương ứng giữ NULL vĩnh viễn nhưng KHÔNG tính là "còn trống" nữa
  carry_over_status     TEXT NOT NULL DEFAULT 'none', -- none | pending | continued | abandoned
  trang_thai            TEXT NOT NULL DEFAULT 'Dự kiến', -- Dự kiến | Đã dùng | Hủy
  real_lot_id           UUID REFERENCES lots(id),
  created_by            UUID REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE (factory_id, ma_lo)
);

-- An toàn nếu bảng đã được tạo từ lần chạy trước (CREATE TABLE IF NOT EXISTS ở trên sẽ bị
-- bỏ qua khi bảng đã tồn tại, không tự thêm cột mới) — đảm bảo cột luôn có mặt trước khi RPC
-- bên dưới tham chiếu tới nó, tránh lỗi "record ... has no field unassignable_kien".
ALTER TABLE lot_prediction_lots
  ADD COLUMN IF NOT EXISTS unassignable_kien TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_lot_prediction_lots_factory_series
  ON lot_prediction_lots (factory_id, loai_csr, loai_banh, year);
CREATE INDEX IF NOT EXISTS idx_lot_prediction_lots_batch
  ON lot_prediction_lots (origin_batch_id);
CREATE INDEX IF NOT EXISTS idx_lot_prediction_lots_real_lot
  ON lot_prediction_lots (real_lot_id);
CREATE INDEX IF NOT EXISTS idx_lot_prediction_lots_pending
  ON lot_prediction_lots (factory_id, loai_csr, loai_banh, year, carry_over_status)
  WHERE carry_over_status = 'pending';

CREATE OR REPLACE FUNCTION set_lot_prediction_lots_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lot_prediction_lots_updated_at ON lot_prediction_lots;
CREATE TRIGGER trg_lot_prediction_lots_updated_at
  BEFORE UPDATE ON lot_prediction_lots
  FOR EACH ROW EXECUTE FUNCTION set_lot_prediction_lots_updated_at();

-- 3. RLS
-- SELECT mở public (`USING (true)`) — mirror đúng precedent "Allow all" đã áp dụng cho
-- `ngans`/`lots` (supabase/schema.sql), bắt buộc vì trang public /product-label (QR quét
-- ngoài hiện trường, không đăng nhập) dùng anon client để đọc, giống hệt cách /storage
-- hiện tại đang đọc `ngans` công khai. Ghi (INSERT/UPDATE/DELETE) vẫn giới hạn theo
-- factory của user đăng nhập, chặt hơn precedent cũ.
ALTER TABLE lot_prediction_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lot_prediction_batches_read" ON lot_prediction_batches;
CREATE POLICY "lot_prediction_batches_read" ON lot_prediction_batches
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "lot_prediction_batches_write" ON lot_prediction_batches;
CREATE POLICY "lot_prediction_batches_write" ON lot_prediction_batches
  FOR INSERT WITH CHECK (
    factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "lot_prediction_batches_update" ON lot_prediction_batches;
CREATE POLICY "lot_prediction_batches_update" ON lot_prediction_batches
  FOR UPDATE USING (
    factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid())
  );

ALTER TABLE lot_prediction_lots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lot_prediction_lots_read" ON lot_prediction_lots;
CREATE POLICY "lot_prediction_lots_read" ON lot_prediction_lots
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "lot_prediction_lots_insert" ON lot_prediction_lots;
CREATE POLICY "lot_prediction_lots_insert" ON lot_prediction_lots
  FOR INSERT WITH CHECK (
    factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "lot_prediction_lots_update" ON lot_prediction_lots;
CREATE POLICY "lot_prediction_lots_update" ON lot_prediction_lots
  FOR UPDATE USING (
    factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid())
  );

-- 4. Permissions
INSERT INTO permissions (code, module_name, action_name) VALUES
  ('product.predict_view',   'product', 'predict_view'),
  ('product.predict_manage', 'product', 'predict_manage')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role, permission_code) VALUES
  ('admin',   'product.predict_view'),
  ('admin',   'product.predict_manage'),
  ('manager', 'product.predict_view'),
  ('manager', 'product.predict_manage')
ON CONFLICT DO NOTHING;

-- 5. RPC atomic: create_lot_prediction_batch
-- Thuật toán chi tiết: .claude/rules/06-module-production.md mục "4.6"
-- p_carry_resolution: NULL (chưa biết có carry-over pending hay không) | 'continue' | 'skip'
--   Nếu đang có 1 lô carry-over 'pending' cùng series (loai_csr+loai_banh+year) và
--   p_carry_resolution = NULL, hàm RAISE EXCEPTION 'CARRY_PENDING:<id>:<ma_lo>' để client
--   biết cần hỏi người dùng trước rồi gọi lại với resolution rõ ràng. Rule này CHỈ áp dụng
--   cho carry-over sinh ra từ dự đoán trước (Bước 3 "đuôi lẻ") — KHÔNG áp dụng cho việc bridge
--   1 lô thật Dở dang có kiện dở dang một phần (p_real_lot_ma_lo), việc đó luôn tự động,
--   không hỏi người dùng (đã chốt nghiệp vụ).
--
-- p_reserved_kg: KL (kg) cần trừ thêm khỏi capacity của CHÍNH ngăn đang xử lý (p_ngan_id) vì
--   ngăn này đã/sẽ phải hoàn tất phần còn thiếu của 1 kiện dở dang một phần thuộc lô thật
--   Dở dang (vd kiện C=12/36, phần 24 bánh còn lại coi như "đã có chủ" của đúng ngăn đã
--   sản xuất 12 bánh đầu) — JS tính sẵn, chỉ áp dụng khi p_ngan_id trùng đúng ngăn gốc.
--
-- p_real_lot_ma_lo/p_real_lot_num/p_real_unassignable_kien: JS phát hiện có 1 lô thật
--   "Dở dang" cùng series CHƯA từng được bridge vào lot_prediction_lots (chưa có row nào
--   khớp ma_lo) — RPC sẽ tự tạo 1 row mới đại diện cho lô đó, đánh dấu các kiện đã có thật
--   (đủ hoặc dở dang 1 phần) vào unassignable_kien để KHÔNG được gán ngăn mới, chỉ gán các
--   kiện thật sự còn trống (vd kiện D) cho p_ngan_id.
--
-- p_requested_trailing_kien: override tường minh số kiện lẻ (0-3) của lô "đuôi" — khi NULL
--   (mặc định, dùng cho tạo nhiều ngăn cùng lúc) giữ nguyên hành vi cũ là tự động tối đa hóa
--   theo dung lượng còn lại; khi có giá trị (client tính theo mục tiêu lấp đầy 100-105%, chỉ
--   áp dụng khi user chọn đúng 1 ngăn), override CHỈ được phép GIẢM so với mức tối đa an toàn
--   vừa tính từ v_available_kg — không bao giờ vượt trần 110% (v_cap_kg). Không ảnh hưởng
--   nhánh v_continue (nối tiếp lô dở dang/carry-over đã có danh tính kiện cố định).
-- p_closes_ngan: true = đánh dấu p_ngan_id là "đã dự kiến xong", loại khỏi gợi ý các lần sau
--   bất kể còn dư dung lượng (xem cột lot_prediction_batches.closes_ngan).
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
  p_closes_ngan             BOOLEAN DEFAULT false
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

    IF v_pending.kien_a_ngan_id IS NULL AND NOT ('a' = ANY(v_pending.unassignable_kien)) AND v_remaining > 0 THEN
      UPDATE lot_prediction_lots SET kien_a_ngan_id = p_ngan_id WHERE id = v_pending.id;
      v_remaining := v_remaining - 1;
      v_available_kg := v_available_kg - v_pending.kien_weight_kg;
    END IF;
    IF v_pending.kien_b_ngan_id IS NULL AND NOT ('b' = ANY(v_pending.unassignable_kien)) AND v_remaining > 0 THEN
      UPDATE lot_prediction_lots SET kien_b_ngan_id = p_ngan_id WHERE id = v_pending.id;
      v_remaining := v_remaining - 1;
      v_available_kg := v_available_kg - v_pending.kien_weight_kg;
    END IF;
    IF v_pending.kien_c_ngan_id IS NULL AND NOT ('c' = ANY(v_pending.unassignable_kien)) AND v_remaining > 0 THEN
      UPDATE lot_prediction_lots SET kien_c_ngan_id = p_ngan_id WHERE id = v_pending.id;
      v_remaining := v_remaining - 1;
      v_available_kg := v_available_kg - v_pending.kien_weight_kg;
    END IF;
    IF v_pending.kien_d_ngan_id IS NULL AND NOT ('d' = ANY(v_pending.unassignable_kien)) AND v_remaining > 0 THEN
      UPDATE lot_prediction_lots SET kien_d_ngan_id = p_ngan_id WHERE id = v_pending.id;
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
    -- Fallback: chưa có gì để nối tiếp — lấy số kế tiếp sau max hiện có (bỏ qua các lô
    -- đã bridge/resolve, MAX(num) đã tự phản ánh đúng vì bridge row cũng nằm trong bảng này)
    SELECT GREATEST(
      COALESCE((SELECT MAX(num) FROM lots
        WHERE factory_id = p_factory_id AND loai_csr = p_loai_csr AND loai_banh = p_loai_banh AND year = p_year), 0),
      COALESCE((SELECT MAX(num) FROM lot_prediction_lots
        WHERE factory_id = p_factory_id AND loai_csr = p_loai_csr AND loai_banh = p_loai_banh
          AND year = p_year AND carry_over_status != 'abandoned'), 0)
    ) + 1 INTO v_next_num;
  END IF;

  -- v_next_num = số của dòng ĐANG được tiếp tục (đã tồn tại trong bảng) khi v_continue=true,
  -- nên lô MỚI hoàn toàn (Bước 2/3) phải bắt đầu từ v_next_num + 1 trong trường hợp đó —
  -- nếu không sẽ INSERT trùng đúng ma_lo của dòng vừa continue (vi phạm UNIQUE factory_id+ma_lo).
  -- Khi KHÔNG continue, v_next_num đã là số kế tiếp đúng (MAX+1), dùng thẳng làm điểm bắt đầu.
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
      carry_over_status, trang_thai, created_by
    ) VALUES (
      p_factory_id, v_ma_lo, v_fresh_start_num + v_i, p_suffix, p_year, p_loai_csr, p_loai_banh, p_boc, p_tham,
      p_kien_weight_kg, v_batch_id, v_batch_id,
      p_ngan_id, p_ngan_id, p_ngan_id, p_ngan_id,
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
        carry_over_status, trang_thai, created_by
      ) VALUES (
        p_factory_id, v_ma_lo, v_fresh_start_num + v_n, p_suffix, p_year, p_loai_csr, p_loai_banh, p_boc, p_tham,
        p_kien_weight_kg, v_batch_id, v_batch_id,
        CASE WHEN v_leftover_kien_count >= 1 THEN p_ngan_id ELSE NULL END,
        CASE WHEN v_leftover_kien_count >= 2 THEN p_ngan_id ELSE NULL END,
        CASE WHEN v_leftover_kien_count >= 3 THEN p_ngan_id ELSE NULL END,
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
  NUMERIC, TEXT, INTEGER, TEXT[], INTEGER, BOOLEAN
) TO authenticated;
