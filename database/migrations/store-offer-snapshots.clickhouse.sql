CREATE TABLE IF NOT EXISTS ggetracker_global.store_offer_snapshots
(
    snapshot_date Date,
    currency LowCardinality(String),
    level UInt8,
    legendary_level UInt16,
    category LowCardinality(String),
    offer_id String,
    name String,
    price UInt32,
    bonus Int32,
    rewards String,
    collected_at DateTime
)
ENGINE = ReplacingMergeTree(collected_at)
PARTITION BY toYYYYMM(snapshot_date)
ORDER BY (currency, level, legendary_level, category, offer_id, snapshot_date);
