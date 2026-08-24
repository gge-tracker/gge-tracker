/**
 * Handshake suite: a real GgeEmpireSocket against the mock server must complete
 * the full login sequence and reach the CONNECTED state
 */
import { Report } from '../lib/report.js';
import { config } from '../config.js';
import { MockGgeServer } from '../lib/mock-server.js';
import { createEmpireSocket, disposeSocket, isConnected, stateOf, waitFor } from '../lib/harness.js';
import { SocketState } from '../../src/utils/ws/base-socket.js';

export async function runHandshake(report: Report): Promise<void> {
  const section = report.section('handshake');
  const server = new MockGgeServer();
  const url = await server.start();
  const socket = createEmpireSocket(url);

  try {
    const startedAt = Date.now();
    void socket.connect();

    const connected = await waitFor(() => isConnected(socket), config.connectTimeoutMs);
    section.expect('socket reaches CONNECTED', {
      ok: connected && stateOf(socket) === SocketState.CONNECTED,
      detail: `state=${stateOf(socket)} connected=${isConnected(socket)}`,
    }, Date.now() - startedAt);

    section.expect('exactly one connection opened', {
      ok: server.connectionCount === 1,
      detail: `connectionCount=${server.connectionCount}`,
    });

    const expectedOrder = ['verChk', 'login', 'autoJoin', 'roundTrip', 'lli'];
    const actualPrefix = server.receivedCommands.slice(0, expectedOrder.length);
    section.expect('login commands sent in order', {
      ok: JSON.stringify(actualPrefix) === JSON.stringify(expectedOrder),
      detail: `got [${server.receivedCommands.join(', ')}]`,
    });

    const sawHeartbeat = await waitFor(() => server.receivedCommands.includes('gpi'), config.connectTimeoutMs);
    section.expect('sends gpi heartbeat after login', {
      ok: sawHeartbeat,
      detail: `commands=[${server.receivedCommands.join(', ')}]`,
    });
  } finally {
    disposeSocket(socket);
    await server.stop();
  }
}
