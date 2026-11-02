-- ============================================================
-- 2026-11-02 — GĐ3 Đề nghị mua ↔ Biên bản bảo trì: liên kết THEO DÒNG + lưu phiếu 1 giao dịch
-- CHẠY TAY trên Supabase SQL Editor TRƯỚC khi deploy code (code mới đọc/ghi cột
-- purchase_request_lines.maintenance_record_id và gọi RPC purchase_save_lines). Idempotent.
--
-- 1. purchase_request_lines.maintenance_record_id — dòng mua cho biên bản nào (NULL = dự trữ kho).
--    Hàng nhập từ dòng gắn biên bản X được giữ cho X trước (maintenance-kt.ts, phân bổ 2 tầng).
--    Backfill = biên bản của phiếu (purchase_requests.maintenance_record_id); dòng phiếu điều chỉnh
--    lấy theo dòng gốc.
-- 2. RPC purchase_save_lines — thay "xoá hết dòng rồi chèn lại" (không giao dịch, lỗi giữa chừng
--    mất sạch dòng). Cập nhật header + giữ nguyên dòng theo id (ảnh, bản chụp bằng chứng còn khớp),
--    chèn dòng mới, xoá dòng bị bỏ — tất cả trong 1 giao dịch.
-- ============================================================

-- ── 1. Liên kết theo dòng ──────────────────────────────────
ALTER TABLE purchase_request_lines
  ADD COLUMN IF NOT EXISTS maintenance_record_id UUID REFERENCES maintenance_records(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_request_lines_maintenance_record
  ON purchase_request_lines(maintenance_record_id) WHERE maintenance_record_id IS NOT NULL;

UPDATE purchase_request_lines l
SET maintenance_record_id = r.maintenance_record_id
FROM purchase_requests r
WHERE l.request_id = r.id
  AND r.maintenance_record_id IS NOT NULL
  AND l.maintenance_record_id IS NULL;

UPDATE purchase_request_lines l
SET maintenance_record_id = p.maintenance_record_id
FROM purchase_request_lines p
WHERE l.parent_line_id = p.id
  AND p.maintenance_record_id IS NOT NULL
  AND l.maintenance_record_id IS NULL;

-- ── 2. Lưu phiếu trong 1 giao dịch ─────────────────────────
-- p_header: loai_tien, giam_doc_user_id, ke_toan_user_id, ghi_chu, bo_phan, ngay_can_hang, tong_tien
--           (+ nguoi_de_nghi_id, nguoi_de_nghi_ten khi "Nhận xử lý"). NULL = không đổi header.
-- p_lines:  mảng dòng (cột của purchase_request_lines). Có "id" thuộc phiếu → cập nhật dòng đó;
--           không có → chèn mới. Dòng cũ không còn trong mảng → xoá.
CREATE OR REPLACE FUNCTION purchase_save_lines(
  p_factory_id UUID,
  p_request_id UUID,
  p_header JSONB,
  p_lines JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_elem JSONB;
  v_row purchase_request_lines%ROWTYPE;
  v_id UUID;
  v_keep UUID[] := '{}';
  v_old purchase_request_lines%ROWTYPE;
BEGIN
  SELECT trang_thai INTO v_status FROM purchase_requests
  WHERE id = p_request_id AND factory_id = p_factory_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Không tìm thấy phiếu đề nghị.'; END IF;
  IF v_status NOT IN ('nhap', 'tra_ve') THEN
    RAISE EXCEPTION 'Phiếu ở trạng thái "%" — không sửa được.', v_status;
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Phiếu phải có ít nhất 1 dòng vật tư.';
  END IF;

  IF p_header IS NOT NULL THEN
    UPDATE purchase_requests SET
      loai_tien        = COALESCE(p_header ->> 'loai_tien', loai_tien),
      giam_doc_user_id = NULLIF(p_header ->> 'giam_doc_user_id', '')::UUID,
      ke_toan_user_id  = NULLIF(p_header ->> 'ke_toan_user_id', '')::UUID,
      ghi_chu          = NULLIF(p_header ->> 'ghi_chu', ''),
      bo_phan          = NULLIF(p_header ->> 'bo_phan', ''),
      ngay_can_hang    = NULLIF(p_header ->> 'ngay_can_hang', '')::DATE,
      tong_tien        = COALESCE((p_header ->> 'tong_tien')::NUMERIC, tong_tien),
      nguoi_de_nghi_id = CASE WHEN p_header ? 'nguoi_de_nghi_id'
                              THEN (p_header ->> 'nguoi_de_nghi_id')::UUID ELSE nguoi_de_nghi_id END,
      nguoi_de_nghi_ten = CASE WHEN p_header ? 'nguoi_de_nghi_ten'
                              THEN p_header ->> 'nguoi_de_nghi_ten' ELSE nguoi_de_nghi_ten END,
      updated_at       = now()
    WHERE id = p_request_id;
  END IF;

  -- Id dòng giữ lại (thuộc đúng phiếu này).
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_id := NULLIF(v_elem ->> 'id', '')::UUID;
    IF v_id IS NOT NULL AND EXISTS (SELECT 1 FROM purchase_request_lines WHERE id = v_id AND request_id = p_request_id) THEN
      v_keep := v_keep || v_id;
    END IF;
  END LOOP;

  DELETE FROM purchase_request_lines
  WHERE request_id = p_request_id AND NOT (id = ANY(v_keep));

  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_row := jsonb_populate_record(NULL::purchase_request_lines, v_elem);
    v_id := NULLIF(v_elem ->> 'id', '')::UUID;
    IF v_id IS NOT NULL AND v_id = ANY(v_keep) THEN
      SELECT * INTO v_old FROM purchase_request_lines WHERE id = v_id;
      UPDATE purchase_request_lines SET
        sort_order       = v_row.sort_order,
        item_id          = v_row.item_id,
        item_code        = v_row.item_code,
        item_name        = v_row.item_name,
        unit             = v_row.unit,
        so_luong         = v_row.so_luong,
        don_gia          = v_row.don_gia,
        thanh_tien       = v_row.thanh_tien,
        muc_dich         = v_row.muc_dich,
        ghi_chu          = v_row.ghi_chu,
        gia_goi_y        = v_row.gia_goi_y,
        nguon_gia_goi_y  = v_row.nguon_gia_goi_y,
        lech_gia_pct     = v_row.lech_gia_pct,
        ly_do_lech_gia   = v_row.ly_do_lech_gia,
        la_vat_tu_moi    = COALESCE(v_row.la_vat_tu_moi, false),
        image_urls       = COALESCE(v_row.image_urls, '{}'),
        mua_tai          = v_row.mua_tai,
        ngay_co_hang     = v_row.ngay_co_hang,
        ngay_can_hang    = v_row.ngay_can_hang,
        maintenance_record_id = v_row.maintenance_record_id,
        -- Bản chụp bằng chứng chỉ còn đúng khi vật tư / SL / giá không đổi.
        insight_snapshot = CASE
          WHEN v_old.item_id IS NOT DISTINCT FROM v_row.item_id
           AND v_old.so_luong IS NOT DISTINCT FROM v_row.so_luong
           AND v_old.don_gia IS NOT DISTINCT FROM v_row.don_gia
          THEN v_old.insight_snapshot ELSE NULL END
      WHERE id = v_id;
    ELSE
      INSERT INTO purchase_request_lines (
        request_id, factory_id, sort_order, item_id, item_code, item_name, unit, so_luong, don_gia,
        thanh_tien, muc_dich, ghi_chu, gia_goi_y, nguon_gia_goi_y, lech_gia_pct, ly_do_lech_gia,
        la_vat_tu_moi, image_urls, mua_tai, ngay_co_hang, ngay_can_hang, maintenance_record_id
      ) VALUES (
        p_request_id, p_factory_id, v_row.sort_order, v_row.item_id, v_row.item_code, v_row.item_name,
        v_row.unit, v_row.so_luong, v_row.don_gia, v_row.thanh_tien, v_row.muc_dich, v_row.ghi_chu,
        v_row.gia_goi_y, v_row.nguon_gia_goi_y, v_row.lech_gia_pct, v_row.ly_do_lech_gia,
        COALESCE(v_row.la_vat_tu_moi, false), COALESCE(v_row.image_urls, '{}'), v_row.mua_tai,
        v_row.ngay_co_hang, v_row.ngay_can_hang, v_row.maintenance_record_id
      );
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION purchase_save_lines(UUID, UUID, JSONB, JSONB) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION purchase_save_lines(UUID, UUID, JSONB, JSONB) TO service_role;

-- Kiểm chứng sau khi chạy:
-- SELECT count(*) FILTER (WHERE maintenance_record_id IS NOT NULL) AS gan_bien_ban, count(*) FROM purchase_request_lines;
-- SELECT proname FROM pg_proc WHERE proname = 'purchase_save_lines';
