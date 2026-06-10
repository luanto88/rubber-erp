-- ============================================================
-- Module Văn bản Nội bộ — Giai đoạn 1 (phần 1)
-- Tạo: van_ban_document_types, van_ban_sequences
--      Function get_next_van_ban_so (atomic, concurrency-safe)
-- ============================================================

-- ── 1. Bảng loại văn bản ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS van_ban_document_types (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,   -- DN | TTR | BC | KH | BB
  name        TEXT NOT NULL,          -- Đề nghị | Tờ trình | ...
  ky_hieu     TEXT NOT NULL,          -- ĐN | Ttr | BC | KH | BB
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO van_ban_document_types (code, name, ky_hieu, sort_order) VALUES
  ('DN',  'Đề nghị',   'ĐN',  10),
  ('TTR', 'Tờ trình',  'Ttr', 20),
  ('BC',  'Báo cáo',   'BC',  30),
  ('KH',  'Kế hoạch',  'KH',  40),
  ('BB',  'Biên bản',  'BB',  50)
ON CONFLICT (code) DO NOTHING;

-- ── 2. Bảng dãy số văn bản ───────────────────────────────────
-- Mỗi tổ hợp (nhà máy, loại VB, phòng ban, năm) có 1 dãy số riêng
CREATE TABLE IF NOT EXISTS van_ban_sequences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id      UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  loai_van_ban    TEXT NOT NULL,   -- code của loại VB (DN, TTR, BC, KH, BB)
  phong_ban       TEXT NOT NULL,   -- mã phòng ban
  nam             INTEGER NOT NULL,
  so_hien_tai     INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (factory_id, loai_van_ban, phong_ban, nam)
);

CREATE INDEX IF NOT EXISTS idx_van_ban_sequences_factory
  ON van_ban_sequences(factory_id, nam);

-- ── 3. Function lấy số tiếp theo (atomic) ───────────────────
-- Dùng INSERT ... ON CONFLICT ... DO UPDATE RETURNING để đảm bảo
-- không có race condition khi nhiều user tạo văn bản cùng lúc.
CREATE OR REPLACE FUNCTION get_next_van_ban_so(
  p_factory_id   UUID,
  p_loai         TEXT,
  p_phong_ban    TEXT,
  p_nam          INTEGER
) RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_next INTEGER;
BEGIN
  INSERT INTO van_ban_sequences (factory_id, loai_van_ban, phong_ban, nam, so_hien_tai)
  VALUES (p_factory_id, p_loai, p_phong_ban, p_nam, 1)
  ON CONFLICT (factory_id, loai_van_ban, phong_ban, nam)
  DO UPDATE SET
    so_hien_tai = van_ban_sequences.so_hien_tai + 1,
    updated_at  = now()
  RETURNING so_hien_tai INTO v_next;

  RETURN v_next;
END;
$$;

-- Chỉ service_role (API routes) mới được gọi function này từ client
REVOKE EXECUTE ON FUNCTION get_next_van_ban_so(UUID, TEXT, TEXT, INTEGER) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_next_van_ban_so(UUID, TEXT, TEXT, INTEGER) TO service_role;

-- RLS cho van_ban_sequences (đọc theo factory, ghi qua function)
ALTER TABLE van_ban_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "van_ban_sequences_factory_read" ON van_ban_sequences;
CREATE POLICY "van_ban_sequences_factory_read" ON van_ban_sequences
  FOR SELECT USING (
    factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid())
  );
