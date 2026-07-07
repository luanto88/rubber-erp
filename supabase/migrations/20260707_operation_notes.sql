-- Module Ghi chú nhanh (/dashboard/notes)
-- Ghi chú nội dung + ngày xảy ra + hình ảnh. Mặc định RIÊNG TƯ theo người tạo,
-- admin thấy tất cả, có thể chia sẻ cho người dùng cụ thể qua operation_note_shares.

CREATE TABLE IF NOT EXISTS operation_notes (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id    UUID NOT NULL,
  noi_dung      TEXT NOT NULL,
  ngay_xay_ra   DATE NOT NULL,
  image_urls    TEXT[] DEFAULT '{}',
  created_by    UUID REFERENCES auth.users,
  nguoi_tao     TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_operation_notes_factory_ngay
  ON operation_notes (factory_id, ngay_xay_ra DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_operation_notes_created_by
  ON operation_notes (created_by);

-- Bảng chia sẻ: mỗi dòng = 1 ghi chú được chia sẻ cho 1 người dùng cụ thể.
-- Người được chia sẻ (shared_with_user_id) sẽ thấy ghi chú này dù không phải người tạo.
CREATE TABLE IF NOT EXISTS operation_note_shares (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  note_id              UUID NOT NULL REFERENCES operation_notes ON DELETE CASCADE,
  factory_id           UUID NOT NULL,
  shared_with_user_id  UUID NOT NULL REFERENCES auth.users,
  shared_by            UUID REFERENCES auth.users,
  created_at           TIMESTAMPTZ DEFAULT now(),
  UNIQUE (note_id, shared_with_user_id)
);

CREATE INDEX IF NOT EXISTS idx_operation_note_shares_note
  ON operation_note_shares (note_id);

CREATE INDEX IF NOT EXISTS idx_operation_note_shares_user
  ON operation_note_shares (shared_with_user_id);

ALTER TABLE operation_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE operation_note_shares ENABLE ROW LEVEL SECURITY;

-- ── operation_notes: chỉ chủ ghi chú, admin, hoặc người được chia sẻ mới đọc được ──
DROP POLICY IF EXISTS "operation_notes_read" ON operation_notes;
DROP POLICY IF EXISTS "operation_notes_write" ON operation_notes;
DROP POLICY IF EXISTS "operation_notes_select" ON operation_notes;
DROP POLICY IF EXISTS "operation_notes_insert" ON operation_notes;
DROP POLICY IF EXISTS "operation_notes_update" ON operation_notes;
DROP POLICY IF EXISTS "operation_notes_delete" ON operation_notes;

CREATE POLICY "operation_notes_select" ON operation_notes
  FOR SELECT USING (
    factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid())
    AND (
      created_by = auth.uid()
      OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
      OR EXISTS (
        SELECT 1 FROM operation_note_shares s
        WHERE s.note_id = operation_notes.id AND s.shared_with_user_id = auth.uid()
      )
    )
  );

CREATE POLICY "operation_notes_insert" ON operation_notes
  FOR INSERT WITH CHECK (
    factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid())
  );

-- Chỉ chủ ghi chú hoặc admin được sửa/xóa — người được chia sẻ chỉ có quyền xem
CREATE POLICY "operation_notes_update" ON operation_notes
  FOR UPDATE USING (
    factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid())
    AND (
      created_by = auth.uid()
      OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

CREATE POLICY "operation_notes_delete" ON operation_notes
  FOR DELETE USING (
    factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid())
    AND (
      created_by = auth.uid()
      OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

-- ── operation_note_shares: chỉ chủ ghi chú/admin được quản lý; người nhận chỉ đọc được dòng của mình ──
DROP POLICY IF EXISTS "operation_note_shares_select" ON operation_note_shares;
CREATE POLICY "operation_note_shares_select" ON operation_note_shares
  FOR SELECT USING (
    factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid())
    AND (
      shared_with_user_id = auth.uid()
      OR shared_by = auth.uid()
      OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

DROP POLICY IF EXISTS "operation_note_shares_insert" ON operation_note_shares;
CREATE POLICY "operation_note_shares_insert" ON operation_note_shares
  FOR INSERT WITH CHECK (
    factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid())
    AND shared_by = auth.uid()
    AND (
      EXISTS (SELECT 1 FROM operation_notes n WHERE n.id = note_id AND n.created_by = auth.uid())
      OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

DROP POLICY IF EXISTS "operation_note_shares_delete" ON operation_note_shares;
CREATE POLICY "operation_note_shares_delete" ON operation_note_shares
  FOR DELETE USING (
    factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid())
    AND (
      shared_by = auth.uid()
      OR EXISTS (SELECT 1 FROM operation_notes n WHERE n.id = note_id AND n.created_by = auth.uid())
      OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

-- Tự cập nhật updated_at mỗi lần sửa
CREATE OR REPLACE FUNCTION operation_notes_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_operation_notes_updated_at ON operation_notes;
CREATE TRIGGER trg_operation_notes_updated_at
  BEFORE UPDATE ON operation_notes
  FOR EACH ROW EXECUTE FUNCTION operation_notes_set_updated_at();

-- Permissions
INSERT INTO permissions (code, module_name, action_name)
VALUES
  ('notes.view',   'notes', 'view'),
  ('notes.create', 'notes', 'create'),
  ('notes.edit',   'notes', 'edit'),
  ('notes.delete', 'notes', 'delete')
ON CONFLICT (code) DO NOTHING;

-- Ai cũng dùng được sổ ghi chú của riêng mình — cấp view/create/edit/delete mặc định
-- cho cả 3 role nghiệp vụ (admin/manager/user). Phạm vi NHÌN THẤY ghi chú nào lại do
-- RLS ở trên quyết định (chủ ghi chú + admin + người được chia sẻ), không phải permission
-- này. edit/delete còn bị chặn thêm ở tầng UI/RLS: chỉ chủ ghi chú hoặc admin.
INSERT INTO role_permissions (role, permission_code)
VALUES
  ('admin',   'notes.view'),
  ('admin',   'notes.create'),
  ('admin',   'notes.edit'),
  ('admin',   'notes.delete'),
  ('manager', 'notes.view'),
  ('manager', 'notes.create'),
  ('manager', 'notes.edit'),
  ('manager', 'notes.delete'),
  ('user',    'notes.view'),
  ('user',    'notes.create'),
  ('user',    'notes.edit'),
  ('user',    'notes.delete')
ON CONFLICT DO NOTHING;
