-- Match van ban documents by semantic similarity (pgvector)
-- Yêu cầu: migration 20260610_van_ban_documents_extend.sql đã chạy trước (cột embedding vector(768))

CREATE OR REPLACE FUNCTION match_van_ban_documents(
  query_embedding vector(768),
  match_threshold float,
  match_count int,
  p_factory_id uuid
)
RETURNS TABLE (
  id uuid,
  ma_van_ban text,
  ten_van_ban text,
  loai_van_ban text,
  phong_ban text,
  trang_thai text,
  ngay_phe_duyet date,
  mo_ta_tim_kiem text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    id,
    ma_van_ban,
    ten_van_ban,
    loai_van_ban,
    phong_ban,
    trang_thai,
    ngay_phe_duyet,
    mo_ta_tim_kiem,
    1 - (embedding <=> query_embedding) AS similarity
  FROM van_ban_documents
  WHERE
    factory_id = p_factory_id
    AND embedding IS NOT NULL
    AND trang_thai = 'da_phe_duyet'
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
