-- Who sent the test: 'cli' = the rominit CLI (admin inbox folders CLI-Bench / Bench-only), NULL = the site. Earlier CLI cards move over by their note.
ALTER TABLE bench_runs ADD COLUMN via TEXT;
UPDATE bench_runs SET via = 'cli' WHERE note LIKE 'Sent automatically by the rominit CLI%';
