/**
 * Latency suite
 */
import { Report } from '../lib/report.js';
import { config } from '../config.js';
import { MockGgeServer } from '../lib/mock-server.js';
import { createEmpireSocket, disposeSocket, isConnected, waitFor } from '../lib/harness.js';
import { GgeEmpireSocket } from '../../src/utils/ws/empire-socket.js';

const FLOOR_MS = 1000;
const CEILING_MS = 3000;
const SINGAPORE_ROUND_TRIP_MS = 155;
const AMERICAS_ROUND_TRIP_MS = 90;
const NEARBY_ROUND_TRIP_MS = 10;
const ANSWER_MIN_SAMPLES = 5;

function feedRoundTrip(socket: GgeEmpireSocket, milliseconds: number): void {
  (socket as unknown as { recordRoundTrip: (ms: number) => void }).recordRoundTrip(milliseconds);
}

function roundTripOf(socket: GgeEmpireSocket): number | null {
  return socket.metricsStats.roundTripMs;
}

export async function runLatency(report: Report): Promise<void> {
  const section = report.section('latency');
  const server = new MockGgeServer();
  await server.start();

  const unmeasured = createEmpireSocket(server.url(), 'Unmeasured');
  section.expect('a socket that measured nothing gets the widest budget', {
    ok: unmeasured.responseTimeoutMs === CEILING_MS && roundTripOf(unmeasured) === null,
    detail: `timeout=${unmeasured.responseTimeoutMs} roundTrip=${roundTripOf(unmeasured)}`,
  });
  disposeSocket(unmeasured);

  const socket = createEmpireSocket(server.url(), 'TestSrv');
  try {
    void socket.connect();
    const connected = await waitFor(() => isConnected(socket), config.connectTimeoutMs);
    section.expect('the login handshake measures the round trip', {
      ok: connected && roundTripOf(socket) !== null,
      detail: `connected=${connected} roundTrip=${roundTripOf(socket)}ms`,
    });

    section.expect('a server next door is held to the floor, not slowed to the ceiling', {
      ok: socket.responseTimeoutMs === FLOOR_MS,
      detail: `roundTrip=${roundTripOf(socket)}ms timeout=${socket.responseTimeoutMs}ms`,
    });

    const nearbyBudget = socket.responseTimeoutMs;
    for (let sample = 0; sample < 20; sample++) feedRoundTrip(socket, SINGAPORE_ROUND_TRIP_MS);
    const farBudget = socket.responseTimeoutMs;
    section.expect('a server on the other side of the world gets room for its answer', {
      // The slowest measured answer on the Singapore servers is 950ms
      ok: farBudget > nearbyBudget && farBudget >= 2000 && farBudget <= CEILING_MS,
      detail: `roundTrip=${roundTripOf(socket)?.toFixed(0)}ms timeout=${farBudget}ms (was ${nearbyBudget}ms)`,
    });

    for (let sample = 0; sample < 20; sample++) feedRoundTrip(socket, AMERICAS_ROUND_TRIP_MS);
    const americasBudget = socket.responseTimeoutMs;
    section.expect('the budget follows the distance back down', {
      ok: americasBudget < farBudget && americasBudget > FLOOR_MS,
      detail: `roundTrip=${roundTripOf(socket)?.toFixed(0)}ms timeout=${americasBudget}ms`,
    });

    const beforeHiccup = socket.responseTimeoutMs;
    feedRoundTrip(socket, 4000);
    section.expect('one slow answer does not widen the budget at all', {
      ok: socket.responseTimeoutMs === beforeHiccup,
      detail: `timeout=${socket.responseTimeoutMs}ms after a single 4000ms sample (was ${beforeHiccup}ms)`,
    });

    for (let sample = 0; sample < 3; sample++) feedRoundTrip(socket, 4000);
    section.expect('a route that really did get slower is followed', {
      ok: socket.responseTimeoutMs === CEILING_MS,
      detail: `roundTrip=${roundTripOf(socket)?.toFixed(0)}ms timeout=${socket.responseTimeoutMs}ms`,
    });

    const smoothed = roundTripOf(socket);
    feedRoundTrip(socket, 60_000);
    section.expect('an absurd sample is refused rather than smoothed in', {
      ok: roundTripOf(socket) === smoothed,
      detail: `roundTrip=${roundTripOf(socket)?.toFixed(0)}ms`,
    });

    section.expect('the budget is published for each server', {
      ok: socket.metricsResponseTimeoutMs === socket.responseTimeoutMs,
      detail: `metric=${socket.metricsResponseTimeoutMs} getter=${socket.responseTimeoutMs}`,
    });

    const nearby = createEmpireSocket(server.url(), 'PerCommand');
    try {
      for (let sample = 0; sample < 5; sample++) feedRoundTrip(nearby, NEARBY_ROUND_TRIP_MS);
      const serverBudget = nearby.responseTimeoutMs;

      section.expect('a command the game never answers keeps the server budget, so a probe still fails fast', {
        ok: nearby.answerBudgetMs('probe') === serverBudget,
        detail: `probe=${nearby.answerBudgetMs('probe')}ms server=${serverBudget}ms`,
      });

      for (let sample = 0; sample < ANSWER_MIN_SAMPLES; sample++) nearby.recordCommandAnswer('hgh', 40);
      section.expect('a command that answers at once is not given room it does not need', {
        ok: nearby.answerBudgetMs('hgh') === serverBudget,
        detail: `hgh=${nearby.answerBudgetMs('hgh')}ms server=${serverBudget}ms`,
      });

      for (let sample = 0; sample < ANSWER_MIN_SAMPLES; sample++) nearby.recordCommandAnswer('gaa', 600);
      const heavyBudget = nearby.answerBudgetMs('gaa');
      section.expect('a heavy command on a nearby server earns room its round trip never showed', {
        ok: heavyBudget > serverBudget && heavyBudget <= CEILING_MS,
        detail: `gaa=${heavyBudget}ms server=${serverBudget}ms`,
      });

      section.expect('the room is earned per command, not handed to the whole socket', {
        ok: nearby.answerBudgetMs('probe') === serverBudget && nearby.answerBudgetMs('hgh') === serverBudget,
        detail: `probe=${nearby.answerBudgetMs('probe')}ms hgh=${nearby.answerBudgetMs('hgh')}ms gaa=${heavyBudget}ms`,
      });

      for (let sample = 0; sample < ANSWER_MIN_SAMPLES; sample++) nearby.recordCommandAnswer('gaa', 2500);
      section.expect('even a very slow command is still capped at the ceiling', {
        ok: nearby.answerBudgetMs('gaa') === CEILING_MS,
        detail: `gaa=${nearby.answerBudgetMs('gaa')}ms`,
      });

      const published = new Map(nearby.metricsCommandBudgets.map((entry) => [entry.command, entry.budgetMs]));
      section.expect('every command that answered publishes its own budget', {
        ok: published.get('gaa') === nearby.answerBudgetMs('gaa') && published.get('hgh') === serverBudget,
        detail: [...published].map(([command, budget]) => `${command}=${budget}ms`).join(' '),
      });
    } finally {
      disposeSocket(nearby);
    }
  } finally {
    disposeSocket(socket);
    await server.stop();
  }
}
