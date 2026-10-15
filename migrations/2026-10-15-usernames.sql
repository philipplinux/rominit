-- Run once on databases created before picked usernames; schema.sql has the column for new ones.
ALTER TABLE users ADD COLUMN name_chosen INTEGER NOT NULL DEFAULT 0;
