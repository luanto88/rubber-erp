-- ============================================================
-- Module ISO & Văn bản nội bộ
-- Tạo bảng: iso_documents, van_ban_documents, sign_pins,
--           doc_approval_log, notifications
-- ============================================================

-- ── 1. sign_pins ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sign_pins (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  pin_hash   TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE sign_pins ENABLE ROW LEVEL SECURITY;

-- Chỉ bản thân user hoặc service_role mới đọc/ghi pin_hash
CREATE POLICY "sign_pins_self" ON sign_pins
  FOR ALL USING (auth.uid() = user_id);

-- ── 2. iso_documents ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS iso_documents (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id           UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,

  ma_tai_lieu          TEXT,
  ten_tai_lieu         TEXT NOT NULL,
  loai_tai_lieu        TEXT,          -- QT | HD | BM | TCCS | ...
  phong_ban            TEXT,
  cap_tl               TEXT,          -- Cấp 1 | Cấp 2
  chon_quy_trinh       TEXT,          -- Soạn thảo | Soát xét
  loai_vb              TEXT DEFAULT 'Thường',  -- Thường | Mật
  lan_ban_hanh         TEXT DEFAULT '00',

  trang_thai           TEXT NOT NULL DEFAULT 'draft',
  -- draft | cho_xem_xet | cho_phe_duyet | co_hieu_luc | het_hieu_luc | tra_ve

  -- Nhân sự (snapshot tên)
  soan_thao            TEXT,
  xem_xet              TEXT,
  phe_duyet            TEXT,

  -- User IDs để gửi thông báo
  soan_thao_user_id    UUID REFERENCES auth.users(id),
  xem_xet_user_id      UUID REFERENCES auth.users(id),
  phe_duyet_user_id    UUID REFERENCES auth.users(id),

  -- Files
  file_goc_url         TEXT,          -- file gốc user upload (PDF/DOCX/XLSX)
  file_soat_xet_url    TEXT,          -- file đề nghị soát xét (nếu có)
  file_signed_pdf_url  TEXT,          -- PDF cuối có chữ ký + QR

  -- Thông tin ký duyệt (tọa độ + ảnh chữ ký nhúng)
  ky_soan_thao_at      TIMESTAMPTZ,
  ky_xem_xet_at        TIMESTAMPTZ,
  ky_phe_duyet_at      TIMESTAMPTZ,

  -- Soát xét
  ma_tai_lieu_moi      TEXT,          -- mã mới nếu đổi mã khi soát xét

  -- Hiệu lực
  ngay_hieu_luc        TIMESTAMPTZ,
  ngay_het_hieu_luc    TIMESTAMPTZ,
  qr_url               TEXT,

  ghi_chu              TEXT,
  created_by           UUID REFERENCES auth.users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_iso_documents_factory ON iso_documents(factory_id);
CREATE INDEX idx_iso_documents_trang_thai ON iso_documents(trang_thai);
CREATE INDEX idx_iso_documents_ma ON iso_documents(factory_id, ma_tai_lieu);

ALTER TABLE iso_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "iso_documents_factory" ON iso_documents
  FOR ALL USING (
    factory_id IN (
      SELECT factory_id FROM profiles WHERE id = auth.uid()
    )
  );

-- ── 3. van_ban_documents ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS van_ban_documents (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id           UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,

  ma_van_ban           TEXT,          -- auto-gen: VB-DDMMYY/NNN
  ten_van_ban          TEXT NOT NULL,
  phong_ban            TEXT,
  cap_tl               TEXT,          -- Cấp 1 | Cấp 2
  loai_vb              TEXT DEFAULT 'Thường',  -- Thường | Mật

  -- Cấp 1: danh sách phòng ban ký tuần tự
  ky_phong_ban         TEXT[],        -- VD: ["KTNN", "QLCL", "TCHC"]
  count_pb             INTEGER DEFAULT 0,   -- bước hiện tại (0-based)
  pb_ky_hien_tai       TEXT,          -- phòng ban đang chờ ký

  -- Nhân sự (snapshot tên)
  soan_thao            TEXT,
  phe_duyet            TEXT,

  -- User IDs để gửi thông báo
  soan_thao_user_id    UUID REFERENCES auth.users(id),
  phe_duyet_user_id    UUID REFERENCES auth.users(id),

  -- Files
  file_goc_url         TEXT,
  file_signed_pdf_url  TEXT,

  trang_thai           TEXT NOT NULL DEFAULT 'draft',
  -- draft | cho_pb{N}_ky | cho_phe_duyet | da_phe_duyet | tra_ve

  noi_dung_kky         TEXT,          -- lý do không ký (trả về)
  nguoi_tra_ve         TEXT,          -- tên người từ chối

  -- Ký duyệt
  ky_phong_ban_at      JSONB DEFAULT '{}',  -- {"KTNN": "2026-05-22T10:00:00Z", ...}
  ky_phe_duyet_at      TIMESTAMPTZ,

  ngay_ban_hanh        TIMESTAMPTZ,
  qr_url               TEXT,

  ghi_chu              TEXT,
  created_by           UUID REFERENCES auth.users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_van_ban_documents_factory ON van_ban_documents(factory_id);
CREATE INDEX idx_van_ban_documents_trang_thai ON van_ban_documents(trang_thai);

ALTER TABLE van_ban_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "van_ban_documents_factory" ON van_ban_documents
  FOR ALL USING (
    factory_id IN (
      SELECT factory_id FROM profiles WHERE id = auth.uid()
    )
  );

-- ── 4. doc_approval_log ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS doc_approval_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id  UUID NOT NULL,
  doc_id      UUID NOT NULL,
  doc_type    TEXT NOT NULL,   -- 'iso' | 'van_ban'
  user_id     UUID REFERENCES auth.users(id),
  action      TEXT NOT NULL,   -- 'xem_xet'|'phe_duyet'|'ky_phong_ban'|'tu_choi'|'tra_ve'
  phong_ban   TEXT,
  buoc_ky     INTEGER,
  ly_do       TEXT,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_doc_approval_log_doc ON doc_approval_log(doc_id, doc_type);
CREATE INDEX idx_doc_approval_log_factory ON doc_approval_log(factory_id);
CREATE INDEX idx_doc_approval_log_user ON doc_approval_log(user_id);

ALTER TABLE doc_approval_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "doc_approval_log_factory" ON doc_approval_log
  FOR ALL USING (
    factory_id IN (
      SELECT factory_id FROM profiles WHERE id = auth.uid()
    )
  );

-- ── 5. notifications ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id  UUID NOT NULL,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,   -- 'cho_ky' | 'phan_phoi' | 'het_hieu_luc'
  doc_id      UUID,
  doc_type    TEXT,            -- 'iso' | 'van_ban'
  title       TEXT NOT NULL,
  body        TEXT,
  is_read     BOOLEAN NOT NULL DEFAULT false,
  link        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX idx_notifications_factory ON notifications(factory_id);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- User chỉ xem thông báo của chính mình
CREATE POLICY "notifications_self_read" ON notifications
  FOR SELECT USING (auth.uid() = user_id);

-- Service role (API routes) có thể insert/update cho bất kỳ user nào
CREATE POLICY "notifications_service_insert" ON notifications
  FOR INSERT WITH CHECK (true);

CREATE POLICY "notifications_self_update" ON notifications
  FOR UPDATE USING (auth.uid() = user_id);

-- ── 6. Permissions cho module ISO & Văn bản ──────────────────
INSERT INTO public.permissions (code, module_name, action_name) VALUES
  ('iso.view',               'iso',       'view'),
  ('iso.create',             'iso',       'create'),
  ('iso.edit',               'iso',       'edit'),
  ('iso.delete',             'iso',       'delete'),
  ('iso.xem_xet',            'iso',       'xem_xet'),
  ('iso.phe_duyet',          'iso',       'phe_duyet'),
  ('iso.print',              'iso',       'print'),
  ('documents.view',         'documents', 'view'),
  ('documents.create',       'documents', 'create'),
  ('documents.edit',         'documents', 'edit'),
  ('documents.delete',       'documents', 'delete'),
  ('documents.ky_phong_ban', 'documents', 'ky_phong_ban'),
  ('documents.phe_duyet',    'documents', 'phe_duyet'),
  ('documents.print',        'documents', 'print')
ON CONFLICT (code) DO NOTHING;

-- admin: toàn quyền ISO & Văn bản
INSERT INTO public.role_permissions (role, permission_code)
  SELECT 'admin', code FROM public.permissions
  WHERE code LIKE 'iso.%' OR code LIKE 'documents.%'
ON CONFLICT DO NOTHING;

-- manager: tất cả trừ delete
INSERT INTO public.role_permissions (role, permission_code) VALUES
  ('manager', 'iso.view'),
  ('manager', 'iso.create'),
  ('manager', 'iso.edit'),
  ('manager', 'iso.xem_xet'),
  ('manager', 'iso.phe_duyet'),
  ('manager', 'iso.print'),
  ('manager', 'documents.view'),
  ('manager', 'documents.create'),
  ('manager', 'documents.edit'),
  ('manager', 'documents.ky_phong_ban'),
  ('manager', 'documents.phe_duyet'),
  ('manager', 'documents.print')
ON CONFLICT DO NOTHING;

-- user: chỉ xem
INSERT INTO public.role_permissions (role, permission_code) VALUES
  ('user', 'iso.view'),
  ('user', 'documents.view')
ON CONFLICT DO NOTHING;

-- ── 7. Trigger auto-update updated_at ────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'iso_documents_updated_at'
  ) THEN
    CREATE TRIGGER iso_documents_updated_at
      BEFORE UPDATE ON iso_documents
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'van_ban_documents_updated_at'
  ) THEN
    CREATE TRIGGER van_ban_documents_updated_at
      BEFORE UPDATE ON van_ban_documents
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
