-- One-use browser approval for the local CLI. Stores no grant code or CLI verifier.
CREATE TABLE IF NOT EXISTS helper_grants (
  code_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  challenge TEXT NOT NULL,
  expires TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS helper_grants_user_expiry ON helper_grants (user_id, expires);
CREATE INDEX IF NOT EXISTS helper_grants_expiry ON helper_grants (expires);
