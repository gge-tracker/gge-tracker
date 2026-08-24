import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Report } from '../lib/report.js';
import { config } from '../config.js';
import { MockGgeServer } from '../lib/mock-server.js';
import { createEmpireSocket, disposeSocket, isConnected, waitFor } from '../lib/harness.js';
import createApp from '../../src/app.controller.js';

interface HttpResult {
  status: number;
  body: any;
}

async function http(base: string, path: string, init?: RequestInit): Promise<HttpResult> {
  const response = await fetch(`${base}${path}`, init);
  const text = await response.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep raw text
  }
  return { status: response.status, body };
}

export async function runRoundtrip(report: Report): Promise<void> {
  const section = report.section('roundtrip');

  const server = new MockGgeServer();
  await server.start();
  const socket = createEmpireSocket(server.url(), 'TestSrv');
  void socket.connect();
  await waitFor(() => isConnected(socket), config.connectTimeoutMs);

  const app = createApp({ TestSrv: socket });
  const httpServer: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;

  try {
    const root = await http(base, '/');
    section.expect('GET / responds', { ok: root.status === 200, detail: `status ${root.status} body=${root.body}` });

    const status = await http(base, '/status');
    section.expect('GET /status reports the socket connected', {
      ok: status.status === 200 && status.body?.TestSrv === true,
      detail: `status ${status.status} body=${JSON.stringify(status.body)}`,
    });

    const roundtrip = await http(base, '/TestSrv/rt/null');
    section.expect('GET command roundtrip returns a response', {
      ok: roundtrip.status === 200 && roundtrip.body?.return_code === 0 && roundtrip.body?.command === 'rt',
      detail: `status ${roundtrip.status} body=${JSON.stringify(roundtrip.body)}`,
    });

    const unknown = await http(base, '/DoesNotExist/rt/null');
    section.expect('GET command on unknown server -> 404', {
      ok: unknown.status === 404,
      detail: `status ${unknown.status}`,
    });

    const missing = await http(base, '/server', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ server: 'X' }),
    });
    section.expect('POST /server with missing params -> 400', {
      ok: missing.status === 400,
      detail: `status ${missing.status} body=${JSON.stringify(missing.body)}`,
    });

    const badUrl = await http(base, '/server', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ server: 'X', socket_url: 'evil.example.com', username: 'u', password: 'p' }),
    });
    section.expect('POST /server with non-GGE url -> 400', {
      ok: badUrl.status === 400,
      detail: `status ${badUrl.status} body=${JSON.stringify(badUrl.body)}`,
    });

    const del = await http(base, '/server/TestSrv', { method: 'DELETE' });
    section.expect('DELETE /server removes the socket', { ok: del.status === 200, detail: `status ${del.status}` });

    const statusAfter = await http(base, '/status');
    section.expect('GET /status no longer lists the deleted socket', {
      ok: statusAfter.status === 200 && !('TestSrv' in (statusAfter.body ?? {})),
      detail: `body=${JSON.stringify(statusAfter.body)}`,
    });
  } finally {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    disposeSocket(socket);
    await server.stop();
  }
}
