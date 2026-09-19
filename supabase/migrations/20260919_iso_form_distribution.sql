-- Migration: Support distributing ISO form instances (Hồ sơ thực hiện ISO)
-- Mở rộng iso_distribution_recipients để hỗ trợ cả tài liệu ISO (iso_documents) và hồ sơ thực hiện (iso_form_instances)

-- 1. Cho phép iso_document_id nullable (vì hồ sơ thực hiện sẽ dùng iso_form_instance_id)
ALTER TABLE iso_distribution_recipients ALTER COLUMN iso_document_id DROP NOT NULL;

-- 2. Thêm cột iso_form_instance_id và item_type
ALTER TABLE iso_distribution_recipients 
  ADD COLUMN IF NOT EXISTS iso_form_instance_id UUID REFERENCES iso_form_instances(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS item_type VARCHAR(20) NOT NULL DEFAULT 'document';

-- 3. Tạo index cho iso_form_instance_id
CREATE INDEX IF NOT EXISTS iso_distrib_recipients_factory_form 
  ON iso_distribution_recipients(factory_id, iso_form_instance_id);

-- 4. Đảm bảo RLS cho phép người nhận xem cả hồ sơ form được phân phối
DROP POLICY IF EXISTS "iso_distrib_recipients_select" ON iso_distribution_recipients;
CREATE POLICY "iso_distrib_recipients_select" ON iso_distribution_recipients
  FOR SELECT USING (
    auth.uid() = recipient_user_id
    OR factory_id IN (
      SELECT factory_id FROM profiles
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
    OR batch_id IN (
      SELECT id FROM iso_distribution_batches WHERE distributed_by = auth.uid()
    )
  );
