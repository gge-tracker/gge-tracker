import { Report, Section } from '../lib/report.js';
import { config } from '../config.js';
import { BridgeAnswer, LiveAccount, LiveContainer, readLiveAccount } from '../lib/live-container.js';
import { CommandBudgetExceeded, Pacer } from '../lib/pacer.js';
import { sleep } from '../lib/harness.js';

interface OwnedCastle {
  ownerId: number;
  castleId: number;
  kingdomId: number;
  x: number;
  y: number;
}

interface TrackedOwner {
  ownerId: number;
  name: string;
  trackedPositions: [number, number][];
}

interface Stand {
  section: Section;
  refusals: string[];
  bridge: LiveContainer;
  pacer: Pacer;
  account: LiveAccount;
}

const UNKNOWN_CASTLE_ID = 2_000_000_000;
const UNKNOWN_PLAYER_ID = 1_999_999_999;
const GDI_PLAYER_NOT_FOUND = 21;
const BACKEND_GCA_ARRAYS = ['BD', 'T', 'D', 'G', 'BG', 'CI'];

function withoutServerCode(trackerId: number): number {
  return Number(String(trackerId).slice(0, -3));
}

interface ExportedCastle {
  player_id: string;
  player_name: string;
  kingdom_id: number;
  position_x: number;
  position_y: number;
}

const EXPORT_FIELDS = 'player_id,player_name,kingdom_id,position_x,position_y';

function ownedByEachPlayer(rows: ExportedCastle[]): Map<string, ExportedCastle[]> {
  const byPlayer = new Map<string, ExportedCastle[]>();
  for (const row of rows) byPlayer.set(row.player_id, [...(byPlayer.get(row.player_id) ?? []), row]);
  return byPlayer;
}

async function trackedOwners(serverId: string, wanted: number): Promise<TrackedOwner[]> {
  const url = `${config.trackerApiUrl}/export/castles?limit=500&fields=${EXPORT_FIELDS}`;
  const response = await fetch(url, { headers: { 'gge-server': serverId }, signal: AbortSignal.timeout(15_000) });
  const body = (await response.json()) as { castles?: ExportedCastle[] };
  const mainKingdom = (body.castles ?? []).filter((castle) => castle.kingdom_id === 0);
  return [...ownedByEachPlayer(mainKingdom).values()]
    .filter((castles) => castles.length >= 2)
    .slice(0, wanted)
    .map((castles) => ({
      ownerId: withoutServerCode(Number(castles[0].player_id)),
      name: castles[0].player_name,
      trackedPositions: castles.map((castle) => [castle.position_x, castle.position_y] as [number, number]),
    }));
}

function mainKingdomCastlesOf(ownerId: number, gdi: any): OwnedCastle[] {
  const kingdoms: any[] = gdi?.content?.gcl?.C ?? [];
  return kingdoms
    .filter((kingdom) => kingdom.KID === 0)
    .flatMap((kingdom) =>
      (kingdom.AI ?? []).map((entry: any) => ({
        ownerId,
        castleId: entry.AI[3],
        kingdomId: kingdom.KID,
        x: entry.AI[1],
        y: entry.AI[2],
      })),
    );
}

function analysedCastle(answer: BridgeAnswer): unknown {
  return answer.json?.content?.gca?.A?.[3];
}

function describe(answer: BridgeAnswer): string {
  const content = answer.json?.content;
  if (!content) return `HTTP ${answer.status} ${answer.text.slice(0, 160)}`;
  const castle = String(analysedCastle(answer));
  return `return_code=${answer.json.return_code} castle=${castle} KID=${String(content.KID)} in ${answer.ms}ms`;
}

