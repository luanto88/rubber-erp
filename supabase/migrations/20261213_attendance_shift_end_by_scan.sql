-- Chấm công — giờ kết thúc ca theo kiện quét cuối + chỉ duyệt phiếu ca sau khi Thành phẩm đã phê duyệt ca
-- (rule 31 + rule 06, người dùng chốt 2026-11-25). CHẠY TAY sau 20261212, TRƯỚC deploy.
--
-- Vấn đề: submit_confirm_draft_batch không truyền created_at ⇒ mọi kiện của 1 lượt "Gửi tất cả" mang CÙNG giờ gửi;
-- nháp bị xoá ⇒ giờ quét thật mất. Không biết kiện cuối của ca quét lúc nào.
--
-- 1. lot_transactions.quet_luc = giờ quét kiện (giờ tạo nháp). NULL ở dữ liệu cũ và ở giao dịch nhập tay. KHÔNG đổi
--    created_at (F09 đang dùng để xếp thứ tự).
-- 2. Trigger: phiếu điểm danh Ca sản xuất (đơn vị loại 'ca') chỉ chuyển sang 'da_duyet' khi ca đó (ngày + mã ca) ĐÃ được
--    "Phê duyệt" ở Thành phẩm (product_shift_locks active) — nếu ngày + ca có giao dịch thành phẩm. Khoá ca chặn nhập thêm
--    kiện ⇒ giờ duyệt điểm danh luôn sau kiện cuối. Ca không có kiện nào / phiếu tổ: không ràng buộc.
--    Khoá ca TP theo (nhà máy, ngày, ca) — không tách dây chuyền.
-- 3. submit_confirm_draft_batch CHÉP NGUYÊN từ 20261118_lot_nap.sql, chỉ thêm quet_luc vào INSERT.
--    Về sau mọi CREATE OR REPLACE submit_confirm_draft_batch PHẢI chép từ file này.

-- ── 1. Cột giờ quét ─────────────────────────────────────────────────────────
ALTER TABLE public.lot_transactions ADD COLUMN IF NOT EXISTS quet_luc timestamptz;
COMMENT ON COLUMN public.lot_transactions.quet_luc IS
  'Giờ quét kiện thật (giờ tạo nháp ở màn quét QR). NULL = nhập tay / dữ liệu trước 20261213.';
CREATE INDEX IF NOT EXISTS idx_lot_transactions_ngay_ca ON public.lot_transactions (ngay_nhap, ca);

-- ── 2. Chặn duyệt phiếu ca trước khi phê duyệt ca ở Thành phẩm ───────────────
CREATE OR REPLACE FUNCTION public.attendance_guard_shift_approve()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ngay date;
  v_unit_loai text;
  v_unit_ten text;
BEGIN
  IF NEW.trang_thai <> 'da_duyet' OR OLD.trang_thai = 'da_duyet' OR NEW.loai <> 'ca_san_xuat' THEN
    RETURN NEW;
  END IF;
  SELECT u.loai, u.ten INTO v_unit_loai, v_unit_ten
    FROM public.attendance_units u WHERE u.factory_id = NEW.factory_id AND u.code = NEW.ca;
  IF coalesce(v_unit_loai, 'ca') <> 'ca' THEN RETURN NEW; END IF;
  SELECT s.ngay INTO v_ngay FROM public.attendance_daily_sheets s WHERE s.id = NEW.sheet_id;
  IF EXISTS (
       SELECT 1 FROM public.lot_transactions lt JOIN public.lots l ON l.id = lt.lot_id
       WHERE l.factory_id = NEW.factory_id AND lt.ngay_nhap = v_ngay AND lt.ca = NEW.ca
     )
     AND NOT public.product_shift_is_locked(NEW.factory_id, v_ngay, NEW.ca) THEN
    RAISE EXCEPTION '% ngày % chưa được "Phê duyệt" ở Thành phẩm — phê duyệt ca ở Thành phẩm trước khi duyệt điểm danh (để giờ duyệt không sớm hơn kiện cuối).',
      coalesce(v_unit_ten, 'Ca ' || NEW.ca), to_char(v_ngay, 'DD/MM/YYYY');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_attendance_guard_shift_approve ON public.attendance_sheet_sections;
CREATE TRIGGER trg_attendance_guard_shift_approve
  BEFORE UPDATE OF trang_thai ON public.attendance_sheet_sections
  FOR EACH ROW EXECUTE FUNCTION public.attendance_guard_shift_approve();

