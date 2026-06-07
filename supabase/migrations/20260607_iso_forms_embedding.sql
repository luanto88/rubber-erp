-- Migration: Thêm pgvector embedding cho iso_documents để hỗ trợ tìm kiếm AI
-- Chạy trong Supabase SQL Editor

-- 1. Bật pgvector extension (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Thêm cột embedding (768 chiều cho text-embedding-004) và mô tả tìm kiếm
ALTER TABLE iso_documents
  ADD COLUMN IF NOT EXISTS embedding vector(768),
  ADD COLUMN IF NOT EXISTS mo_ta_tim_kiem TEXT;

-- 3. Index cosine similarity (IVFFlat — phù hợp với dataset vừa/nhỏ)
CREATE INDEX IF NOT EXISTS idx_iso_documents_embedding
  ON iso_documents
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- 4. RPC function tìm kiếm tài liệu gần nhất
CREATE OR REPLACE FUNCTION match_iso_templates(
  query_embedding vector(768),
  p_factory_id    UUID,
  match_count     INT DEFAULT 8
)
RETURNS TABLE(
  id                      UUID,
  ten_tai_lieu            TEXT,
  ma_tai_lieu             TEXT,
  loai_tai_lieu           TEXT,
  phong_ban               TEXT,
  lan_ban_hanh            TEXT,
  phan_loai_tl            TEXT,
  file_signed_office_url  TEXT,
  file_signed_office_type TEXT,
  file_goc_url            TEXT,
  file_signed_pdf_url     TEXT,
  mo_ta_tim_kiem          TEXT,
  similarity              FLOAT
)
LANGUAGE sql STABLE AS $$
  SELECT
    id,
    ten_tai_lieu,
    ma_tai_lieu,
    loai_tai_lieu,
    phong_ban,
    lan_ban_hanh,
    phan_loai_tl,
    file_signed_office_url,
    file_signed_office_type,
    file_goc_url,
    file_signed_pdf_url,
    mo_ta_tim_kiem,
    1 - (embedding <=> query_embedding) AS similarity
  FROM iso_documents
  WHERE factory_id = p_factory_id
    AND trang_thai = 'co_hieu_luc'
    AND embedding IS NOT NULL
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
