enum GgeTrackerApiGuardActivityDefaultParametersEnum {
  LOG_MAX_ENTRIES = 1000,
  LOG_MAX_BYTES = 512 * 1024,
  LOG_FLUSH_INTERVAL_MS = 5000,
  LOKI_MAX_RETRIES = 5,
  LOKI_RETRY_BASE_MS = 500,
  IP_WINDOW_MS = 60_000,
  DECAY_INTERVAL_MS = 10_000,
  DECAY_FACTOR = 0.5,
  LOKI_URL = 'http://localhost:3100/loki/api/v1/push',
  IP_THRESHOLD = 10,
  NODE_ENV = 'development',
}

export class GgeTrackerApiGuardActivityDefaultParameters {
  protected LOG_MAX_ENTRIES = Number.parseInt(
    process.env.LOG_MAX_ENTRIES || GgeTrackerApiGuardActivityDefaultParametersEnum.LOG_MAX_ENTRIES.toString(),
    10,
  );
  protected LOG_MAX_BYTES = Number.parseInt(
    process.env.LOG_MAX_BYTES || GgeTrackerApiGuardActivityDefaultParametersEnum.LOG_MAX_BYTES.toString(),
    10,
  );
  protected LOG_FLUSH_INTERVAL_MS = Number.parseInt(
    process.env.LOG_FLUSH_INTERVAL_MS ||
      GgeTrackerApiGuardActivityDefaultParametersEnum.LOG_FLUSH_INTERVAL_MS.toString(),
    10,
  );
  protected LOKI_MAX_RETRIES = Number.parseInt(
    process.env.LOKI_MAX_RETRIES || GgeTrackerApiGuardActivityDefaultParametersEnum.LOKI_MAX_RETRIES.toString(),
    10,
  );
  protected LOKI_RETRY_BASE_MS = Number.parseInt(
    process.env.LOKI_RETRY_BASE_MS || GgeTrackerApiGuardActivityDefaultParametersEnum.LOKI_RETRY_BASE_MS.toString(),
    10,
  );
  protected IP_WINDOW_MS = Number.parseInt(
    process.env.IP_WINDOW_MS || GgeTrackerApiGuardActivityDefaultParametersEnum.IP_WINDOW_MS.toString(),
    10,
  );
  protected DECAY_INTERVAL_MS = Number.parseInt(
    process.env.DECAY_INTERVAL_MS || GgeTrackerApiGuardActivityDefaultParametersEnum.DECAY_INTERVAL_MS.toString(),
    10,
  );
  protected DECAY_FACTOR = Number.parseFloat(
    process.env.DECAY_FACTOR || GgeTrackerApiGuardActivityDefaultParametersEnum.DECAY_FACTOR.toString(),
  );
  protected LOKI_URL = `http://${process.env.LOKI_HOST}:${process.env.LOKI_PORT}/loki/api/v1/push`;
  protected IP_THRESHOLD = Number.parseInt(
    process.env.IP_THRESHOLD || GgeTrackerApiGuardActivityDefaultParametersEnum.IP_THRESHOLD.toString(),
    10,
  );
  protected NODE_ENV = process.env.NODE_ENV || GgeTrackerApiGuardActivityDefaultParametersEnum.NODE_ENV;
}
