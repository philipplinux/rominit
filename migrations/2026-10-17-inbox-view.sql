-- Benchmark items in the inbox view also carry flash (how the ROM got on the phone) and via ('cli' or NULL = site).
DROP VIEW IF EXISTS inbox;
CREATE VIEW inbox AS
  SELECT 'benchmarks' AS inbox, code AS ref, submitted AS at, rom AS subject, json_object('final', json(final), 'note', note, 'flash', flash, 'via', via, 'output', output) AS body FROM bench_runs WHERE submitted IS NOT NULL
  UNION ALL
  SELECT 'reports', CAST(id AS TEXT), at, page, text FROM reports
  UNION ALL
  SELECT 'failures', CAST(id AS TEXT), at, rom, json_object('stage', stage, 'error', error, 'log', log) FROM flash_failures
  UNION ALL
  SELECT 'agents', r.id, r.finished, r.rom, json_object('outcome', r.outcome, 'resolution', r.resolution, 'host', r.host, 'tools', r.tools, 'version', r.version,
    'steps', (SELECT json_group_array(json_object('stage', s.stage, 'step', s.step, 'outcome', s.outcome, 'detail', s.detail)) FROM agent_steps s WHERE s.run_id = r.id))
  FROM agent_runs r WHERE r.finished IS NOT NULL;
