CREATE TABLE IF NOT EXISTS ggetracker_global.rift_raid_division_rounds
(
    game              LowCardinality(String),
    event_id          UInt16,
    division_round_id Int32,
    server            LowCardinality(String),
    seen_at           DateTime
)
ENGINE = ReplacingMergeTree(seen_at)
ORDER BY (game, event_id);
