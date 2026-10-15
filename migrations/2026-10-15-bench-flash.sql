-- How the tested ROM got on the phone, as this browser saw it: verified (through ROMinit, hashes matched),
-- unmatched (through ROMinit with skip verification: not the listed image), elsewhere (marked flashed another way), NULL unknown.
ALTER TABLE bench_runs ADD COLUMN flash TEXT;
