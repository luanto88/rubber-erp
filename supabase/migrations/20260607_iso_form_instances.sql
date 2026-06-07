-- Migration: Bảng iso_form_instances — thực hiện hồ sơ ISO (Phương án B)
-- Chạy trong Supabase SQL Editor

-- Bảng chính: mỗi instance là một lần thực hiện hồ sơ từ template
CREATE TABLE IF NOT EXISTS iso_form_instances (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  factory_id          UUID NOT NULL REFERENCES factories(id),
  template_doc_id     UUID NOT NULL REFERENCES iso_documents(id),
  tieu_de             TEXT NOT NULL,
  nguoi_tao           UUID NOT NULL,          -- auth.users.id

  -- Files (Storage path: {factory_id}/iso/instances/{id}/)
  draft_file_url      TEXT,                   -- bản sao đang làm việc
  draft_file_type     TEXT,                   -- docx | xlsx | pdf
  final_office_url    TEXT,                   -- Office đã ký (nếu không convert)
  final_pdf_url       TEXT,                   -- PDF đã ký (nếu convert)

  -- Workflow state
  trang_thai          TEXT NOT NULL DEFAULT 'draft',
  -- draft | cho_xem_xet | cho_phe_duyet | da_phe_duyet | tra_ve | tu_choi
  cap_tl              TEXT NOT NULL DEFAULT 'Cấp 1',  -- "Cấp 1" | "Cấp 2"

  -- Người ký (snapshot tên + FK user_id)
  xem_xet_user_id     UUID,
  xem_xet             TEXT,   -- snapshot tên
  phe_duyet_user_id   UUID,
  phe_duyet           TEXT,   -- snapshot tên

  -- Timestamps ký
  ky_xem_xet_at       TIMESTAMPTZ,
  ky_phe_duyet_at     TIMESTAMPTZ,

  -- Placement chữ ký (cùng format với iso_documents placements)
  xem_xet_placement   JSONB,
  phe_duyet_placement JSONB,

  -- Tuỳ chọn
  auto_convert_pdf    BOOLEAN DEFAULT false,

  -- Metadata
  ghi_chu             TEXT,
  ly_do_tra_ve        TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

-- Trigger updated_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_iso_form_instances_updated_at'
  ) THEN
    CREATE TRIGGER trg_iso_form_instances_updated_at
      BEFORE UPDATE ON iso_form_instances
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END;
$$;

-- RLS: chỉ đọc/ghi bản ghi của factory mình
ALTER TABLE iso_form_instances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "iso_form_instances_factory" ON iso_form_instances;
CREATE POLICY "iso_form_instances_factory" ON iso_form_instances
  USING (
    factory_id IN (
      SELECT factory_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Index hỗ trợ query theo factory + người tạo
CREATE INDEX IF NOT EXISTS idx_iso_form_instances_factory
  ON iso_form_instances (factory_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_iso_form_instances_nguoi_tao
  ON iso_form_instances (nguoi_tao, factory_id);

CREATE INDEX IF NOT EXISTS idx_iso_form_instances_approvers
  ON iso_form_instances (xem_xet_user_id, phe_duyet_user_id);

-- Bảng audit log
CREATE TABLE IF NOT EXISTS iso_form_instance_logs (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_id  UUID NOT NULL REFERENCES iso_form_instances(id) ON DELETE CASCADE,
  factory_id   UUID NOT NULL,
  user_id      UUID NOT NULL,
  action       TEXT NOT NULL,
  -- clone | upload | submit | xem_xet | phe_duyet | tra_ve | tu_choi | finalize
  note         TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE iso_form_instance_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "iso_form_instance_logs_factory" ON iso_form_instance_logs;
CREATE POLICY "iso_form_instance_logs_factory" ON iso_form_instance_logs
  USING (
    factory_id IN (
      SELECT factory_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_iso_form_instance_logs_instance
  ON iso_form_instance_logs (instance_id, created_at DESC);

-- Seed permissions cho module forms (nếu chưa có)
INSERT INTO public.permissions (code, module_name, action_name)
VALUES
  ('iso.forms.view',   'iso', 'Xem hồ sơ thực hiện ISO'),
  ('iso.forms.create', 'iso', 'Tạo hồ sơ thực hiện ISO'),
  ('iso.forms.edit',   'iso', 'Sửa hồ sơ thực hiện ISO'),
  ('iso.forms.delete', 'iso', 'Xóa hồ sơ thực hiện ISO'),
  ('iso.forms.approve','iso', 'Phê duyệt hồ sơ thực hiện')
ON CONFLICT (code) DO NOTHING;
