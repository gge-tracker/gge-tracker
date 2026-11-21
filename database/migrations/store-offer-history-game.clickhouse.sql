CREATE TABLE ggetracker_global.store_offer_history_with_game
(
    `snapshot_at` DateTime,
    `game` LowCardinality(String) DEFAULT 'ep',
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
ORDER BY (game, currency, level, legendary_level, category, offer_id, snapshot_at);

INSERT INTO ggetracker_global.store_offer_history_with_game
SELECT
    snapshot_at, 'ep' AS game, currency, level, legendary_level, category, offer_id, name, price, price_currency,
    price_source, approximate_price, bonus, rewards, offer, reference_fetched_at, collected_at
FROM ggetracker_global.store_offer_history;

RENAME TABLE
    ggetracker_global.store_offer_history TO ggetracker_global.store_offer_history_before_game,
    ggetracker_global.store_offer_history_with_game TO ggetracker_global.store_offer_history;
