import { config } from '../config.js';
import { GgeEmpireSocket } from '../../src/utils/ws/empire-socket.js';
import { SocketState } from '../../src/utils/ws/base-socket.js';

export async function waitFor(
  predicate: () => boolean,
  timeoutMs = config.connectTimeoutMs,
  intervalMs = config.pollIntervalMs,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(intervalMs);
  }
  return predicate();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createEmpireSocket(url: string, header = 'EmpireEx_TEST'): GgeEmpireSocket {
  return new GgeEmpireSocket(url, header, 'mock-user', 'mock-password', true);
}

export function stateOf(socket: GgeEmpireSocket): SocketState {
  return (socket as unknown as { socketState: SocketState }).socketState;
}

export function isConnected(socket: GgeEmpireSocket): boolean {
  return (socket as unknown as { connected: { isSet: boolean } }).connected.isSet;
}

export function hasPendingRestart(socket: GgeEmpireSocket): boolean {
  return Boolean((socket as unknown as { restartTimeout?: NodeJS.Timeout }).restartTimeout);
}

export function disposeSocket(socket: GgeEmpireSocket | undefined): void {
  try {
    socket?.kill();
  } catch {
    // ignore teardown errors
  }
}
