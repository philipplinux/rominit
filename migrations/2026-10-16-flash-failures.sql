CREATE TABLE IF NOT EXISTS flash_failures (
  id INTEGER PRIMARY KEY,
  rom TEXT NOT NULL,     -- <codename>/<rom id>
  stage INTEGER NOT NULL, -- 1-based stage number
  error TEXT NOT NULL,   -- the STOPPED line the user saw
  log TEXT NOT NULL,     -- the stage's debug log, serial numbers removed
  voter TEXT NOT NULL,   -- salted address hash, for the rate limit only
  at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
DROP VIEW IF EXISTS inbox;
CREATE VIEW inbox AS
  SELECT 'benchmarks' AS inbox, code AS ref, submitted AS at, rom AS subject, json_object('final', json(final), 'note', note, 'output', output) AS body FROM bench_runs WHERE submitted IS NOT NULL
  UNION ALL
  SELECT 'reports', CAST(id AS TEXT), at, page, text FROM reports
  UNION ALL
  SELECT 'failures', CAST(id AS TEXT), at, rom, json_object('stage', stage, 'error', error, 'log', log) FROM flash_failures;
