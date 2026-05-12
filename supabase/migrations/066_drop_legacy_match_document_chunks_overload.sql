-- 066_drop_legacy_match_document_chunks_overload.sql
--
-- Field report (2026-05-12): Howard's `search_documents` tool was
-- consistently failing with:
--   "Could not choose the best candidate function between:
--      public.match_document_chunks(query_embedding => public.vector, ...),
--      public.match_document_chunks(query_embedding => text, ...)"
--
-- Root cause: both overloads exist on prod.
--   • Migration 008 created `match_document_chunks(vector(1536), uuid, ...)`.
--   • Migration 026 added `match_document_chunks(text, uuid, ...)` via
--     `CREATE OR REPLACE FUNCTION`, but `OR REPLACE` only replaces when
--     the FULL signature matches — different first-arg type → new
--     overload created alongside the old one, both retained.
--
-- The client (`src/lib/howard/toolHandlers.ts` search_documents) passes
-- `JSON.stringify(queryEmbedding)` — a text — so PostgreSQL has two
-- candidates with text-compatible first args and can't pick.
--
-- Fix: drop the old `(vector, ...)` overload. The `(text, ...)` version
-- handles the cast to vector internally.
--
-- Idempotent: `IF EXISTS` so re-running is a no-op.

DROP FUNCTION IF EXISTS public.match_document_chunks(vector, uuid, integer, double precision);
-- Belt + suspenders — Supabase sometimes registers `vector(1536)`
-- as a distinct signature.
DROP FUNCTION IF EXISTS public.match_document_chunks(vector(1536), uuid, integer, double precision);
