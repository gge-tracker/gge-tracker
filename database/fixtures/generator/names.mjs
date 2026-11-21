const PLAYER_STARTS = ['Al', 'Bran', 'Cael', 'Dor', 'Ed', 'Fen', 'Gar', 'Hal', 'Ise', 'Jor', 'Kel', 'Lor', 'Mor', 'Nor', 'Os', 'Per', 'Quin', 'Ros', 'Sel', 'Tor', 'Ul', 'Val', 'Wil', 'Yor', 'Zan'];
const PLAYER_MIDDLES = ['a', 'e', 'i', 'o', 'u', 'ae', 'ia', 'or', 'an', 'el', 'ar', 'en'];
const PLAYER_ENDS = ['dric', 'wyn', 'mar', 'ric', 'thas', 'win', 'gar', 'dan', 'wen', 'ia', 'or', 'us', 'eth', 'ald', 'ina', 'is'];
const PLAYER_TITLES = ['the Bold', 'Ironhand', 'of the Vale', 'Stormborn', 'the Wise', 'Redcloak', 'Oakheart'];

const ALLIANCE_ADJECTIVES = ['Iron', 'Crimson', 'Silent', 'Golden', 'Northern', 'Ashen', 'Wild', 'Eternal', 'Black', 'Silver', 'Burning', 'Frozen', 'Hidden', 'Royal', 'Free'];
const ALLIANCE_NOUNS = ['Wolves', 'Lions', 'Keep', 'Legion', 'Banners', 'Ravens', 'Crown', 'Order', 'Guard', 'Riders', 'Shields', 'Hawks', 'Covenant', 'Watch', 'Blades'];
const ALLIANCE_TAGS = ['', '', '', ' II', ' Academy', ' Reborn'];

const DESCRIPTIONS = [
  'Active alliance, daily events, mutual help.',
  'Recruiting level 70 players. Discord required.',
  'Friendly family, no stress, help with defence.',
  'Top 10 goal. Daily attacks on nomads and samurai.',
  'Casual players welcome, just be active once a day.',
];

export class NameForge {
  constructor(random) {
    this.random = random;
    this.taken = new Set();
  }

  player() {
    return this.unique(() => {
      const base = this.random.pick(PLAYER_STARTS) + this.random.pick(PLAYER_MIDDLES) + this.random.pick(PLAYER_ENDS);
      const roll = this.random.next();
      if (roll < 0.15) return `${base} ${this.random.pick(PLAYER_TITLES)}`;
      if (roll < 0.35) return `${base}${this.random.integer(1, 99)}`;
      if (roll < 0.45) return `${base}_${this.random.pick(PLAYER_ENDS)}`;
      return base;
    });
  }

  alliance() {
    return this.unique(() => {
      const name = `${this.random.pick(ALLIANCE_ADJECTIVES)} ${this.random.pick(ALLIANCE_NOUNS)}${this.random.pick(ALLIANCE_TAGS)}`;
      return this.random.chance(0.2) ? `The ${name}` : name;
    }, 30);
  }

  description() {
    return this.random.pick(DESCRIPTIONS);
  }

  unique(build, maxLength = 40) {
    for (let attempt = 0; ; attempt++) {
      let name = build().slice(0, maxLength);
      if (attempt > 20) name = `${name.slice(0, maxLength - 5)} ${this.random.integer(1000, 9999)}`;
      if (!this.taken.has(name)) {
        this.taken.add(name);
        return name;
      }
    }
  }
}
