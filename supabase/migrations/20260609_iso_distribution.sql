-- Migration: ISO Document Distribution
-- Bảng lưu lịch sử phân phối tài liệu ISO đến người dùng

-- Batch header: mỗi lần bấm "Phân phối" tạo 1 batch
CREATE TABLE IF NOT EXISTS iso_distribution_batches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id UUID NOT NULL,
  distributed_by UUID NOT NULL,      -- auth.users.id
  distributed_at TIMESTAMPTZ DEFAULT now(),
  ghi_chu TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Mỗi row = 1 tài liệu × 1 người nhận
-- Unique per (iso_document_id, recipient_user_id) toàn factory — không cho trùng bản với cùng người
CREATE TABLE IF NOT EXISTS iso_distribution_recipients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id UUID NOT NULL REFERENCES iso_distribution_batches(id) ON DELETE CASCADE,
  iso_document_id UUID NOT NULL REFERENCES iso_documents(id),
  factory_id UUID NOT NULL,
  recipient_user_id UUID NOT NULL,   -- auth.users.id
  first_viewed_at TIMESTAMPTZ,       -- NULL = chưa xem; set once khi view đầu tiên
  first_downloaded_at TIMESTAMPTZ,   -- NULL = chưa tải; set once khi download đầu tiên
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index cho query Kho của tôi và management panel
CREATE INDEX IF NOT EXISTS iso_distrib_recipients_factory_user
  ON iso_distribution_recipients(factory_id, recipient_user_id);
CREATE INDEX IF NOT EXISTS iso_distrib_recipients_factory_doc
  ON iso_distribution_recipients(factory_id, iso_document_id);
CREATE INDEX IF NOT EXISTS iso_distrib_batches_factory
  ON iso_distribution_batches(factory_id, distributed_by);

-- RLS
ALTER TABLE iso_distribution_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE iso_distribution_recipients ENABLE ROW LEVEL SECURITY;

-- Batches: distributor xem batch của mình; admin/manager xem tất cả của factory
CREATE POLICY "iso_distrib_batches_select" ON iso_distribution_batches
  FOR SELECT USING (
    auth.uid() = distributed_by
    OR factory_id IN (
      SELECT factory_id FROM profiles
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
  );

CREATE POLICY "iso_distrib_batches_insert" ON iso_distribution_batches
  FOR INSERT WITH CHECK (auth.uid() = distributed_by);

CREATE POLICY "iso_distrib_batches_delete" ON iso_distribution_batches
  FOR DELETE USING (
    auth.uid() = distributed_by
    OR factory_id IN (
      SELECT factory_id FROM profiles WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Recipients: người nhận xem row của mình; distributor + admin/manager xem tất cả của factory
CREATE POLICY "iso_distrib_recipients_select" ON iso_distribution_recipients
  FOR SELECT USING (
    recipient_user_id = auth.uid()
    OR factory_id IN (
      SELECT factory_id FROM profiles
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
    OR batch_id IN (
      SELECT id FROM iso_distribution_batches WHERE distributed_by = auth.uid()
    )
  );

CREATE POLICY "iso_distrib_recipients_insert" ON iso_distribution_recipients
  FOR INSERT WITH CHECK (
    batch_id IN (
      SELECT id FROM iso_distribution_batches WHERE distributed_by = auth.uid()
    )
  );

CREATE POLICY "iso_distrib_recipients_update" ON iso_distribution_recipients
  FOR UPDATE USING (recipient_user_id = auth.uid());

CREATE POLICY "iso_distrib_recipients_delete" ON iso_distribution_recipients
  FOR DELETE USING (
    batch_id IN (
      SELECT id FROM iso_distribution_batches WHERE distributed_by = auth.uid()
    )
    OR factory_id IN (
      SELECT factory_id FROM profiles WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Thêm permission iso.distribute vào bảng permissions
INSERT INTO permissions (code, ten, mo_ta, module, nhom)
VALUES (
  'iso.distribute',
  'Phân phối tài liệu',
  'Phân phối tài liệu ISO cho người nhận, theo dõi xem/tải',
  'iso',
  'Tài liệu ISO'
)
ON CONFLICT (code) DO NOTHING;
