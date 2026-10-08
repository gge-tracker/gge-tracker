import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Report } from '../lib/report.js';
import { config } from '../config.js';
import { MockGgeServer, MockServerOptions } from '../lib/mock-server.js';
import { createEmpireSocket, disposeSocket, isConnected, sleep, waitFor } from '../lib/harness.js';
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

const OWNED_CASTLES = [101, 202];

function jaaFrame(castleId: number, kingdomId = 0): string {
  const data = {
    KID: kingdomId,
    gca: {
      O: { OID: 42, N: 'owner', AP: OWNED_CASTLES.map((id) => [kingdomId, id, 10, 10, 1]) },
      A: [1, 10, 10, castleId, 42, 4, 4, 4, 4, 1, 'castle', 0],
    },
  };
  return `%xt%jaa%1%0%${JSON.stringify(data)}%`;
}

function analysedCastle(answer: any): unknown {
  return answer?.content?.gca?.A?.[3];
}

async function castleAnalysesAreMatchedByCastle(report: Report): Promise<void> {
  const section = report.section('matching');
  let inFlight = 0;
  let observedParallel = false;
  let stand: Stage;
  stand = await stage({
    respond: (command, data) => {
      if (command !== 'jca') return undefined;
      inFlight++;
      if (inFlight > 1) observedParallel = true;
      setTimeout(() => stand.server.pushRaw(jaaFrame(data.CID, data.KID)), data.CID === OWNED_CASTLES[0] ? 120 : 10);
      return null;
    },
  });

  try {
    const [a, b] = await Promise.all(
      OWNED_CASTLES.map((id) => call(stand.base, `/TestSrv/jca/"CID":${id},"KID":0`)),
    );
    section.expect('two jca on one kingdom each get their own castle back', {
      ok: analysedCastle(a) === OWNED_CASTLES[0] && analysedCastle(b) === OWNED_CASTLES[1],
      detail: `first=${String(analysedCastle(a))} second=${String(analysedCastle(b))}`,
    });
    section.expect('two jca on different castles run at once', {
      ok: observedParallel,
      detail: observedParallel ? 'both reached the game before either answered' : 'they were serialized',
    });
  } finally {
    await stand.close();
  }
}

async function aStrayAnalysisIsIgnored(report: Report): Promise<void> {
  const section = report.section('matching');
  let stand: Stage;
  stand = await stage({
    respond: (command, data) => {
      if (command !== 'jca') return undefined;
      stand.server.pushRaw(jaaFrame(OWNED_CASTLES[1], data.KID));
      setTimeout(() => stand.server.pushRaw(jaaFrame(data.CID, data.KID)), 30);
      return null;
    },
  });

  try {
    const answer = await call(stand.base, `/TestSrv/jca/"CID":${OWNED_CASTLES[0]},"KID":0`);
    section.expect('the analysis of another castle arriving first is skipped', {
      ok: analysedCastle(answer) === OWNED_CASTLES[0],
      detail: `got castle ${String(analysedCastle(answer))}, asked for ${OWNED_CASTLES[0]}`,
    });
  } finally {
    await stand.close();
  }
}

async function framesMissingAWaitedValueAreNotParsed(report: Report): Promise<void> {
  const section = report.section('matching');
  let stand: Stage;
  stand = await stage({
    respond: (command, data) => {
      if (command !== 'jca') return undefined;
      // A body no JSON parser would accept: parsing it would throw inside the socket
      stand.server.pushRaw('%xt%jaa%1%0%{"KID":0, not json, castle 999%');
      setTimeout(() => stand.server.pushRaw(jaaFrame(data.CID, data.KID)), 30);
      return null;
    },
  });

  try {
    const before = framesUnmatched(stand.socket);
    const answer = await call(stand.base, `/TestSrv/jca/"CID":${OWNED_CASTLES[0]},"KID":0`);
    section.expect('a jaa without the castle id is counted unmatched, unparsed', {
      ok: framesUnmatched(stand.socket) > before && analysedCastle(answer) === OWNED_CASTLES[0],
      detail: `framesUnmatched ${before} -> ${framesUnmatched(stand.socket)}, castle ${String(analysedCastle(answer))}`,
    });
  } finally {
    await stand.close();
  }
}

