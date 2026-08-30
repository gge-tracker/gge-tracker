/**
 * Discovers real, live data so "valid input" requests actually exercise the data paths
 * (DBs, cache) instead of just bouncing off validation
 */
import { request } from './http';
import { config } from '../config';
import { AuthorizedSpecialServersEnum } from '../../src/api/enums/gge-tracker-special-servers.enums';

export interface Seeds {
  server?: string;
  serverHeader(): Record<string, string>;
  specialServer?: string;
  unsupportedServer?: string;
  playerId?: string;
  playerName?: string;
  allianceId?: string;
  allianceName?: string;
  castleId?: string;
  castlePlayerName?: string;
  eventPlayerName?: string;
  woaEventId?: string;
  woaEventDate?: string;
  woaPlayerId?: string;
  movementPlayerName?: string;
  renamePlayerName?: string;
  stormOccupierName?: string;
  alliedPlayerName?: string;
  alliedPlayerAlliance?: string;
  alliedPlayerRank?: number;
  movementType?: string;
  movementCastleType?: number;
  statusEtag?: string;
}

const SPECIAL_SERVERS = new Set<string>(Object.values(AuthorizedSpecialServersEnum));

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
    const servers: string[] = serversRes.body;
    const pick = (wanted: string, fallback: (s: string) => boolean): string | undefined =>
      servers.includes(wanted) ? wanted : servers.find(fallback);

    seeds.server = pick(config.server, (s) => /^(DE|FR|US|INT)\d/.test(s)) ?? servers[0];
    seeds.specialServer = SPECIAL_SERVERS.has(config.specialServer)
      ? pick(config.specialServer, (s) => SPECIAL_SERVERS.has(s))
      : servers.find((s) => SPECIAL_SERVERS.has(s));
    seeds.unsupportedServer = pick(config.unsupportedServer, (s) => !SPECIAL_SERVERS.has(s));
  }

  const header = seeds.server ? { 'gge-server': seeds.server } : {};

  if (seeds.server) {
    const statusRes = await request({ path: '/', headers: header });
    const etag = statusRes.headers['etag'];
    if (typeof etag === 'string' && etag !== '') seeds.statusEtag = etag;

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

    const castleRes = await request({ path: '/castle/random', headers: header, timeoutMs: 3000 });
    const castle = Array.isArray(castleRes.body) ? castleRes.body[0] : castleRes.body;
    if (castle && (castle.castle_id || castle.id)) {
      seeds.castleId = String(castle.castle_id ?? castle.id);
    }

    const candidates: string[] = (playersRes.body?.players ?? [])
      .map((p: any) => p?.player_name)
      .filter((name: unknown): name is string => typeof name === 'string' && name !== '');
    for (const name of candidates.slice(0, 15)) {
      const found = await request({ path: `/castle/search/${encodeURIComponent(name)}`, headers: header, timeoutMs: 3000 });
      if (found.status === 200) {
        seeds.castlePlayerName = name;
        break;
      }
    }

    const woaRes = await request({ path: '/woa/events?page=1', headers: header });
    const woaEvent = woaRes.body?.events?.[0];
    if (woaEvent?.id) seeds.woaEventId = String(woaEvent.id);
    if (woaEvent?.date) seeds.woaEventDate = String(woaEvent.date).slice(0, 10);

    if (seeds.woaEventId) {
      const woaParticipants = await request({ path: `/woa/events/id/${seeds.woaEventId}?page=1`, headers: header });
      const participant = woaParticipants.body?.players?.[0];
      if (participant?.player_id) seeds.woaPlayerId = String(participant.player_id);
    }

    const movementsRes = await request({ path: '/server/movements?page=1', headers: header });
    seeds.movementPlayerName = movementsRes.body?.movements?.[0]?.player_name ?? undefined;

    const renamesRes = await request({ path: '/server/renames?page=1', headers: header });
    const rename = renamesRes.body?.renames?.[0];
    seeds.renamePlayerName = rename?.new_player_name ?? rename?.player_name ?? undefined;

    const movement = movementsRes.body?.movements?.[0];
    seeds.movementType = movement?.movement_type ?? undefined;
    seeds.movementCastleType = movement?.castle_type ?? undefined;

    const allied = (playersRes.body?.players ?? []).find((p: any) => p?.alliance_id && p?.alliance_name);
    if (allied) {
      seeds.alliedPlayerName = allied.player_name ?? undefined;
      seeds.alliedPlayerAlliance = allied.alliance_name ?? undefined;
      seeds.alliedPlayerRank = allied.alliance_rank ?? undefined;
    }
  }

  const eventPlayersRes = await request({
    path: `/events/outer-realms/1/players?page=1${seeds.server ? `&server=${encodeURIComponent(seeds.server)}` : ''}`,
  });
  seeds.eventPlayerName = eventPlayersRes.body?.players?.[0]?.player_name ?? undefined;

  if (seeds.specialServer) {
    const occupied = await request({
      path: '/storms/isles?page=1&filterByState=2',
      headers: { 'gge-server': seeds.specialServer },
    });
    seeds.stormOccupierName = occupied.body?.isles?.find((isle: any) => isle?.occupier_name)?.occupier_name ?? undefined;
  }

  cached = seeds;
  return seeds;
}

export interface Preflight {
  pool: string;
  probe: string;
  ok: boolean;
  detail: string;
}

export async function preflight(seeds: Seeds, onResult?: (result: Preflight) => void): Promise<Preflight[]> {
  const probes: { pool: string; probe: string; headers?: Record<string, string> }[] = [
    { pool: 'per-server postgres', probe: '/players?page=1', headers: seeds.serverHeader() },
    { pool: 'shared global postgres', probe: '/grand-tournament/dates' },
    { pool: 'clickhouse', probe: `/statistics/player/${seeds.playerId ?? '1'}/might/30`, headers: seeds.serverHeader() },
    {
      pool: 'empire-api bridge',
      probe: `/castle/search/${encodeURIComponent(seeds.castlePlayerName ?? seeds.playerName ?? 'a')}`,
      headers: seeds.serverHeader(),
    },
  ];

  const results: Preflight[] = [];
  for (const { pool, probe, headers } of probes) {
    const res = await request({ path: probe, headers, timeoutMs: 5000 });
    const result: Preflight = {
      pool,
      probe,
      ok: res.status < 500 && res.status !== 0,
      detail:
        res.status === 0
          ? `unreachable (${res.networkError})`
          : res.status >= 500
            ? `${res.status} after ${Math.round(res.ms)}ms - restart the API, this pool is not serving`
            : `${res.status} in ${Math.round(res.ms)}ms`,
    };
    results.push(result);
    onResult?.(result);
  }
  return results;
}

export function describeSeeds(s: Seeds): string {
  return [
    `server=${s.server ?? 'NONE'}`,
    `storms=${s.specialServer ?? 'NONE'}`,
    `player=${s.playerId ?? '-'}/${s.playerName ?? '-'}`,
    `alliance=${s.allianceId ?? '-'}/${s.allianceName ?? '-'}`,
    `castle=${s.castleId ?? '-'}/${s.castlePlayerName ?? '-'}`,
    `woa=${s.woaEventId ?? '-'}@${s.woaEventDate ?? '-'}/player=${s.woaPlayerId ?? '-'}`,
  ].join('  ');
}
