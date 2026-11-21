export class Random {
  constructor(seed) {
    this.state = seed >>> 0 || 1;
  }

  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  chance(probability) {
    return this.next() < probability;
  }

  between(min, max) {
    return min + this.next() * (max - min);
  }

  integer(min, max) {
    return Math.floor(this.between(min, max + 1));
  }

  pick(items) {
    return items[Math.floor(this.next() * items.length)];
  }

  gaussian(mean = 0, deviation = 1) {
    const u = 1 - this.next();
    const v = this.next();
    return mean + deviation * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  shuffle(items) {
    for (let index = items.length - 1; index > 0; index--) {
      const other = Math.floor(this.next() * (index + 1));
      [items[index], items[other]] = [items[other], items[index]];
    }
    return items;
  }

  uniqueIntegers(count, min, max) {
    const taken = new Set();
    while (taken.size < count) taken.add(this.integer(min, max));
    return [...taken];
  }
}
