-- Agent API: personal API tokens (agent reports only) and runs reported through the MCP (functions/mcp.js).
CREATE TABLE IF NOT EXISTS api_tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL, -- users.id
  name TEXT NOT NULL,       -- the user's label, e.g. "Claude Code on my laptop"
  hash TEXT NOT NULL UNIQUE, -- SHA-256 of the token; the token itself is shown once and never stored
  created TEXT NOT NULL DEFAULT (datetime('now')),
  expires TEXT NOT NULL,
  last_used TEXT,
  revoked TEXT
);
-- One flash or recovery attempt an agent reports: started from a recipe, steps logged, finished with the resolution.
-- MCP tool calls per hour, for the rate limit (functions/mcp.js); old hours are swept on the next hour's first call.
CREATE TABLE IF NOT EXISTS mcp_hits (
  who TEXT NOT NULL,       -- token:<api_tokens.id> or ip:<salted SHA-256 of the address>
  hour TEXT NOT NULL,      -- UTC, e.g. 2026-10-17T14
  n INTEGER NOT NULL,
  PRIMARY KEY (who, hour)
);
-- Device and procedure facts only; free text is checked for personal data before it is stored.
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,      -- random run id handed to the agent
  rom TEXT NOT NULL,        -- <codename>/<rom id>
  version TEXT,             -- the ROM's catalog version when the run started
  user_id INTEGER NOT NULL,
  token_id INTEGER NOT NULL,
  host TEXT,                -- linux | windows | macos | android | other
  tools TEXT,               -- e.g. "fastboot 35.0.2"
  created TEXT NOT NULL DEFAULT (datetime('now')),
  finished TEXT,
  outcome TEXT CHECK (outcome IN ('success', 'partial', 'failed', 'abandoned')),
  resolution TEXT           -- what fixed it / the best path the agent found
);
CREATE TABLE IF NOT EXISTS agent_steps (
  run_id TEXT NOT NULL,     -- agent_runs.id
  at TEXT NOT NULL DEFAULT (datetime('now')),
  stage INTEGER NOT NULL,   -- 1-based stage number in the recipe
  step INTEGER,             -- 1-based step number in the stage, NULL for the whole stage
  outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'failed', 'skipped', 'workaround')),
  detail TEXT               -- error line, bootloader version, the workaround used
);
CREATE INDEX IF NOT EXISTS agent_steps_run ON agent_steps (run_id, at);
DROP VIEW IF EXISTS inbox;
-- triage labels: add recipe-fix and user-side (the inbox offers them); SQLite changes a CHECK only by rebuilding the table.
CREATE TABLE triage_new (
  inbox TEXT NOT NULL,
  ref TEXT NOT NULL,       -- bench_runs.code, reports.id, flash_failures.id or agent_runs.id
  label TEXT NOT NULL CHECK (label IN ('script-fix', 'recipe-fix', 'user-side', 'catalog-update', 'site-bug', 'device-report', 'spam', 'other')),
  summary TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (inbox, ref)
);
INSERT INTO triage_new SELECT inbox, ref, label, summary, at FROM triage;
DROP TABLE triage;
ALTER TABLE triage_new RENAME TO triage;
CREATE VIEW inbox AS
  SELECT 'benchmarks' AS inbox, code AS ref, submitted AS at, rom AS subject, json_object('final', json(final), 'note', note, 'output', output) AS body FROM bench_runs WHERE submitted IS NOT NULL
  UNION ALL
  SELECT 'reports', CAST(id AS TEXT), at, page, text FROM reports
  UNION ALL
  SELECT 'failures', CAST(id AS TEXT), at, rom, json_object('stage', stage, 'error', error, 'log', log) FROM flash_failures
  UNION ALL
  SELECT 'agents', r.id, r.finished, r.rom, json_object('outcome', r.outcome, 'resolution', r.resolution, 'host', r.host, 'tools', r.tools, 'version', r.version,
    'steps', (SELECT json_group_array(json_object('stage', s.stage, 'step', s.step, 'outcome', s.outcome, 'detail', s.detail)) FROM agent_steps s WHERE s.run_id = r.id))
  FROM agent_runs r WHERE r.finished IS NOT NULL;
