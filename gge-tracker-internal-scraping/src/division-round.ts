//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
import { ScrapingServer } from './servers-file';

export type DivisionRoundGame = 'ep' | 'e4k';

export type DivisionRoundTournament = 'grand-tournament' | 'rift-raid';

export const DIVISION_ROUND_EVENT_IDS: Record<DivisionRoundTournament, number> = {
  'grand-tournament': 129,
  'rift-raid': 133,
};
export const DIVISION_ROUND_BRIDGE_HOST = process.env.DIVISION_ROUND_BRIDGE_HOST || 'http://empire-api-realtime:3000';
export const DIVISION_ROUND_MAX_ACCOUNTS = 6;

const REFERENCE_SERVERS: Record<DivisionRoundGame, readonly string[]> = {
  ep: ['PT1', 'CZ1', 'INT3'],
  e4k: ['E4K_FR1', 'E4K_DE2'],
};
const UNIVERSE_KINDS: Record<DivisionRoundGame, ReadonlySet<string>> = {
  ep: new Set(['ep', 'partner']),
  e4k: new Set(['e4k']),
};

export interface DivisionRoundSighting {
  divisionRoundId: number;
  server: string;
}

export function readDivisionRoundId(seiContent: unknown, eventId: number): number | null {
  const events = (seiContent as { E?: unknown })?.E;
  if (!Array.isArray(events)) return null;
  const event = events.find((entry) => Number(entry?.EID) === eventId);
  const divisionRoundId = Number(event?.DRI);
  return Number.isInteger(divisionRoundId) ? divisionRoundId : null;
}

export function divisionRoundAccounts(game: DivisionRoundGame, servers: ScrapingServer[]): ScrapingServer[] {
  const universe = servers.filter((server) => UNIVERSE_KINDS[game].has(server.kind) && server.zone !== '');
  const references = REFERENCE_SERVERS[game];
  const preferred = references
    .map((name) => universe.find((server) => server.server === name))
    .filter((server): server is ScrapingServer => server !== undefined);
  const others = universe.filter((server) => !references.includes(server.server));
  return [...preferred, ...others].slice(0, DIVISION_ROUND_MAX_ACCOUNTS);
}

export async function findDivisionRound(
  game: DivisionRoundGame,
  eventId: number,
  servers: ScrapingServer[],
  get: (url: string) => Promise<{ data: any }>,
  bridgeHost: string = DIVISION_ROUND_BRIDGE_HOST,
): Promise<DivisionRoundSighting | null> {
  for (const account of divisionRoundAccounts(game, servers)) {
    try {
      const response = await get(`${bridgeHost}/${account.zone}/sei/null`);
      const divisionRoundId = readDivisionRoundId(response?.data?.content, eventId);
      if (divisionRoundId !== null) return { divisionRoundId, server: account.server };
    } catch {
      continue;
    }
  }
  return null;
}

export const KNOWN_DIVISION_ROUNDS_KEY = 'division-rounds:known';

export function isKnownDivisionRound(published: string | null, game: DivisionRoundGame, id: number): boolean | null {
  if (!published) return null;
  try {
    const known = (JSON.parse(published) as Partial<Record<DivisionRoundGame, unknown>>)[game];
    return Array.isArray(known) ? known.map(Number).includes(id) : null;
  } catch {
    return null;
  }
}
