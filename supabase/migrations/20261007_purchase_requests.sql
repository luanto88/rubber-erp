-- ============================================================
-- Module "Đề nghị mua vật tư hàng hóa" (ĐNMVT) — Giai đoạn 1
-- ============================================================
-- Ký số dùng chung (yeu_cau_ky, modun = 'purchase'), thứ tự cứng:
--   Người đề nghị (10) → Giám đốc (20) → Kế toán (30, phe_duyet).
-- Số phiếu "NN/ĐNMVT" quay về 01 mỗi năm, KHÔNG tái sử dụng (không có thao tác xoá phiếu,
-- chỉ huỷ — phiếu huỷ vẫn giữ số).
--
-- Mọi GHI đi qua API route service-role (src/app/api/purchase/*) — RLS chỉ có SELECT.
-- Chạy thủ công trên Supabase SQL Editor. Idempotent.

-- ── 1. Dãy số theo năm ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_request_sequences (
  factory_id  UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  nam         INTEGER NOT NULL,
  so_hien_tai INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (factory_id, nam)
);

CREATE OR REPLACE FUNCTION get_next_purchase_so(p_factory_id UUID, p_nam INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_next INTEGER;
BEGIN
  INSERT INTO purchase_request_sequences (factory_id, nam, so_hien_tai)
  VALUES (p_factory_id, p_nam, 1)
  ON CONFLICT (factory_id, nam)
  DO UPDATE SET so_hien_tai = purchase_request_sequences.so_hien_tai + 1, updated_at = now()
  RETURNING so_hien_tai INTO v_next;
  RETURN v_next;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_next_purchase_so(UUID, INTEGER) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_next_purchase_so(UUID, INTEGER) TO service_role;

ALTER TABLE purchase_request_sequences ENABLE ROW LEVEL SECURITY;

-- ── 2. Phiếu đề nghị ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_requests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id         UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  nam                INTEGER NOT NULL,
  so                 INTEGER NOT NULL,
  ngay               DATE NOT NULL,
  loai               TEXT NOT NULL DEFAULT 'goc' CHECK (loai IN ('goc', 'dieu_chinh')),
  parent_request_id  UUID REFERENCES purchase_requests(id),
  ly_do_dieu_chinh   TEXT,
  nguoi_de_nghi_id   UUID NOT NULL REFERENCES auth.users(id),
  nguoi_de_nghi_ten  TEXT,
  giam_doc_user_id   UUID REFERENCES auth.users(id),
  ke_toan_user_id    UUID REFERENCES auth.users(id),
  trang_thai         TEXT NOT NULL DEFAULT 'nhap'
                     CHECK (trang_thai IN ('nhap','cho_ky','tra_ve','da_duyet','dang_mua','hoan_tat','dong','huy')),
  loai_tien          TEXT NOT NULL DEFAULT 'USD',
  tong_tien          NUMERIC NOT NULL DEFAULT 0,
  ghi_chu            TEXT,
  yeu_cau_ky_id      UUID,
  ngay_duyet         TIMESTAMPTZ,
  ly_do_huy          TEXT,
  huy_boi            UUID REFERENCES auth.users(id),
  huy_luc            TIMESTAMPTZ,
  ly_do_dong         TEXT,
  created_by         UUID REFERENCES auth.users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (factory_id, nam, so)
);

CREATE INDEX IF NOT EXISTS idx_purchase_requests_factory_ngay ON purchase_requests(factory_id, ngay DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_nguoi ON purchase_requests(nguoi_de_nghi_id);

-- ── 3. Dòng vật tư ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_request_lines (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       UUID NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  factory_id       UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  item_id          UUID REFERENCES inventory_items(id),
  item_code        TEXT,
  item_name        TEXT NOT NULL,
  unit             TEXT,
  so_luong         NUMERIC NOT NULL CHECK (so_luong > 0),
  don_gia          NUMERIC NOT NULL DEFAULT 0 CHECK (don_gia >= 0),
  thanh_tien       NUMERIC NOT NULL DEFAULT 0,
  muc_dich         TEXT,
  ghi_chu          TEXT,
  gia_goi_y        NUMERIC,
  nguon_gia_goi_y  TEXT,
  lech_gia_pct     NUMERIC,
  ly_do_lech_gia   TEXT,
  la_vat_tu_moi    BOOLEAN NOT NULL DEFAULT false,
  parent_line_id   UUID REFERENCES purchase_request_lines(id),
  sl_da_mua        NUMERIC NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_request_lines_request ON purchase_request_lines(request_id);
CREATE INDEX IF NOT EXISTS idx_purchase_request_lines_item ON purchase_request_lines(item_id);

-- ── 4. Nhật ký (bất biến) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_request_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  factory_id  UUID NOT NULL,
  user_id     UUID REFERENCES auth.users(id),
  hanh_dong   TEXT NOT NULL,
  noi_dung    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_purchase_request_logs_request ON purchase_request_logs(request_id);

CREATE OR REPLACE FUNCTION purchase_logs_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Nhật ký đề nghị mua là bất biến, không được sửa/xoá';
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_logs_immutable ON purchase_request_logs;
CREATE TRIGGER trg_purchase_logs_immutable
  BEFORE UPDATE ON purchase_request_logs
  FOR EACH ROW EXECUTE FUNCTION purchase_logs_immutable();

-- ── 5. Vật tư tạo từ đề nghị ────────────────────────────────
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS nguon_tao TEXT;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS tao_tu_request_id UUID;

-- ── 6. RLS — chỉ SELECT; ghi qua service role ───────────────
CREATE OR REPLACE FUNCTION purchase_can_view(p_request_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM purchase_requests r
    WHERE r.id = p_request_id
      AND (r.nguoi_de_nghi_id = p_user_id
        OR r.giam_doc_user_id = p_user_id
        OR r.ke_toan_user_id = p_user_id
        OR r.created_by = p_user_id)
  )
$$;

ALTER TABLE purchase_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_request_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_request_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchase_requests_select ON purchase_requests;
CREATE POLICY purchase_requests_select ON purchase_requests FOR SELECT USING (
  factory_id = current_profile_factory_id()
  AND (
    current_profile_role() = 'admin'
    OR current_profile_has_permission('purchase.view_all')
    OR purchase_can_view(id, auth.uid())
  )
);

DROP POLICY IF EXISTS purchase_request_lines_select ON purchase_request_lines;
CREATE POLICY purchase_request_lines_select ON purchase_request_lines FOR SELECT USING (
  factory_id = current_profile_factory_id()
  AND (
    current_profile_role() = 'admin'
    OR current_profile_has_permission('purchase.view_all')
    OR purchase_can_view(request_id, auth.uid())
  )
);

DROP POLICY IF EXISTS purchase_request_logs_select ON purchase_request_logs;
CREATE POLICY purchase_request_logs_select ON purchase_request_logs FOR SELECT USING (
  factory_id = current_profile_factory_id()
  AND (
    current_profile_role() = 'admin'
    OR current_profile_has_permission('purchase.view_all')
    OR purchase_can_view(request_id, auth.uid())
  )
);

-- ── 7. Quyền ────────────────────────────────────────────────
INSERT INTO permissions (code, module_name, action_name) VALUES
  ('purchase.view', 'purchase', 'view'),
  ('purchase.create', 'purchase', 'create'),
  ('purchase.view_all', 'purchase', 'view_all')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role, permission_code) VALUES
  ('admin', 'purchase.view'),
  ('admin', 'purchase.create'),
  ('admin', 'purchase.view_all'),
  ('manager', 'purchase.view'),
  ('manager', 'purchase.create'),
  ('user', 'purchase.view'),
  ('user', 'purchase.create')
ON CONFLICT DO NOTHING;

-- Kiểm chứng:
--   SELECT get_next_purchase_so('<factory_id>', 2099);  -- lần đầu = 1
--   SELECT policyname FROM pg_policies WHERE tablename LIKE 'purchase_%';
