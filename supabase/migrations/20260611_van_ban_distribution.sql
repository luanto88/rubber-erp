-- Migration: van_ban phân phối
-- Tương tự iso_distribution_batches / iso_distribution_recipients nhưng cho văn bản nội bộ

CREATE TABLE IF NOT EXISTS van_ban_distribution_batches (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id      UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  distributed_by  UUID NOT NULL REFERENCES auth.users(id),
  distributed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ghi_chu         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS van_ban_distribution_recipients (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id            UUID NOT NULL REFERENCES van_ban_distribution_batches(id) ON DELETE CASCADE,
  van_ban_document_id UUID NOT NULL REFERENCES van_ban_documents(id) ON DELETE CASCADE,
  factory_id          UUID NOT NULL,
  recipient_user_id   UUID NOT NULL REFERENCES auth.users(id),
  first_viewed_at     TIMESTAMPTZ,
  first_downloaded_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vb_dist_batches_factory ON van_ban_distribution_batches(factory_id);
CREATE INDEX IF NOT EXISTS idx_vb_dist_recipients_batch ON van_ban_distribution_recipients(batch_id);
CREATE INDEX IF NOT EXISTS idx_vb_dist_recipients_user ON van_ban_distribution_recipients(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_vb_dist_recipients_doc ON van_ban_distribution_recipients(van_ban_document_id);

-- RLS
ALTER TABLE van_ban_distribution_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE van_ban_distribution_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vb_dist_batches_factory_read" ON van_ban_distribution_batches;
CREATE POLICY "vb_dist_batches_factory_read"
  ON van_ban_distribution_batches FOR SELECT
  TO authenticated
  USING (factory_id = (SELECT factory_id FROM profiles WHERE id = auth.uid() LIMIT 1));

DROP POLICY IF EXISTS "vb_dist_recipients_factory_read" ON van_ban_distribution_recipients;
CREATE POLICY "vb_dist_recipients_factory_read"
  ON van_ban_distribution_recipients FOR SELECT
  TO authenticated
  USING (factory_id = (SELECT factory_id FROM profiles WHERE id = auth.uid() LIMIT 1));

-- Permission seed: documents.distribute
INSERT INTO permissions (code, module, action, description)
VALUES ('documents.distribute', 'documents', 'distribute', 'Phân phối văn bản đến người dùng')
ON CONFLICT (code) DO NOTHING;

-- Cấp cho admin và manager mặc định
INSERT INTO role_permissions (role, permission_code)
SELECT r.role, 'documents.distribute'
FROM (VALUES ('admin'), ('manager')) AS r(role)
WHERE NOT EXISTS (
  SELECT 1 FROM role_permissions
  WHERE role = r.role AND permission_code = 'documents.distribute'
);
