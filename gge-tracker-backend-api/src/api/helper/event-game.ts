import * as express from 'express';
import * as pg from 'pg';
import { GgeTrackerServersEnum } from '../enums/gge-tracker-servers.enums';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { IApiToken } from '../interfaces/interfaces';
import { ApiHelper } from './api-helper';
import { RankingGame, RankingUniverse } from './ranking-universe';

export type EventGame = RankingGame;

const EVENTS_SERVER: Record<EventGame, GgeTrackerServersEnum> = {
  ep: GgeTrackerServersEnum.FR1,
  e4k: GgeTrackerServersEnum.E4K_FR1,
};

const TEMPORARY_SERVER_ID_KEYS: Record<EventGame, string> = {
  ep: 'temporaryServerData',
  e4k: 'temporaryServerData:e4k',
};

const LIVE_RANKING_TABLES: Record<EventGame, string> = {
  ep: 'ggetracker_global.outer_realms_ranking',
  e4k: 'ggetracker_global.outer_realms_ranking_e4k',
};

export abstract class EventGames {
  public static readonly ALL: readonly EventGame[] = ['ep', 'e4k'];

  public static parse(raw: unknown): EventGame | null {
    if (raw === undefined || raw === '') return 'ep';
    return EventGames.ALL.find((game) => game === raw) ?? null;
  }

  public static fromRequest(request: express.Request, response: express.Response): EventGame | null {
    const game = EventGames.parse(request.query.game);
    if (game === null) {
      response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidEventGame });
    }
    return game;
  }

  public static pool(game: EventGame): pg.Pool | null {
    return ApiHelper.ggeTrackerManager.getPgSqlPool(EVENTS_SERVER[game]);
  }

  public static ofPlayerCode(code: string): EventGame {
    const serverName = ApiHelper.ggeTrackerManager.getServerNameFromCode(code);
    return serverName ? RankingUniverse.gameOfServerName(serverName) : 'ep';
  }

  public static liveRankingTable(game: EventGame): string {
    return LIVE_RANKING_TABLES[game];
  }

  public static temporaryServerIdKey(game: EventGame): string {
    return TEMPORARY_SERVER_ID_KEYS[game];
  }

  public static serverOfSuffix(suffix: string, game: EventGame): IApiToken | null {
    const manager = ApiHelper.ggeTrackerManager;
    if (game === 'ep') return manager.getOuterServer(suffix as GgeTrackerServersEnum);
    const epName = manager.getServerNameByOuterName(suffix);
    const code = manager.getServerCodeByName(`E4K_${epName ?? suffix}`);
    return code ? manager.getServerByCode(code) : null;
  }

  public static keySuffix(game: EventGame): string {
    return game === 'ep' ? '' : `:${game}`;
  }
}
