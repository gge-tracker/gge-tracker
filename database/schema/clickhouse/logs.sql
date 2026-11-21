CREATE DATABASE IF NOT EXISTS `logs`;
CREATE TABLE IF NOT EXISTS logs.logs
(
    `timestamp` DateTime,
    `job` String,
    `server` String,
    `method` String,
    `status` UInt16,
    `route` String,
    `url` String,
    `response_time` Float32,
    `user_agent` String,
    `ip` String
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (job, server, timestamp)
SETTINGS index_granularity = 8192
;
CREATE TABLE IF NOT EXISTS logs.scrapes
(
    `server` String,
    `timestamp` DateTime,
    `durationMs` UInt32,
    `playersCreated` UInt32,
    `alliancesCreated` UInt32,
    `playersAllianceUpdated` UInt32,
    `alliancesUpdated` UInt32,
    `criticalErrors` UInt32,
    `playerCount` UInt32,
    `allianceCount` UInt32,
    `startTime` DateTime MATERIALIZED timestamp - toIntervalMillisecond(durationMs)
)
ENGINE = MergeTree
ORDER BY (server, timestamp)
SETTINGS index_granularity = 8192
;
