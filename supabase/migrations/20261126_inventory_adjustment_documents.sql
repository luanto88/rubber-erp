-- 2026-11-15 — Phiếu kho "ĐIỀU CHỈNH TỒN" (không phải tiêu hao thật). Rule 13.
--
-- Bối cảnh: ngày 30/07/2026 khi bắt đầu dùng app, kho lập lô phiếu nhập/xuất ghi ngày 24/07/2026 (ghi chú "tính tồn kho
-- ngày 25/07/2026") để đưa tồn app khớp tồn thực tế. Các phiếu XUẤT trong lô này (vd TT 380, DCS 74, B013H 87, N50 266)
-- KHÔNG phải sử dụng thật ⇒ không được cộng vào báo cáo sử dụng theo ngày (55-BC / 46-BC) và đối soát định mức.
-- KHÔNG XOÁ các phiếu này: chúng tạo nên tồn hiện tại (balance_after của mọi phát sinh sau) — xoá sẽ làm sai tồn/thẻ kho.
--
--   inventory_documents.la_dieu_chinh (+ lý do, người, lúc)  — cờ ở cấp phiếu; tồn/thẻ kho vẫn tính bình thường.
--   inventory_document_set_adjustment(p_document_id, p_flag, p_ly_do)  — đổi cờ (quyền inventory.settings hoặc admin).
--   Trigger chặn đổi cờ trực tiếp qua UPDATE (policy update phiếu đang mở cho phê duyệt).
--   Đánh dấu sẵn lô chốt tồn 24/07/2026 (phiếu ngày 24/07 tạo từ 30/07, nhà máy phuochoa_kt).
-- Chạy TAY trên Supabase SQL Editor, SAU 20261125. Idempotent.

BEGIN;

ALTER TABLE inventory_documents ADD COLUMN IF NOT EXISTS la_dieu_chinh BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE inventory_documents ADD COLUMN IF NOT EXISTS ly_do_dieu_chinh TEXT;
ALTER TABLE inventory_documents ADD COLUMN IF NOT EXISTS dieu_chinh_boi UUID REFERENCES auth.users(id);
ALTER TABLE inventory_documents ADD COLUMN IF NOT EXISTS dieu_chinh_luc TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_inventory_documents_adjustment ON inventory_documents (factory_id) WHERE la_dieu_chinh;

-- Chặn đổi cờ ngoài RPC (người dùng thường chỉ có policy UPDATE để phê duyệt). Service role / SQL Editor không bị chặn.
CREATE OR REPLACE FUNCTION inventory_document_adjustment_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.la_dieu_chinh IS DISTINCT FROM OLD.la_dieu_chinh
      OR NEW.ly_do_dieu_chinh IS DISTINCT FROM OLD.ly_do_dieu_chinh
      OR NEW.dieu_chinh_boi IS DISTINCT FROM OLD.dieu_chinh_boi
      OR NEW.dieu_chinh_luc IS DISTINCT FROM OLD.dieu_chinh_luc)
     AND auth.uid() IS NOT NULL
     AND coalesce(current_setting('app.inv_adjustment_rpc', true), '') <> '1' THEN
    RAISE EXCEPTION 'Chỉ đổi cờ "Phiếu điều chỉnh tồn" qua chức năng Đánh dấu điều chỉnh.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_inventory_document_adjustment_guard ON inventory_documents;
CREATE TRIGGER trg_inventory_document_adjustment_guard BEFORE UPDATE ON inventory_documents
  FOR EACH ROW EXECUTE FUNCTION inventory_document_adjustment_guard();

CREATE OR REPLACE FUNCTION inventory_document_set_adjustment(p_document_id UUID, p_flag BOOLEAN, p_ly_do TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_doc inventory_documents%ROWTYPE;
BEGIN
  SELECT * INTO v_doc FROM inventory_documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND OR v_doc.factory_id IS DISTINCT FROM current_profile_factory_id() THEN
    RAISE EXCEPTION 'Không tìm thấy phiếu.';
  END IF;
  IF NOT (current_profile_is_admin() OR current_profile_has_permission('inventory.settings')) THEN
    RAISE EXCEPTION 'Cần quyền cấu hình kho (inventory.settings) để đánh dấu phiếu điều chỉnh.';
  END IF;
  IF v_doc.status <> 'posted' THEN
    RAISE EXCEPTION 'Chỉ đánh dấu phiếu đã ghi sổ.';
  END IF;
  IF p_flag AND nullif(btrim(coalesce(p_ly_do, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Nhập lý do điều chỉnh.';
  END IF;
  PERFORM set_config('app.inv_adjustment_rpc', '1', true);
  UPDATE inventory_documents
     SET la_dieu_chinh = p_flag,
         ly_do_dieu_chinh = CASE WHEN p_flag THEN btrim(p_ly_do) ELSE NULL END,
         dieu_chinh_boi = auth.uid(),
         dieu_chinh_luc = now()
   WHERE id = p_document_id;
  PERFORM set_config('app.inv_adjustment_rpc', '', true);
END $$;
REVOKE EXECUTE ON FUNCTION inventory_document_set_adjustment(UUID, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inventory_document_set_adjustment(UUID, BOOLEAN, TEXT) TO authenticated;

-- Lô chốt tồn khi bắt đầu dùng app: phiếu ngày 24/07/2026, lập từ 30/07/2026 (20 dòng, cả nhập và xuất).
UPDATE inventory_documents d
   SET la_dieu_chinh = true,
       ly_do_dieu_chinh = 'Chốt tồn khi bắt đầu dùng app (tính tồn kho ngày 25/07/2026)',
       dieu_chinh_luc = now()
  FROM factories f
 WHERE f.id = d.factory_id AND f.code = 'phuochoa_kt'
   AND d.document_date = DATE '2026-07-24'
   AND d.created_at >= TIMESTAMPTZ '2026-07-30 00:00:00+07'
   AND d.status = 'posted'
   AND NOT d.la_dieu_chinh;

COMMIT;