function missingBackendFields(answer: BridgeAnswer): string[] {
  const gca = answer.json?.content?.gca;
  if (!gca) return ['gca'];
  const missing = BACKEND_GCA_ARRAYS.filter((key) => !Array.isArray(gca[key]));
  if (!Array.isArray(gca.A) || typeof gca.A[10] !== 'string') missing.push('A[10]');
  if (typeof gca.O?.N !== 'string') missing.push('O.N');
  if (typeof gca.O?.L !== 'number') missing.push('O.L');
  return missing;
}

function metricValue(metrics: string, name: string, labels: Record<string, string>): number {
  const wanted = Object.entries(labels).map(([key, value]) => `${key}="${value}"`);
  return metrics
    .split('\n')
    .filter(
      (line) =>
        (line.startsWith(`${name}{`) || line.startsWith(`${name} `)) && wanted.every((label) => line.includes(label)),
    )
    .reduce((sum, line) => sum + Number(line.slice(line.lastIndexOf(' ') + 1)), 0);
}

function jca(stand: Stand, castle: { castleId: number; kingdomId: number }): Promise<BridgeAnswer> {
  return stand.bridge.get(`/${stand.account.zone}/jca/"CID":${castle.castleId},"KID":${castle.kingdomId}`);
}

function gameAnswered(answer: BridgeAnswer): boolean {
  const code = answer.json?.return_code;
  return answer.status === 200 && typeof code === 'number' && code !== -1;
}

function expectAnalysisOf(stand: Stand, label: string, answer: BridgeAnswer, castle: OwnedCastle): void {
  const { section } = stand;
  const content = answer.json?.content;
  section.expect(`${label}: the game's answer reaches the caller`, {
    ok: gameAnswered(answer),
    detail: `asked ${castle.castleId}, ${describe(answer)}`,
  });
  if (answer.json?.return_code !== 0) {
    stand.refusals.push(`${castle.castleId}: ${String(answer.json?.return_code)} as ${String(answer.json?.command)}`);
    section.expect(`${label}: a refusal carries no other castle`, {
      ok: content === null,
      detail: describe(answer),
    });
    return;
  }
  const owner = content?.gca?.O?.OID;
  const [x, y] = [content?.gca?.A?.[1], content?.gca?.A?.[2]];
  section.expect(`${label}: it is the analysis of the castle asked for, at its gdi position`, {
    ok:
      analysedCastle(answer) === castle.castleId &&
      content?.KID === castle.kingdomId &&
      owner === castle.ownerId &&
      x === castle.x &&
      y === castle.y,
    detail: `${describe(answer)}, owner ${String(owner)}, at ${String(x)}:${String(y)} vs gdi ${castle.x}:${castle.y}`,
  });
}

async function readOwners(stand: Stand): Promise<OwnedCastle[][]> {
  const owners = await trackedOwners(stand.account.serverId, config.liveCastle.owners);
  stand.section.expect(
    `gge-tracker lists ${config.liveCastle.owners} ${stand.account.serverId} players with two KID 0 castles`,
    {
      ok: owners.length === config.liveCastle.owners,
      detail: owners.map((owner) => `${owner.name} (${owner.ownerId})`).join(', '),
    },
  );

  const castlesByOwner: OwnedCastle[][] = [];
  for (const owner of owners) {
    const gdi = await stand.pacer.run(1, () => stand.bridge.get(`/${stand.account.zone}/gdi/"PID":${owner.ownerId}`));
    const castles = mainKingdomCastlesOf(owner.ownerId, gdi.json);
    const agreeing = castles.filter((castle) =>
      owner.trackedPositions.some(([x, y]) => x === castle.x && y === castle.y),
    );
    stand.section.expect(`gdi ${owner.name}: answered for this player, castle ids readable`, {
      ok: gdi.json?.return_code === 0 && gdi.json?.content?.O?.OID === owner.ownerId && castles.length > 0,
      detail: `${castles.length} KID 0 castles in ${gdi.ms}ms`,
    });
    stand.section.expect(`gdi ${owner.name}: KID 0 castles match the positions gge-tracker stored`, {
      ok: agreeing.length > 0,
      detail: `${agreeing.length}/${castles.length} at a stored position`,
    });
    castlesByOwner.push(castles);
  }
  return castlesByOwner;
}

