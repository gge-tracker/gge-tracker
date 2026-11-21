const HOUR = 3_600_000;
const FILL_MINUTE = 9;

export function buildTimeline(now, days) {
  let last = Math.floor(now / HOUR) * HOUR + FILL_MINUTE * 60_000;
  if (last > now) last -= HOUR;
  const hours = days * 24;
  return Array.from({ length: hours }, (_, index) => last - (hours - 1 - index) * HOUR);
}

export function growingSeries(random, current, hours, active, spread) {
  const values = new Array(hours);
  values[hours - 1] = current;
  const growth = active ? random.between(spread * 0.1, spread) : 0;
  const step = (current * growth) / (hours * 0.25);
  for (let index = hours - 2; index >= 0; index--) {
    const next = values[index + 1];
    if (active && random.chance(0.004)) values[index] = Math.round(next * random.between(1.01, 1.05));
    else if (active && random.chance(0.25)) values[index] = Math.max(1, Math.round(next - step * random.between(0, 2)));
    else values[index] = next;
  }
  return values;
}

export function weeklyLootSeries(random, pace, timeline, weekStarts) {
  const values = new Array(timeline.length);
  if (pace === 0) return values.fill(0);
  const hoursIntoWeek = (timeline[0] - weekStarts[0]) / HOUR;
  let value = Math.round(pace * hoursIntoWeek * 0.35 * random.between(0.6, 1.4));
  for (let index = 0; index < timeline.length; index++) {
    if (index > 0 && weekStarts[index] !== weekStarts[index - 1]) value = 0;
    if (random.chance(0.35)) value += Math.round(pace * random.between(0.3, 1.7));
    values[index] = value;
  }
  return values;
}

export class HourlyTotals {
  constructor(hours) {
    this.might = new Float64Array(hours);
    this.loot = new Float64Array(hours);
    this.maxMight = new Float64Array(hours);
    this.maxMightPlayer = new Array(hours).fill(null);
    this.maxLoot = new Float64Array(hours);
    this.maxLootPlayer = new Array(hours).fill(null);
  }

  add(playerId, might, loot) {
    for (let index = 0; index < might.length; index++) {
      this.might[index] += might[index];
      this.loot[index] += loot[index];
      if (might[index] > this.maxMight[index]) {
        this.maxMight[index] = might[index];
        this.maxMightPlayer[index] = playerId;
      }
      if (loot[index] > this.maxLoot[index]) {
        this.maxLoot[index] = loot[index];
        this.maxLootPlayer[index] = playerId;
      }
    }
  }
}
