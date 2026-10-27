-- New entries from publisher release feeds (npm run feeds). Triage rows with inbox 'rss-<feed>' file them.
CREATE TABLE IF NOT EXISTS rss_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feed TEXT NOT NULL,      -- feed group: 'os-pc'
  source TEXT NOT NULL,    -- OS family (ROMvault page slug)
  guid TEXT NOT NULL,      -- entry id, else its link
  title TEXT NOT NULL,
  link TEXT,
  published TEXT,          -- as the feed states it
  at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (feed, guid)
);