async function analysesInSequence(stand: Stand, mains: OwnedCastle[]): Promise<void> {
  for (const castle of mains) {
    const answer = await stand.pacer.run(1, () => jca(stand, castle));
    expectAnalysisOf(stand, `jca ${castle.castleId}`, answer, castle);
    if (answer.json?.return_code !== 0) continue;
    const missing = missingBackendFields(answer);
    stand.section.expect(`jca ${castle.castleId}: carries every field the backend maps`, {
      ok: missing.length === 0,
      detail: missing.length === 0 ? 'gca.O, gca.A, BD, T, D, G, BG, CI present' : `missing ${missing.join(', ')}`,
    });
    stand.section.expect(`jca ${castle.castleId}: relayed as the game's own text`, {
      ok: answer.text.startsWith('{"server":') && answer.text.includes('"command":"jaa"') && answer.json !== null,
      detail: answer.text.slice(0, 120),
    });
  }
}

async function analysesInParallel(stand: Stand, label: string, castles: OwnedCastle[]): Promise<void> {
  const answers = await stand.pacer.run(castles.length, () => Promise.all(castles.map((castle) => jca(stand, castle))));
  castles.forEach((castle, index) => expectAnalysisOf(stand, `${label} ${castle.castleId}`, answers[index], castle));
}

async function serializedCount(stand: Stand): Promise<number> {
  const metrics = await stand.bridge.get('/metrics');
  return metricValue(metrics.text, 'empire_api_command_serialized_total', { command: 'jca' });
}

async function differentCastlesAreNotSerialized(stand: Stand, castles: OwnedCastle[]): Promise<void> {
  const before = await serializedCount(stand);
  await analysesInParallel(stand, 'parallel, different owners:', castles);
  const after = await serializedCount(stand);
  stand.section.expect('jca on different castles were not queued behind each other', {
    ok: after === before,
    detail: `empire_api_command_serialized_total{command="jca"} ${before} -> ${after}`,
  });
}

async function sameCastleTwiceIsSerialized(stand: Stand, castle: OwnedCastle): Promise<void> {
  const before = await serializedCount(stand);
  await analysesInParallel(stand, 'parallel, same castle twice:', [castle, castle]);
  const after = await serializedCount(stand);
  stand.section.expect('two jca on the same castle are queued, their answers cannot be told apart', {
    ok: after === before + 1,
    detail: `empire_api_command_serialized_total{command="jca"} ${before} -> ${after}`,
  });
}

const UNKNOWN_CASTLE: OwnedCastle = { ownerId: 0, castleId: UNKNOWN_CASTLE_ID, kingdomId: 0, x: 0, y: 0 };

async function unknownCastleIsRefusedAtOnce(stand: Stand, next: OwnedCastle): Promise<void> {
  const answer = await stand.pacer.run(1, () => jca(stand, UNKNOWN_CASTLE));
  stand.section.expect('jca on a castle id that does not exist: refused by the game, not timed out', {
    ok: gameAnswered(answer) && answer.json.return_code !== 0 && answer.json.content === null && answer.ms < 1500,
    detail: describe(answer),
  });
  const after = await stand.pacer.run(1, () => jca(stand, next));
  expectAnalysisOf(stand, `after the refusal, jca ${next.castleId}`, after, next);
}

async function refusalBetweenTwoAnalyses(stand: Stand, first: OwnedCastle, last: OwnedCastle): Promise<void> {
  const castles = [first, UNKNOWN_CASTLE, last];
  const answers = await stand.pacer.run(3, () =>
    Promise.all(castles.map((castle, index) => sleep(index * 5).then(() => jca(stand, castle)))),
  );
  expectAnalysisOf(stand, `refusal in between: ${first.castleId}`, answers[0], first);
  stand.section.expect('refusal in between: the unknown castle gets the refusal', {
    ok: gameAnswered(answers[1]) && answers[1].json.return_code !== 0 && answers[1].json.content === null,
    detail: describe(answers[1]),
  });
  expectAnalysisOf(stand, `refusal in between: ${last.castleId}`, answers[2], last);
}

