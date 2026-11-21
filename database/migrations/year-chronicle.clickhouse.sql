CREATE TABLE IF NOT EXISTS ggetracker_global.year_chronicle
(
    `year` UInt16,
    `server` LowCardinality(String),
    `player_id` UInt32,
    `name` String,
    `tier` LowCardinality(String),
    `persona` LowCardinality(String),
    `payload` String CODEC(ZSTD(3)),
    `built_at` DateTime
)
ENGINE = MergeTree
PARTITION BY year
ORDER BY (year, server, player_id, built_at);

CREATE TABLE IF NOT EXISTS ggetracker_global.year_chronicle_server
(
    `year` UInt16,
    `server` LowCardinality(String),
    `tier` LowCardinality(String),
    `tracked_days` UInt16,
    `data_from` DateTime,
    `data_until` DateTime,
    `players` UInt32,
    `full_players` UInt32,
    `built_at` DateTime
)
ENGINE = MergeTree
PARTITION BY year
ORDER BY (year, server, built_at);
