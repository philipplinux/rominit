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
  at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
