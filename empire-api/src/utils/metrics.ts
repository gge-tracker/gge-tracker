import { performance } from 'node:perf_hooks';

export type GgeCommandOutcome = 'ok' | 'timeout' | 'not_found' | 'not_connected' | 'rejected';

export interface GgeSocketStats {
  messagesReceived: number;
  framesUnmatched: number;
  messagesSent: number;
  restarts: number;
  socketErrors: number;
  socketCloses: number;
  loginFailures: number;
  connectedSinceMs: number | null;
  lastMessageAtMs: number | null;
  roundTripMs: number | null;
}

export interface GgeMetricsSocket {
  metricsLabels: { server: string; type: string };
  metricsConnected: boolean;
  metricsState: string;
  metricsStats: GgeSocketStats;
  metricsResponseTimeoutMs: number;
  metricsCommandBudgets: { command: string; budgetMs: number }[];
}

export function createSocketStats(): GgeSocketStats {
  return {
    messagesReceived: 0,
    framesUnmatched: 0,
    messagesSent: 0,
    restarts: 0,
    socketErrors: 0,
    socketCloses: 0,
    loginFailures: 0,
    connectedSinceMs: null,
    lastMessageAtMs: null,
    roundTripMs: null,
  };
}

interface CommandSample {
  server: string;
  command: string;
  outcome: GgeCommandOutcome;
  count: number;
  durationSeconds: number;
}

const commandSamples = new Map<string, CommandSample>();
const serializedSamples = new Map<string, { server: string; command: string; count: number }>();
let eventLoopLagSeconds = 0;

export function recordCommand(
  server: string,
  command: string,
  outcome: GgeCommandOutcome,
  durationSeconds: number,
): void {
  const key = `${server} ${command} ${outcome}`;
  const sample = commandSamples.get(key) ?? { server, command, outcome, count: 0, durationSeconds: 0 };
  sample.count++;
  sample.durationSeconds += durationSeconds;
  commandSamples.set(key, sample);
}

export function recordCommandSerialized(server: string, command: string): void {
  const key = `${server} ${command}`;
  const sample = serializedSamples.get(key) ?? { server, command, count: 0 };
  sample.count++;
  serializedSamples.set(key, sample);
}

export function startEventLoopLagProbe(intervalMs = 200): NodeJS.Timeout {
  let previous = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    eventLoopLagSeconds = Math.max(0, now - previous - intervalMs) / 1000;
    previous = now;
  }, intervalMs);
  timer.unref();
  return timer;
}

function escapeLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}

function labels(pairs: Record<string, string>): string {
  const rendered = Object.entries(pairs)
    .map(([key, value]) => `${key}="${escapeLabel(value)}"`)
    .join(',');
  return rendered ? `{${rendered}}` : '';
}

class MetricsWriter {
  private readonly lines: string[] = [];
  private readonly declared = new Set<string>();

  public add(
    name: string,
    type: 'counter' | 'gauge',
    help: string,
    value: number,
    tags: Record<string, string> = {},
  ): void {
    if (!this.declared.has(name)) {
      this.declared.add(name);
      this.lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    }
    this.lines.push(`${name}${labels(tags)} ${value}`);
  }

  public render(): string {
    return this.lines.join('\n') + '\n';
  }
}

interface SocketMetricDefinition {
  name: string;
  type: 'counter' | 'gauge';
  help: string;
  read: (socket: GgeMetricsSocket, nowMs: number) => number;
  extraTags?: (socket: GgeMetricsSocket) => Record<string, string>;
}

const SOCKET_METRICS: SocketMetricDefinition[] = [
  {
    name: 'empire_api_socket_connected',
    type: 'gauge',
    help: 'Socket is logged in and answering',
    read: (socket) => (socket.metricsConnected ? 1 : 0),
  },
  {
    name: 'empire_api_socket_state',
    type: 'gauge',
    help: 'Socket state, one series per state',
    read: () => 1,
    extraTags: (socket) => ({ state: socket.metricsState ?? 'UNKNOWN' }),
  },
  {
    name: 'empire_api_socket_messages_received_total',
    type: 'counter',
    help: 'Frames read from the game server',
    read: (socket) => socket.metricsStats.messagesReceived,
  },
  {
    name: 'empire_api_socket_messages_sent_total',
    type: 'counter',
    help: 'Frames written to the game server',
    read: (socket) => socket.metricsStats.messagesSent,
  },
  {
    name: 'empire_api_socket_frames_unmatched_total',
    type: 'counter',
    help: 'Frames no pending request wanted, discarded without parsing their payload',
    read: (socket) => socket.metricsStats.framesUnmatched,
  },
  {
    name: 'empire_api_socket_restarts_total',
    type: 'counter',
    help: 'Reconnection attempts started',
    read: (socket) => socket.metricsStats.restarts,
  },
  {
    name: 'empire_api_socket_errors_total',
    type: 'counter',
    help: 'Transport errors raised by the socket',
    read: (socket) => socket.metricsStats.socketErrors,
  },
  {
    name: 'empire_api_socket_closes_total',
    type: 'counter',
    help: 'Close events received from the game server',
    read: (socket) => socket.metricsStats.socketCloses,
  },
  {
    name: 'empire_api_socket_login_failures_total',
    type: 'counter',
    help: 'Logins the game refused',
    read: (socket) => socket.metricsStats.loginFailures,
  },
  {
    name: 'empire_api_socket_connected_seconds',
    type: 'gauge',
    help: 'Seconds since the socket last logged in, -1 when it is not connected',
    read: (socket, nowMs) =>
      socket.metricsStats.connectedSinceMs === null ? -1 : (nowMs - socket.metricsStats.connectedSinceMs) / 1000,
  },
  {
    name: 'empire_api_socket_round_trip_ms',
    type: 'gauge',
    help: 'Measured round trip of a trivial command, -1 when none was measured yet',
    read: (socket) => socket.metricsStats.roundTripMs ?? -1,
  },
  {
    name: 'empire_api_socket_response_timeout_ms',
    type: 'gauge',
    help: 'How long the bridge waits for this server to answer, derived from its round trip',
    read: (socket) => socket.metricsResponseTimeoutMs,
  },
  {
    name: 'empire_api_socket_last_message_age_seconds',
    type: 'gauge',
    help: 'Seconds since the last frame was read, -1 when nothing was ever read',
    read: (socket, nowMs) =>
      socket.metricsStats.lastMessageAtMs === null ? -1 : (nowMs - socket.metricsStats.lastMessageAtMs) / 1000,
  },
];

