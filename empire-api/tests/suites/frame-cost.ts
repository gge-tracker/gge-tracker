import { Report, Section } from '../lib/report.js';
import { createEmpireSocket, disposeSocket, sleep } from '../lib/harness.js';
import { GgeEmpireSocket } from '../../src/utils/ws/empire-socket.js';
import { JsonFramePayload } from '../../src/utils/ws/json-frame-payload.js';

const ROUNDS = 5;
const FRAMES_PER_ROUND = 2000;
const BYTES_PER_MB = 1024 * 1024;
const WAITED = 9_990_101;
const SIBLING = 9_990_102;
const OTHER_OWNER = [9_990_303, 9_990_304];

interface Feedable {
  _onMessage(message: string, needToStringOption?: boolean): void;
  waitForJsonResponse(command: string, data?: unknown, timeout?: number, errorCommands?: string[]): Promise<any>;
}

function jaaFrame(castleId: number, ownerCastles: number[]): string {
  const building = (index: number): number[] => [2997, index, 195, 210, 0, 0, 4, 100, -1, -1, 0, 0, 0, 0, -1, -1, -1];
  const data = {
    KID: 0,
    T: 4,
    gca: {
      O: { OID: 42, N: 'owner', L: 70, AP: ownerCastles.map((id) => [0, id, 10, 10, 1]) },
      BD: Array.from({ length: 120 }, (_, index) => building(index)),
      T: Array.from({ length: 30 }, (_, index) => building(index)),
      D: [building(1)],
      G: [building(2)],
      BG: Array.from({ length: 40 }, (_, index) => building(index)),
      CI: Array.from({ length: 20 }, (_, index) => ({ OID: index, CIL: [{ CID: 700 + index, S: 0 }] })),
      A: [1, 10, 10, castleId, 42, 4, 4, 4, 4, 1, 'castle', 0],
    },
  };
  return `%xt%jaa%1%0%${JSON.stringify(data)}%`;
}

function seiFrame(): string {
  const style = JSON.stringify({ backgroundColor: 'rgb(0, 145, 220)', videoOpacity: 0.7, bannerTitleKey: 'event' });
  const data = { E: Array.from({ length: 30 }, (_, index) => ({ EID: index, RS: 559_104, DATA: style })) };
  return `%xt%sei%1%0%${JSON.stringify(data)}%`;
}

function bodyOf(frame: string): string {
  return frame.slice(frame.indexOf('{'), -1);
}

function gc(): void {
  (global as unknown as { gc?: () => void }).gc?.();
}

