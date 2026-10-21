-- Optional, validated technical diagnostics; existing anonymous reports remain intact.
ALTER TABLE os_usb_runs ADD COLUMN environment TEXT CHECK (environment IS NULL OR json_valid(environment));

DROP VIEW IF EXISTS inbox;
CREATE VIEW IF NOT EXISTS inbox AS
  SELECT inbox, ref, at, subject, body FROM (
    SELECT 'benchmarks' AS inbox, code AS ref, submitted AS at, rom AS subject, json_object('final', json(final), 'note', note, 'flash', flash, 'via', via, 'output', output) AS body FROM bench_runs WHERE submitted IS NOT NULL
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
    'failureCode', failure_code, 'environment', json(environment))
  FROM os_usb_runs;
