import { ApiHelper } from './api-helper';
import { IServerDefinition } from '../interfaces/interfaces';

export type RankingGame = 'ep' | 'e4k';

interface RankingOrigin {
  game: RankingGame;
  serverId: number;
  server: IServerDefinition;
}

export abstract class RankingUniverse {
  private static readonly ZONE = /^(.*?)(?:_(\d+))?$/;

  public static gameOf(server: IServerDefinition | null): RankingGame {
    return server?.kind === 'e4k' ? 'e4k' : 'ep';
  }

  public static gameOfServerName(serverName: string): RankingGame {
    return RankingUniverse.gameOf(ApiHelper.ggeTrackerManager.getServerDefinition(serverName));
  }

  public static serversOf(game: RankingGame): Map<number, IServerDefinition> {
    const entries = new Map<number, IServerDefinition>();
    const family = RankingUniverse.familyOf(game);
    if (family === null) return entries;
    for (const server of ApiHelper.ggeTrackerManager.getPublicServerDefinitions()) {
      const zone = RankingUniverse.splitZone(server.zone);
      if (RankingUniverse.gameOf(server) === game && zone.family === family) {
        entries.set(zone.serverId, server);
      }
    }
    return entries;
  }

  public static originOf(code: string): RankingOrigin | null {
    const server = ApiHelper.ggeTrackerManager
      .getPublicServerDefinitions()
      .find((definition) => definition.code === code);
    if (!server) return null;
    const game = RankingUniverse.gameOf(server);
    const { family, serverId } = RankingUniverse.splitZone(server.zone);
    if (family !== RankingUniverse.familyOf(game)) return null;
    return { game, serverId, server };
  }

  private static familyOf(game: RankingGame): string | null {
    for (const server of ApiHelper.ggeTrackerManager.getPublicServerDefinitions()) {
      const zone = RankingUniverse.splitZone(server.zone);
      if (server.kind === game && zone.serverId === 1) return zone.family;
    }
    return null;
  }

  private static splitZone(zone: string): { family: string; serverId: number } {
    const match = RankingUniverse.ZONE.exec(zone);
    return { family: match?.[1] ?? zone, serverId: match?.[2] ? Number(match[2]) : 1 };
  }
}