async function burstOfAnalyses(stand: Stand, castles: OwnedCastle[]): Promise<void> {
  await analysesInParallel(stand, `burst of ${castles.length}:`, castles);
}

function gdi(stand: Stand, playerId: number): Promise<BridgeAnswer> {
  return stand.bridge.get(`/${stand.account.zone}/gdi/"PID":${playerId}`);
}

function expectPlayer(stand: Stand, label: string, answer: BridgeAnswer, playerId: number): void {
  stand.section.expect(`${label}: gdi ${playerId} answers that player`, {
    ok: answer.json?.return_code === 0 && answer.json?.content?.O?.OID === playerId,
    detail: describe(answer),
  });
}

function expectPlayerNotFound(stand: Stand, label: string, answer: BridgeAnswer): void {
  stand.section.expect(`${label}: gdi on a player that does not exist answers ${GDI_PLAYER_NOT_FOUND}, not a timeout`, {
    ok: answer.json?.return_code === GDI_PLAYER_NOT_FOUND && answer.json?.content === null && answer.ms < 1500,
    detail: `${describe(answer)} in ${answer.ms}ms`,
  });
}

async function playerNotFoundReachesItsCaller(stand: Stand, owners: number[]): Promise<void> {
  const alone = await stand.pacer.run(1, () => gdi(stand, UNKNOWN_PLAYER_ID));
  expectPlayerNotFound(stand, 'alone', alone);

  const players = [owners[0], UNKNOWN_PLAYER_ID, owners[1]];
  const answers = await stand.pacer.run(3, () =>
    Promise.all(players.map((playerId, index) => sleep(index * 5).then(() => gdi(stand, playerId)))),
  );
  expectPlayer(stand, 'missing player in between', answers[0], owners[0]);
  expectPlayerNotFound(stand, 'missing player in between', answers[1]);
  expectPlayer(stand, 'missing player in between', answers[2], owners[1]);
}

async function bridgeResources(stand: Stand): Promise<void> {
  const metrics = (await stand.bridge.get('/metrics')).text;
  const compressed = metricValue(metrics, 'empire_api_socket_compressed', {});
  const offered = process.env.WS_PER_MESSAGE_DEFLATE !== '0';
  stand.section.expect(`permessage-deflate is ${offered ? 'negotiated when offered' : 'off when not offered'}`, {
    ok: compressed === (offered ? 1 : 0),
    detail: compressed === 1 ? 'every frame is inflated before it is read' : 'frames arrive uncompressed',
  });
  const gdiTimeouts = metricValue(metrics, 'empire_api_commands_total', { command: 'gdi', outcome: 'timeout' });
  stand.section.expect('no gdi of the run timed out', { ok: gdiTimeouts === 0, detail: `${gdiTimeouts} timeouts` });
  const timeouts = metricValue(metrics, 'empire_api_commands_total', { command: 'jca', outcome: 'timeout' });
  const answered = metricValue(metrics, 'empire_api_commands_total', { command: 'jca' });
  stand.section.expect('no jca of the run timed out', {
    ok: timeouts === 0,
    detail: `${timeouts} timeouts out of ${answered} jca; refusals seen: ${stand.refusals.join(', ') || 'none'}`,
  });
  const lagMs = metricValue(metrics, 'empire_api_event_loop_lag_seconds', {}) * 1000;
  const heapMb = metricValue(metrics, 'empire_api_process_heap_used_bytes', {}) / 1024 / 1024;
  const residentMb = metricValue(metrics, 'empire_api_process_resident_memory_bytes', {}) / 1024 / 1024;
  const usage = await stand.bridge.stats();
  stand.section.expect('the bridge stays light: event loop lag, heap and resident set', {
    ok: lagMs < 50 && heapMb < 64 && residentMb < 160,
    detail: `lag ${lagMs.toFixed(1)}ms, heap ${heapMb.toFixed(1)} MB, rss ${residentMb.toFixed(1)} MB, docker ${usage}`,
  });
}

