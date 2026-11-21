CREATE DATABASE IF NOT EXISTS `ggetracker_global`;
CREATE TABLE IF NOT EXISTS ggetracker_global.outer_realms_ranking
(
    `player_id` UInt32,
    `player_name` String,
    `server` LowCardinality(String),
    `score` UInt32,
    `rank` UInt16,
    `level` UInt8,
    `legendary_level` UInt16,
    `might` UInt32,
    `castle_position_x` Nullable(Int16),
    `castle_position_y` Nullable(Int16),
    `fetch_date` DateTime,
    `player_name_lower` String DEFAULT lower(player_name),
    INDEX idx_rank rank TYPE minmax GRANULARITY 1,
    INDEX idx_score score TYPE minmax GRANULARITY 1,
    INDEX idx_player_name player_name TYPE bloom_filter GRANULARITY 4,
    INDEX idx_player_name_lower player_name_lower TYPE ngrambf_v1(3, 256, 1024, 0) GRANULARITY 2,
    PROJECTION proj_by_server_date_rank
    (
        SELECT *
        ORDER BY
            server,
            fetch_date,
            rank
    )
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(fetch_date)
ORDER BY (server, fetch_date, rank)
SETTINGS index_granularity = 8192
;
CREATE TABLE IF NOT EXISTS ggetracker_global.rift_raid_ranking
(
    `game` LowCardinality(String),
    `event_id` UInt16,
    `created_at` DateTime,
    `division_id` UInt8,
    `subdivision_id` UInt16,
    `rank` UInt16,
    `server_id` UInt16,
    `alliance_id` UInt32,
    `alliance_name` String,
    `score` UInt64,
    PROJECTION proj_by_alliance
    (
        SELECT *
        ORDER BY
            game,
            alliance_id,
            server_id,
            event_id,
            created_at
    )
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (game, created_at, division_id, subdivision_id, rank)
SETTINGS index_granularity = 8192
;
CREATE TABLE IF NOT EXISTS ggetracker_global.rift_raid_hours
(
    `game` LowCardinality(String),
    `event_id` UInt16,
    `hour` DateTime
)
ENGINE = ReplacingMergeTree
PARTITION BY tuple()
ORDER BY (game, event_id, hour)
SETTINGS index_granularity = 8192
;
