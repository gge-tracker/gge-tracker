const GUARD_ACTIVITY_FALLBACKS = {
  LOG_MAX_ENTRIES: 1000,
  LOG_MAX_BYTES: 512 * 1024,
  LOG_FLUSH_INTERVAL_MS: 5000,
  LOKI_MAX_RETRIES: 5,
  LOKI_RETRY_BASE_MS: 500,
  IP_WINDOW_MS: 60_000,
  DECAY_INTERVAL_MS: 10_000,
  DECAY_FACTOR: 0.5,
  IP_THRESHOLD: 10,
  NODE_ENV: 'development',
} as const;

export class GgeTrackerApiGuardActivityDefaultParameters {
  protected LOG_MAX_ENTRIES = Number.parseInt(
    process.env.LOG_MAX_ENTRIES || GUARD_ACTIVITY_FALLBACKS.LOG_MAX_ENTRIES.toString(),
    10,
  );
  protected LOG_MAX_BYTES = Number.parseInt(
    process.env.LOG_MAX_BYTES || GUARD_ACTIVITY_FALLBACKS.LOG_MAX_BYTES.toString(),
    10,
  );
  protected LOG_FLUSH_INTERVAL_MS = Number.parseInt(
    process.env.LOG_FLUSH_INTERVAL_MS || GUARD_ACTIVITY_FALLBACKS.LOG_FLUSH_INTERVAL_MS.toString(),
    10,
  );
  protected LOKI_MAX_RETRIES = Number.parseInt(
    process.env.LOKI_MAX_RETRIES || GUARD_ACTIVITY_FALLBACKS.LOKI_MAX_RETRIES.toString(),
    10,
  );
  protected LOKI_RETRY_BASE_MS = Number.parseInt(
    process.env.LOKI_RETRY_BASE_MS || GUARD_ACTIVITY_FALLBACKS.LOKI_RETRY_BASE_MS.toString(),
    10,
  );
  protected IP_WINDOW_MS = Number.parseInt(
    process.env.IP_WINDOW_MS || GUARD_ACTIVITY_FALLBACKS.IP_WINDOW_MS.toString(),
    10,
  );
  protected DECAY_INTERVAL_MS = Number.parseInt(
    process.env.DECAY_INTERVAL_MS || GUARD_ACTIVITY_FALLBACKS.DECAY_INTERVAL_MS.toString(),
    10,
  );
  protected DECAY_FACTOR = Number.parseFloat(
    process.env.DECAY_FACTOR || GUARD_ACTIVITY_FALLBACKS.DECAY_FACTOR.toString(),
  );
  protected LOKI_URL = `http://${process.env.LOKI_HOST}:${process.env.LOKI_PORT}/loki/api/v1/push`;
  protected IP_THRESHOLD = Number.parseInt(
    process.env.IP_THRESHOLD || GUARD_ACTIVITY_FALLBACKS.IP_THRESHOLD.toString(),
    10,
  );
  protected NODE_ENV = process.env.NODE_ENV || GUARD_ACTIVITY_FALLBACKS.NODE_ENV;
}
