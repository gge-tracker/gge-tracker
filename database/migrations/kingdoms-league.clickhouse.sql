CREATE TABLE IF NOT EXISTS ggetracker_global.kingdoms_league_days
(
    `server` LowCardinality(String),
    `season_id` UInt16,
    `day` Date,
    `ranked_players` UInt32,
    `ranked_alliances` UInt32,
    `top_gold` UInt16,
    `top_signature` String CODEC(ZSTD(3)),
    `collected_at` DateTime
)
ENGINE = ReplacingMergeTree(collected_at)
ORDER BY (server, day);

CREATE TABLE IF NOT EXISTS ggetracker_global.kingdoms_league_players
(
    `server` LowCardinality(String),
    `season_id` UInt16,
    `day` Date,
    `rank` UInt32 CODEC(Delta, ZSTD(1)),
    `player_id` UInt32,
    `player_name` String CODEC(ZSTD(3)),
    `alliance_id` Int32,
    `alliance_name` String CODEC(ZSTD(3)),
    `title` UInt8,
    `gold` UInt16,
    `silver` UInt16,
    `bronze` UInt16,
    `collected_at` DateTime CODEC(DoubleDelta, ZSTD(1))
)
ENGINE = ReplacingMergeTree(collected_at)
PARTITION BY toYYYYMM(day)
ORDER BY (server, season_id, day, rank)
TTL day + toIntervalMonth(3) TO VOLUME 'cold'
SETTINGS storage_policy = 'hot_and_cold', index_granularity = 8192;

CREATE TABLE IF NOT EXISTS ggetracker_global.kingdoms_league_alliances
(
    `server` LowCardinality(String),
    `season_id` UInt16,
    `day` Date,
    `rank` UInt32 CODEC(Delta, ZSTD(1)),
    `alliance_id` UInt32,
    `alliance_name` String CODEC(ZSTD(3)),
    `gold` UInt16,
    `silver` UInt16,
    `bronze` UInt16,
    `collected_at` DateTime CODEC(DoubleDelta, ZSTD(1))
)
ENGINE = ReplacingMergeTree(collected_at)
PARTITION BY toYYYYMM(day)
ORDER BY (server, season_id, day, rank)
TTL day + toIntervalMonth(3) TO VOLUME 'cold'
SETTINGS storage_policy = 'hot_and_cold', index_granularity = 8192;
