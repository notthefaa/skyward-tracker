-- =============================================================
-- Migration 008: Aircraft Documents + Vector Search (pgvector)
-- =============================================================
-- Run in the Supabase SQL Editor.
-- PREREQUISITE: Enable pgvector extension first:
--   CREATE EXTENSION IF NOT EXISTS vector;
-- =============================================================

-- 0. Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Document metadata (per-aircraft, shared with all users who have access)
CREATE TABLE IF NOT EXISTS aft_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id  uuid NOT NULL REFERENCES aft_aircraft(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  filename     text NOT NULL,
  file_url     text NOT NULL,
  doc_type     text NOT NULL CHECK (doc_type IN ('POH', 'AFM', 'Supplement', 'MEL', 'SOP', 'Other')),
  page_count   integer,
  status       text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'error')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_aircraft
  ON aft_documents (aircraft_id, created_at DESC);

-- 2. Document chunks with vector embeddings
CREATE TABLE IF NOT EXISTS aft_document_chunks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   uuid NOT NULL REFERENCES aft_documents(id) ON DELETE CASCADE,
  chunk_index   integer NOT NULL,
  content       text NOT NULL,
  embedding     vector(1536),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chunks_document
  ON aft_document_chunks (document_id, chunk_index ASC);

-- Vector similarity index (IVFFlat for fast approximate search)
-- Note: This index is created after some data exists. For initial setup,
-- we use exact search. Uncomment after inserting first ~1000 chunks:
-- CREATE INDEX IF NOT EXISTS idx_chunks_embedding
--   ON aft_document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 3. Similarity search function
CREATE OR REPLACE FUNCTION match_document_chunks(
  query_embedding vector(1536),
  match_aircraft_id uuid,
  match_count int DEFAULT 5,
  match_threshold float DEFAULT 0.3
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  chunk_index int,
  content text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    dc.id,
    dc.document_id,
    dc.chunk_index,
    dc.content,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM aft_document_chunks dc
  JOIN aft_documents d ON d.id = dc.document_id
  WHERE d.aircraft_id = match_aircraft_id
    AND d.status = 'ready'
    AND 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- 4. Enable RLS
ALTER TABLE aft_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE aft_document_chunks ENABLE ROW LEVEL SECURITY;

-- 5. SELECT policies (users with aircraft access)
CREATE POLICY "documents_select" ON aft_documents FOR SELECT
  USING (aircraft_id IN (
    SELECT aircraft_id FROM aft_user_aircraft_access WHERE user_id = auth.uid()
  ));
CREATE POLICY "chunks_select" ON aft_document_chunks FOR SELECT
  USING (document_id IN (
    SELECT id FROM aft_documents WHERE aircraft_id IN (
      SELECT aircraft_id FROM aft_user_aircraft_access WHERE user_id = auth.uid()
    )
  ));

-- 6. INSERT policies (users with aircraft access)
CREATE POLICY "documents_insert" ON aft_documents FOR INSERT
  WITH CHECK (aircraft_id IN (
    SELECT aircraft_id FROM aft_user_aircraft_access WHERE user_id = auth.uid()
  ));
CREATE POLICY "chunks_insert" ON aft_document_chunks FOR INSERT
  WITH CHECK (document_id IN (
    SELECT id FROM aft_documents WHERE aircraft_id IN (
      SELECT aircraft_id FROM aft_user_aircraft_access WHERE user_id = auth.uid()
    )
  ));
