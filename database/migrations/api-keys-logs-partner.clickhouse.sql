ALTER TABLE logs.logs ADD COLUMN IF NOT EXISTS partner LowCardinality(String) DEFAULT '';

