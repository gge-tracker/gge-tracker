import { Report } from '../lib/report.js';
import { config } from '../config.js';
import { MockGgeServer } from '../lib/mock-server.js';
import { createEmpireSocket, disposeSocket, isConnected, sleep, waitFor } from '../lib/harness.js';
import { GgeEmpireSocket } from '../../src/utils/ws/empire-socket.js';

const BYTES_PER_MB = 1024 * 1024;

function gc(): void {
  (global as unknown as { gc?: () => void }).gc?.();
}

/** Force the heap into a stable state by running GC a few times with yields. */
async function settleHeap(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    gc();
    await sleep(50);
  }
}

function heapUsedMb(): number {
  return process.memoryUsage().heapUsed / BYTES_PER_MB;
}

function activeTimerCount(): number {
  return process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
}

function pendingResponses(socket: GgeEmpireSocket): number {
  return (socket as unknown as { messages: unknown[] }).messages.length;
}

async function churn(report: Report, server: MockGgeServer): Promise<void> {
  const section = report.section('memory');
  const { churnIterations, pingDrainMs, heapGrowthBudgetMb, timerLeakBudget } = config.memory;

  for (let i = 0; i < 10; i++) {
    const socket = createEmpireSocket(server.url());
    void socket.connect();
    await waitFor(() => isConnected(socket), config.connectTimeoutMs);
    disposeSocket(socket);
  }
  await sleep(pingDrainMs);
  await settleHeap();

  const baseHeap = heapUsedMb();
  const baseTimers = activeTimerCount();

  for (let i = 0; i < churnIterations; i++) {
    const socket = createEmpireSocket(server.url());
    void socket.connect();
    await waitFor(() => isConnected(socket), config.connectTimeoutMs);
    disposeSocket(socket);
  }

  await sleep(pingDrainMs);
  await settleHeap();

  const heapGrowth = heapUsedMb() - baseHeap;
  const timerGrowth = activeTimerCount() - baseTimers;

  section.expect(`churn ${churnIterations}x connect/kill - heap stable`, {
    ok: heapGrowth < heapGrowthBudgetMb,
    detail: `heap +${heapGrowth.toFixed(2)}MB (budget ${heapGrowthBudgetMb}MB)`,
  });
  section.expect(`churn ${churnIterations}x connect/kill - no timer leak`, {
    ok: timerGrowth <= timerLeakBudget,
    detail: `active Timeout handles ${baseTimers} -> ${baseTimers + timerGrowth} (budget +${timerLeakBudget})`,
  });
}

async function traffic(report: Report, server: MockGgeServer): Promise<void> {
  const section = report.section('memory');
  const { transmissionMessages, heapGrowthBudgetMb } = config.memory;

  const socket = createEmpireSocket(server.url());
  try {
    void socket.connect();
    await waitFor(() => isConnected(socket), config.connectTimeoutMs);
    await settleHeap();
    const baseHeap = heapUsedMb();

    let answered = 0;
    for (let i = 0; i < transmissionMessages; i++) {
      socket.sendJsonCommand('rt', { seq: i });
      const response = await socket.waitForJsonResponse('rt', { seq: i }, 2000);
      if (response?.payload?.status === 0) answered++;
    }

    await settleHeap();
    const heapGrowth = heapUsedMb() - baseHeap;
    const leftover = pendingResponses(socket);

    section.expect(`transmission ${transmissionMessages} roundtrips - all answered`, {
      ok: answered === transmissionMessages,
      detail: `${answered}/${transmissionMessages} responses matched`,
    });
    section.expect('transmission - pending-response buffer drains', {
      ok: leftover === 0,
      detail: `messages buffer length=${leftover}`,
    });
    section.expect('transmission - heap stable', {
      ok: heapGrowth < heapGrowthBudgetMb,
      detail: `heap +${heapGrowth.toFixed(2)}MB (budget ${heapGrowthBudgetMb}MB)`,
    });
  } finally {
    disposeSocket(socket);
  }
}

export async function runMemory(report: Report): Promise<void> {
  const section = report.section('memory');
  if (typeof (global as unknown as { gc?: () => void }).gc !== 'function') {
    section.skip('memory suite', 'run with node --expose-gc (npm run test:mem) to measure the heap');
    return;
  }

  const server = new MockGgeServer();
  await server.start();
  try {
    await churn(report, server);
    await traffic(report, server);
  } finally {
    await server.stop();
  }
}
