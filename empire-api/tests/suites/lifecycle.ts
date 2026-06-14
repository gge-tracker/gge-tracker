/**
 * Lifecycle suite: socket state-machine transitions
 * (CONNECTING -> CONNECTED -> DISCONNECTED, and the irreversible KILLED state).
 */
import { Report } from '../lib/report.js';
import { config } from '../config.js';
import { MockGgeServer } from '../lib/mock-server.js';
import { createEmpireSocket, disposeSocket, isConnected, stateOf, waitFor } from '../lib/harness.js';
import { SocketState } from '../../src/utils/ws/base-socket.js';

export async function runLifecycle(report: Report): Promise<void> {
  const section = report.section('lifecycle');

  {
    const server = new MockGgeServer();
    await server.start();
    const socket = createEmpireSocket(server.url());
    try {
      void socket.connect();
      const sawConnecting = await waitFor(
        () => stateOf(socket) === SocketState.CONNECTING || stateOf(socket) === SocketState.CONNECTED,
        config.connectTimeoutMs,
      );
      section.expect('enters CONNECTING/CONNECTED state', {
        ok: sawConnecting,
        detail: `state=${stateOf(socket)}`,
      });

      const connected = await waitFor(() => stateOf(socket) === SocketState.CONNECTED, config.connectTimeoutMs);
      section.expect('settles on CONNECTED', { ok: connected, detail: `state=${stateOf(socket)}` });
    } finally {
      disposeSocket(socket);
      await server.stop();
    }
  }

  {
    const server = new MockGgeServer();
    await server.start();
    const socket = createEmpireSocket(server.url());
    try {
      void socket.connect();
      await waitFor(() => isConnected(socket), config.connectTimeoutMs);

      socket.disconnect();
      section.expect('disconnect() -> DISCONNECTED', {
        ok: stateOf(socket) === SocketState.DISCONNECTED && !isConnected(socket),
        detail: `state=${stateOf(socket)} connected=${isConnected(socket)}`,
      });
    } finally {
      disposeSocket(socket);
      await server.stop();
    }
  }

  {
    const server = new MockGgeServer();
    await server.start();
    const socket = createEmpireSocket(server.url());
    try {
      void socket.connect();
      await waitFor(() => isConnected(socket), config.connectTimeoutMs);

      socket.kill();
      section.expect('kill() -> KILLED', {
        ok: stateOf(socket) === SocketState.KILLED && !isConnected(socket),
        detail: `state=${stateOf(socket)}`,
      });

      // setSocketState must refuse to move away from KILLED.
      (socket as unknown as { setSocketState(s: SocketState): void }).setSocketState(SocketState.CONNECTED);
      section.expect('KILLED is irreversible', {
        ok: stateOf(socket) === SocketState.KILLED,
        detail: `state=${stateOf(socket)}`,
      });
    } finally {
      disposeSocket(socket);
      await server.stop();
    }
  }
}
