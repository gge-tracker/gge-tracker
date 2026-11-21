CREATE TABLE IF NOT EXISTS rift_raid_ranking
(
    game           LowCardinality(String),
    event_id       UInt16,
    created_at     DateTime,
    division_id    UInt8,
    subdivision_id UInt16,
    rank           UInt16,
    server_id      UInt16,
    alliance_id    UInt32,
    alliance_name  String,
    score          UInt64,
    PROJECTION proj_by_alliance
    (
        SELECT *
        ORDER BY game, alliance_id, server_id, event_id, created_at
    )
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (game, created_at, division_id, subdivision_id, rank)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS rift_raid_hours
(
    game     LowCardinality(String),
    event_id UInt16,
    hour     DateTime
)
ENGINE = ReplacingMergeTree
PARTITION BY tuple()
ORDER BY (game, event_id, hour);

