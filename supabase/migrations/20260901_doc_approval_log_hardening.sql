-- ============================================================
-- Vá bảo mật hệ thống ký số dùng chung — Giai đoạn 0, mục 2-4
-- (xem CLAUDE.md "Kế hoạch phiên sau 2026-08-27" và
--  cung_cap_dl/du_an_ky_so_dung_chung - new.docx mục 6.1)
--
-- 1. Thêm content_hash / hash_backfilled_at vào doc_approval_log — chứng minh toàn vẹn
--    file đã ký (SHA-256), tính ngay lúc ký (mục 2) hoặc hồi tố bằng script backfill
--    (mục 4, xem scripts/backfill-doc-approval-hash.mjs).
-- 2. Trigger bất biến chan_sua_nhat_ky() — RLS insert-only KHÔNG đủ vì API route ký
--    (generate-pdf/route.ts, generate-office/route.ts, documents/sign/route.ts) dùng
--    service role, bỏ qua toàn bộ RLS. Trigger áp dụng với MỌI role, kể cả service role.
-- 3. Thay policy "FOR ALL" cũ bằng 2 policy tách riêng SELECT/INSERT theo factory —
--    không có policy UPDATE/DELETE nào (Postgres mặc định DENY khi RLS bật và không có
--    policy khớp action đó); trigger là lớp phòng thủ thứ 2 cho service role.
-- ============================================================

ALTER TABLE doc_approval_log
  ADD COLUMN IF NOT EXISTS content_hash TEXT,
  ADD COLUMN IF NOT EXISTS hash_backfilled_at TIMESTAMPTZ;

COMMENT ON COLUMN doc_approval_log.content_hash IS
  'SHA-256 (hex) của file đã ký, tính ngay sau khi stamp và trước khi upload Storage. NULL cho các dòng log không kèm file (vd chuyển trạng thái tra_ve, xem_xet không sinh file mới).';
COMMENT ON COLUMN doc_approval_log.hash_backfilled_at IS
  'Set khi content_hash được tính HỒI TỐ cho file đã ký từ trước khi có content_hash (script backfill-doc-approval-hash.mjs) — không phải bằng chứng toàn vẹn tại thời điểm ký gốc, chỉ chứng minh file không đổi kể từ mốc backfill này trở đi.';

-- ── Trigger bất biến ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION chan_sua_nhat_ky() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Nhật ký ký số là bất biến, không được sửa hoặc xoá';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS nhat_ky_bat_bien ON doc_approval_log;
CREATE TRIGGER nhat_ky_bat_bien
  BEFORE UPDATE OR DELETE ON doc_approval_log
  FOR EACH ROW EXECUTE FUNCTION chan_sua_nhat_ky();

-- ── RLS: thay "FOR ALL" bằng SELECT + INSERT tách riêng ──────────────────────

DROP POLICY IF EXISTS "doc_approval_log_factory" ON doc_approval_log;

CREATE POLICY "doc_approval_log_select" ON doc_approval_log
  FOR SELECT USING (
    factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "doc_approval_log_insert" ON doc_approval_log
  FOR INSERT WITH CHECK (
    factory_id IN (SELECT factory_id FROM profiles WHERE id = auth.uid())
  );
