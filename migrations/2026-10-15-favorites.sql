-- Run once on databases created before favorites.
CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL, -- users.id
  rom TEXT NOT NULL,        -- <codename>/<rom id>
  at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, rom)
);