async function payloadIsRelayedVerbatim(report: Report): Promise<void> {
  const section = report.section('matching');
  const body = String.raw`{"O":{"OID":7,"N":"café"}}`;
  let stand: Stage;
  stand = await stage({
    respond: (command) => {
      if (command !== 'gdi') return undefined;
      stand.server.pushRaw(`%xt%gdi%1%0%${body}%`);
      return null;
    },
  });

  try {
    const response = await fetch(`${stand.base}/TestSrv/gdi/"PID":7`);
    const text = await response.text();
    const parsed = JSON.parse(text);
    section.expect('the game text reaches the caller byte for byte', {
      ok: text.includes(`"content":${body}`) && parsed?.content?.O?.N === 'café',
      detail: text,
    });
  } finally {
    await stand.close();
  }
}

async function listKeysStillMatchAnyItem(report: Report): Promise<void> {
  const section = report.section('matching');
  const stand = await stage({
    respond: (command, data) =>
      command === 'llsp' ? { data: { LT: data.LT, LID: data.LID, L: [{ R: data.R - 1 }, { R: data.R }] } } : undefined,
  });

  try {
    const answer = await call(stand.base, '/TestSrv/llsp/"LT":89,"LID":1,"R":5');
    section.expect('an llsp answer is matched on any entry of its list', {
      ok: answer?.content?.L?.[1]?.R === 5,
      detail: JSON.stringify(answer?.content),
    });
  } finally {
    await stand.close();
  }
}

async function refusedAnalysesAreAnswered(report: Report): Promise<void> {
  const section = report.section('matching');
  const refusals: Record<number, string> = { 101: '%xt%jaa%1%106%', 202: '%xt%jca%1%6%' };
  let stand: Stage;
  stand = await stage({
    respond: (command, data) => {
      if (command !== 'jca') return undefined;
      setTimeout(() => stand.server.pushRaw(refusals[data.CID]), 10);
      return null;
    },
  });

  try {
    for (const [castleId, frame] of Object.entries(refusals)) {
      const startedAt = Date.now();
      const answer = await call(stand.base, `/TestSrv/jca/"CID":${castleId},"KID":0`);
      const [, , command, , status] = frame.split('%');
      section.expect(`a refusal sent as ${frame} reaches the caller instead of a timeout`, {
        ok: answer?.return_code === Number(status) && answer?.command === command && answer?.content === null,
        detail: `${JSON.stringify(answer)} in ${Date.now() - startedAt}ms`,
      });
    }
  } finally {
    await stand.close();
  }
}

async function refusalsGoToTheOldestPendingAnalysis(report: Report): Promise<void> {
  const section = report.section('matching');
  const order = [101, 999, 202];
  let stand: Stage;
  stand = await stage({
    respond: (command, data) => {
      if (command !== 'jca') return undefined;
      const answer = data.CID === 999 ? '%xt%jca%1%6%' : jaaFrame(data.CID, data.KID);
      setTimeout(() => stand.server.pushRaw(answer), 20 + order.indexOf(data.CID) * 20);
      return null;
    },
  });

  try {
    const answers: any[] = [];
    const calls = order.map((castleId, index) =>
      new Promise((resolve) => setTimeout(resolve, index * 5)).then(async () => {
        answers[index] = await call(stand.base, `/TestSrv/jca/"CID":${castleId},"KID":0`);
      }),
    );
    await Promise.all(calls);
    section.expect('a refusal between two analyses lands on the castle it refused', {
      ok:
        analysedCastle(answers[0]) === 101 &&
        answers[1]?.return_code === 6 &&
        answers[1]?.content === null &&
        analysedCastle(answers[2]) === 202,
      detail: answers.map((answer) => `${String(analysedCastle(answer))}/${String(answer?.return_code)}`).join(', '),
    });
  } finally {
    await stand.close();
  }
}

async function unknownPlayerIsAnswered(report: Report): Promise<void> {
  const section = report.section('matching');
  let stand: Stage;
  stand = await stage({
    respond: (command) => {
      if (command !== 'gdi') return undefined;
      stand.server.pushRaw('%xt%gdi%1%21%');
      return null;
    },
  });

  try {
    const answer = await call(stand.base, '/TestSrv/gdi/"PID":7');
    section.expect('gdi on a player that does not exist answers 21, not a timeout', {
      ok: answer?.return_code === 21 && answer?.command === 'gdi' && answer?.content === null,
      detail: JSON.stringify(answer),
    });
  } finally {
    await stand.close();
  }
}

