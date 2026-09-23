CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS responses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status            TEXT NOT NULL DEFAULT 'submitted'
                      CHECK (status IN ('partial','submitted')),
  session_token     TEXT,
  submitted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_hash           TEXT,
  user_agent        TEXT,
  age               INT CHECK (age IS NULL OR (age >= 15 AND age <= 70)),
  gender            TEXT,
  year_of_study     TEXT,
  residence         TEXT,
  kn1               BOOLEAN,
  kn2               BOOLEAN,
  kn3               BOOLEAN,
  kn4               BOOLEAN,
  substances        JSONB NOT NULL DEFAULT '{}'::jsonb,
  other_substance   TEXT,
  attitudes         JSONB NOT NULL DEFAULT '{}'::jsonb,
  perceived_effects TEXT,
  consent_given     BOOLEAN NOT NULL DEFAULT false,
  duration_secs     INT
);




CREATE INDEX IF NOT EXISTS idx_responses_status    ON responses(status);
CREATE INDEX IF NOT EXISTS idx_responses_submitted ON responses(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_responses_khat_ever ON responses ((substances->'khat'->>'c1'));
CREATE INDEX IF NOT EXISTS idx_responses_session   ON responses(session_token);

CREATE TABLE IF NOT EXISTS draft_progress (
  session_token  TEXT PRIMARY KEY,
  step_reached   INT NOT NULL DEFAULT 1,
  total_steps    INT NOT NULL DEFAULT 7,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_hash        TEXT,
  completed      BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_draft_completed ON draft_progress(completed);
CREATE INDEX IF NOT EXISTS idx_draft_last_act  ON draft_progress(last_activity DESC);

CREATE OR REPLACE VIEW v_response_summary AS
SELECT
  COUNT(*) FILTER (WHERE status = 'submitted')                          AS submitted_total,
  COUNT(*) FILTER (WHERE status = 'submitted'
                     AND submitted_at::date = CURRENT_DATE)             AS submitted_today,
  COUNT(*) FILTER (WHERE status = 'submitted'
                     AND substances->'khat'->>'c1' = 'Yes')             AS khat_ever_users,
  MAX(submitted_at) FILTER (WHERE status = 'submitted')                 AS latest_submission
FROM responses;