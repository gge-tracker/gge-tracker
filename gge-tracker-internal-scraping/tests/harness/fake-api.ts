//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
import { RankingFixture, RankingRow } from './fixture-types';

export interface ApiRequest {
  command: string;
  parameters: Record<string, string | number>;
  url: string;
}

export type ApiHandler = (request: ApiRequest, callIndex: number) => unknown;

export class FakeGameApi {
  private readonly handlers = new Map<string, ApiHandler>();
  private readonly counters = new Map<string, number>();

  public readonly requests: ApiRequest[] = [];

  constructor(private readonly baseUrl: string) {}

  public on(command: string, handler: ApiHandler): this {
    this.handlers.set(command, handler);
    return this;
  }

  public serveRanking(...fixtures: RankingFixture[]): this {
    const byKey = new Map(fixtures.map((fixture) => [`${fixture.lt}/${fixture.lid}`, fixture]));
    return this.on('hgh', (request) => {
      const fixture = byKey.get(`${Number(request.parameters.LT)}/${Number(request.parameters.LID)}`);
      if (!fixture) return emptyRanking(request);
      return rankingResponse(fixture, Number(request.parameters.SV));
    });
  }

  public callsFor(command: string): ApiRequest[] {
    return this.requests.filter((request) => request.command === command);
  }

  public svSequence(command = 'hgh'): number[] {
    return this.callsFor(command).map((request) => Number(request.parameters.SV));
  }

  public handles(url: string): boolean {
    return url.startsWith(this.baseUrl);
  }

  public get(url: string): { status: number; data: unknown } {
    const request = this.parse(url);
    this.requests.push(request);
    const handler = this.handlers.get(request.command);
    const callIndex = this.counters.get(request.command) ?? 0;
    this.counters.set(request.command, callIndex + 1);
    if (!handler) return { status: 200, data: unknownCommand(request) };
    return { status: 200, data: handler(request, callIndex) };
  }

  private parse(url: string): ApiRequest {
    const rest = decodeURI(url.slice(this.baseUrl.length));
    const separator = rest.indexOf('/');
    const command = separator === -1 ? rest : rest.slice(0, separator);
    const raw = separator === -1 ? '' : rest.slice(separator + 1);
    let parameters: Record<string, string | number> = {};
    if (raw && raw !== 'null') {
      parameters = JSON.parse(`{${raw}}`);
    }
    return { command, parameters, url };
  }
}

export function rankingWindow(rows: RankingRow[], pageSize: number, totalRanked: number, sv: number): RankingRow[] {
  if (rows.length === 0 || pageSize === 0) return [];
  const lastStart = Math.max(1, totalRanked - pageSize + 1);
  const start = Math.min(Math.max(sv - Math.floor((pageSize - 1) / 2), 1), lastStart);
  return rows.filter((row) => row[0] >= start && row[0] < start + pageSize);
}

export function rankingResponse(fixture: RankingFixture, sv: number): Record<string, unknown> {
  if (fixture.rawResponse) return fixture.rawResponse;
  return {
    server: 'TEST',
    command: 'hgh',
    return_code: 0,
    content: {
      LT: fixture.lt,
      LID: fixture.lid,
      L: rankingWindow(fixture.rows, fixture.pageSize, fixture.totalRanked, sv),
      LR: fixture.totalRanked,
      SV: String(sv),
      FR: fixture.fr,
      IGH: fixture.igh,
    },
  };
}

export function emptyRanking(request: ApiRequest): Record<string, unknown> {
  return {
    server: 'TEST',
    command: 'hgh',
    return_code: 0,
    content: {
      LT: Number(request.parameters.LT),
      LID: Number(request.parameters.LID),
      L: [],
      LR: 0,
      SV: String(request.parameters.SV ?? ''),
      FR: 1,
      IGH: 0,
    },
  };
}

export function timeout(command: string): Record<string, unknown> {
  return { error: 'Timeout', server: 'TEST', command, response_headers: {}, return_code: -1 };
}

function unknownCommand(request: ApiRequest): Record<string, unknown> {
  return timeout(request.command);
}

export const STORM_FORT_OBJECT = 25;
export const STORM_ISLE_OBJECT = 24;
export const STORM_BORDER_OBJECT = 31;

export function stormArea(objects: unknown[][]): Record<string, unknown> {
  return { return_code: '0', content: { AI: objects } };
}

export function stormFort(x: number, y: number, { locked = false } = {}): unknown[] {
  return [STORM_FORT_OBJECT, x, y, 0, 0, 1, 0, 3, locked ? 1 : 0];
}

export function stormIsle(x: number, y: number, occupierId = 0): unknown[] {
  return [STORM_ISLE_OBJECT, x, y, 900, occupierId, 0, 0, 0, 2, 0];
}

export interface OwnCastle {
  kid: number;
  x?: number;
  y?: number;
  objectId?: number;
}

export function ownCastles(castles: OwnCastle[]): Record<string, unknown> {
  return {
    return_code: 0,
    content: {
      gcl: {
        C: castles.map((castle) => ({
          KID: castle.kid,
          AI: [
            {
              AI: [
                12,
                castle.x ?? 0,
                castle.y ?? 0,
                castle.objectId ?? 0,
                SCRAPER_PLAYER_ID,
                1,
                2,
                2,
                2,
                0,
                'SCRAPER',
                0,
                0,
                -1,
                -1,
                -1,
                castle.kid,
                0,
                [],
                0,
              ],
            },
          ],
        })),
      },
    },
  };
}

export const SCRAPER_PLAYER_ID = 5500473;

export function ownPlayerInfo(playerId = SCRAPER_PLAYER_ID): Record<string, unknown> {
  return { return_code: 0, content: { UID: 10_422, PID: playerId, PN: 'SCRAPER' } };
}
