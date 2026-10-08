CREATE TABLE IF NOT EXISTS fund_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  broker_balance NUMERIC(18,8),
  broker_equity NUMERIC(18,8),
  currency TEXT NOT NULL DEFAULT 'USD',
  withdrawal_offset NUMERIC(18,8) NOT NULL DEFAULT 0,
  last_fund_balance NUMERIC(18,8),
  updated_at TIMESTAMPTZ
);

INSERT INTO fund_state (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS members (
  slug TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  capital NUMERIC(18,8) NOT NULL DEFAULT 0
);

INSERT INTO members (slug, display_name, capital) VALUES
  ('micky', 'Micky', 0),
  ('doc', 'Doc', 0),
  ('hacky', 'Hacky', 0)
ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  member_slug TEXT NOT NULL REFERENCES members(slug) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
