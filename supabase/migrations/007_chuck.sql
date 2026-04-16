-- =============================================================
-- Migration 007: Chuck AI Chat (per-aircraft, per-user threads)
-- =============================================================
-- Run in the Supabase SQL Editor.
-- =============================================================

-- 1. Threads — one per user per aircraft
CREATE TABLE IF NOT EXISTS aft_chuck_threads (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id  uuid NOT NULL REFERENCES aft_aircraft(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  summary      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (aircraft_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chuck_threads_user
  ON aft_chuck_threads (user_id, updated_at DESC);

-- 2. Messages — full conversation log with token tracking
CREATE TABLE IF NOT EXISTS aft_chuck_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id           uuid NOT NULL REFERENCES aft_chuck_threads(id) ON DELETE CASCADE,
  role                text NOT NULL CHECK (role IN ('user', 'assistant')),
  content             text NOT NULL,
  tool_calls          jsonb,
  tool_results        jsonb,
  input_tokens        integer,
  output_tokens       integer,
  cache_read_tokens   integer,
  cache_create_tokens integer,
  model               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chuck_messages_thread
  ON aft_chuck_messages (thread_id, created_at ASC);

-- 3. Enable RLS
ALTER TABLE aft_chuck_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE aft_chuck_messages ENABLE ROW LEVEL SECURITY;

-- 4. Thread policies — users can read/create their own threads
CREATE POLICY "chuck_threads_select" ON aft_chuck_threads FOR SELECT
  USING (user_id = auth.uid());
CREATE POLICY "chuck_threads_insert" ON aft_chuck_threads FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- 5. Message policies — users can read/create messages in their threads
CREATE POLICY "chuck_messages_select" ON aft_chuck_messages FOR SELECT
  USING (thread_id IN (
    SELECT id FROM aft_chuck_threads WHERE user_id = auth.uid()
  ));
CREATE POLICY "chuck_messages_insert" ON aft_chuck_messages FOR INSERT
  WITH CHECK (thread_id IN (
    SELECT id FROM aft_chuck_threads WHERE user_id = auth.uid()
  ));
