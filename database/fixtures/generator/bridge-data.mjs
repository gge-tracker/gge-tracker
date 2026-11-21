export const CASTLE_ID_STRIDE = 10_000_000;
const CASTLE_LABELS = { 4: 'Outpost', 26: 'Monument', 28: 'Laboratory' };

export function assignCastleIds(world) {
  for (const player of world.players) {
    const entries = [
      ...player.castles.map(([x, y, type]) => ({ kingdom: 0, x, y, type })),
      ...player.realmCastles.map(([kingdom, x, y, type]) => ({ kingdom, x, y, type })),
    ];
    entries.forEach((entry, index) => (entry.id = (index + 1) * CASTLE_ID_STRIDE + player.id));
    player.castleEntries = entries;
    player.mainCastleId = entries.find((entry) => entry.kingdom === 0 && entry.type === 1)?.id ?? null;
  }
}

// What the mock bridge answers gdi and jca from: the generated player, castle by castle
export function bridgeRecord(random, server, world) {
  const allianceNames = new Map(world.alliances.map((alliance) => [alliance.id, alliance.name]));
  const players = {};
  for (const player of world.players) {
    if (player.castleEntries.length === 0) continue;
    const level = (max) => random.integer(Math.max(1, max - 4), max);
    const counters = {};
    const label = (type) => {
      const word = CASTLE_LABELS[type] ?? 'Landmark';
      counters[word] = (counters[word] ?? 0) + 1;
      return `${word} ${counters[word]}`;
    };
    players[player.id] = {
      N: player.name,
      L: player.level,
      LL: player.legendaryLevel,
      H: player.honor,
      CF: player.fame,
      HF: player.highestFame,
      MP: player.might,
      AID: player.allianceId ?? -1,
      AN: allianceNames.get(player.allianceId) ?? '',
      AR: player.allianceRank ?? 0,
      castles: player.castleEntries.map((entry) => {
        const name =
          entry.kingdom !== 0 ? `${player.name.slice(0, 12)} ${entry.kingdom}` : entry.type === 1 ? player.name.slice(0, 20) : label(entry.type);
        return [entry.kingdom, entry.type, entry.x, entry.y, entry.id, level(8), level(8), level(8), level(8), level(6), name];
      }),
    };
  }
  return { zone: server.zone, players };
}
