-- Run once on databases created before accounts; schema.sql has the columns for new ones.
ALTER TABLE comments ADD COLUMN user_id INTEGER;
ALTER TABLE comments ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