async function otherCommandsKeepTimingOutOnBareErrors(report: Report): Promise<void> {
  const section = report.section('matching');
  let stand: Stage;
  stand = await stage({
    respond: (command) => {
      if (command !== 'hgh') return undefined;
      stand.server.pushRaw('%xt%hgh%1%5%');
      return null;
    },
  });

  try {
    const answer = await call(stand.base, '/TestSrv/hgh/"LT":6,"LID":1,"SV":1');
    section.expect('a bare hgh error still ends in a Timeout', {
      ok: answer?.error === 'Timeout' && answer?.return_code === -1,
      detail: JSON.stringify(answer),
    });
  } finally {
    await stand.close();
  }
}

async function lateRefusalIsAbsorbed(report: Report): Promise<void> {
  const section = report.section('matching');
  const socket = createEmpireSocket('ws://127.0.0.1:9', 'LateAnswer');
  const ask = (playerId: number, timeoutMs: number): Promise<any> =>
    socket.waitForJsonResponse('gdi', { O: { OID: playerId } }, timeoutMs, ['gdi']).catch(() => null);
  try {
    await ask(1, 20);
    const second = ask(2, 1000);
    socket._onMessage('%xt%gdi%1%21%', false);
    socket._onMessage('%xt%gdi%1%0%{"O":{"OID":2}}%', false);
    const answer = await second;
    const player = answer?.payload?.data?.O?.OID;
    section.expect('a refusal arriving after its request timed out is absorbed, the next player gets its own', {
      ok: player === 2 && socket.metricsStats.lateAnswers === 1,
      detail: `second got ${String(player)}, late answers ${socket.metricsStats.lateAnswers}`,
    });

    await ask(3, 20);
    await sleep(400);
    const fourth = ask(4, 1000);
    socket._onMessage('%xt%gdi%1%21%', false);
    const refused = await fourth;
    section.expect('past its window, a timed-out request no longer holds its place', {
      ok: refused?.payload?.status === 21 && socket.metricsStats.lateAnswers === 1,
      detail: `fourth got ${String(refused?.payload?.status)}, late answers ${socket.metricsStats.lateAnswers}`,
    });
  } finally {
    disposeSocket(socket);
  }
}

async function twoRefusalsInOneReadReachTwoCallers(report: Report): Promise<void> {
  const section = report.section('matching');
  const socket = createEmpireSocket('ws://127.0.0.1:9', 'SameTick');
  try {
    const waitRefusal = (castleId: number): Promise<any> =>
      socket
        .waitForJsonResponse('jaa', { gca: { A: { 3: castleId } }, KID: 0 }, 1000, ['jaa', 'jca'])
        .catch(() => null);
    const first = waitRefusal(101);
    const second = waitRefusal(202);
    socket._onMessage('%xt%jaa%1%106%', false);
    socket._onMessage('%xt%jca%1%6%', false);
    const [a, b] = await Promise.all([first, second]);
    section.expect('two refusals read in one tick go to two callers, in send order', {
      ok: a?.payload?.status === 106 && b?.payload?.status === 6,
      detail: `first ${String(a?.payload?.status)}, second ${String(b?.payload?.status)}`,
    });
  } finally {
    disposeSocket(socket);
  }
}

async function metricsDoNotGrowWithUnknownNames(report: Report): Promise<void> {
  const section = report.section('matching');
  const stand = await stage();
  try {
    for (let index = 0; index < 50; index++) await call(stand.base, `/NoSuchServer${index}/gpi/null`);
    const metrics = await (await fetch(`${stand.base}/metrics`)).text();
    const series = metrics.split('\n').filter((line) => line.startsWith('empire_api_commands_total{'));
    const named = series.filter((line) => line.includes('NoSuchServer')).length;
    const unknown = series.filter((line) => line.includes('server="unknown"')).length;
    section.expect('requests to 50 unknown servers add one metric series, not fifty', {
      ok: named === 0 && unknown === 1,
      detail: `${named} series named after a requested server, ${unknown} under server="unknown"`,
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
  await castleAnalysesAreMatchedByCastle(report);
  await aStrayAnalysisIsIgnored(report);
  await framesMissingAWaitedValueAreNotParsed(report);
  await payloadIsRelayedVerbatim(report);
  await listKeysStillMatchAnyItem(report);
  await refusedAnalysesAreAnswered(report);
  await refusalsGoToTheOldestPendingAnalysis(report);
  await unknownPlayerIsAnswered(report);
  await otherCommandsKeepTimingOutOnBareErrors(report);
  await lateRefusalIsAbsorbed(report);
  await twoRefusalsInOneReadReachTwoCallers(report);
  await metricsDoNotGrowWithUnknownNames(report);
}
