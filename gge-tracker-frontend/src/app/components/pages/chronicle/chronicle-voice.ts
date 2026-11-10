import { ApiChroniclePlayer } from '@ggetracker-interfaces/empire-ranking';
import { ChronicleSlide } from './chronicle.copy';

export interface ChronicleNote {
  key: string;
  params?: Record<string, string | number>;
}

const EVENT_NOTES: Record<string, string> = {
  nomad: 'n_nomad',
  samurai: 'n_samurai',
  bloodcrow: 'n_bloodcrow',
  berimond: 'n_berimond',
  war_realms: 'n_war',
};

function climbNote(hero: ApiChroniclePlayer, server: string): ChronicleNote {
  const { might } = hero;
  const multiple = might.end / Math.max(might.start, 1);
  if (might.rankEnd === 1) return { key: 'n_climb1', params: { server } };
  if (might.rankEnd !== null && might.rankEnd <= 10) return { key: 'n_climb10' };
  if (multiple >= 3) return { key: 'n_climb3x' };
  if (multiple >= 2) return { key: 'n_climb2x' };
  if (might.higherThanPct >= 90) return { key: 'n_climbHigh' };
  if (might.higherThanPct >= 50) return { key: 'n_climbMid' };
  return { key: 'n_climbLow' };
}

function lootNote(hero: ApiChroniclePlayer, server: string): ChronicleNote {
  const { loot } = hero;
  const pct = Math.round((100 * loot.bestWeek) / Math.max(loot.total, 1));
  if (loot.rank > 0 && loot.rank <= 10) return { key: 'n_lootTop', params: { server } };
  if (loot.weeksLooted >= 4 && pct >= 25) return { key: 'n_lootSpike', params: { pct } };
  if (loot.weeksLooted >= 40) return { key: 'n_lootSteady' };
  if (loot.higherThanPct >= 50) return { key: 'n_lootMid', params: { server } };
  return { key: 'n_lootLow' };
}

function battleNote(hero: ApiChroniclePlayer): ChronicleNote {
  const { events } = hero;
  if (events.podiums >= 10) return { key: 'n_battlePodium' };
  if (events.runs <= 3) return { key: 'n_battleFew' };
  return { key: (events.favourite && EVENT_NOTES[events.favourite]) || 'n_battle' };
}

function worldNote(hero: ApiChroniclePlayer): ChronicleNote {
  const events = [hero.world.outerRealms, hero.world.horizon].flatMap((event) => (event ? [event] : []));
  if (events.some((event) => event.bestRank <= 100)) return { key: 'n_worldTop' };
  if (events.some((event) => event.higherThanPct >= 75)) return { key: 'n_worldHigh' };
  return { key: 'n_world' };
}

function gloryNote(hero: ApiChroniclePlayer): ChronicleNote {
  const { glory } = hero;
  if (glory.rank > 0 && glory.rank <= 10) return { key: 'n_gloryTop' };
  if (glory.best.higherThanPct - glory.higherThanPct >= 15) return { key: 'n_gloryFaded' };
  if (glory.higherThanPct >= 90) return { key: 'n_gloryHigh' };
  return { key: 'n_glory' };
}

function rhythmNote(hero: ApiChroniclePlayer, ownDays: number): ChronicleNote {
  const { rhythm } = hero;
  if (ownDays > 0 && rhythm.activeDays >= ownDays * 0.9) return { key: 'n_yearAlways' };
  if (rhythm.longestStreak >= 100) return { key: 'n_yearStreak' };
  if (rhythm.activeDays < ownDays * 0.2) return { key: 'n_yearFew' };
  return { key: 'n_year' };
}

function allianceNote(hero: ApiChroniclePlayer): ChronicleNote {
  const names = hero.alliance.timeline.map((segment) => segment.name);
  const current = names.at(-1);
  if (names.length === 1) return { key: 'n_allyOne' };
  if (names.indexOf(current ?? null) < names.length - 1) return { key: 'n_allyBack' };
  if (names.length >= 5) return { key: 'n_allyMany' };
  return { key: 'n_ally' };
}

function rivalNote(hero: ApiChroniclePlayer): ChronicleNote | null {
  const rival = hero.rival;
  if (!rival) return null;
  if (rival.monthsAhead * 2 > rival.monthsCompared) return { key: 'n_rivalAhead' };
  if (rival.monthsAhead * 2 < rival.monthsCompared) return { key: 'n_rivalBehind' };
  return { key: 'n_rivalEven' };
}

function summitNote(hero: ApiChroniclePlayer): ChronicleNote {
  const best = hero.might.rankBest;
  return { key: best !== null && best <= 100 ? 'n_summitTop' : 'n_summit' };
}

function coverNote(hero: ApiChroniclePlayer): ChronicleNote | null {
  if (hero.tier === 'short') return { key: 'n_coverShort' };
  if (hero.might.rankEnd !== null && hero.might.rankEnd <= 10) return { key: 'n_coverTop' };
  return null;
}

export function scribeNote(
  slide: ChronicleSlide,
  hero: ApiChroniclePlayer,
  server: string,
  hoursNote: ChronicleNote,
  ownDays: number,
): ChronicleNote | null {
  switch (slide) {
    case 'cover': {
      return coverNote(hero);
    }
    case 'climb': {
      return climbNote(hero, server);
    }
    case 'summit': {
      return summitNote(hero);
    }
    case 'great-day': {
      return hero.might.bestDay ? { key: `n_week${new Date(`${hero.might.bestDay}T12:00:00Z`).getUTCDay()}` } : null;
    }
    case 'plunder': {
      return lootNote(hero, server);
    }
    case 'battlefield': {
      return battleNote(hero);
    }
    case 'beyond': {
      return worldNote(hero);
    }
    case 'glory': {
      return gloryNote(hero);
    }
    case 'rhythm': {
      return rhythmNote(hero, ownDays);
    }
    case 'hours': {
      return hoursNote;
    }
    case 'banner': {
      return allianceNote(hero);
    }
    case 'rival': {
      return rivalNote(hero);
    }
    default: {
      return null;
    }
  }
}
