import { readFileSync } from 'node:fs';

const text = (block, path) => {
  let scope = block;
  for (const tag of path.split('/')) {
    const match = scope.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    if (!match) return '';
    scope = match[1];
  }
  return scope.trim();
};

const blocksOf = (file) => readFileSync(file, 'utf8').match(/<server>[\s\S]*?<\/server>/g) || [];

// The I a tournament row carries: EmpireEx is 1, EmpireEx_3 is 3
const zoneIndex = (zone) => {
  const match = zone.match(/_(\d+)$/);
  return match ? Number(match[1]) : 1;
};

export function readServerDefinition(file, name) {
  const blocks = blocksOf(file);
  const block = blocks.find((candidate) => text(candidate, 'name') === name);
  if (!block) {
    const known = blocks.map((candidate) => text(candidate, 'name')).join(', ');
    throw new Error(`${name} is not described in ${file} (it describes: ${known})`);
  }
  const kind = text(block, 'kind');
  if (!['ep', 'e4k', 'partner'].includes(kind)) throw new Error(`${name} is a "${kind}" entry, not a game server`);
  const definition = {
    name,
    kind,
    game: kind === 'e4k' ? 'e4k' : 'ep',
    code: text(block, 'code'),
    zone: text(block, 'zone'),
    serverId: zoneIndex(text(block, 'zone')),
    globalName: text(block, 'global-name'),
    sql: text(block, 'databases/sql'),
    olap: text(block, 'databases/olap'),
    resetTimezone: text(block, 'reset-timezone') || 'Europe/Paris',
    resetTime: text(block, 'reset-time') || 'MON 00:00',
    hasStorms: text(block, 'scraping/storm') === 'true',
    hasDungeons: text(block, 'scraping/dungeon') === 'true',
  };
  if (!definition.sql || !definition.olap) throw new Error(`${name} declares no <databases>`);
  return definition;
}

export function readGlobalDefinition(file) {
  const block = blocksOf(file).find((candidate) => text(candidate, 'kind') === 'global');
  if (!block) throw new Error(`${file} describes no global entry`);
  return { sql: text(block, 'databases/sql'), olap: text(block, 'databases/olap') };
}
