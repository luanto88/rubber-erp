-- Fix: ngăn kẹt mãi ở "Chờ sản xuất" khi nhập thành phẩm qua luồng quét QR (Kho nguyên
-- liệu → Thành phẩm). Xem .claude/rules/06-module-production.md mục "Đồng bộ trạng thái
-- ngăn theo sản lượng thật (2026-08-08)" để biết bối cảnh đầy đủ.
--
-- Nguyên nhân: luồng nhập tay (product/page.tsx) có sẵn syncNganStatusAfterLotEdit() tự cập
-- nhật ngans.trang_thai sau mỗi lần lưu, nhưng luồng quét QR ("Lưu tạm" → "Gửi tất cả", RPC
-- submit_confirm_draft_batch trong 20260716_product_confirm_drafts.sql) chưa từng đụng tới
-- ngans.trang_thai — chỉ gọi sync_lot_master_snapshot() cho bảng lots.
--
-- Quy tắc mới (khác luồng nhập tay có chủ đích): chỉ cần ngăn có sản lượng thật (kg > 0) là
-- chuyển "Đang sản xuất" ngay, KỂ CẢ khi tỷ lệ đã ≥100% ngay từ lần đầu — không chờ admin xác
-- nhận tay như luồng nhập tay. Đánh dấu "Đã sản xuất" vẫn là thao tác tay riêng (nút trên
-- storage/page.tsx, ngưỡng ≥50%), không đổi.

CREATE OR REPLACE FUNCTION sync_ngan_production_status(p_ngan_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_trang_thai TEXT;
  v_total_kg   NUMERIC;
BEGIN
  SELECT trang_thai INTO v_trang_thai FROM ngans WHERE id = p_ngan_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Chỉ đụng 2 trạng thái "sống" của vòng đời sản xuất; không chạm "Đang nhận"/"Đóng" (chưa
  -- vào sản xuất) hay "Đã sản xuất" (đã chốt tay, chỉ admin mới đổi lại).
  IF v_trang_thai NOT IN ('Chờ sản xuất', 'Đang sản xuất') THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(so_kg), 0) INTO v_total_kg FROM lot_transactions WHERE ngan_id = p_ngan_id;

  IF v_total_kg > 0 AND v_trang_thai <> 'Đang sản xuất' THEN
    UPDATE ngans SET trang_thai = 'Đang sản xuất' WHERE id = p_ngan_id;
  ELSIF v_total_kg <= 0 AND v_trang_thai = 'Đang sản xuất' THEN
    -- Toàn bộ sản lượng của ngăn vừa bị xóa hết (vd xóa dòng cuối trong "Lịch sử ca") ->
    -- trả về Chờ sản xuất.
    UPDATE ngans SET trang_thai = 'Chờ sản xuất' WHERE id = p_ngan_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION sync_ngan_production_status(UUID) TO authenticated, service_role;

