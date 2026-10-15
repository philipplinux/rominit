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
  at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  name TEXT NOT NULL,
  email TEXT,
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
