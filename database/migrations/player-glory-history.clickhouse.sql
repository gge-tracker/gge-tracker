CREATE TABLE IF NOT EXISTS player_glory_history
(
    `player_id` UInt32,
    `point` UInt64 CODEC(Delta, ZSTD(1)),
    `created_at` DateTime CODEC(DoubleDelta, ZSTD(1))
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(toDate(created_at))
ORDER BY (player_id, created_at)
TTL created_at + toIntervalMonth(3) TO VOLUME 'cold'
SETTINGS storage_policy = 'hot_and_cold', index_granularity = 8192;
