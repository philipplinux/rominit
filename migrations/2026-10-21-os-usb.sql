-- Authenticated CLI-reported OS USB outcomes. Rows intentionally contain no account
-- identifiers, hashes, serials, paths, hostnames or free-form diagnostics.
CREATE TABLE os_usb_runs (
  job_id TEXT PRIMARY KEY CHECK (length(job_id) = 43 AND job_id NOT GLOB '*[^A-Za-z0-9_-]*'),
  method TEXT NOT NULL CHECK (method IN ('ventoy', 'direct')),
  action TEXT NOT NULL CHECK (action IN ('install', 'copy', 'direct')),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failed')),
  image_id TEXT NOT NULL,
  image_name TEXT NOT NULL,
  image_size INTEGER NOT NULL CHECK (image_size BETWEEN 0 AND 70368744177664),
  source_verification TEXT NOT NULL CHECK (source_verification IN ('verified', 'mismatch-accepted', 'none')),
  drive_capacity INTEGER NOT NULL CHECK (drive_capacity > 0),
  readback_size INTEGER CHECK (readback_size BETWEEN 0 AND 70368744177664),
  readback_matched INTEGER CHECK (readback_matched IN (0, 1)),
  failure_code TEXT CHECK (failure_code IN ('preflight', 'device_changed', 'unmount', 'write', 'timeout', 'readback', 'unknown')),
  at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((image_id = 'none' AND image_name = 'No ISO' AND image_size = 0 AND source_verification = 'none') OR
         (image_id <> 'none' AND image_name <> 'No ISO' AND image_size > 0 AND source_verification <> 'none')),
  CHECK ((method = 'ventoy' AND action IN ('install', 'copy')) OR (method = 'direct' AND action = 'direct')),
  CHECK (action <> 'copy' OR image_id <> 'none'),
  CHECK (method <> 'direct' OR image_id <> 'none'),
  CHECK ((readback_size IS NULL AND readback_matched IS NULL) OR (readback_size IS NOT NULL AND readback_matched IS NOT NULL)),
  CHECK ((outcome = 'success' AND failure_code IS NULL AND
            ((image_id = 'none' AND readback_size IS NULL) OR
             (image_id <> 'none' AND readback_matched = 1 AND readback_size = image_size AND image_size <= drive_capacity))) OR
         (outcome = 'failed' AND failure_code IS NOT NULL))
);
CREATE INDEX os_usb_runs_outcome_at ON os_usb_runs (outcome, at DESC);

DROP VIEW IF EXISTS inbox;
CREATE VIEW inbox AS
  SELECT inbox, ref, at, subject, body FROM (
    SELECT 'benchmarks' AS inbox, code AS ref, submitted AS at, rom AS subject,
      json_object('final', json(final), 'note', note, 'flash', flash, 'via', via, 'output', output) AS body
      FROM bench_runs WHERE submitted IS NOT NULL
    UNION ALL
    SELECT 'reports', CAST(id AS TEXT), at, page, text FROM reports
    UNION ALL
    SELECT 'requests-' || kind, CAST(id AS TEXT), at, page, json_object('kind', kind, 'rom', rom, 'url', url, 'text', text) FROM requests
    UNION ALL
    SELECT 'failures', CAST(id AS TEXT), at, rom, json_object('stage', stage, 'error', error, 'log', log) FROM flash_failures
    UNION ALL
    SELECT 'agents', r.id, r.finished, r.rom, json_object('outcome', r.outcome, 'resolution', r.resolution, 'host', r.host, 'tools', r.tools, 'version', r.version,
      'steps', (SELECT json_group_array(json_object('stage', s.stage, 'step', s.step, 'outcome', s.outcome, 'detail', s.detail)) FROM agent_steps s WHERE s.run_id = r.id))
      FROM agent_runs r WHERE r.finished IS NOT NULL
  ) existing_inboxes
  UNION ALL
  SELECT 'os-usb', job_id, at, 'OS USB', json_object('method', method, 'action', action, 'outcome', outcome,
    'image', json_object('id', image_id, 'name', image_name, 'size', image_size),
    'verification', json_object('source', source_verification), 'drive', json_object('capacityBytes', drive_capacity),
    'readback', CASE WHEN readback_size IS NULL THEN NULL ELSE json_object('size', readback_size, 'matched', readback_matched = 1) END,
    'failureCode', failure_code)
    FROM os_usb_runs;
