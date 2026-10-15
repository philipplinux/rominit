CREATE TABLE IF NOT EXISTS searches (
  q TEXT NOT NULL,     -- the device search as typed, lower-cased, <= 60 chars
  hits INTEGER NOT NULL, -- devices it matched; 0 = a phone we are missing
  voter TEXT NOT NULL, -- salted address hash, for the dedupe window only
  at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS searches_q ON searches (q, voter, at);
