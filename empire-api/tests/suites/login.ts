/**
 * Login-failure suite: the server must react safely to rejected logins
 */
import { Report } from '../lib/report.js';
import { config } from '../config.js';
import { MockGgeServer } from '../lib/mock-server.js';
import { createEmpireSocket, disposeSocket, isConnected, stateOf, waitFor } from '../lib/harness.js';
import { SocketState } from '../../src/utils/ws/base-socket.js';

async function expectKilledOnLogin(
  report: Report,
  label: string,
  lliStatus: number,
  lliData?: Record<string, unknown>,
): Promise<void> {
  const section = report.section('login');
  const server = new MockGgeServer({ lliStatus, lliData });
  await server.start();
  const socket = createEmpireSocket(server.url());
  try {
    void socket.connect();
    const killed = await waitFor(() => stateOf(socket) === SocketState.KILLED, config.connectTimeoutMs);
    section.expect(label, {
      ok: killed && !isConnected(socket) && server.connectionCount === 1,
      detail: `state=${stateOf(socket)} connected=${isConnected(socket)} connections=${server.connectionCount}`,
    });
  } finally {
    disposeSocket(socket);
    await server.stop();
  }
}

export async function runLogin(report: Report): Promise<void> {
  await expectKilledOnLogin(report, 'invalid credentials (21) -> KILLED', 21);
  await expectKilledOnLogin(report, 'banned account (27) -> KILLED', 27);
  await expectKilledOnLogin(report, 'too many attempts (453) -> KILLED', 453);
  await expectKilledOnLogin(report, 'unknown status (99) -> KILLED', 99);
}
