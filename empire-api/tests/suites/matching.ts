import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Report } from '../lib/report.js';
import { config } from '../config.js';
import { MockGgeServer, MockServerOptions } from '../lib/mock-server.js';
import { createEmpireSocket, disposeSocket, isConnected, waitFor } from '../lib/harness.js';
import createApp from '../../src/app.controller.js';
import { GgeEmpireSocket } from '../../src/utils/ws/empire-socket.js';

interface Stage {
  base: string;
  server: MockGgeServer;
  socket: GgeEmpireSocket;
  close: () => Promise<void>;
}

async function stage(options: MockServerOptions = {}): Promise<Stage> {
  const server = new MockGgeServer(options);
  await server.start();
  const socket = createEmpireSocket(server.url(), 'TestSrv');
  void socket.connect();
  await waitFor(() => isConnected(socket), config.connectTimeoutMs);

  const app = createApp({ TestSrv: socket });
  const httpServer: Server = await new Promise((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  return {
    base: `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`,
    server,
    socket,
    close: async (): Promise<void> => {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      disposeSocket(socket);
      await server.stop();
    },
  };
}

async function call(base: string, path: string): Promise<any> {
  const response = await fetch(`${base}${path}`);
  return response.json();
}

function framesUnmatched(socket: GgeEmpireSocket): number {
  return socket.metricsStats.framesUnmatched;
}

/**
 * Two 'gaa' on one kingdom are answered by frames that carry nothing but that kingdom,
 * so the bridge must not have both in flight at once
 */
async function ambiguousCommandsAreSerialized(report: Report): Promise<void> {
  const section = report.section('matching');
  const sent: { tile: number; at: number }[] = [];
  const stand = await stage({
    respond: (command, data) => {
      if (command !== 'gaa') return undefined;
      sent.push({ tile: data.AX1, at: Date.now() });
      // The second tile is answered first: without serialization it lands on the first caller
      return { data: { KID: data.KID, AI: [data.AX1] }, delayMs: sent.length === 1 ? 120 : 10 };
    },
  });

  try {
    const first = call(stand.base, '/TestSrv/gaa/"KID":4,"AX1":100,"AY1":100,"AX2":200,"AY2":200');
    const second = call(stand.base, '/TestSrv/gaa/"KID":4,"AX1":700,"AY1":700,"AX2":800,"AY2":800');
    const [a, b] = await Promise.all([first, second]);

    section.expect('two gaa on one kingdom each get their own tile back', {
      ok: a?.content?.AI?.[0] === 100 && b?.content?.AI?.[0] === 700,
      detail: `first=${JSON.stringify(a?.content)} second=${JSON.stringify(b?.content)}`,
    });
    const gapMs = sent.length === 2 ? sent[1].at - sent[0].at : 0;
    section.expect('the second gaa reaches the game only once the first is answered', {
      ok: sent.length === 2 && sent[0].tile === 100 && sent[1].tile === 700 && gapMs >= 100,
      detail: `tiles ${sent.map((entry) => entry.tile).join(', ')} sent ${gapMs}ms apart, the first answers in 120ms`,
    });
  } finally {
    await stand.close();
  }
}

/**
 * A command whose parameters come back in its answer stays parallel
 */
async function distinguishableCommandsStayParallel(report: Report): Promise<void> {
  const section = report.section('matching');
  let inFlight = 0;
  let observedParallel = false;
  const stand = await stage({
    respond: (command, data) => {
      if (command !== 'gpe') return undefined;
      inFlight++;
      if (inFlight > 1) observedParallel = true;
      // The second player is answered first
      return { data: { PID: data.PID, EID: data.EID }, delayMs: data.PID === 1 ? 120 : 10 };
    },
  });

  try {
    const [a, b] = await Promise.all([
      call(stand.base, '/TestSrv/gpe/"PID":1,"EID":102'),
      call(stand.base, '/TestSrv/gpe/"PID":2,"EID":102'),
    ]);
    section.expect('two gpe on different players run at once', {
      ok: observedParallel,
      detail: observedParallel ? 'both reached the game before either answered' : 'they were serialized',
    });
    section.expect('each gpe gets its own player back', {
      ok: a?.content?.PID === 1 && b?.content?.PID === 2,
      detail: `first=${JSON.stringify(a?.content)} second=${JSON.stringify(b?.content)}`,
    });
  } finally {
    await stand.close();
  }
}

/**
 * The payload of a frame nobody is waiting for is never parsed
 */
async function unwantedFramesAreDropped(report: Report): Promise<void> {
  const section = report.section('matching');
  const stand = await stage();

  try {
    const before = framesUnmatched(stand.socket);
    // A body no JSON parser would accept: reaching it at all would throw
    stand.server.pushRaw('%xt%zzz%1%0%{not json at all%');
    const counted = await waitFor(() => framesUnmatched(stand.socket) > before, 2000);
    section.expect('a frame no request wanted is counted and left unparsed', {
      ok: counted,
      detail: `framesUnmatched ${before} -> ${framesUnmatched(stand.socket)}`,
    });

    const alive = await call(stand.base, '/TestSrv/rt/null');
    section.expect('the socket still answers after an unparsable frame', {
      ok: alive?.return_code === 0,
      detail: JSON.stringify(alive),
    });
  } finally {
    await stand.close();
  }
}

/**
 * Cutting the envelope by index rather than splitting on '%' keeps a payload intact
 */
async function payloadPercentSignsSurvive(report: Report): Promise<void> {
  const section = report.section('matching');
  const name = 'a%%b';
  const stand = await stage({
    respond: (command) => (command === 'gdi' ? { data: { O: { OID: 7, N: name } } } : undefined),
  });

  try {
    const answer = await call(stand.base, '/TestSrv/gdi/"PID":7');
    section.expect('a name carrying %% comes back unchanged', {
      ok: answer?.content?.O?.N === name,
      detail: `got ${JSON.stringify(answer?.content?.O?.N)}, expected ${JSON.stringify(name)}`,
    });
  } finally {
    await stand.close();
  }
}

export async function runMatching(report: Report): Promise<void> {
  await ambiguousCommandsAreSerialized(report);
  await distinguishableCommandsStayParallel(report);
  await unwantedFramesAreDropped(report);
  await payloadPercentSignsSurvive(report);
}