function heapUsedMb(): number {
  return process.memoryUsage().heapUsed / BYTES_PER_MB;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function microsPerCall(run: () => void): number {
  for (let index = 0; index < FRAMES_PER_ROUND / 4; index++) run();
  const rounds: number[] = [];
  for (let round = 0; round < ROUNDS; round++) {
    const startedAt = process.hrtime.bigint();
    for (let index = 0; index < FRAMES_PER_ROUND; index++) run();
    rounds.push(Number(process.hrtime.bigint() - startedAt) / 1000 / FRAMES_PER_ROUND);
  }
  return median(rounds);
}

function pendingResponses(socket: GgeEmpireSocket): number {
  return (socket as unknown as { messages: unknown[] }).messages.length;
}

function ratio(cost: number, reference: number): string {
  const share = ((cost / reference) * 100).toFixed(1);
  return `${cost.toFixed(2)}us per frame, ${share}% of a JSON.parse (${reference.toFixed(2)}us)`;
}

function waitForCastle(socket: Feedable, castleId: number): Promise<any> {
  return socket.waitForJsonResponse('jaa', { gca: { A: { 3: castleId } }, KID: 0 }, 60_000).catch(() => null);
}

function unwantedFramesCostNoParse(section: Section, socket: Feedable): void {
  const frame = seiFrame();
  const parse = microsPerCall(() => JSON.parse(bodyOf(frame)));
  const cost = microsPerCall(() => socket._onMessage(frame, false));
  section.expect('a frame nobody waits for costs a small fraction of a parse', {
    ok: cost < parse * 0.15,
    detail: `sei ${frame.length} chars: ${ratio(cost, parse)}`,
  });
}

function framesOfAnotherCastleAreRejectedBeforeParsing(section: Section, socket: Feedable): void {
  const frame = jaaFrame(OTHER_OWNER[0], OTHER_OWNER);
  const parse = microsPerCall(() => JSON.parse(bodyOf(frame)));
  const cost = microsPerCall(() => socket._onMessage(frame, false));
  section.expect('an analysis of another owner is rejected by its text, never parsed', {
    ok: cost < parse * 0.35,
    detail: `jaa ${frame.length} chars: ${ratio(cost, parse)}`,
  });
}

function framesOfASiblingCastleCostOneParse(section: Section, socket: Feedable): void {
  const frame = jaaFrame(SIBLING, [WAITED, SIBLING]);
  const parse = microsPerCall(() => JSON.parse(bodyOf(frame)));
  const cost = microsPerCall(() => socket._onMessage(frame, false));
  section.expect('an analysis of a sibling castle costs about one parse', {
    ok: cost < parse * 1.6,
    detail: `jaa ${frame.length} chars: ${ratio(cost, parse)}`,
  });
}

function relayingSkipsTheStringify(section: Section): void {
  const body = bodyOf(jaaFrame(WAITED, [WAITED]));
  const parsedOnce = new JsonFramePayload('jaa', '1', 0, body);
  void parsedOnce.data;
  const relay = microsPerCall(() => parsedOnce.toJson());
  const stringify = microsPerCall(() => JSON.stringify(parsedOnce.data));
  section.expect('relaying an answer costs nothing next to stringifying it again', {
    ok: relay < stringify * 0.05,
    detail: `toJson ${relay.toFixed(3)}us, JSON.stringify ${stringify.toFixed(2)}us`,
  });
}

async function manyPendingAnalysesStayLinear(section: Section, socket: Feedable & GgeEmpireSocket): Promise<void> {
  const waiting = 200;
  const castleIds = Array.from({ length: waiting }, (_, index) => 20_000_000 + index);
  const frames = castleIds.map((castleId) => jaaFrame(castleId, castleIds.slice(0, 4)));
  const parse = microsPerCall(() => JSON.parse(bodyOf(frames[0])));

  const answers = castleIds.map((castleId) => waitForCastle(socket, castleId));
  const startedAt = process.hrtime.bigint();
  for (const frame of [...frames].reverse()) socket._onMessage(frame, false);
  const cost = Number(process.hrtime.bigint() - startedAt) / 1000 / waiting;
  const delivered = await Promise.all(answers);
  const correct = delivered.filter((answer, index) => answer?.payload?.data?.gca?.A?.[3] === castleIds[index]).length;

  section.expect(`${waiting} analyses pending at once each get their own castle`, {
    ok: correct === waiting && pendingResponses(socket) === 0,
    detail: `${correct}/${waiting} correct, ${pendingResponses(socket)} left pending`,
  });
  section.expect(`with ${waiting} analyses pending, a frame costs a few parses at most`, {
    ok: cost < parse * 4,
    detail: ratio(cost, parse),
  });
}

async function rejectedFramesLeaveNoHeap(section: Section, socket: Feedable & GgeEmpireSocket): Promise<void> {
  const unwanted = seiFrame();
  const otherOwner = jaaFrame(OTHER_OWNER[0], OTHER_OWNER);
  const answer = waitForCastle(socket, WAITED);
  for (let index = 0; index < 1000; index++) socket._onMessage(otherOwner, false);
  for (let pass = 0; pass < 3; pass++) gc();
  await sleep(20);
  const baseHeap = heapUsedMb();
  for (let index = 0; index < 20_000; index++) {
    socket._onMessage(unwanted, false);
    socket._onMessage(otherOwner, false);
  }
  for (let pass = 0; pass < 3; pass++) gc();
  await sleep(20);
  const growth = heapUsedMb() - baseHeap;
  socket._onMessage(jaaFrame(WAITED, [WAITED]), false);
  const delivered = await answer;

  section.expect('40 000 dropped frames leave the heap where it was', {
    ok: growth < 2,
    detail: `heap ${growth >= 0 ? '+' : ''}${growth.toFixed(2)} MB`,
  });
  section.expect('the analysis waited for all along still arrives afterwards', {
    ok: delivered?.payload?.data?.gca?.A?.[3] === WAITED && pendingResponses(socket) === 0,
    detail: `castle ${String(delivered?.payload?.data?.gca?.A?.[3])}, ${pendingResponses(socket)} pending`,
  });
}

export async function runFrameCost(report: Report): Promise<void> {
  const section = report.section('frame-cost');
  const socket = createEmpireSocket('ws://127.0.0.1:9', 'FrameCost');
  const pending = waitForCastle(socket, WAITED);
  try {
    unwantedFramesCostNoParse(section, socket);
    framesOfAnotherCastleAreRejectedBeforeParsing(section, socket);
    framesOfASiblingCastleCostOneParse(section, socket);
    relayingSkipsTheStringify(section);
    socket._onMessage(jaaFrame(WAITED, [WAITED]), false);
    await pending;
    await manyPendingAnalysesStayLinear(section, socket);
    await rejectedFramesLeaveNoHeap(section, socket);
  } finally {
    disposeSocket(socket);
  }
}
