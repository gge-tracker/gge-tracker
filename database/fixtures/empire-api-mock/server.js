/**
 * Offline stand-in for the empire-api bridge
 *
 * Answers gdi and jca from the players the generator wrote (generated/<set>/bridge/<zone>.json),
 * so a castle search or a castle analysis shows the castles that player has in the database.
 * An id the generated data does not know gets the anonymised template, re-pointed at that id.
 *
 * It deliberately has no dependencies: it runs on a stock node image with a bind mount.
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT ?? 3000);
const DATA = path.join(__dirname, 'data');
const GENERATED = process.env.GENERATED_DIR ?? '/generated';
const CASTLE_ID_STRIDE = 10_000_000;
const RELOAD_EVERY_MS = 5000;

const template = (name) => JSON.parse(fs.readFileSync(path.join(DATA, `${name}.json`), 'utf8'));
const TEMPLATES = { gdi: template('gdi'), jca: template('jca'), gbl: template('gbl') };
const clone = (value) => JSON.parse(JSON.stringify(value));

let zones = new Map();
let signature = '';
let checkedAt = 0;

function bridgeFiles() {
  if (!fs.existsSync(GENERATED)) return [];
  return fs.readdirSync(GENERATED).flatMap((set) => {
    const dir = path.join(GENERATED, set, 'bridge');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((file) => file.endsWith('.json')).map((file) => path.join(dir, file));
  });
}

function reloadIfChanged() {
  if (Date.now() - checkedAt < RELOAD_EVERY_MS) return;
  checkedAt = Date.now();
  const files = bridgeFiles().map((file) => ({ file, mtime: fs.statSync(file).mtimeMs })).sort((a, b) => a.mtime - b.mtime);
  const next = files.map(({ file, mtime }) => `${file}:${mtime}`).join('|');
  if (next === signature) return;
  signature = next;
  zones = new Map();
  for (const { file } of files) {
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    zones.set(record.zone, record.players);
  }
  console.log(`[empire-api-mock] ${zones.size} generated zone(s) loaded`);
}

function readArguments(raw) {
  const found = {};
  for (const [, key, value] of decodeURIComponent(raw).matchAll(/"(\w+)"\s*:\s*(-?\d+)/g)) found[key] = Number(value);
  return found;
}

function owner(base, playerId, player) {
  const result = { ...base, OID: playerId };
  if (!player) return result;
  return { ...result, N: player.N, L: player.L, LL: player.LL, H: player.H, CF: player.CF, HF: player.HF, MP: player.MP, AID: player.AID, AN: player.AN, AR: player.AR };
}

// [kingdom, type, x, y, id, keep, wall, gate, tower, moat, name] to the AI array the game sends
function castleArray(base, castle, playerId) {
  const ai = [...base];
  [ai[0], ai[1], ai[2], ai[3], ai[4]] = [castle[1], castle[2], castle[3], castle[4], playerId];
  [ai[5], ai[6], ai[7], ai[8], ai[9], ai[10]] = castle.slice(5, 11);
  return ai;
}

function playerDetail(zone, playerId) {
  const body = clone(TEMPLATES.gdi);
  const player = zones.get(zone)?.[playerId];
  body.content.O = owner(body.content.O, playerId, player);
  const list = body.content.gcl;
  list.PID = playerId;
  const baseEntry = list.C[0].AI[0];
  if (!player) {
    list.C = [{ ...list.C[0], AI: [{ ...baseEntry, AI: castleArray(baseEntry.AI, [0, 1, 0, 0, playerId, 1, 1, 1, 1, 1, 'Castle'], playerId) }] }];
    return body;
  }
  const byKingdom = Map.groupBy(player.castles, (castle) => castle[0]);
  list.C = [...byKingdom].map(([kingdom, castles]) => ({
    ...list.C[0],
    KID: kingdom,
    AI: castles.map((castle) => ({ ...baseEntry, AI: castleArray(baseEntry.AI, castle, playerId) })),
  }));
  return body;
}

function castleAnalysis(zone, castleId, kingdomId) {
  const body = clone(TEMPLATES.jca);
  const playerId = castleId % CASTLE_ID_STRIDE;
  const player = zones.get(zone)?.[playerId];
  const castle = player?.castles.find((candidate) => candidate[4] === castleId);
  const gca = body.content.gca;
  gca.O = owner(gca.O, playerId, player);
  gca.A = castleArray(gca.A, castle ?? [kingdomId ?? 0, 1, 0, 0, castleId, 1, 1, 1, 1, 1, 'Castle'], playerId);
  body.content.KID = castle ? castle[0] : (kingdomId ?? body.content.KID);
  return body;
}

const server = http.createServer((request, response) => {
  reloadIfChanged();
  const [, zone, command, ...rest] = (request.url ?? '').split('?')[0].split('/');
  const args = readArguments(rest.join('/'));
  let body;
  switch (command) {
    case 'gdi':
      body = playerDetail(zone, args.PID ?? 0);
      break;
    case 'jca':
      body = castleAnalysis(zone, args.CID ?? 0, args.KID);
      break;
    case 'gbl':
      body = clone(TEMPLATES.gbl);
      break;
    default:
      body = { server: zone ?? '', command: command ?? '', return_code: 1, content: {} };
  }
  if (zone) body.server = zone;
  const payload = JSON.stringify(body);
  response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  response.end(payload);
});

server.listen(PORT, () => console.log(`[empire-api-mock] listening on ${PORT}`));
