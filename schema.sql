CREATE TABLE IF NOT EXISTS ratings (
  rom TEXT NOT NULL,   -- <codename>/<rom id>
  voter TEXT NOT NULL, -- SHA-256 of SALT + address, never the address itself
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (rom, voter)
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  rom TEXT NOT NULL,   -- <codename>/<rom id>
  voter TEXT NOT NULL, -- salted address hash, for the rate limit only; never sent to the page
  name TEXT NOT NULL,
  text TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_id INTEGER,                   -- users.id; NULL for comments from before accounts
  hidden INTEGER NOT NULL DEFAULT 0  -- set by an owner, moderator or admin of the ROM
);
CREATE INDEX IF NOT EXISTS comments_rom ON comments (rom, id);
CREATE TABLE IF NOT EXISTS comment_images (
  comment_id INTEGER PRIMARY KEY, -- comments.id
  data BLOB NOT NULL,             -- WebP, re-encoded in the browser, <= 400 KB
  approved INTEGER NOT NULL DEFAULT 0 -- served only once the owner sets 1
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY,
  page TEXT NOT NULL,  -- path + query of the page, e.g. /?device=starlte
  voter TEXT NOT NULL, -- salted address hash, for the rate limit only
  text TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  section TEXT -- which page section it is about ("2 · Custom recovery"), or NULL for the whole page
);

CREATE TABLE IF NOT EXISTS counts (
  rom TEXT NOT NULL,   -- <codename>/<rom id>
  kind TEXT NOT NULL CHECK (kind IN ('view', 'flash')),
  voter TEXT NOT NULL, -- salted address hash, for the dedupe window only
  at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS counts_rom ON counts (rom, kind, voter, at);

-- Accounts (functions/_lib/auth.js). Email is kept for admin matching only and never sent to the page.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,  -- google | github
  subject TEXT NOT NULL,   -- the provider's stable user id
  name TEXT NOT NULL,      -- shown on comments; the provider's name until the user picks one
  name_chosen INTEGER NOT NULL DEFAULT 0, -- 1 once picked: logins no longer overwrite it
  email TEXT,              -- never shown; only matched against ADMINS
  at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, subject)
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,  -- SHA-256 of the cookie value
  user_id INTEGER NOT NULL,
  expires TEXT NOT NULL
);
-- Granted by an admin only, after checking who the person is (owners: verified ROM maintainers).
CREATE TABLE IF NOT EXISTS roles (
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'moderator')),
  scope TEXT NOT NULL,     -- * | os:<os> | vendor:<vendor> | device:<codename> | rom:<codename>/<rom id>
  PRIMARY KEY (user_id, role, scope)
);

-- Phone tests: the page starts a run, the phone's script fetches and posts back through the run's code, the user corrects and submits.
-- Script fixes: SELECT rom, output FROM bench_runs WHERE output LIKE '% inconclusive %' (each line names the probe, exit code and error).
CREATE TABLE IF NOT EXISTS bench_runs (
  code TEXT PRIMARY KEY,   -- random, valid for an hour until submitted
  rom TEXT NOT NULL,
  voter TEXT NOT NULL,
  user_id INTEGER,
  created TEXT NOT NULL DEFAULT (datetime('now')),
  output TEXT,             -- what the script printed, up to 128 KB, package list included
  final TEXT,              -- JSON {feature: status} after the user's corrections
  note TEXT,
  submitted TEXT,
  accepted TEXT           -- set by an admin: the card's results now show on the ROM page
);

-- Inboxes, one per kind of incoming item: `benchmarks` (submitted phone tests), `reports` (page reports). Add one by adding a UNION arm.
-- An LLM (or a person) sorts each item with scripts/inbox.mjs; sorted items leave the inbox.
CREATE TABLE IF NOT EXISTS triage (
  inbox TEXT NOT NULL,
  ref TEXT NOT NULL,       -- bench_runs.code or reports.id
  label TEXT NOT NULL CHECK (label IN ('script-fix', 'catalog-update', 'site-bug', 'device-report', 'spam', 'other')),
  summary TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (inbox, ref)
);
CREATE VIEW IF NOT EXISTS inbox AS
  SELECT 'benchmarks' AS inbox, code AS ref, submitted AS at, rom AS subject, json_object('final', json(final), 'note', note, 'output', output) AS body FROM bench_runs WHERE submitted IS NOT NULL
  UNION ALL
  SELECT 'reports', CAST(id AS TEXT), at, page, text FROM reports;
CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL, -- users.id
  rom TEXT NOT NULL,        -- <codename>/<rom id>
  at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, rom)
);
CREATE TABLE IF NOT EXISTS searches (
  q TEXT NOT NULL,     -- the device search as typed, lower-cased, <= 60 chars
  hits INTEGER NOT NULL, -- devices it matched; 0 = a phone we are missing
  voter TEXT NOT NULL, -- salted address hash, for the dedupe window only
  at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS searches_q ON searches (q, voter, at);
