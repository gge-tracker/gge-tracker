CREATE TABLE IF NOT EXISTS ggetracker_global.outer_realms_ranking_e4k
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
SETTINGS index_granularity = 8192;