-- Wire vào submit_confirm_draft_batch (RPC atomic của luồng "Gửi tất cả") — copy nguyên
-- body từ 20260716_product_confirm_drafts.sql, chỉ thêm theo dõi v_touched_ngans và vòng lặp
-- gọi sync_ngan_production_status ngay sau vòng lặp sync_lot_master_snapshot hiện có.
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
  v_max_per_kien     INTEGER;
  v_so_kg            NUMERIC;
  v_existing_banh    NUMERIC;
  v_ngan_tong_kho    NUMERIC;
  v_existing_real_kg NUMERIC;
  v_cap_kg           NUMERIC;
  v_existing_boc     TEXT;
  v_existing_pallet  TEXT[];
  v_touched_lots     UUID[] := '{}';
  v_touched_ngans    UUID[] := '{}';
  v_ngan_id          UUID;
  v_dup_count        INTEGER;
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

  -- Khóa trước toàn bộ ngăn và lô liên quan (thứ tự cố định theo id/ma_lo) để tránh deadlock khi
  -- nhiều thiết bị cùng "Gửi tất cả" chạm cùng ngăn/lô — mirror kỹ thuật lock-trước-loop của
  -- create_lot_prediction_batch, mở rộng thêm cho nhiều dòng trong 1 lệnh gọi.
  PERFORM 1 FROM ngans
    WHERE id IN (SELECT DISTINCT ngan_id FROM product_confirm_drafts WHERE id = ANY(p_draft_ids))
    ORDER BY id FOR UPDATE;
  -- FIX (2026-07-15): "ma_lo"/"lot_id" trần bên dưới bị ambiguous với OUT parameter cùng tên của
  -- RETURNS TABLE (đúng landmine đã gặp và fix ở delete_lot_transaction — xem
  -- 20260714_fix_delete_lot_transaction_ambiguous_column.sql) — mọi tham chiếu cột trùng tên OUT
  -- parameter (draft_id/lot_id/ma_lo/kien/so_kg) phải qualify rõ bằng alias bảng.
  PERFORM 1 FROM lots lk
    WHERE lk.ma_lo IN (SELECT DISTINCT pcdk.ma_lo FROM product_confirm_drafts pcdk WHERE pcdk.id = ANY(p_draft_ids))
    ORDER BY lk.ma_lo FOR UPDATE;

  FOR v_draft IN
    SELECT * FROM product_confirm_drafts WHERE id = ANY(p_draft_ids) ORDER BY created_at ASC
  LOOP
    -- Khóa tạo lô mới theo (factory_id, ma_lo) — lots không có unique constraint thật (xem rule
    -- "canonical lot"), khóa advisory ngăn 2 batch đồng thời cùng tạo trùng ma_lo mới.
    PERFORM pg_advisory_xact_lock(hashtext(v_draft.factory_id::text || ':' || v_draft.ma_lo));

    SELECT l.id, l.trang_thai INTO v_lot_id, v_lot_status
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
    ELSIF v_lot_status NOT IN ('Dở dang', 'Do dang') THEN
      RAISE EXCEPTION 'Lô % đang ở trạng thái "%", không thể nhập thêm giao dịch.', v_draft.ma_lo, v_lot_status;
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

    INSERT INTO lot_transactions (lot_id, ngan_id, ca, ngay_nhap, kien_a, kien_b, kien_c, kien_d, so_banh, so_kg, created_by, boc, pallet, chi_thi)
    VALUES (
      v_lot_id, v_draft.ngan_id, v_draft.ca, v_draft.ngay_sx,
      CASE WHEN v_draft.kien = 'A' THEN v_draft.so_banh ELSE 0 END,
      CASE WHEN v_draft.kien = 'B' THEN v_draft.so_banh ELSE 0 END,
      CASE WHEN v_draft.kien = 'C' THEN v_draft.so_banh ELSE 0 END,
      CASE WHEN v_draft.kien = 'D' THEN v_draft.so_banh ELSE 0 END,
      v_draft.so_banh, v_so_kg, v_draft.created_by, v_draft.boc, v_draft.pallet, v_draft.chi_thi
    );

    DELETE FROM product_confirm_drafts WHERE id = v_draft.id;
    v_touched_lots := array_append(v_touched_lots, v_lot_id);
    v_touched_ngans := array_append(v_touched_ngans, v_draft.ngan_id);

    RETURN QUERY SELECT v_draft.id, v_lot_id, v_draft.ma_lo, v_draft.kien, v_so_kg;
  END LOOP;

  FOR v_lot_id IN SELECT DISTINCT unnest(v_touched_lots) LOOP
    PERFORM sync_lot_master_snapshot(v_lot_id);
  END LOOP;

  FOR v_ngan_id IN SELECT DISTINCT unnest(v_touched_ngans) LOOP
    PERFORM sync_ngan_production_status(v_ngan_id);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION submit_confirm_draft_batch(UUID[], UUID, JSONB) TO authenticated, service_role;

-- Backfill 1 lần: RPC sync_ngan_production_status() ở trên chỉ kích hoạt khi có GHI MỚI vào
-- lot_transactions đi qua submit_confirm_draft_batch/editShiftHistoryEntry/deleteShiftHistoryEntry
-- — không hồi tố cho dữ liệu đã tồn tại TRƯỚC migration này. Vòng lặp dưới đây đồng bộ lại 1 lần
-- cho MỌI ngăn hiện đang "Chờ sản xuất"/"Đang sản xuất" trong toàn hệ thống — an toàn chạy lại
-- nhiều lần (idempotent), không đụng ngăn "Đang nhận"/"Đóng"/"Đã sản xuất".
DO $$
DECLARE
  v_ngan_id UUID;
BEGIN
  FOR v_ngan_id IN SELECT id FROM ngans WHERE trang_thai IN ('Chờ sản xuất', 'Đang sản xuất') LOOP
    PERFORM sync_ngan_production_status(v_ngan_id);
  END LOOP;
END;
$$;