async function runChecks(stand: Stand): Promise<void> {
  const castlesByOwner = await readOwners(stand);
  const mains = castlesByOwner.map((castles) => castles[0]).filter(Boolean);
  if (mains.length < 2) {
    stand.section.skip('castle analyses', 'fewer than two players with a KID 0 castle to analyse');
    return;
  }

  await analysesInSequence(stand, mains);

  const sharedOwner = castlesByOwner.find((castles) => castles.length >= 2);
  if (sharedOwner) {
    await analysesInParallel(stand, 'parallel, same owner:', sharedOwner.slice(0, 2));
  } else {
    stand.section.skip('parallel, same owner', 'no player with two KID 0 castles');
  }

  await differentCastlesAreNotSerialized(stand, mains);
  await sameCastleTwiceIsSerialized(stand, mains[0]);
  await unknownCastleIsRefusedAtOnce(stand, mains[0]);
  await refusalBetweenTwoAnalyses(stand, mains[0], mains[1]);
  await burstOfAnalyses(stand, interleaved(castlesByOwner).slice(0, config.liveCastle.burst));
  await playerNotFoundReachesItsCaller(stand, [mains[0].ownerId, mains[1].ownerId]);
  await bridgeResources(stand);
}

function interleaved(castlesByOwner: OwnedCastle[][]): OwnedCastle[] {
  const longest = Math.max(...castlesByOwner.map((castles) => castles.length));
  return Array.from({ length: longest }, (_, index) => castlesByOwner.map((castles) => castles[index]))
    .flat()
    .filter(Boolean);
}

async function startBridge(section: Section, bridge: LiveContainer, account: LiveAccount): Promise<boolean> {
  const buildStartedAt = Date.now();
  await bridge.build();
  section.expect('the image builds from the working tree', true, Date.now() - buildStartedAt);

  const startedAt = Date.now();
  await bridge.start();
  const connected = await bridge.waitConnected(account.zone, config.liveConnectTimeoutMs);
  section.expect(
    `the container logs in to ${account.zone} (${account.serverId})`,
    {
      ok: connected,
      detail: connected
        ? bridge.base
        : `not connected within ${config.liveConnectTimeoutMs}ms:\n${await bridge.logs()}`,
    },
    Date.now() - startedAt,
  );
  return connected;
}

export async function runLiveCastle(report: Report): Promise<void> {
  const section = report.section('live-castle');
  if (!config.live) {
    section.skip('live castle suite', 'opt-in only - set EMPIRE_TEST_LIVE=1 to run against real GGE servers');
    return;
  }
  const account = readLiveAccount();
  if (typeof account === 'string') {
    section.skip('live castle suite', account);
    return;
  }

  const bridge = new LiveContainer();
  const pacer = new Pacer(config.liveCastle.gapMs, config.liveCastle.maxCommands);
  try {
    if (!(await startBridge(section, bridge, account))) return;
    await runChecks({ section, refusals: [], bridge, pacer, account });
  } catch (error) {
    const budget = error instanceof CommandBudgetExceeded;
    section.expect(budget ? 'the run stays within its command budget' : 'live castle suite ran to the end', {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  } finally {
    section.expect('game commands sent stay within the budget', {
      ok: pacer.used <= config.liveCastle.maxCommands,
      detail: `${pacer.used}/${config.liveCastle.maxCommands}, at least ${config.liveCastle.gapMs}ms apart`,
    });
    await bridge.remove();
  }
}
