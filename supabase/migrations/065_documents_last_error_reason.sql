-- 065_documents_last_error_reason.sql
--
-- Diagnostic visibility for document-indexing failures.
--
-- When indexDocumentInBackground (Next `after()`) fails, failDocument
-- flips the row to status='error' but the user only sees a generic
-- "Couldn't index" toast. The actual failure (scanned PDF, OpenAI
-- rate limit, parse timeout, etc.) is buried in Vercel function logs
-- and a field report turns into a 30-min grep.
--
-- This column persists the failure reason so:
--   • The watcher can show a specific toast ("…couldn't read text from
--     the PDF — looks like a scan").
--   • Support reports include the actual cause without a log dive.
--
-- Idempotent: `IF NOT EXISTS` so re-running this migration is a no-op.

ALTER TABLE aft_documents
  ADD COLUMN IF NOT EXISTS last_error_reason TEXT;
