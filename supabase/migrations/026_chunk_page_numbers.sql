-- =============================================================
-- Migration 026: Add page_number to document chunks
-- =============================================================
-- Tracks which PDF page each chunk originated from. New uploads
-- chunk per-page so Howard can cite "POH page 47" instead of
-- just linking the whole document. Existing chunks get NULL
-- (unknown page) — they still work, Howard just won't cite a
-- page number for docs uploaded before this migration.
--
-- The match_document_chunks RPC is recreated to return the new
-- column.
--
-- Run in the Supabase SQL Editor.
-- =============================================================

BEGIN;

ALTER TABLE aft_document_chunks
  ADD COLUMN IF NOT EXISTS page_number integer;

-- Recreate the RPC so it returns page_number alongside the other
-- fields. The function signature doesn't change so callers stay
-- compatible.
CREATE OR REPLACE FUNCTION match_document_chunks(
  query_embedding text,
  match_aircraft_id uuid,
  match_count int DEFAULT 5,
  match_threshold float DEFAULT 0.3
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  chunk_index int,
  content text,
  page_number int,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.document_id,
    c.chunk_index,
    c.content,
    c.page_number,
    1 - (c.embedding <=> query_embedding::vector) AS similarity
  FROM aft_document_chunks c
  JOIN aft_documents d ON d.id = c.document_id
  WHERE d.aircraft_id = match_aircraft_id
    AND d.deleted_at IS NULL
    AND d.status = 'ready'
    AND 1 - (c.embedding <=> query_embedding::vector) > match_threshold
  ORDER BY c.embedding <=> query_embedding::vector
  LIMIT match_count;
END;
$$;

COMMIT;
