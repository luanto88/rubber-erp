-- GĐ7b (2026-09-29): "Bản cứng" PDF của Phiếu thành phẩm (F09), Báo cáo lô (F11), Báo cáo sản
-- xuất hằng ngày (F12) cho ngày đã KHÓA ĐỦ mọi ca. Xem .claude/rules/06-module-production.md 4.15.
--
-- Quy tắc (người dùng chốt):
--   - Bản cứng chỉ sinh khi (1) mọi ca có phát sinh trong ngày đã khóa VÀ (2) có người render lần
--     đầu sau thời điểm đó. Khóa ca KHÔNG tự sinh PDF.
--   - Đã có bản cứng hiện hành → mọi người (kể cả admin) mở lại đều nhận đúng bản đó.
--   - Muốn sửa: admin mở khóa → khóa lại → lần render kế tiếp sinh bản mới. "Bản hiện hành" = bản
--     mới nhất có lock_ids trùng đúng bộ khóa active của ngày; bản cũ giữ làm lịch sử.
--
-- Bucket private, KHÔNG có policy storage cho authenticated/anon: ghi qua signed upload URL, đọc
-- qua signed URL ngắn hạn — cả hai do server (service role) phát sau khi kiểm quyền.
-- Chạy lại file này an toàn (idempotent).

INSERT INTO storage.buckets (id, name, public)
VALUES ('product-shift-reports', 'product-shift-reports', false)
ON CONFLICT (id) DO UPDATE SET public = false;

CREATE TABLE IF NOT EXISTS public.product_shift_report_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Không ON DELETE CASCADE: bảng bất biến (trigger bên dưới chặn DELETE).
  factory_id UUID NOT NULL REFERENCES public.factories(id),
  ngay_sx DATE NOT NULL,
  loai TEXT NOT NULL CHECK (loai IN ('F09', 'F11', 'F12', 'F11_F12')),
  lock_ids UUID[] NOT NULL CHECK (cardinality(lock_ids) > 0),
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  inputs JSONB,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT product_shift_report_snapshots_path_unique UNIQUE (storage_path)
);

CREATE INDEX IF NOT EXISTS idx_product_shift_report_snapshots_lookup
  ON public.product_shift_report_snapshots (factory_id, ngay_sx, loai, created_at DESC);

ALTER TABLE public.product_shift_report_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_shift_report_snapshots_select ON public.product_shift_report_snapshots;
CREATE POLICY product_shift_report_snapshots_select ON public.product_shift_report_snapshots
  FOR SELECT TO authenticated
  USING (
    factory_id = public.current_profile_factory_id()
    AND (public.current_profile_role() = 'admin'
         OR public.current_profile_has_permission('product.view'))
  );
-- Không có policy INSERT/UPDATE/DELETE: chỉ server (service role) ghi được.

CREATE OR REPLACE FUNCTION public.product_shift_report_snapshots_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Bản cứng phiếu/báo cáo thành phẩm là bất biến, không được sửa hoặc xóa.';
END;
$$;

DROP TRIGGER IF EXISTS trg_product_shift_report_snapshots_immutable ON public.product_shift_report_snapshots;
CREATE TRIGGER trg_product_shift_report_snapshots_immutable
  BEFORE UPDATE OR DELETE ON public.product_shift_report_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.product_shift_report_snapshots_immutable();

-- Kiểm chứng:
--   SELECT id, public FROM storage.buckets WHERE id = 'product-shift-reports';           -- public = false
--   SELECT policyname, cmd FROM pg_policies WHERE tablename = 'product_shift_report_snapshots';  -- 1 dòng SELECT
--   SELECT ngay_sx, loai, created_at, sha256 FROM product_shift_report_snapshots ORDER BY created_at DESC LIMIT 10;
