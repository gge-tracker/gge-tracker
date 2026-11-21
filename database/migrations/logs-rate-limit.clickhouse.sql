ALTER TABLE logs.logs ADD COLUMN IF NOT EXISTS rate_limit LowCardinality(String) DEFAULT '';
