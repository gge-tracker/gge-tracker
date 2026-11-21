CREATE DATABASE IF NOT EXISTS `empire_ranking`;
CREATE TABLE IF NOT EXISTS empire_ranking.event_dates
(
    `table_name` String,
    `created_at` DateTime
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (table_name, created_at)
SETTINGS index_granularity = 8192, storage_policy = 'default'
;
CREATE TABLE IF NOT EXISTS empire_ranking.player_event_berimond_invasion_history
(
    `player_id` UInt32,
    `point` UInt64,
    `created_at` DateTime
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (player_id, created_at)
SETTINGS index_granularity = 8192, storage_policy = 'default'
;
CREATE TABLE IF NOT EXISTS empire_ranking.player_event_berimond_kingdom_history
(
    `player_id` UInt32,
    `point` UInt64,
    `created_at` DateTime
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (player_id, created_at)
SETTINGS index_granularity = 8192, storage_policy = 'default'
;
CREATE TABLE IF NOT EXISTS empire_ranking.player_event_bloodcrow_history
(
    `player_id` UInt32,
    `point` UInt64,
    `created_at` DateTime
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (player_id, created_at)
SETTINGS index_granularity = 8192, storage_policy = 'default'
;
CREATE TABLE IF NOT EXISTS empire_ranking.player_event_nomad_history
(
    `player_id` UInt32,
    `point` UInt64,
    `created_at` DateTime
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (player_id, created_at)
SETTINGS index_granularity = 8192, storage_policy = 'default'
;
CREATE TABLE IF NOT EXISTS empire_ranking.player_event_samurai_history
(
    `player_id` UInt32,
    `point` UInt64,
    `created_at` DateTime
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (player_id, created_at)
SETTINGS index_granularity = 8192, storage_policy = 'default'
;
CREATE TABLE IF NOT EXISTS empire_ranking.player_event_war_realms_history
(
    `player_id` UInt32,
    `point` UInt64,
    `created_at` DateTime
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (player_id, created_at)
SETTINGS index_granularity = 8192, storage_policy = 'default'
;
CREATE TABLE IF NOT EXISTS empire_ranking.player_loot_history
(
    `player_id` UInt32,
    `point` UInt64,
    `created_at` DateTime
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (player_id, created_at)
SETTINGS index_granularity = 8192, storage_policy = 'default'
;
CREATE TABLE IF NOT EXISTS empire_ranking.player_metrics
(
    `player_id` UInt32,
    `metric_id` UInt8 CODEC(T64, ZSTD(1)),
    `value` UInt64 CODEC(T64, ZSTD(1)),
    `collected_at` DateTime CODEC(Delta(4), ZSTD(1))
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(collected_at)
ORDER BY (player_id, metric_id, collected_at)
SETTINGS index_granularity = 8192
;
CREATE TABLE IF NOT EXISTS empire_ranking.player_might_history
(
    `player_id` UInt32,
    `point` UInt64,
    `created_at` DateTime
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(toDate(created_at))
ORDER BY (player_id, created_at)
SETTINGS storage_policy = 'default', index_granularity = 8192
;
CREATE TABLE IF NOT EXISTS empire_ranking.wheel_unimaginable_affluence
(
    `player_id` UInt32,
    `point` UInt16,
    `created_at` DateTime,
    INDEX idx_created_at created_at TYPE minmax GRANULARITY 4,
    INDEX idx_player_id player_id TYPE minmax GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (player_id, created_at)
SETTINGS index_granularity = 8192
;
