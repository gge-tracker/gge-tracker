import { clickHouseDateTime } from './csv-writer.mjs';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const RANKED_EVENTS = [
  { key: 'nomad', lt: 46, table: 'player_event_nomad_history', days: 3, period: 14, share: 0.5, scale: 4e4 },
  { key: 'war_realms', lt: 44, table: 'player_event_war_realms_history', days: 7, period: 21, share: 0.45, scale: 6e6 },
  { key: 'samurai', lt: 51, table: 'player_event_samurai_history', days: 5, period: 14, share: 0.5, scale: 2e4 },
  { key: 'bloodcrow', lt: 58, table: 'player_event_bloodcrow_history', days: 3, period: 14, share: 0.4, scale: 5e6 },
  { key: 'berimond_kingdom', lt: 30, table: 'player_event_berimond_kingdom_history', days: 6, period: 14, share: 0.35, scale: 6e4 },
];

export class EventHours {
  constructor(hours) {
    this.byEvent = new Map(RANKED_EVENTS.map((event) => [event.key, Array.from({ length: hours }, () => null)]));
  }

  record(event, hour, playerId, point) {
    const slots = this.byEvent.get(event.key);
    const slot = (slots[hour] ??= { players: 0, points: 0, top: [] });
    slot.players++;
    slot.points += point;
    slot.top.push({ id: String(playerId), point });
    if (slot.top.length > 3) slot.top = slot.top.sort((a, b) => b.point - a.point).slice(0, 3);
  }

  at(event, hour) {
    return this.byEvent.get(event.key)[hour];
  }
}

function runsWithin(random, event, timeline) {
  const period = event.period * DAY;
  const duration = event.days * DAY;
  let start = timeline[0] - random.next() * period;
  const runs = [];
  for (; start < timeline.at(-1); start += period) {
    if (start + duration > timeline[0]) runs.push({ start, end: start + duration });
  }
  return runs;
}

export async function writeRankedEvents(random, dataset, server, world, timeline) {
  const hours = new EventHours(timeline.length);
  const stamps = timeline.map(clickHouseDateTime);
  const dates = dataset.clickhouse(server.olap, 'event_dates');
  for (const event of RANKED_EVENTS) {
    const writer = dataset.clickhouse(server.olap, event.table);
    const participants = world.players.filter((player) => player.active && random.chance(event.share));
    for (const run of runsWithin(random, event, timeline)) {
      const finals = new Map(
        participants.map((player) => [player.id, Math.max(1, Math.round(event.scale * Math.pow(player.might / 1e6, 0.8) * random.between(0.2, 3)))]),
      );
      for (let hour = 0; hour < timeline.length; hour++) {
        const instant = timeline[hour];
        if (instant < run.start || instant >= run.end) continue;
        await dates.write([event.table, clickHouseDateTime(instant + random.integer(0, 30) * 1000)]);
        const progress = Math.pow((instant - run.start) / (run.end - run.start), 1.2);
        for (const player of participants) {
          const point = Math.round(finals.get(player.id) * progress);
          if (point <= 0) continue;
          await writer.write([player.id, point, stamps[hour]]);
          hours.record(event, hour, player.id, point);
        }
      }
    }
    await writer.close();
  }
  await dates.close();
  return hours;
}

export async function writeWheelOfAffluence(random, dataset, server, world, timeline) {
  const writer = dataset.clickhouse(server.olap, 'wheel_unimaginable_affluence');
  const players = world.players.filter((player) => player.active);
  let draw = Math.floor(timeline[0] / (12 * HOUR)) * 12 * HOUR + 7 * HOUR + 58 * 60_000;
  for (; draw <= timeline.at(-1); draw += 12 * HOUR) {
    if (draw < timeline[0]) continue;
    for (const player of players) {
      if (!random.chance(0.12)) continue;
      await writer.write([player.id, Math.min(65_535, Math.round(Math.pow(random.next(), 3) * 800) + 1), clickHouseDateTime(draw + random.integer(0, 5) * 1000)]);
    }
  }
  await writer.close();
}

export async function writeAquamarineMetrics(random, dataset, server, world, timeline) {
  const writer = dataset.clickhouse(server.olap, 'player_metrics');
  const entrants = world.players.filter((player) => player.realmCastles.some((castle) => castle[0] === 4));
  const snapshots = [];
  for (let instant = timeline.at(-1) - 2 * 60_000; instant >= timeline[0] && snapshots.length < 8; instant -= DAY) snapshots.unshift(instant);
  for (const player of entrants) {
    const scale = Math.pow(player.might / 1e6, 0.7) * random.between(0.2, 5);
    const finals = {
      15: Math.round(scale * 150_000),
      16: random.chance(0.4) ? Math.round(scale * 30_000) : 0,
      18: random.chance(0.1) ? Math.round(scale * 5_000) : 0,
      19: random.chance(0.5) ? Math.round(scale * 200_000) : 0,
      100: Math.round(scale * random.between(500, 20_000)),
    };
    finals[17] = Math.round(finals[15] * random.between(0.85, 1));
    finals[20] = finals[18];
    for (const [index, instant] of snapshots.entries()) {
      const progress = (index + 1) / snapshots.length;
      const stamp = clickHouseDateTime(instant);
      for (const [metric, value] of Object.entries(finals)) await writer.write([player.id, Number(metric), Math.round(value * progress), stamp]);
      await writer.write([player.id, 21, Math.floor((instant - random.integer(0, 36) * HOUR) / 1000), stamp]);
    }
  }
  await writer.close();
}
