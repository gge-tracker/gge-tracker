import { createServer, type Server } from 'node:net';
import type { AddressInfo } from 'node:net';
import { Report } from '../lib/report.js';
import { config } from '../config.js';
import { MockGgeServer } from '../lib/mock-server.js';
import {
  createEmpireSocket,
  disposeSocket,
  isConnected,
  hasPendingRestart,
  sleep,
  waitFor,
} from '../lib/harness.js';

function gpiCount(server: MockGgeServer): number {
  return server.receivedCommands.filter((command) => command === 'gpi').length;
}

async function connectFresh(server: MockGgeServer): Promise<ReturnType<typeof createEmpireSocket>> {
  const socket = createEmpireSocket(server.url());
  void socket.connect();
  await waitFor(() => isConnected(socket), config.connectTimeoutMs);
  // connect() starts 2 concurrent heartbeats
  await waitFor(() => gpiCount(server) >= 2, config.connectTimeoutMs);
  await sleep(80);
  return socket;
}

async function startRefusingListener(): Promise<{ server: Server; url: string; attempts: () => number }> {
  let attempts = 0;
  const server = createServer((connection) => {
    attempts++;
    connection.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `ws://127.0.0.1:${port}`, attempts: () => attempts };
}

function reconnectCount(socket: ReturnType<typeof createEmpireSocket>): number {
  return (socket as unknown as { nbReconnects: number }).nbReconnects;
}

export async function runReconnect(report: Report): Promise<void> {
  const section = report.section('reconnect');

  {
    const server = new MockGgeServer();
    await server.start();
    const socket = await connectFresh(server);
    try {
      section.expect('initial connection established', isConnected(socket));

      server.dropActive(1000);
      const dropped = await waitFor(() => !isConnected(socket), config.reconnectTimeoutMs);
      section.expect('detects clean disconnect', { ok: dropped, detail: `connected=${isConnected(socket)}` });

      const reconnected = await waitFor(
        () => server.connectionCount >= 2 && isConnected(socket),
        config.reconnectTimeoutMs,
      );
      section.expect('reconnects after clean close', {
        ok: reconnected,
        detail: `connectionCount=${server.connectionCount} connected=${isConnected(socket)}`,
      });
    } finally {
      disposeSocket(socket);
      await server.stop();
    }
  }

  {
    const server = new MockGgeServer();
    await server.start();
    const socket = await connectFresh(server);
    try {
      server.terminateActive();
      const reconnected = await waitFor(
        () => server.connectionCount >= 2 && isConnected(socket),
        config.reconnectTimeoutMs,
      );
      section.expect('reconnects after abrupt drop', {
        ok: reconnected,
        detail: `connectionCount=${server.connectionCount} connected=${isConnected(socket)}`,
      });
    } finally {
      disposeSocket(socket);
      await server.stop();
    }
  }

  {
    const server = new MockGgeServer();
    await server.start();
    const socket = await connectFresh(server);
    try {
      let recoveredEveryTime = true;
      for (let round = 2; round <= 4; round++) {
        server.dropActive(1000);
        const ok = await waitFor(
          () => server.connectionCount >= round && isConnected(socket),
          config.reconnectTimeoutMs,
        );
        if (!ok) recoveredEveryTime = false;
      }
      section.expect('recovers from repeated disconnects', {
        ok: recoveredEveryTime && server.connectionCount >= 4,
        detail: `connectionCount=${server.connectionCount}`,
      });
    } finally {
      disposeSocket(socket);
      await server.stop();
    }
  }

  {
    const server = new MockGgeServer();
    await server.start();
    const socket = await connectFresh(server);
    try {
      socket.kill();
      const countAfterKill = server.connectionCount;
      server.dropActive(1000);
      await sleep(Math.min(config.reconnectTimeoutMs, 1500));
      section.expect('killed socket does not reconnect', {
        ok: server.connectionCount === countAfterKill && !isConnected(socket) && !hasPendingRestart(socket),
        detail: `connectionCount=${server.connectionCount} (was ${countAfterKill}) connected=${isConnected(socket)}`,
      });
    } finally {
      disposeSocket(socket);
      await server.stop();
    }
  }

  {
    const listener = await startRefusingListener();
    const socket = createEmpireSocket(listener.url);
    try {
      void socket.connect();
      const climbed = await waitFor(() => listener.attempts() >= 4, config.reconnectTimeoutMs);
      await sleep(100);
      section.expect('climbs the backoff ladder across failed attempts', {
        ok: climbed && reconnectCount(socket) >= 4,
        detail: `attempts=${listener.attempts()} backoffStep=${reconnectCount(socket)}`,
      });
      section.expect('one failed attempt is one backoff step', {
        ok: reconnectCount(socket) === listener.attempts(),
        detail: `attempts=${listener.attempts()} backoffStep=${reconnectCount(socket)}`,
      });
    } finally {
      disposeSocket(socket);
      await new Promise((resolve) => listener.server.close(resolve));
    }
  }
}
