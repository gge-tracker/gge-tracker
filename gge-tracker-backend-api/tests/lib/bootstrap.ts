/**
 * Discovers real, live data so "valid input" requests actually exercise the data paths
 * (DBs, cache) instead of just bouncing off validation
 */
import { request } from './http';

export interface Seeds {
  server?: string;
  serverHeader(): Record<string, string>;
  playerId?: string;
  playerName?: string;
  allianceId?: string;
  allianceName?: string;
  castleId?: string;
}

let cached: Seeds | undefined;

export async function bootstrap(): Promise<Seeds> {
  if (cached) return cached;

  const seeds: Seeds = {
    serverHeader() {
      return this.server ? { 'gge-server': this.server } : {};
    },
  };

  const serversRes = await request({ path: '/servers' });
  if (Array.isArray(serversRes.body) && serversRes.body.length > 0) {
    const preferred = serversRes.body.find((s: string) => /^(DE|FR|US|INT)\d/.test(s));
    seeds.server = preferred ?? serversRes.body[0];
  }

  const header = seeds.server ? { 'gge-server': seeds.server } : {};

  if (seeds.server) {
    const playersRes = await request({ path: '/players?page=1', headers: header });
    const first = playersRes.body?.players?.[0];
    if (first) {
      seeds.playerId = String(first.player_id ?? '');
      seeds.playerName = first.player_name ?? undefined;
    }

    const alliancesRes = await request({ path: '/alliances?page=1', headers: header });
    const firstAlliance = alliancesRes.body?.alliances?.[0];
    if (firstAlliance) {
      seeds.allianceId = String(firstAlliance.alliance_id ?? '');
      seeds.allianceName = firstAlliance.alliance_name ?? undefined;
    }

    const castleRes = await request({ path: '/castle/random', headers: header });
    const castle = castleRes.body;
    if (castle && (castle.castle_id || castle.id)) {
      seeds.castleId = String(castle.castle_id ?? castle.id);
    }
  }

  cached = seeds;
  return seeds;
}

export function describeSeeds(s: Seeds): string {
  return [
    `server=${s.server ?? 'NONE'}`,
    `player=${s.playerId ?? '-'}/${s.playerName ?? '-'}`,
    `alliance=${s.allianceId ?? '-'}/${s.allianceName ?? '-'}`,
    `castle=${s.castleId ?? '-'}`,
  ].join('  ');
}
