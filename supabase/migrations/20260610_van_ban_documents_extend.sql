-- ============================================================
-- Module Văn bản Nội bộ — Giai đoạn 1 (phần 2)
-- Mở rộng bảng van_ban_documents (đã có từ 20260522)
-- Thêm các cột cho workflow ký theo thứ tự tùy chỉnh,
-- số văn bản, loại VB, trả về theo bước, embedding AI
-- ============================================================

-- ── 1. Các cột loại văn bản và số ────────────────────────────
ALTER TABLE van_ban_documents
  ADD COLUMN IF NOT EXISTS loai_van_ban   TEXT,          -- DN | TTR | BC | KH | BB
  ADD COLUMN IF NOT EXISTS so_van_ban     TEXT,          -- "01" | "1A" — text tự do
  ADD COLUMN IF NOT EXISTS nam            INTEGER;       -- năm dùng để tách dãy số

-- ── 2. Workflow ký theo thứ tự ───────────────────────────────
-- Thay thế mảng phẳng ky_phong_ban[] + count_pb bằng JSONB có cấu trúc.
-- Hai cột cũ giữ nguyên để backward-compat; cột mới dùng cho logic mới.
ALTER TABLE van_ban_documents
  ADD COLUMN IF NOT EXISTS thu_tu_ky_json  JSONB NOT NULL DEFAULT '[]',
  -- Ví dụ:
  -- [
  --   { "step": 1, "type": "phong_ban", "phong_ban_code": "KTNN", "phong_ban_name": "Phòng KTNN" },
  --   { "step": 2, "type": "ca_nhan",   "user_id": "uuid", "ten": "Nguyễn A", "chuc_vu": "TP QLCL" }
  -- ]
  ADD COLUMN IF NOT EXISTS buoc_hien_tai   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS so_buoc_tong    INTEGER NOT NULL DEFAULT 0;

-- Snapshot tên/thời gian ký từng bước: { "1": { "ten": "...", "chuc_vu": "...", "ky_at": "..." }, ... }
ALTER TABLE van_ban_documents
  ADD COLUMN IF NOT EXISTS nguoi_ky       JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS placement_ky   JSONB NOT NULL DEFAULT '{}';
-- placement_ky: { "1": { x, y, w, h, page, ... }, "phe_duyet": { ... } }

-- ── 3. Trả về theo bước ──────────────────────────────────────
-- Cột cũ (noi_dung_kky, nguoi_tra_ve) giữ nguyên cho backward-compat.
ALTER TABLE van_ban_documents
  ADD COLUMN IF NOT EXISTS tra_ve_step   INTEGER,        -- bước bị trả về (NULL nếu chưa có)
  ADD COLUMN IF NOT EXISTS tra_ve_ly_do  TEXT,           -- lý do trả về (thay noi_dung_kky)
  ADD COLUMN IF NOT EXISTS tra_ve_nguoi  TEXT,           -- người trả về (thay nguoi_tra_ve)
  ADD COLUMN IF NOT EXISTS tra_ve_at     TIMESTAMPTZ;

-- ── 4. Người phê duyệt cuối cụ thể ──────────────────────────
-- (phe_duyet TEXT và phe_duyet_user_id UUID đã có từ migration gốc)
-- Thêm trường ngày phê duyệt dạng DATE để hiển thị báo cáo
ALTER TABLE van_ban_documents
  ADD COLUMN IF NOT EXISTS ngay_phe_duyet   DATE;

-- ── 5. File Office đã ký ─────────────────────────────────────
ALTER TABLE van_ban_documents
  ADD COLUMN IF NOT EXISTS file_signed_office_url   TEXT,
  ADD COLUMN IF NOT EXISTS file_signed_office_type  TEXT,  -- docx | xlsx
  ADD COLUMN IF NOT EXISTS auto_convert_pdf         BOOLEAN NOT NULL DEFAULT false;

-- ── 6. Upload văn bản ký tay ─────────────────────────────────
ALTER TABLE van_ban_documents
  ADD COLUMN IF NOT EXISTS is_uploaded   BOOLEAN NOT NULL DEFAULT false;
-- Khi is_uploaded = true, người soạn thảo xác nhận đã ký tay,
-- hệ thống chuyển thẳng trang_thai = 'da_phe_duyet'.

-- ── 7. Metadata hiển thị ─────────────────────────────────────
ALTER TABLE van_ban_documents
  ADD COLUMN IF NOT EXISTS phong_ban_ky_display     TEXT[],  -- tên hiển thị từng bước ký
  ADD COLUMN IF NOT EXISTS nguoi_soan_thao_display  TEXT;    -- tên đầy đủ người soạn thảo

-- ── 8. Embedding AI (tái dụng pattern ISO Forms) ─────────────
-- Cần extension vector đã được bật trong migration iso_forms.
ALTER TABLE van_ban_documents
  ADD COLUMN IF NOT EXISTS embedding        vector(768),
  ADD COLUMN IF NOT EXISTS mo_ta_tim_kiem  TEXT;

-- IVFFlat index — bắt đầu sau khi có ít nhất 100 vectors
CREATE INDEX IF NOT EXISTS idx_van_ban_docs_embedding
  ON van_ban_documents
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 10);

-- ── 9. Permissions mới ───────────────────────────────────────
INSERT INTO permissions (code, module_name, action_name) VALUES
  ('documents.upload_signed', 'documents', 'upload_signed'),
  ('documents.distribute',    'documents', 'distribute')
ON CONFLICT (code) DO NOTHING;

-- Cấp mặc định cho admin và manager
INSERT INTO role_permissions (role, permission_code) VALUES
  ('admin',   'documents.upload_signed'),
  ('admin',   'documents.distribute'),
  ('manager', 'documents.upload_signed'),
  ('manager', 'documents.distribute')
ON CONFLICT DO NOTHING;

-- ── 10. RPC tìm kiếm văn bản bằng vector (tái dụng pattern ISO) ──
CREATE OR REPLACE FUNCTION match_van_ban_templates(
  p_factory_id    UUID,
  query_embedding vector(768),
  match_threshold FLOAT    DEFAULT 0.3,
  match_count     INT      DEFAULT 10
)
RETURNS TABLE (
  id          UUID,
  ten_van_ban TEXT,
  ma_van_ban  TEXT,
  loai_van_ban TEXT,
  phong_ban   TEXT,
  trang_thai  TEXT,
  similarity  FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    vbd.id,
    vbd.ten_van_ban,
    vbd.ma_van_ban,
    vbd.loai_van_ban,
    vbd.phong_ban,
    vbd.trang_thai,
    1 - (vbd.embedding <=> query_embedding) AS similarity
  FROM van_ban_documents vbd
  WHERE vbd.factory_id = p_factory_id
    AND vbd.trang_thai = 'da_phe_duyet'
    AND vbd.embedding IS NOT NULL
    AND 1 - (vbd.embedding <=> query_embedding) > match_threshold
  ORDER BY vbd.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
