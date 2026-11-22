const HOUR = 3_600_000;
const NEW_ACCOUNT_MAX_LEVEL = 50;

// Drawn from its own random stream -> adding it left every other generated row unchanged
export function buildVicinityHistory(random, world, timeline) {
  const start = timeline[0];
  const end = timeline.at(-1);
  const instant = () => random.integer(start, end) + random.integer(60, 240) * 1000;
  const firstSeen = new Map();
  const stateChanges = [];
  for (const player of world.players) {
    if (player.castles.length === 0) continue;
    if (player.level < NEW_ACCOUNT_MAX_LEVEL && random.chance(0.15)) firstSeen.set(player.id, instant());
    if (player.active && random.chance(0.35)) stateChanges.push(...honorChanges(random, player, instant));
    if (player.peaceSeconds > 0 && random.chance(0.6)) stateChanges.push(protectionStarted(player, instant(), end));
    if (player.peaceSeconds === 0 && random.chance(0.04)) stateChanges.push(protectionEnded(random, player, instant()));
    if (random.chance(0.01)) stateChanges.push(stateRow(player, instant(), { ruin: [false, true] }));
  }
  return { firstSeen, stateChanges: stateChanges.sort((a, b) => a.at - b.at) };
}

function honorChanges(random, player, instant) {
  const instants = Array.from({ length: random.integer(1, 12) }, instant).sort((a, b) => a - b);
  const values = [player.honor];
  for (let index = 0; index < instants.length; index++) {
    values.unshift(Math.max(0, values[0] - random.pick([-1, 1]) * random.integer(5, 120)));
  }
  return instants
    .map((at, index) => stateRow(player, at, { honor: [values[index], values[index + 1]] }))
    .filter((row) => row.honorOld !== row.honorNew);
}

function protectionStarted(player, at, end) {
  return stateRow(player, at, { peace: [false, true], peaceUntil: [null, end + player.peaceSeconds * 1000] });
}

function protectionEnded(random, player, at) {
  const scheduledEnd = random.chance(0.5) ? at - random.integer(1, 50) * 60_000 : at + random.integer(2, 48) * HOUR;
  return stateRow(player, at, { peace: [true, false], peaceUntil: [scheduledEnd, null] });
}

function stateRow(player, at, change) {
  const [honorOld, honorNew] = change.honor ?? [player.honor, player.honor];
  const [peaceOld, peaceNew] = change.peace ?? [player.peaceSeconds > 0, player.peaceSeconds > 0];
  const [peaceUntilOld, peaceUntilNew] = change.peaceUntil ?? [null, null];
  const [ruinOld, ruinNew] = change.ruin ?? [false, false];
  return { playerId: player.id, honorOld, honorNew, peaceOld, peaceNew, peaceUntilOld, peaceUntilNew, ruinOld, ruinNew, at };
}