function addSocketMetrics(writer: MetricsWriter, sockets: Record<string, GgeMetricsSocket>, nowMs: number): void {
  const all = Object.values(sockets);
  for (const definition of SOCKET_METRICS) {
    for (const socket of all) {
      writer.add(definition.name, definition.type, definition.help, definition.read(socket, nowMs), {
        ...socket.metricsLabels,
        ...definition.extraTags?.(socket),
      });
    }
  }
}

function addCommandBudgetMetrics(writer: MetricsWriter, sockets: Record<string, GgeMetricsSocket>): void {
  for (const socket of Object.values(sockets)) {
    for (const budget of socket.metricsCommandBudgets) {
      writer.add(
        'empire_api_socket_command_timeout_ms',
        'gauge',
        'How long the bridge waits for one command on this server, widened by what that command has answered in',
        budget.budgetMs,
        { ...socket.metricsLabels, command: budget.command },
      );
    }
  }
}

function addSerializedMetrics(writer: MetricsWriter): void {
  for (const sample of serializedSamples.values()) {
    writer.add(
      'empire_api_command_serialized_total',
      'counter',
      'Requests queued behind an identical in-flight one, which the game answer could not be told apart from',
      sample.count,
      { server: sample.server, command: sample.command },
    );
  }
}

function addCommandMetrics(writer: MetricsWriter): void {
  const samples = [...commandSamples.values()];
  const tagsOf = (sample: CommandSample): Record<string, string> => ({
    server: sample.server,
    command: sample.command,
    outcome: sample.outcome,
  });
  for (const sample of samples) {
    writer.add('empire_api_commands_total', 'counter', 'Commands relayed to a game socket', sample.count, tagsOf(sample));
  }
  for (const sample of samples) {
    writer.add(
      'empire_api_command_duration_seconds_total',
      'counter',
      'Time spent waiting for the game server to answer a command',
      sample.durationSeconds,
      tagsOf(sample),
    );
  }
}

function addProcessMetrics(writer: MetricsWriter): void {
  const memory = process.memoryUsage();
  writer.add('empire_api_process_resident_memory_bytes', 'gauge', 'Resident set size', memory.rss);
  writer.add('empire_api_process_heap_used_bytes', 'gauge', 'V8 heap in use', memory.heapUsed);
  writer.add('empire_api_process_heap_total_bytes', 'gauge', 'V8 heap reserved', memory.heapTotal);
  writer.add('empire_api_process_external_memory_bytes', 'gauge', 'Memory held outside the V8 heap', memory.external);
  writer.add('empire_api_process_uptime_seconds', 'gauge', 'Seconds since the process started', process.uptime());
  writer.add(
    'empire_api_event_loop_lag_seconds',
    'gauge',
    'Delay the last scheduled tick suffered',
    eventLoopLagSeconds,
  );
}

export function renderMetrics(sockets: Record<string, GgeMetricsSocket>): string {
  const writer = new MetricsWriter();
  const nowMs = Date.now();
  const all = Object.values(sockets);

  writer.add('empire_api_info', 'gauge', 'Build information of this bridge', 1, {
    api_type: process.env.API_TYPE?.toLowerCase() === 'realtime' ? 'realtime' : 'standard',
    node_version: process.version,
  });
  writer.add('empire_api_sockets_total', 'gauge', 'Sockets the bridge holds', all.length);
  writer.add(
    'empire_api_sockets_connected',
    'gauge',
    'Sockets currently logged in',
    all.filter((socket) => socket.metricsConnected).length,
  );
  addSocketMetrics(writer, sockets, nowMs);
  addCommandBudgetMetrics(writer, sockets);
  addCommandMetrics(writer);
  addSerializedMetrics(writer);
  addProcessMetrics(writer);
  return writer.render();
}
