ALTER TABLE logs.logs
    ADD COLUMN IF NOT EXISTS country LowCardinality(String) DEFAULT '',
    ADD COLUMN IF NOT EXISTS origin LowCardinality(String) DEFAULT '',
    ADD COLUMN IF NOT EXISTS referer String DEFAULT '',
    ADD COLUMN IF NOT EXISTS page LowCardinality(String) DEFAULT '';