-- ── 3. submit_confirm_draft_batch (chép từ 20261118, chỉ thêm quet_luc) ─────
CREATE OR REPLACE FUNCTION submit_confirm_draft_batch(
  p_draft_ids  UUID[],
  p_user_id    UUID,
  p_recomputed JSONB
) RETURNS TABLE (
  draft_id UUID,
  lot_id   UUID,
  ma_lo    TEXT,
  kien     TEXT,
  so_kg    NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_draft            RECORD;
  v_match            TEXT[];
  v_num              INTEGER;
  v_suffix           TEXT;
  v_year             TEXT;
  v_lot_id           UUID;
  v_lot_status       TEXT;
  v_lot_csr          TEXT;
  v_lot_banh         NUMERIC;
  v_lot_boc          TEXT;
  v_max_per_kien     INTEGER;
  v_so_kg            NUMERIC;
  v_existing_banh    NUMERIC;
  v_ngan_tong_kho    NUMERIC;
  v_existing_real_kg NUMERIC;
  v_cap_kg           NUMERIC;
  v_existing_boc     TEXT;
  v_existing_pallet  TEXT[];
  v_touched_lots     UUID[] := '{}';
  v_dup_count        INTEGER;
  v_actor_role       TEXT;
  v_touched_ngans    UUID[] := '{}';
  v_ngan_id          UUID;
  v_nap              JSONB;
BEGIN
  IF p_draft_ids IS NULL OR array_length(p_draft_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Danh sách nháp trống.';
  END IF;

  SELECT COUNT(DISTINCT x) INTO v_dup_count FROM unnest(p_draft_ids) x;
  IF v_dup_count <> array_length(p_draft_ids, 1) THEN
    RAISE EXCEPTION 'Danh sách nháp có id trùng lặp.';
  END IF;

  IF (SELECT COUNT(*) FROM product_confirm_drafts WHERE id = ANY(p_draft_ids)) <> array_length(p_draft_ids, 1) THEN
    RAISE EXCEPTION 'Một số nháp không còn tồn tại — vui lòng tải lại danh sách.';
  END IF;
  IF (SELECT COUNT(*) FROM product_confirm_drafts WHERE id = ANY(p_draft_ids) AND created_by = p_user_id) <> array_length(p_draft_ids, 1) THEN
    RAISE EXCEPTION 'Không có quyền gửi một số nháp trong danh sách này.';
  END IF;

  SELECT role INTO v_actor_role FROM profiles WHERE id = p_user_id;

  PERFORM 1 FROM ngans
    WHERE id IN (SELECT DISTINCT ngan_id FROM product_confirm_drafts WHERE id = ANY(p_draft_ids))
    ORDER BY id FOR UPDATE;

  PERFORM 1 FROM lots lk
    WHERE lk.ma_lo IN (SELECT DISTINCT pcdk.ma_lo FROM product_confirm_drafts pcdk WHERE pcdk.id = ANY(p_draft_ids))
    ORDER BY lk.ma_lo FOR UPDATE;

  FOR v_draft IN
    SELECT * FROM product_confirm_drafts WHERE id = ANY(p_draft_ids) ORDER BY created_at ASC
  LOOP
    IF public.product_shift_is_locked(v_draft.factory_id, v_draft.ngay_sx, v_draft.ca)
       AND v_actor_role IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION 'Ca sản xuất % - Ca % của lô % đã được duyệt & khóa, không thể gửi nháp này.',
        v_draft.ngay_sx, v_draft.ca, v_draft.ma_lo;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_draft.factory_id::text || ':' || v_draft.ma_lo));

    SELECT l.id, l.trang_thai, l.loai_csr, l.loai_banh, l.boc
      INTO v_lot_id, v_lot_status, v_lot_csr, v_lot_banh, v_lot_boc
      FROM lots l WHERE l.factory_id = v_draft.factory_id AND l.ma_lo = v_draft.ma_lo
      ORDER BY l.created_at DESC LIMIT 1;

    IF v_lot_id IS NULL THEN
      v_match := regexp_match(v_draft.ma_lo, '^(\d+)([a-z]*)/(\d{2,4})$');
      IF v_match IS NULL THEN
        RAISE EXCEPTION 'Mã lô "%" không hợp lệ.', v_draft.ma_lo;
      END IF;
      v_num := v_match[1]::INTEGER;
      v_suffix := v_match[2];
      v_year := v_match[3];
      INSERT INTO lots (
        factory_id, ma_lo, num, suffix, year, ngay_sx, ca, ngan_id, loai_csr, loai_banh,
        tong_banh, tong_kg, trang_thai, ghi_chu, day_chuyen, boc, tham, pallet, chi_thi
      ) VALUES (
        v_draft.factory_id, v_draft.ma_lo, v_num, v_suffix, v_year, v_draft.ngay_sx, v_draft.ca,
        v_draft.ngan_id, v_draft.loai_csr, v_draft.loai_banh, 0, 0, 'Dở dang', v_draft.ghi_chu,
        v_draft.day_chuyen, v_draft.boc, v_draft.tham, v_draft.pallet, v_draft.chi_thi
      ) RETURNING id INTO v_lot_id;
    ELSE
      IF v_lot_status NOT IN ('Dở dang', 'Do dang') THEN
        RAISE EXCEPTION 'Lô % đang ở trạng thái "%", không thể nhập thêm giao dịch.', v_draft.ma_lo, v_lot_status;
      END IF;

      -- Kiểm tra đồng nhất thuộc tính toàn lô (Chủng loại, Bọc, Loại bành)
      IF v_lot_csr IS NOT NULL AND v_lot_csr IS DISTINCT FROM v_draft.loai_csr THEN
        RAISE EXCEPTION 'Cùng lô %, chủng loại (%) không khớp với kiện trước (%).', v_draft.ma_lo, v_draft.loai_csr, v_lot_csr;
      END IF;
      IF v_lot_banh IS NOT NULL AND v_lot_banh IS DISTINCT FROM v_draft.loai_banh THEN
        RAISE EXCEPTION 'Cùng lô %, loại bành (%kg) không khớp với kiện trước (%kg).', v_draft.ma_lo, v_draft.loai_banh, v_lot_banh;
      END IF;
      IF v_lot_boc IS NOT NULL AND v_lot_boc IS DISTINCT FROM v_draft.boc THEN
        RAISE EXCEPTION 'Cùng lô %, loại bọc (%) không khớp với kiện trước (%).', v_draft.ma_lo, v_draft.boc, v_lot_boc;
      END IF;
    END IF;

    SELECT (elem->>'max_per_kien')::INTEGER INTO v_max_per_kien
      FROM jsonb_array_elements(p_recomputed) elem
      WHERE (elem->>'draft_id')::UUID = v_draft.id;
    IF v_max_per_kien IS NULL THEN
      RAISE EXCEPTION 'Thiếu dữ liệu tính toán cho nháp %.', v_draft.id;
    END IF;
    v_so_kg := ROUND(v_draft.so_banh * v_draft.loai_banh, 2);

    SELECT COALESCE(SUM(
      CASE v_draft.kien
        WHEN 'A' THEN ltk.kien_a WHEN 'B' THEN ltk.kien_b WHEN 'C' THEN ltk.kien_c WHEN 'D' THEN ltk.kien_d
      END
    ), 0) INTO v_existing_banh
    FROM lot_transactions ltk WHERE ltk.lot_id = v_lot_id;

    IF v_existing_banh + v_draft.so_banh > v_max_per_kien THEN
      RAISE EXCEPTION 'Kiện % của lô % đã có % bành, nháp này (thêm % bành) sẽ vượt quá % bành cho phép.',
        v_draft.kien, v_draft.ma_lo, v_existing_banh, v_draft.so_banh, v_max_per_kien;
    END IF;

    SELECT lt.boc, lt.pallet INTO v_existing_boc, v_existing_pallet
      FROM lot_transactions lt WHERE lt.lot_id = v_lot_id
      AND (
        CASE v_draft.kien
          WHEN 'A' THEN lt.kien_a WHEN 'B' THEN lt.kien_b WHEN 'C' THEN lt.kien_c WHEN 'D' THEN lt.kien_d
        END
      ) > 0
      ORDER BY lt.created_at DESC LIMIT 1;
    IF v_existing_boc IS NOT NULL AND v_existing_boc IS DISTINCT FROM v_draft.boc THEN
      RAISE EXCEPTION 'Bọc của kiện % lô % (%) không khớp lần nhập trước (%).', v_draft.kien, v_draft.ma_lo, v_draft.boc, v_existing_boc;
    END IF;
    IF v_existing_pallet IS NOT NULL AND array_length(v_existing_pallet, 1) > 0 AND v_existing_pallet IS DISTINCT FROM v_draft.pallet THEN
      RAISE EXCEPTION 'Pallet của kiện % lô % không khớp lần nhập trước.', v_draft.kien, v_draft.ma_lo;
    END IF;

    SELECT tong_kho INTO v_ngan_tong_kho FROM ngans WHERE id = v_draft.ngan_id AND factory_id = v_draft.factory_id;
    IF v_ngan_tong_kho IS NULL THEN
      RAISE EXCEPTION 'Không tìm thấy ngăn nguồn cho lô % kiện %.', v_draft.ma_lo, v_draft.kien;
    END IF;
    SELECT COALESCE(SUM(lt.so_kg), 0) INTO v_existing_real_kg
      FROM lot_transactions lt JOIN lots l ON l.id = lt.lot_id
      WHERE lt.ngan_id = v_draft.ngan_id AND l.factory_id = v_draft.factory_id;
    v_cap_kg := COALESCE(v_ngan_tong_kho, 0) * 1.1;
    IF v_existing_real_kg + v_so_kg > v_cap_kg + 0.01 THEN
      RAISE EXCEPTION 'Ngăn sẽ vượt quá 110%% sau khi gửi lô % kiện % — vui lòng kiểm tra lại.', v_draft.ma_lo, v_draft.kien;
    END IF;

    -- GĐ3B: nắp của kiện (chỉ khi pallet cần nắp + mã là nắp hợp lệ).
    v_nap := '{}'::jsonb;
    IF NULLIF(btrim(COALESCE(v_draft.nap, '')), '') IS NOT NULL THEN
      v_nap := lot_nap_sanitize(
        v_draft.factory_id,
        jsonb_build_object(lower(v_draft.kien), btrim(v_draft.nap)),
        ARRAY[
          CASE WHEN v_draft.kien = 'A' THEN v_draft.so_banh ELSE 0 END,
          CASE WHEN v_draft.kien = 'B' THEN v_draft.so_banh ELSE 0 END,
          CASE WHEN v_draft.kien = 'C' THEN v_draft.so_banh ELSE 0 END,
          CASE WHEN v_draft.kien = 'D' THEN v_draft.so_banh ELSE 0 END
        ],
        v_draft.pallet
      );
    END IF;

    INSERT INTO lot_transactions (lot_id, ngan_id, ca, ngay_nhap, kien_a, kien_b, kien_c, kien_d, so_banh, so_kg, created_by, boc, pallet, chi_thi, nap, quet_luc)
    VALUES (
      v_lot_id, v_draft.ngan_id, v_draft.ca, v_draft.ngay_sx,
      CASE WHEN v_draft.kien = 'A' THEN v_draft.so_banh ELSE 0 END,
      CASE WHEN v_draft.kien = 'B' THEN v_draft.so_banh ELSE 0 END,
      CASE WHEN v_draft.kien = 'C' THEN v_draft.so_banh ELSE 0 END,
      CASE WHEN v_draft.kien = 'D' THEN v_draft.so_banh ELSE 0 END,
      v_draft.so_banh, v_so_kg, v_draft.created_by, v_draft.boc, v_draft.pallet, v_draft.chi_thi, v_nap, v_draft.created_at
    );

    -- Đồng bộ bọc cho toàn bộ giao dịch của lô để không bị phân mảnh
    IF v_draft.boc IS NOT NULL THEN
      UPDATE lot_transactions ltb SET boc = v_draft.boc WHERE ltb.lot_id = v_lot_id;
    END IF;

    DELETE FROM product_confirm_drafts WHERE id = v_draft.id;
    v_touched_lots := array_append(v_touched_lots, v_lot_id);
    v_touched_ngans := array_append(v_touched_ngans, v_draft.ngan_id);

    RETURN QUERY SELECT v_draft.id, v_lot_id, v_draft.ma_lo, v_draft.kien, v_so_kg;
  END LOOP;

  FOR v_lot_id IN SELECT DISTINCT unnest(v_touched_lots) LOOP
    PERFORM sync_lot_master_snapshot(v_lot_id);
  END LOOP;

  -- Khôi phục (mất từ 20260828): tự chuyển ngăn Chờ sản xuất -> Đang sản xuất khi có sản lượng thật.
  FOR v_ngan_id IN SELECT DISTINCT unnest(v_touched_ngans) LOOP
    PERFORM sync_ngan_production_status(v_ngan_id);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_confirm_draft_batch(UUID[], UUID, JSONB) TO authenticated, service_role;
