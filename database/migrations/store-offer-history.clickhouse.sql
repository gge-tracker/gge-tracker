CREATE TABLE IF NOT EXISTS ggetracker_global.store_offer_history
(
    `snapshot_at` DateTime,
    `currency` LowCardinality(String),
    `level` UInt8,
    `legendary_level` UInt16,
    `category` LowCardinality(String),
    `offer_id` String,
    `name` String,
    `price` UInt32,
    `price_currency` LowCardinality(String),
    `price_source` LowCardinality(String),
    `approximate_price` UInt8,
    `bonus` Int32,
    `rewards` String CODEC(ZSTD(3)),
    `offer` String CODEC(ZSTD(3)),
    `reference_fetched_at` DateTime,
    `collected_at` DateTime
)
ENGINE = ReplacingMergeTree(collected_at)
PARTITION BY toYYYYMM(snapshot_at)
ORDER BY (currency, level, legendary_level, category, offer_id, snapshot_at);

