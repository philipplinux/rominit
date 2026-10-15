CREATE TABLE IF NOT EXISTS ratings (
  rom TEXT NOT NULL,   -- <codename>/<rom id>
  voter TEXT NOT NULL, -- SHA-256 of SALT + address, never the address itself
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (rom, voter)
);
